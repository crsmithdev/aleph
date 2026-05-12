#!/usr/bin/env bun
import { readFileSync, writeFileSync, readdirSync, unlinkSync, existsSync } from "fs";
import { resolve } from "path";
import {
  createTestEnv, cleanupTestEnv, runHook, check, checkInfo, runAndCheck,
  createResults, printAndExit, userMsg, assistantMsg, writeTranscript,
} from "../eval/harness.ts";

const te = createTestEnv("memory");
const r = createResults();
const sessionsDir = resolve(te.tmpBase, "sessions");
import { mkdirSync } from "fs";
mkdirSync(sessionsDir, { recursive: true });

const ratingsFile = resolve(te.tmpBase, "ratings.jsonl");
te.env.RATINGS_FILE = ratingsFile;

const feedbackFile = resolve(te.tmpBase, "feedback.jsonl");
te.env.FEEDBACK_FILE = feedbackFile;

// ── Session start ────────────────────────────────────────────────────────────

console.log("--- context-restore-start ---");
runAndCheck(te, r, "memory/hooks/context-restore-start.ts", "smoke", "{}", { expectStdout: ["Session Start"] });

// Morning briefing: no new sessions since last interactive → no digest
{
  const briefingMarker = resolve(sessionsDir, ".last-briefing");
  try { unlinkSync(briefingMarker); } catch {}
  const futureSession = resolve(sessionsDir, "9998-01-01-000000.md");
  writeFileSync(futureSession, "# Session: 9998-01-01\n\n- Intent: test\n- Outcome: done\n- Tools: none; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");
  writeFileSync(briefingMarker, "9998-01-01-000000.md");
  const { stdout } = runHook(te, "memory/hooks/context-restore-start.ts", "{}");
  check(r, "morning-briefing: no digest when no new sessions", !stdout.includes("Background Work"));
  check(r, "morning-briefing: still shows session count", stdout.includes("Sessions:"));
  check(r, "morning-briefing: still shows last session header", stdout.includes("Last session ("));
  try { unlinkSync(futureSession); } catch {}
  try { unlinkSync(briefingMarker); } catch {}
}

// Morning briefing: multiple new sessions since last interactive → digest shown
{
  const briefingMarker = resolve(sessionsDir, ".last-briefing");
  try { unlinkSync(briefingMarker); } catch {}

  const oldSession = resolve(sessionsDir, "2000-01-01-000000.md");
  writeFileSync(oldSession, "# Session: 2000-01-01\n\n- Intent: old work\n- Outcome: old done\n- Tools: none; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");

  const bgSession1 = resolve(sessionsDir, "2000-01-02-100000.md");
  writeFileSync(bgSession1, "# Session: 2000-01-02\n\n- Intent: fix auth bug\n- Outcome: auth fixed and tests pass\n- Tools: Read, Edit, Bash; files: src/auth.ts\n- Edits: 3 tool calls, 1 files\n- Messages: 6 (3 user, 3 assistant)\n");

  const bgSession2 = resolve(sessionsDir, "2000-01-02-200000.md");
  writeFileSync(bgSession2, "# Session: 2000-01-02\n\n- Intent: refactor parser\n- Outcome: parser refactored but tests pending\n- Tools: Edit, Bash; files: src/parser.ts\n- Edits: 2 tool calls, 1 files\n- Messages: 8 (4 user, 4 assistant)\n- Notes:\n  - Tests are still failing for edge cases\n");

  writeFileSync(briefingMarker, "2000-01-01-000000.md");

  const { stdout } = runHook(te, "memory/hooks/context-restore-start.ts", "{}");

  check(r, "morning-briefing: shows background work header", stdout.includes("Background Work"));
  check(r, "morning-briefing: shows completed work section", stdout.includes("Completed") || stdout.includes("Done"));
  check(r, "morning-briefing: shows in-progress section", stdout.includes("In Progress") || stdout.includes("pending") || stdout.includes("failing"));
  check(r, "morning-briefing: includes session content (auth)", stdout.includes("auth"));
  check(r, "morning-briefing: includes session content (parser)", stdout.includes("parser"));
  check(r, "morning-briefing: still shows Session Start", stdout.includes("Session Start"));
  check(r, "morning-briefing: still shows session count", stdout.includes("Sessions:"));

  try { unlinkSync(oldSession); } catch {}
  try { unlinkSync(bgSession1); } catch {}
  try { unlinkSync(bgSession2); } catch {}
  try { unlinkSync(briefingMarker); } catch {}
}

// Morning briefing: no marker file + multiple sessions → treat all as new
{
  const briefingMarker = resolve(sessionsDir, ".last-briefing");
  try { unlinkSync(briefingMarker); } catch {}

  const s1 = resolve(sessionsDir, "2000-02-01-000000.md");
  const s2 = resolve(sessionsDir, "2000-02-01-010000.md");
  writeFileSync(s1, "# Session: 2000-02-01\n\n- Intent: first session\n- Outcome: done\n- Tools: none; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");
  writeFileSync(s2, "# Session: 2000-02-01\n\n- Intent: second session background task\n- Outcome: completed background work\n- Tools: Bash; files: none\n- Edits: 0 tool calls, 0 files\n- Messages: 4 (2 user, 2 assistant)\n");

  const { stdout } = runHook(te, "memory/hooks/context-restore-start.ts", "{}");
  check(r, "morning-briefing: no marker + multiple sessions shows briefing", stdout.includes("Background Work"));

  try { unlinkSync(s1); } catch {}
  try { unlinkSync(s2); } catch {}
  try { unlinkSync(briefingMarker); } catch {}
}

// ── Rating capture ───────────────────────────────────────────────────────────

console.log("\n--- rating-capture ---");

function ratingTest(prompt: string): { rating: number | null; output: string } {
  let linesBefore = 0;
  try { linesBefore = readFileSync(ratingsFile, "utf-8").trim().split("\n").filter(Boolean).length; } catch {}
  const { stdout } = runHook(te, "memory/hooks/rating-capture-submit.ts", JSON.stringify({ prompt }));
  let linesAfter = 0;
  try { linesAfter = readFileSync(ratingsFile, "utf-8").trim().split("\n").filter(Boolean).length; } catch {}
  if (linesAfter > linesBefore) {
    const last = readFileSync(ratingsFile, "utf-8").trim().split("\n").pop()!;
    return { rating: JSON.parse(last).rating, output: stdout };
  }
  return { rating: null, output: stdout };
}

check(r, "rating: standalone 7", ratingTest("7").rating === 7);
check(r, "rating: standalone 8", ratingTest("8").rating === 8);
check(r, "rating: standalone 10", ratingTest("10").rating === 10);
check(r, "rating: 7/10 pattern", ratingTest("7/10").rating === 7);
check(r, "rating: 'I rate this 9'", ratingTest("I rate this 9").rating === 9);
check(r, "rating: 'rate 6'", ratingTest("rate 6").rating === 6);
check(r, "rating: 'rating: 8'", ratingTest("rating: 8").rating === 8);
check(r, "rating: 'I rated it 10'", ratingTest("I rated it 10").rating === 10);

check(r, "rating: ignores 'hello'", ratingTest("hello world").rating === null);
check(r, "rating: ignores '42'", ratingTest("42").rating === null);
check(r, "rating: ignores 'there are 3 files'", ratingTest("there are 3 files to edit").rating === null);
check(r, "rating: 'deploy to 3 servers' → no match", ratingTest("deploy to 3 servers").rating === null);
check(r, "rating: '8 files changed' → no match", ratingTest("8 files changed in the PR").rating === null);
check(r, "rating: 'rate this' alone → no match", ratingTest("rate this").rating === null);

// False-positive regressions from 2026-05-12: rate-keyword in the middle of prose
check(r, "rating: 'rate-limit ... 2 findings' → no match",
  ratingTest("Excluded: rate-limit / DoS — 2 findings out of scope").rating === null);
check(r, "rating: 'did not intend to rate you 2/5' → no match",
  ratingTest("if it's feedback, that's probably an error on my part, did not intend to rate you 2/5").rating === null);
check(r, "rating: 'the rating system fired 3 times' → no match",
  ratingTest("the rating system fired 3 times today").rating === null);
check(r, "rating: '8/100 not a rating' → no match",
  ratingTest("8/100 score on the eval").rating === null);

// Skip system-event injections (UserPromptSubmit fires on these too)
check(r, "rating: skips <task-notification> prompt",
  ratingTest("<task-notification>\n<task-id>abc</task-id>\nresult contains rate-limit and 2 findings\n</task-notification>").rating === null);
check(r, "rating: skips <system-reminder> prompt",
  ratingTest("<system-reminder>UserPromptSubmit hook success: stuff mentioning rate and 2</system-reminder>").rating === null);

const lowResult = ratingTest("2");
check(r, "rating: low rating warns", lowResult.rating === 2 && lowResult.output.includes("Low rating"));

runAndCheck(te, r, "memory/hooks/rating-capture-submit.ts", "malformed", "not json");

// ── Feedback (sentiment) capture ─────────────────────────────────────────────

console.log("\n--- feedback-capture ---");

function feedbackTest(prompt: string, transcriptPath?: string): { entry: any | null; output: string } {
  let linesBefore = 0;
  try { linesBefore = readFileSync(feedbackFile, "utf-8").trim().split("\n").filter(Boolean).length; } catch {}
  const payload: any = { prompt, session_id: "fb-test" };
  if (transcriptPath) payload.transcript_path = transcriptPath;
  const { stdout } = runHook(te, "memory/hooks/feedback-capture-submit.ts", JSON.stringify(payload));
  let linesAfter = 0;
  try { linesAfter = readFileSync(feedbackFile, "utf-8").trim().split("\n").filter(Boolean).length; } catch {}
  if (linesAfter > linesBefore) {
    const last = readFileSync(feedbackFile, "utf-8").trim().split("\n").pop()!;
    return { entry: JSON.parse(last), output: stdout };
  }
  return { entry: null, output: stdout };
}

// Positive — high-confidence words
check(r, "feedback: 'great' → positive", feedbackTest("great").entry?.polarity === "positive");
check(r, "feedback: 'perfect, now do X' → positive", feedbackTest("perfect, now do X").entry?.polarity === "positive");
check(r, "feedback: 'thanks!' → positive", feedbackTest("thanks!").entry?.polarity === "positive");
check(r, "feedback: 'exactly' → positive", feedbackTest("exactly").entry?.polarity === "positive");
check(r, "feedback: 'looks good' → positive", feedbackTest("looks good").entry?.polarity === "positive");

// Positive — standalone-only words
check(r, "feedback: standalone 'yes' → positive", feedbackTest("yes").entry?.polarity === "positive");
check(r, "feedback: standalone 'good' → positive", feedbackTest("good").entry?.polarity === "positive");
check(r, "feedback: 'yes the file is at /src/foo' → no match (not standalone)",
  feedbackTest("yes the file is at /src/foo").entry === null);
check(r, "feedback: 'good question, but...' → no match",
  feedbackTest("good question, but does this work?").entry === null);

// Negative — reuses CORRECTION_RE
check(r, "feedback: 'no, do it differently' → negative",
  feedbackTest("no, do it differently").entry?.polarity === "negative");
check(r, "feedback: \"don't mock the database\" → negative",
  feedbackTest("don't mock the database").entry?.polarity === "negative");
check(r, "feedback: 'actually, use postgres' → negative",
  feedbackTest("actually, use postgres").entry?.polarity === "negative");

// No-match cases
check(r, "feedback: random prompt → no match", feedbackTest("write a test for foo").entry === null);
check(r, "feedback: 'great work on this is what I want to discuss' → still positive (leads with great)",
  feedbackTest("great work on this is what I want to discuss").entry?.polarity === "positive");
check(r, "feedback: short non-feedback → no match", feedbackTest("hi").entry === null);

// Trigger word captured
const triggerEntry = feedbackTest("Perfect, ship it").entry;
check(r, "feedback: trigger word lowercased", triggerEntry?.trigger === "perfect");

// Prior-turn context populated when transcript provided
{
  const tFile = writeTranscript(te, "fb-prior", [
    userMsg("fix the auth bug"),
    assistantMsg("Refactored auth.ts to use cookie sessions", [
      { name: "Edit", input: { file_path: "/src/auth.ts" } },
      { name: "Bash", input: { command: "bun test auth" } },
    ]),
  ]);
  const e = feedbackTest("great, ship it", tFile).entry;
  check(r, "feedback: prior_tools captured from transcript",
    Array.isArray(e?.prior_tools) && e.prior_tools.includes("Edit") && e.prior_tools.includes("Bash"));
  check(r, "feedback: prior_files captured from transcript",
    Array.isArray(e?.prior_files) && e.prior_files.some((f: string) => f.includes("auth.ts")));
  check(r, "feedback: prior_text excerpted from transcript",
    typeof e?.prior_text === "string" && e.prior_text.includes("auth"));
  try { unlinkSync(tFile); } catch {}
}

runAndCheck(te, r, "memory/hooks/feedback-capture-submit.ts", "malformed", "not json");

// ── Session summary ──────────────────────────────────────────────────────────

console.log("\n--- session-summary ---");
{
  const tinyTranscript = writeTranscript(te, "tiny", [userMsg("hi"), assistantMsg("hello")]);
  runAndCheck(te, r, "memory/hooks/context-save-stop.ts", "too few", JSON.stringify({ transcript_path: tinyTranscript }));
  try { unlinkSync(tinyTranscript); } catch {}
}
runAndCheck(te, r, "memory/hooks/context-save-stop.ts", "malformed", "not json");

// ── Memory extraction ───────────────────────────────────────────────────────

console.log("\n--- memory-extract ---");

{
  const extractFile = writeTranscript(te, "extract-sub", [
    userMsg("fix the auth bug"),
    assistantMsg("found it", [{ name: "Read", input: { file_path: "/src/auth.ts" } }]),
    userMsg("ok"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/auth.ts" } }]),
    userMsg("test it"),
    assistantMsg("running", [{ name: "Bash", input: { command: "bun test" } }]),
    userMsg("good"),
    assistantMsg("done"),
  ]);
  runAndCheck(te, r, "memory/hooks/memory-extract-stop.ts", "extracts from substantive session",
    JSON.stringify({ transcript_path: extractFile }));
  try { unlinkSync(extractFile); } catch {}
}

{
  const extractStoreFile = writeTranscript(te, "extract-store", [
    userMsg("fix the auth bug"),
    assistantMsg("found it", [{ name: "Edit", input: { file_path: "/src/auth.ts" } }]),
    userMsg("ok"),
    assistantMsg("storing", [{ name: "mcp__memory__memory_store", input: { content: "fixed auth" } }]),
    userMsg("test it"),
    assistantMsg("running", [{ name: "Bash", input: { command: "bun test" } }]),
    userMsg("good"),
    assistantMsg("done"),
  ]);
  runAndCheck(te, r, "memory/hooks/memory-extract-stop.ts", "skips when memory_store present",
    JSON.stringify({ transcript_path: extractStoreFile }));
  try { unlinkSync(extractStoreFile); } catch {}
}

{
  const extractSmall = writeTranscript(te, "extract-small", [userMsg("hi"), assistantMsg("hello")]);
  runAndCheck(te, r, "memory/hooks/memory-extract-stop.ts", "skips non-substantive",
    JSON.stringify({ transcript_path: extractSmall }));
  try { unlinkSync(extractSmall); } catch {}
}

runAndCheck(te, r, "memory/hooks/memory-extract-stop.ts", "malformed stdin", "not json");

// Heuristic tests via direct import
{
  const { parseTranscript } = await import("../memory/parse-transcript.ts");
  const { extractMemories, hasMemoryStore, CORRECTION_RE } = await import("../memory/extract.ts");

  check(r, "extract: detects 'no' correction", CORRECTION_RE.test("no, do it this way"));
  check(r, "extract: detects 'don't' correction", CORRECTION_RE.test("don't use that approach"));
  check(r, "extract: detects 'actually' correction", CORRECTION_RE.test("actually, use the other one"));
  check(r, "extract: ignores normal text", !CORRECTION_RE.test("looks good, thanks"));
  check(r, "extract: ignores 'notice'", !CORRECTION_RE.test("notice how it works"));

  const correctionFile = writeTranscript(te, "extract-correction", [
    userMsg("fix the auth bug"),
    assistantMsg("I'll use mocks", [{ name: "Edit", input: { file_path: "/src/auth.ts" } }]),
    userMsg("no, don't mock the database"),
    assistantMsg("ok, using real db", [{ name: "Edit", input: { file_path: "/src/auth.ts" } }]),
    userMsg("test it"),
    assistantMsg("running", [{ name: "Bash", input: { command: "bun test" } }]),
    userMsg("good"),
    assistantMsg("done"),
  ]);
  const corrTranscript = parseTranscript(correctionFile, { textLimit: 1000 });
  const corrMemories = extractMemories(corrTranscript!);
  check(r, "extract: finds correction in transcript", corrMemories.some(m => m.tags.includes("preference")));
  check(r, "extract: includes session summary", corrMemories.some(m => m.tags.includes("session_context")));
  check(r, "extract: correction content has user text", corrMemories.some(m => m.content.includes("don't mock")));
  try { unlinkSync(correctionFile); } catch {}

  const storeFile2 = writeTranscript(te, "extract-store2", [
    userMsg("fix it"),
    assistantMsg("storing", [{ name: "mcp__memory__memory_store", input: { content: "done" } }]),
    userMsg("ok"),
    assistantMsg("done", [{ name: "Bash", input: { command: "test" } }]),
  ]);
  const storeT = parseTranscript(storeFile2);
  check(r, "extract: detects memory_store in transcript", hasMemoryStore(storeT!));
  try { unlinkSync(storeFile2); } catch {}
}

// ── Re-edit ↔ correction correlation (#4) ────────────────────────────────────

console.log("\n--- re-edit correlation ---");
{
  const { augmentWithSignals } = await import("../memory/extract.ts");
  const SID = "corr-sess";

  const reEditSig = (file: string) => JSON.stringify({
    type: "re-edit", file, count: 3, sessionId: SID, timestamp: "2026-05-09T10:00:00Z",
  });

  const negFb = (file: string, prompt: string, prior_text: string) => JSON.stringify({
    timestamp: "2026-05-09T10:30:00Z", session_id: SID, polarity: "negative", trigger: "no",
    prompt, prior_text, prior_tools: ["Edit"], prior_files: [file],
  });

  // Case 1: re-edit + matching negative feedback → approach_friction
  {
    const out = augmentWithSignals(
      [],
      reEditSig("src/auth.ts"),
      negFb("src/auth.ts", "no don't use mocks", "switching to mocked sessions"),
      SID,
    );
    check(r, "correlate: matching feedback → approach_friction tag",
      out.some(m => m.tags.includes("approach_friction")));
    check(r, "correlate: includes user pushback in content",
      out.some(m => m.content.includes("don't use mocks")));
    check(r, "correlate: includes prior reaction context",
      out.some(m => m.content.includes("mocked sessions")));
    check(r, "correlate: no quiet 'Re-edit observation' when matched",
      !out.some(m => m.content.startsWith("Re-edit observation")));
  }

  // Case 2: re-edit, no matching feedback → quieter observation, no editorial
  {
    const out = augmentWithSignals(
      [],
      reEditSig("src/parser.ts"),
      "", // no feedback
      SID,
    );
    check(r, "no-correlate: emits Re-edit observation (not friction)",
      out.some(m => m.content.startsWith("Re-edit observation: src/parser.ts")));
    check(r, "no-correlate: no approach_friction tag",
      !out.some(m => m.tags.includes("approach_friction")));
    check(r, "no-correlate: drops 'approach needed corrections' editorial",
      !out.some(m => m.content.includes("approach needed")));
  }

  // Case 3: re-edit + UNRELATED negative feedback (different file) → no correlation
  {
    const out = augmentWithSignals(
      [],
      reEditSig("src/auth.ts"),
      negFb("src/parser.ts", "no don't do that", "doing something to parser"),
      SID,
    );
    check(r, "no-correlate: feedback on different file does not match",
      !out.some(m => m.tags.includes("approach_friction")));
    check(r, "no-correlate: still emits the quiet observation",
      out.some(m => m.content.startsWith("Re-edit observation")));
  }

  // Case 4: positive feedback still produces validated-approach memories
  {
    const posFb = JSON.stringify({
      timestamp: "2026-05-09T10:30:00Z", session_id: SID, polarity: "positive",
      trigger: "perfect", prompt: "perfect, ship it",
      prior_text: "Refactored to use cookie sessions", prior_tools: ["Edit", "Bash"],
      prior_files: ["src/auth.ts"],
    });
    const out = augmentWithSignals([], "", posFb, SID);
    check(r, "validated: positive feedback → validated tag",
      out.some(m => m.tags.includes("validated")));
    check(r, "validated: content names trigger word",
      out.some(m => m.content.includes(`"perfect"`)));
  }

  // Case 5: filters by session_id
  {
    const out = augmentWithSignals(
      [],
      JSON.stringify({ type: "re-edit", file: "x.ts", count: 3, sessionId: "OTHER", timestamp: "2026-05-09" }),
      "",
      SID,
    );
    check(r, "session filter: ignores other-session signals", out.length === 0);
  }
}

// ── Rule fingerprint helpers (#5) ────────────────────────────────────────────

console.log("\n--- rule-fingerprint ---");
{
  const { ruleFingerprint, parseRuleLine, similarity, effectivenessScore } = await import("../memory/rule-fingerprint.ts");

  // ruleFingerprint stable across whitespace/punctuation
  check(r, "fingerprint: stable across capitalization",
    ruleFingerprint("Use real DB not mocks") === ruleFingerprint("use real db not mocks"));
  check(r, "fingerprint: stable across trailing punctuation",
    ruleFingerprint("use real db not mocks.") === ruleFingerprint("use real db not mocks"));
  check(r, "fingerprint: different rules → different hashes",
    ruleFingerprint("use real db") !== ruleFingerprint("commit before context switch"));

  // parseRuleLine
  const a = parseRuleLine("- [avoid] use real db not mocks _(3x)_");
  check(r, "parseRuleLine: extracts text", a?.text === "use real db not mocks");
  check(r, "parseRuleLine: extracts polarity", a?.polarity === "avoid");

  const b = parseRuleLine("- [keep] verify with bun test.ts before claiming done");
  check(r, "parseRuleLine: handles [keep] → validated", b?.polarity === "validated");

  const c = parseRuleLine("- some untagged rule that should still parse");
  check(r, "parseRuleLine: handles untagged lines", c?.text === "some untagged rule that should still parse" && c?.polarity === null);

  check(r, "parseRuleLine: rejects too-short lines", parseRuleLine("- hi") === null);

  // similarity
  check(r, "similarity: identical → 1.0",
    similarity("use real db not mocks", "use real db not mocks") === 1);
  check(r, "similarity: paraphrased same rule → above threshold",
    similarity("commit before context switch", "always commit before switching context") >= 0.4);
  check(r, "similarity: unrelated → low",
    similarity("commit frequently", "review pull requests") < 0.3);

  // effectivenessScore
  check(r, "effectiveness: avoid w/ 0 recurrences → 1.0",
    effectivenessScore({ text: "x", polarity: "avoid", first_seen: "", last_seen: "", injections: 5, recurrences: 0, reaffirmations: 0 }) === 1);
  check(r, "effectiveness: avoid w/ all recurrences → 0",
    effectivenessScore({ text: "x", polarity: "avoid", first_seen: "", last_seen: "", injections: 5, recurrences: 5, reaffirmations: 0 }) === 0);
  check(r, "effectiveness: validated w/ 3/5 reaffirmations → 0.6",
    Math.abs((effectivenessScore({ text: "x", polarity: "validated", first_seen: "", last_seen: "", injections: 5, recurrences: 0, reaffirmations: 3 }) ?? 0) - 0.6) < 0.001);
  check(r, "effectiveness: 0 injections → null",
    effectivenessScore({ text: "x", polarity: "avoid", first_seen: "", last_seen: "", injections: 0, recurrences: 0, reaffirmations: 0 }) === null);
}

// ── Rule injection logging (#5) ──────────────────────────────────────────────

console.log("\n--- rule-injection logging ---");
{
  const { resolve: resolvePath } = await import("path");
  const injFile = resolvePath(te.tmpBase, "signals", "rule-injections.jsonl");
  const rulesFile = resolvePath(te.tmpBase, "signals", "learned-rules.md");

  // Write a learned-rules.md the SessionStart hook will read
  const sessionsDir2 = resolve(te.tmpBase, "sessions");
  // Clear injections from prior runs
  try { unlinkSync(injFile); } catch {}
  writeFileSync(rulesFile, [
    "# Learned Rules",
    "_Auto-generated 2026-05-09_",
    "",
    "- [avoid] use real db not mocks _(3x)_",
    "- [keep] verify with bun test.ts before claiming done",
    "- [avoid] do not edit ~/.claude directly _(2x)_",
    "",
  ].join("\n"));

  const { stdout } = runHook(te, "memory/hooks/context-restore-start.ts",
    JSON.stringify({ session_id: "inj-test-sess" }));

  check(r, "injection: briefing includes rules", stdout.includes("Learned Behavioral Rules"));

  let lines: string[] = [];
  try { lines = readFileSync(injFile, "utf-8").trim().split("\n").filter(Boolean); } catch {}
  check(r, "injection: rule-injections.jsonl has 3 entries", lines.length === 3);
  if (lines.length === 3) {
    const parsed = lines.map(l => JSON.parse(l));
    check(r, "injection: each entry has rule_hash", parsed.every(p => typeof p.rule_hash === "string" && p.rule_hash.length > 0));
    check(r, "injection: each entry has session_id", parsed.every(p => p.session_id === "inj-test-sess"));
    check(r, "injection: polarity captured for [avoid]",
      parsed.filter(p => p.polarity === "avoid").length === 2);
    check(r, "injection: polarity captured for [keep]→validated",
      parsed.filter(p => p.polarity === "validated").length === 1);
    check(r, "injection: text strips frequency suffix",
      parsed[0].rule_text === "use real db not mocks");
  }

  try { unlinkSync(rulesFile); } catch {}
  try { unlinkSync(injFile); } catch {}
}

// ── Session recall ───────────────────────────────────────────────────────────

console.log("\n--- session recall ---");

{
  const recallTranscript = writeTranscript(te, "recall", [
    userMsg("the payments webhook is returning 500 on Stripe signature verification"),
    assistantMsg("Root cause: express.json() consumes the raw body before Stripe can verify the signature. Fix: use express.raw() for the webhook route.", [
      { name: "Read", input: { file_path: "/src/payments/webhook.ts" } },
      { name: "Edit", input: { file_path: "/src/payments/webhook.ts" } },
      { name: "Edit", input: { file_path: "/src/routes/index.ts" } },
      { name: "Bash", input: { command: "bun test payments" } },
    ]),
    userMsg("confirmed, 500s are gone. while you're in there, the retry logic in webhook.ts is a mess — can you refactor it to use exponential backoff?"),
    assistantMsg("The current retry logic uses a fixed 1s delay with 3 retries. Refactoring to exponential backoff with jitter: base 500ms, max 30s, max 5 retries.", [
      { name: "Read", input: { file_path: "/src/payments/retry.ts" } },
      { name: "Edit", input: { file_path: "/src/payments/retry.ts" } },
      { name: "Edit", input: { file_path: "/src/payments/webhook.ts" } },
      { name: "Edit", input: { file_path: "/src/payments/subscription.ts" } },
      { name: "Bash", input: { command: "bun test payments" } },
    ]),
    userMsg("looks good"),
    assistantMsg("While refactoring I noticed a race condition: two concurrent webhook deliveries with the same event ID can both pass the idempotency check because the SELECT and INSERT aren't atomic. Need a unique constraint (uq_idempotency_key) on the idempotency_key column plus an ON CONFLICT DO NOTHING upsert pattern.", [
      { name: "Read", input: { file_path: "/src/db/schema.ts" } },
      { name: "Edit", input: { file_path: "/src/db/schema.ts" } },
      { name: "Edit", input: { file_path: "/src/db/migrations/004-idempotency-unique.ts" } },
      { name: "Edit", input: { file_path: "/src/payments/idempotency.ts" } },
      { name: "Bash", input: { command: "bun test payments" } },
    ]),
    assistantMsg("Migration and upsert are in but 2 tests are failing — the test fixtures assume duplicate inserts succeed. Need to update test helpers."),
    userMsg("let's pick that up next time, I need to head out. commit what we have"),
    assistantMsg("Committed. The idempotency fix is in but tests need updating — 2 failures in test/payments/idempotency.test.ts around duplicate insert fixtures.", [
      { name: "Bash", input: { command: "git add -A && git commit -m 'fix webhook 500, refactor retries, start idempotency fix'" } },
    ]),
  ]);

  const beforeSessions = new Set(readdirSync(sessionsDir));
  runHook(te, "memory/hooks/context-save-stop.ts", JSON.stringify({ transcript_path: recallTranscript }));
  const newSessions = readdirSync(sessionsDir).filter(f => !beforeSessions.has(f));

  if (newSessions.length === 0) {
    check(r, "context-save-stop did not create a file", false);
  } else {
    const summary = readFileSync(resolve(sessionsDir, newSessions[0]), "utf-8");

    check(r, "recall: knows initial task (webhook 500)", summary.includes("webhook") || summary.includes("500"));
    check(r, "recall: knows about retry refactor", summary.includes("retry") || summary.includes("backoff"));
    check(r, "recall: knows about idempotency fix", summary.includes("idempotency") || summary.includes("race"));
    check(r, "recall: knows webhook root cause (express.json)", summary.includes("express.json") || summary.includes("raw body"));
    check(r, "recall: knows retry approach (exponential backoff)", summary.includes("exponential") || summary.includes("backoff") || summary.includes("jitter"));
    check(r, "recall: knows idempotency problem (race condition)", summary.includes("race") || summary.includes("atomic") || summary.includes("concurrent"));
    check(r, "recall: knows webhook fix is done", summary.includes("confirmed") || summary.includes("gone") || summary.includes("500s are gone"));
    check(r, "recall: knows idempotency fix is incomplete", summary.includes("failing") || summary.includes("need to update") || summary.includes("pick that up") || summary.includes("2 test"));
    check(r, "recall: knows which tests are broken", summary.includes("idempotency.test") || summary.includes("duplicate insert") || summary.includes("test fixtures"));
    checkInfo(r, "recall: knows constraint name (uq_idempotency_key)", summary.includes("uq_idempotency_key"));

    const seedFile = resolve(sessionsDir, "9999-99-99-999999.md");
    writeFileSync(seedFile, summary);
    const { stdout: startOut } = runHook(te, "memory/hooks/context-restore-start.ts", "{}");
    check(r, "recall: start shows what was worked on", startOut.includes("webhook") || startOut.includes("payments") || startOut.includes("500"));
    check(r, "recall: start shows work is unfinished", startOut.includes("failing") || startOut.includes("pick that up") || startOut.includes("next time") || startOut.includes("2 test"));
    try { unlinkSync(seedFile); } catch {}
    try { unlinkSync(resolve(sessionsDir, newSessions[0])); } catch {}
  }
  try { unlinkSync(recallTranscript); } catch {}
}

cleanupTestEnv(te);
printAndExit(r);
