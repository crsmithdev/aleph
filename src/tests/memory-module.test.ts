#!/usr/bin/env bun
import { mkdtempSync, writeFileSync, rmSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { check, createResults, printAndExit } from "../eval/harness.ts";
import { parseTranscript } from "../memory/parse-transcript.ts";
import {
  CORRECTION_RE,
  POSITIVE_FEEDBACK_RE,
  POSITIVE_STANDALONE_RE,
  deriveIntentOutcome,
  hasMemoryStore,
  extractMemories,
} from "../memory/extract.ts";
import {
  ruleFingerprint,
  tokenize,
  jaccard,
  similarity,
  parseRuleLine,
  effectivenessScore,
} from "../memory/rule-fingerprint.ts";
import type { TranscriptSummary, ParsedMessage } from "../memory/parse-transcript.ts";
import type { EffectivenessRow } from "../memory/rule-fingerprint.ts";

console.log("[verify]");
console.log("scope: src/memory/parse-transcript.ts, src/memory/extract.ts, src/memory/rule-fingerprint.ts");
console.log("method: invoke each exported pure function with synthetic inputs; use real temp files for parseTranscript; assert return values via check()");
console.log("assertions: null returns for bad paths, correct field population, regex matching, pure-function correctness");
console.log("[/verify]");

const r = createResults();

// ── helpers ──────────────────────────────────────────────────────────────────

function makeTmpDir(): string {
  return mkdtempSync(join(tmpdir(), "memory-test-"));
}

function writeTmpTranscript(dir: string, lines: object[]): string {
  const path = join(dir, "transcript.jsonl");
  writeFileSync(path, lines.map(l => JSON.stringify(l)).join("\n"));
  return path;
}

function userLine(text: string) {
  return { type: "user", message: { role: "user", content: [{ type: "text", text }] } };
}

function assistantLine(toolName: string, input: Record<string, any> = {}) {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "tool_use", name: toolName, input }] } };
}

function assistantTextLine(text: string) {
  return { type: "assistant", message: { role: "assistant", content: [{ type: "text", text }] } };
}

function mockSummary(overrides: Partial<TranscriptSummary> = {}): TranscriptSummary {
  return {
    messages: [],
    toolCounts: {},
    editedFiles: new Set<string>(),
    firstUserText: "implement the feature",
    userTexts: ["implement the feature"],
    assistantTexts: [],
    totalMessages: 0,
    ...overrides,
  };
}

// ── parseTranscript ───────────────────────────────────────────────────────────
console.log("--- parseTranscript ---");

check(r, "returns null for nonexistent path",
  parseTranscript("/tmp/no-such-file-xyzzy-12345.jsonl") === null);

check(r, "returns null for empty string path",
  parseTranscript("") === null);

{
  const dir = makeTmpDir();
  try {
    const path = writeTmpTranscript(dir, [
      userLine("hello world from the user"),
      userLine("second user message here"),
    ]);
    const result = parseTranscript(path);
    check(r, "parses user messages and populates firstUserText",
      result !== null && result.firstUserText === "hello world from the user");
    check(r, "parses user messages and populates userTexts array",
      result !== null && result.userTexts.length === 2 && result.userTexts[1] === "second user message here");
  } finally {
    rmSync(dir, { recursive: true });
  }
}

{
  const dir = makeTmpDir();
  try {
    const path = writeTmpTranscript(dir, [
      userLine("edit this file please"),
      assistantLine("Edit", { file_path: "src/foo/bar.ts" }),
      assistantLine("Write", { file_path: "src/baz/qux.ts" }),
      assistantLine("Bash", { command: "bun test" }),
    ]);
    const result = parseTranscript(path);
    check(r, "populates toolCounts for tool_use blocks",
      result !== null
        && result.toolCounts["Edit"] === 1
        && result.toolCounts["Write"] === 1
        && result.toolCounts["Bash"] === 1);
    check(r, "populates editedFiles for Edit and Write tool uses",
      result !== null
        && result.editedFiles.has("foo/bar.ts")
        && result.editedFiles.has("baz/qux.ts")
        && !result.editedFiles.has("bun test"));
  } finally {
    rmSync(dir, { recursive: true });
  }
}

{
  const dir = makeTmpDir();
  try {
    // Mix valid lines with corrupt/malformed ones
    const path = join(dir, "transcript.jsonl");
    writeFileSync(path, [
      JSON.stringify(userLine("valid message")),
      "this is not json at all {{{",
      '{"broken": true',
      JSON.stringify(userLine("another valid one")),
    ].join("\n"));
    const result = parseTranscript(path);
    check(r, "skips malformed JSONL lines gracefully",
      result !== null && result.userTexts.length === 2);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

{
  const dir = makeTmpDir();
  try {
    const longText = "a".repeat(500);
    const path = writeTmpTranscript(dir, [userLine(longText)]);
    const result = parseTranscript(path, { textLimit: 50 });
    check(r, "respects textLimit option — truncates text blocks",
      result !== null && result.userTexts[0].length <= 50);
  } finally {
    rmSync(dir, { recursive: true });
  }
}

{
  const dir = makeTmpDir();
  try {
    // Lines with non-user/assistant types should be ignored
    const path = join(dir, "transcript.jsonl");
    writeFileSync(path, [
      JSON.stringify({ type: "system", message: { content: [{ type: "text", text: "system msg" }] } }),
      JSON.stringify({ type: "progress", message: { content: [] } }),
      JSON.stringify(userLine("only real user text")),
    ].join("\n"));
    const result = parseTranscript(path);
    check(r, "ignores system and progress lines",
      result !== null && result.userTexts.length === 1 && result.firstUserText === "only real user text");
  } finally {
    rmSync(dir, { recursive: true });
  }
}

// ── CORRECTION_RE ─────────────────────────────────────────────────────────────
console.log("--- CORRECTION_RE ---");

check(r, "matches 'no, ' prefix", CORRECTION_RE.test("no, don't do it that way"));
check(r, "matches 'don't'", CORRECTION_RE.test("don't do that"));
check(r, "matches 'dont' (no apostrophe)", CORRECTION_RE.test("dont do that"));
check(r, "matches 'stop' at word boundary", CORRECTION_RE.test("stop that"));
check(r, "matches 'wrong' at word boundary", CORRECTION_RE.test("wrong approach"));
check(r, "matches 'actually,' prefix", CORRECTION_RE.test("actually, use the other pattern"));
check(r, "matches 'wait,' prefix", CORRECTION_RE.test("wait, that's not right"));
check(r, "matches 'revert'", CORRECTION_RE.test("revert that change"));
check(r, "matches 'undo'", CORRECTION_RE.test("undo the last edit"));
check(r, "does NOT match 'now do X'", !CORRECTION_RE.test("now do the next step"));
check(r, "does NOT match plain affirmative", !CORRECTION_RE.test("looks good to me"));

// ── POSITIVE_FEEDBACK_RE ──────────────────────────────────────────────────────
console.log("--- POSITIVE_FEEDBACK_RE ---");

check(r, "matches 'great'", POSITIVE_FEEDBACK_RE.test("great job on that"));
check(r, "matches 'perfect'", POSITIVE_FEEDBACK_RE.test("perfect, now do the next thing"));
check(r, "matches 'exactly'", POSITIVE_FEEDBACK_RE.test("exactly what I wanted"));
check(r, "matches 'excellent'", POSITIVE_FEEDBACK_RE.test("excellent work"));
check(r, "matches 'awesome'", POSITIVE_FEEDBACK_RE.test("awesome"));
check(r, "matches 'looks good'", POSITIVE_FEEDBACK_RE.test("looks good to me"));
check(r, "matches 'thanks'", POSITIVE_FEEDBACK_RE.test("thanks"));
check(r, "does NOT match 'now' at start", !POSITIVE_FEEDBACK_RE.test("now do the next step"));
check(r, "does NOT match mid-sentence positive", !POSITIVE_FEEDBACK_RE.test("that was great"));

// ── POSITIVE_STANDALONE_RE ────────────────────────────────────────────────────
console.log("--- POSITIVE_STANDALONE_RE ---");

check(r, "does NOT match 'yes' alone (ambiguous)", !POSITIVE_STANDALONE_RE.test("yes"));
check(r, "does NOT match 'yes!'", !POSITIVE_STANDALONE_RE.test("yes!"));
check(r, "matches 'good'", POSITIVE_STANDALONE_RE.test("good"));
check(r, "does NOT match 'ok' (ambiguous)", !POSITIVE_STANDALONE_RE.test("ok"));
check(r, "does NOT match 'okay' (ambiguous)", !POSITIVE_STANDALONE_RE.test("okay"));
check(r, "matches 'works'", POSITIVE_STANDALONE_RE.test("works"));
check(r, "does NOT match 'hello'", !POSITIVE_STANDALONE_RE.test("hello"));
check(r, "does NOT match 'yes please do X'", !POSITIVE_STANDALONE_RE.test("yes please do X"));

// ── deriveIntentOutcome ───────────────────────────────────────────────────────
console.log("--- deriveIntentOutcome ---");

{
  const s = mockSummary({ firstUserText: "add the login button", userTexts: ["add the login button"] });
  const { intent, outcome } = deriveIntentOutcome(s);
  check(r, "intent equals firstUserText",
    intent === "add the login button");
  check(r, "outcome equals intent when only one user message",
    outcome === "add the login button");
}

{
  const s = mockSummary({
    firstUserText: "refactor the auth module",
    userTexts: ["refactor the auth module", "now update the tests too", "looks good ship it"],
  });
  const { intent, outcome } = deriveIntentOutcome(s);
  check(r, "intent is firstUserText",
    intent === "refactor the auth module");
  check(r, "outcome is last userText when multiple exist",
    outcome === "looks good ship it");
}

{
  const s = mockSummary({ firstUserText: "", userTexts: [] });
  const { intent } = deriveIntentOutcome(s);
  check(r, "intent falls back to 'unknown task' when firstUserText is empty",
    intent === "unknown task");
}

// ── hasMemoryStore ────────────────────────────────────────────────────────────
console.log("--- hasMemoryStore ---");

{
  const msg: ParsedMessage = { role: "assistant", text: "", toolUses: ["memory_store"], toolInputs: [{}] };
  const s = mockSummary({ messages: [msg] });
  check(r, "returns true when assistant used memory_store",
    hasMemoryStore(s) === true);
}

{
  const msg: ParsedMessage = { role: "assistant", text: "", toolUses: ["Bash", "Edit"], toolInputs: [{}, {}] };
  const s = mockSummary({ messages: [msg] });
  check(r, "returns false when memory_store not in toolUses",
    hasMemoryStore(s) === false);
}

{
  // memory_store on user role should NOT count
  const msg: ParsedMessage = { role: "user", text: "", toolUses: ["memory_store"], toolInputs: [{}] };
  const s = mockSummary({ messages: [msg] });
  check(r, "ignores memory_store on user messages",
    hasMemoryStore(s) === false);
}

{
  const s = mockSummary({ messages: [] });
  check(r, "returns false for empty messages",
    hasMemoryStore(s) === false);
}

// ── extractMemories ───────────────────────────────────────────────────────────
console.log("--- extractMemories ---");

{
  const s = mockSummary({
    firstUserText: "build the feature",
    userTexts: ["build the feature", "done, ship it"],
    editedFiles: new Set(["src/foo.ts"]),
  });
  const memories = extractMemories(s);
  check(r, "returns a non-empty array",
    Array.isArray(memories) && memories.length > 0);
  check(r, "first entry is session summary with correct tags",
    memories[0]?.tags.includes("session_context") && memories[0]?.memory_type === "observation");
  check(r, "session summary content includes intent arrow outcome",
    memories[0]?.content.includes("build the feature") && memories[0]?.content.includes("→"));
}

{
  const correction: ParsedMessage = { role: "user", text: "no, use a different approach", toolUses: [], toolInputs: [] };
  const s = mockSummary({
    firstUserText: "do the task",
    userTexts: ["do the task", "no, use a different approach"],
    messages: [correction],
  });
  const memories = extractMemories(s);
  const correctionMemory = memories.find(m => m.tags.includes("preference"));
  check(r, "extracts correction memory when user corrects",
    correctionMemory !== undefined && correctionMemory.content.includes("no, use a different approach"));
}

// ── ruleFingerprint ───────────────────────────────────────────────────────────
console.log("--- ruleFingerprint ---");

check(r, "returns a 10-char hex string",
  /^[0-9a-f]{10}$/.test(ruleFingerprint("some rule text")));

check(r, "same text produces the same fingerprint",
  ruleFingerprint("use real db not mocks") === ruleFingerprint("use real db not mocks"));

check(r, "different text produces different fingerprint",
  ruleFingerprint("use real db not mocks") !== ruleFingerprint("use fake db always"));

check(r, "normalizes case — same fingerprint regardless of case",
  ruleFingerprint("Use Real DB Not Mocks") === ruleFingerprint("use real db not mocks"));

check(r, "normalizes punctuation",
  ruleFingerprint("use real db, not mocks!") === ruleFingerprint("use real db  not mocks"));

// ── tokenize ──────────────────────────────────────────────────────────────────
console.log("--- tokenize ---");

{
  const tokens = tokenize("use real database not mocks");
  check(r, "tokenize returns a Set of lowercased tokens",
    tokens instanceof Set && tokens.has("real") && tokens.has("database") && tokens.has("mocks"));
  check(r, "tokenize filters words <= 3 chars",
    !tokens.has("not") && !tokens.has("use"));
}

{
  const tokens = tokenize("the and for with from that this");
  check(r, "tokenize removes stopwords",
    tokens.size === 0);
}

// ── jaccard ───────────────────────────────────────────────────────────────────
console.log("--- jaccard ---");

check(r, "identical sets → 1.0",
  jaccard(new Set(["a", "b", "c"]), new Set(["a", "b", "c"])) === 1.0);

check(r, "disjoint sets → 0.0",
  jaccard(new Set(["a", "b"]), new Set(["c", "d"])) === 0.0);

check(r, "empty sets → 0.0",
  jaccard(new Set(), new Set()) === 0.0);

{
  const score = jaccard(new Set(["a", "b", "c"]), new Set(["a", "b", "d"]));
  check(r, "partial overlap → fractional value between 0 and 1",
    score > 0 && score < 1);
}

// ── similarity ────────────────────────────────────────────────────────────────
console.log("--- similarity ---");

check(r, "identical strings → 1.0",
  similarity("use real database for testing", "use real database for testing") === 1.0);

check(r, "completely different strings → 0.0 or very low",
  similarity("banana pineapple mango tropical fruit", "typescript compiler webpack bundler") <= 0.1);

{
  const s = similarity("avoid using mocks in tests", "avoid using stubs in tests");
  check(r, "similar strings → value between 0 and 1",
    s > 0 && s < 1);
}

// ── parseRuleLine ─────────────────────────────────────────────────────────────
console.log("--- parseRuleLine ---");

{
  const result = parseRuleLine("- [avoid] use real db not mocks _(3x)_");
  check(r, "parses avoid tag and strips count suffix",
    result !== null && result.polarity === "avoid" && result.text === "use real db not mocks");
}

{
  const result = parseRuleLine("- [keep] verify with bun test.ts");
  check(r, "parses keep tag as validated polarity",
    result !== null && result.polarity === "validated" && result.text === "verify with bun test.ts");
}

{
  const result = parseRuleLine("- some text without tag");
  check(r, "parses plain line with null polarity",
    result !== null && result.polarity === null && result.text === "some text without tag");
}

{
  const result = parseRuleLine("- hi");
  check(r, "returns null for text shorter than 5 chars",
    result === null);
}

{
  const result = parseRuleLine("- [avoid] x");
  check(r, "returns null when body after tag is too short",
    result === null);
}

// ── effectivenessScore ────────────────────────────────────────────────────────
console.log("--- effectivenessScore ---");

{
  const row: EffectivenessRow = {
    text: "test rule", polarity: "avoid",
    first_seen: "2024-01-01", last_seen: "2024-01-10",
    injections: 0, recurrences: 0, reaffirmations: 0,
  };
  check(r, "returns null when injections === 0",
    effectivenessScore(row) === null);
}

{
  const row: EffectivenessRow = {
    text: "test rule", polarity: "avoid",
    first_seen: "2024-01-01", last_seen: "2024-01-10",
    injections: 5, recurrences: 0, reaffirmations: 0,
  };
  check(r, "avoid rule with zero recurrences → score 1.0",
    effectivenessScore(row) === 1.0);
}

{
  const row: EffectivenessRow = {
    text: "test rule", polarity: "avoid",
    first_seen: "2024-01-01", last_seen: "2024-01-10",
    injections: 4, recurrences: 4, reaffirmations: 0,
  };
  check(r, "avoid rule with 100% recurrence → score 0.0",
    effectivenessScore(row) === 0.0);
}

{
  const row: EffectivenessRow = {
    text: "test rule", polarity: "validated",
    first_seen: "2024-01-01", last_seen: "2024-01-10",
    injections: 4, recurrences: 0, reaffirmations: 4,
  };
  check(r, "validated rule with 100% reaffirmations → score 1.0",
    effectivenessScore(row) === 1.0);
}

{
  const row: EffectivenessRow = {
    text: "test rule", polarity: "validated",
    first_seen: "2024-01-01", last_seen: "2024-01-10",
    injections: 4, recurrences: 0, reaffirmations: 2,
  };
  check(r, "validated rule with 50% reaffirmations → score 0.5",
    effectivenessScore(row) === 0.5);
}

// ── memory-extract-stop.ts hook behavioral tests ───────────────────────────────
//
// These tests cover the three root causes we fixed when sessions weren't
// appearing in the Learning Loop:
//
//   Bug 1: hasMemoryStore() was used as a gate — any session where Claude
//           called memory_store would be skipped entirely, which meant every
//           session was skipped because CLAUDE.md instructs routine memory_store
//           use. Fix: removed the gate; the function is kept but no longer called
//           from the hook.
//
//   Bug 2: memory-writer.py used getattr(result, 'id', None) on a dict —
//           store_memory returns a dict, not an object, so the id was always None
//           and no provenance was written. Fix: use result.get('memory', {}).get('content_hash').
//
//   Bug 3: memory-writer.py only wrote provenance for newly-stored memories,
//           not for deduped ones. Dedup = session already stored via memory_store
//           MCP, so the Learning Loop never logged those sessions either.
//           Fix: write provenance even for duplicates (with "duplicate": true).
//
// Tests here cover Bug 1 (hook-level, testable without Python) and confirm
// hasMemoryStore() still works correctly as a pure function (unchanged contract).

console.log("--- memory-extract-stop hook behavioral ---");

import { createTestEnv, cleanupTestEnv, runHook, writeTranscript, userMsg, assistantMsg } from "../eval/harness.ts";

const te = createTestEnv("memory-extract");

const EXTRACT_HOOK = "memory/hooks/memory-extract-stop.ts";

// Helper: build a substantive transcript (>= 6 messages, >= 1 edit)
function makeSubstantiveTranscript(
  te: ReturnType<typeof createTestEnv>,
  name: string,
  opts: { withMemoryStore?: boolean } = {}
): string {
  const lines = [
    userMsg("implement the feature"),
    assistantMsg("Starting work.", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    userMsg("looks good, keep going"),
    assistantMsg("Continuing.", [{ name: "Edit", input: { file_path: "/src/bar.ts" } }]),
    userMsg("great, almost there"),
    assistantMsg("Done.", opts.withMemoryStore
      ? [{ name: "mcp__memory__memory_store", input: { content: "user prefers small commits" } }]
      : [{ name: "Bash", input: { command: "bun test" } }]
    ),
    userMsg("ship it"),
  ];
  return writeTranscript(te, name, lines);
}

// Non-substantive: too few messages, no edits → should skip
{
  const tPath = writeTranscript(te, "tiny", [
    userMsg("do the thing"),
    assistantMsg("ok", []),
  ]);
  const result = runHook(te, EXTRACT_HOOK, JSON.stringify({
    session_id: "test-tiny",
    transcript_path: tPath,
  }));
  check(r, "non-substantive (2 msgs, 0 edits): exits 0 silently", result.exitCode === 0);
}

// Substantive without memory_store: should proceed to extraction (may spawn writer)
{
  const tPath = makeSubstantiveTranscript(te, "no-mstore", { withMemoryStore: false });
  const result = runHook(te, EXTRACT_HOOK, JSON.stringify({
    session_id: "test-no-mstore",
    transcript_path: tPath,
  }));
  check(r, "substantive (no memory_store): exits 0", result.exitCode === 0);
}

// Substantive WITH memory_store: must NOT skip (Bug 1 fix)
// Before the fix, this session would be silently skipped. After the fix,
// the hook proceeds to extraction regardless.
{
  const tPath = makeSubstantiveTranscript(te, "with-mstore", { withMemoryStore: true });
  const result = runHook(te, EXTRACT_HOOK, JSON.stringify({
    session_id: "test-with-mstore",
    transcript_path: tPath,
  }));
  check(r, "substantive (WITH memory_store): exits 0 — not skipped (Bug 1 fix)", result.exitCode === 0);
  // The hook should NOT emit a "skip: Claude already called memory_store" trace.
  // We can verify there's no such skip by enabling tracing and checking output.
}

// Tracing verification: with memory_store present, old skip trace should NOT appear
{
  const { writeFileSync, unlinkSync } = await import("fs");
  const { resolve } = await import("path");
  const traceFile = resolve(te.root, "src/.trace");
  writeFileSync(traceFile, "");

  const tPath = makeSubstantiveTranscript(te, "trace-mstore", { withMemoryStore: true });
  const result = runHook(te, EXTRACT_HOOK, JSON.stringify({
    session_id: "test-trace-mstore",
    transcript_path: tPath,
  }));

  try { unlinkSync(traceFile); } catch {}

  check(r, "memory_store in transcript: trace does NOT contain old skip message",
    !result.trace.includes("skip: Claude already called memory_store"));
  check(r, "memory_store in transcript: hook still exits 0",
    result.exitCode === 0);
}

// Missing transcript path → graceful skip
{
  const result = runHook(te, EXTRACT_HOOK, JSON.stringify({
    session_id: "test-missing",
    transcript_path: "/tmp/this-does-not-exist-xyzzy.jsonl",
  }));
  check(r, "missing transcript path: exits 0", result.exitCode === 0);
}

// Malformed stdin → exits 0 (advisory — must never block)
{
  const result = runHook(te, EXTRACT_HOOK, "not valid json {{{{");
  check(r, "malformed stdin: exits 0", result.exitCode === 0);
}

// ── hasMemoryStore function contract (unchanged, still exported) ───────────────

console.log("--- hasMemoryStore (still exported, no longer a gate) ---");

// The function contract hasn't changed even though it's no longer used
// as a gate in the hook. These verify the function itself is correct.

{
  // mcp__memory__memory_store (the actual MCP tool name) must match
  const msg: ParsedMessage = { role: "assistant", text: "", toolUses: ["mcp__memory__memory_store"], toolInputs: [{}] };
  const s = mockSummary({ messages: [msg] });
  check(r, "hasMemoryStore: matches mcp__memory__memory_store",
    hasMemoryStore(s) === true);
}

{
  // Short form used in tests also matches
  const msg: ParsedMessage = { role: "assistant", text: "", toolUses: ["memory_store"], toolInputs: [{}] };
  const s = mockSummary({ messages: [msg] });
  check(r, "hasMemoryStore: matches short 'memory_store'",
    hasMemoryStore(s) === true);
}

{
  // Non-memory tools do not match
  const msg: ParsedMessage = { role: "assistant", text: "", toolUses: ["Bash", "Edit", "Read"], toolInputs: [{}, {}, {}] };
  const s = mockSummary({ messages: [msg] });
  check(r, "hasMemoryStore: false for non-memory tools",
    hasMemoryStore(s) === false);
}

cleanupTestEnv(te);

printAndExit(r);
