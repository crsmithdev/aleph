#!/usr/bin/env bun
import { check, createResults, printAndExit } from "../eval/harness.ts";
import {
  classifyChange,
  decide,
  extractTurn,
  isDocOnly,
  missingRequiredFields,
  mostRecentUserText,
  scanVerifyBlock,
  turnStartIndex,
  userAffirmedSkip,
} from "../eval/verify-policy.ts";

console.log("[verify]");
console.log("type: unit");
console.log("scope: src/eval/verify-policy.ts, src/tests/verify-policy.test.ts");
console.log("input: in-process function calls with synthetic transcript / tool-output strings");
console.log("output: return values from classifyChange, scanVerifyBlock, missingRequiredFields, decide, transcript helpers");
console.log("method: pin every documented contract of verify-policy with a check(); failure-mode is bad regex or wrong required-key list breaking one or more checks");
console.log("[/verify]");

const r = createResults();

// ── isDocOnly ────────────────────────────────────────────────────────────────
console.log("--- isDocOnly ---");
check(r, "*.md anywhere is docs",
  isDocOnly("README.md") && isDocOnly("src/skills/foo/SKILL.md") && isDocOnly("/abs/path/CLAUDE.md"));
check(r, "*.txt and *.rst are docs",
  isDocOnly("notes.txt") && isDocOnly("foo.rst"));
check(r, "files under top-level docs/ are docs",
  isDocOnly("docs/architecture.html") && isDocOnly("/repo/docs/foo.png"));
check(r, "source code is NOT docs",
  !isDocOnly("src/core/hooks/quality-check-stop.ts")
    && !isDocOnly("src/ui/web/src/App.tsx")
    && !isDocOnly("install.ts"));
check(r, "config/json is NOT docs (ships behavior)",
  !isDocOnly("settings.json")
    && !isDocOnly("src/core/hooks/settings-hooks.json")
    && !isDocOnly("package.json"));

// ── classifyChange ───────────────────────────────────────────────────────────
console.log("--- classifyChange ---");
check(r, "no files → skip", classifyChange([]) === "skip");
check(r, "only docs → skip",
  classifyChange(["README.md", "docs/foo.png", "src/skills/x/SKILL.md"]) === "skip");
check(r, "any code mixed in → required",
  classifyChange(["README.md", "src/foo.ts"]) === "required");
check(r, "config alone → required",
  classifyChange(["settings.json"]) === "required");

// ── scanVerifyBlock ──────────────────────────────────────────────────────────
console.log("--- scanVerifyBlock ---");

const FULL_BLOCK = [
  "[verify]",
  "type: e2e",
  "scope: src/ui/web/src/routes-meta.ts",
  "input: playwright nav to /research/__smoke_none__",
  "output: DOM query for [data-testid=\"error-state\"]",
  "method: bogus-id detail page renders the not-found ErrorState",
  "[/verify]",
].join("\n");

{
  const b = scanVerifyBlock(FULL_BLOCK);
  check(r, "scanVerifyBlock: parses all five required keys",
    b !== null
      && b.fields.type === "e2e"
      && b.fields.scope === "src/ui/web/src/routes-meta.ts"
      && b.fields.input === "playwright nav to /research/__smoke_none__"
      && b.fields.output === 'DOM query for [data-testid="error-state"]'
      && b.fields.method === "bogus-id detail page renders the not-found ErrorState");
}
{
  const b = scanVerifyBlock(FULL_BLOCK);
  check(r, "scanVerifyBlock: missingRequiredFields returns [] when all present",
    missingRequiredFields(b).length === 0);
}
{
  const b = scanVerifyBlock("");
  check(r, "scanVerifyBlock: empty input → null",
    b === null && missingRequiredFields(b).length === 5);
}
{
  const b = scanVerifyBlock("[verify]\ntype: unit\nscope: foo.ts\n[/verify]");
  check(r, "scanVerifyBlock: missingRequiredFields names exactly the absent keys",
    b !== null
      && missingRequiredFields(b).join(",") === "input,output,method");
}
{
  const block = [
    "[verify]",
    "type: integration",
    "scope: src/foo.ts",
    "input: function call",
    "output: return value",
    "method: round-trip works",
    "gaps: did not exercise concurrent-call path",
    "assertions: result.ok === true; result.value matches schema",
    "failure-mode: if foo() throws on null, the test catches via expect(...).not.toThrow()",
    "[/verify]",
  ].join("\n");
  const b = scanVerifyBlock(block);
  check(r, "scanVerifyBlock: optional keys (gaps, assertions, failure-mode) recorded",
    b !== null
      && b.fields.gaps === "did not exercise concurrent-call path"
      && b.fields.assertions === "result.ok === true; result.value matches schema"
      && b.fields["failure-mode"]?.startsWith("if foo() throws"));
}
{
  const noisy = "blah blah\nrunning tests...\n" + FULL_BLOCK + "\nmore noise\n151 failures elsewhere";
  const b = scanVerifyBlock(noisy);
  check(r, "scanVerifyBlock: extracts block from surrounding noise (incl. stray 'failures' prose)",
    b !== null && b.fields.type === "e2e");
}
{
  const b = scanVerifyBlock("[verify]\ntype: e2e\nscope:\ninput: x\noutput: y\nmethod: z\n[/verify]");
  check(r, "scanVerifyBlock: empty value counts as missing key",
    missingRequiredFields(b).includes("scope"));
}

// ── userAffirmedSkip ─────────────────────────────────────────────────────────
console.log("--- userAffirmedSkip ---");
check(r, "'skip verify' triggers", userAffirmedSkip("yeah, skip verify on this one"));
check(r, "'Skip Verification' (case + suffix) triggers", userAffirmedSkip("Skip Verification — paid endpoint"));
check(r, "plain 'yes' does NOT trigger (avoids false positive)",
  !userAffirmedSkip("yes") && !userAffirmedSkip("ok go ahead"));
check(r, "'skip' alone (without 'verify') does NOT trigger",
  !userAffirmedSkip("we should skip this commit for now"));

// ── decide ───────────────────────────────────────────────────────────────────
console.log("--- decide ---");
{
  const d = decide({
    editedFiles: ["README.md", "docs/x.md"],
    toolResultText: "",
    mostRecentUserText: "update the readme",
  });
  check(r, "docs-only → pass", d.kind === "pass");
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: FULL_BLOCK,
    mostRecentUserText: "fix foo",
  });
  check(r, "code + complete [verify] block → pass",
    d.kind === "pass" && d.reason.includes("ErrorState"));
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: FULL_BLOCK + "\n151 failures elsewhere in unrelated log",
    mostRecentUserText: "fix",
  });
  check(r, "stray 'N failures' prose alongside complete block → still pass",
    d.kind === "pass");
}
{
  const partial = "[verify]\ntype: unit\nscope: foo.ts\n[/verify]";
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: partial,
    mostRecentUserText: "fix",
  });
  check(r, "partial block → block, names every missing key",
    d.kind === "block"
      && d.reason.includes("input")
      && d.reason.includes("output")
      && d.reason.includes("method"));
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: "ran some tests; all good",
    mostRecentUserText: "fix",
  });
  check(r, "no [verify] block at all → block",
    d.kind === "block" && d.reason.includes("no [verify] block"));
}
{
  const d = decide({
    editedFiles: ["src/ui/web/src/App.tsx"],
    toolResultText: "",
    mostRecentUserText: "yeah, skip verify — too costly to run",
  });
  check(r, "no verification but user said 'skip verify' → pass",
    d.kind === "pass" && d.reason.includes("user-affirmed"));
}
{
  const old = "[verify-type] x\n[verify-surface] y\n[verify-behavior] z";
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: old,
    mostRecentUserText: "fix",
  });
  check(r, "OLD [verify-X] markers without [verify] block → block",
    d.kind === "block");
}

// ── transcript helpers ───────────────────────────────────────────────────────
console.log("--- transcript helpers ---");

function jsonl(...entries: object[]): string[] {
  return entries.map(e => JSON.stringify(e));
}

const lines = jsonl(
  // prior turn
  { type: "user", message: { content: [{ type: "text", text: "old prompt" }] } },
  { type: "assistant", message: { content: [{ type: "tool_use", name: "Edit", input: { file_path: "old.ts" } }] } },
  { type: "user", message: { content: [{ type: "tool_result", content: "old result" }] } },
  // current turn
  { type: "user", message: { content: [{ type: "text", text: "fix the bug" }] } },
  { type: "assistant", message: { content: [
    { type: "tool_use", name: "Edit", input: { file_path: "src/a.ts" } },
    { type: "tool_use", name: "Bash", input: { command: "bun test src/tests/a.test.ts" } },
  ] } },
  { type: "user", message: { content: [
    { type: "tool_result", content: FULL_BLOCK },
  ] } },
);

check(r, "turnStartIndex finds the most recent user-text message",
  turnStartIndex(lines) === 3);
check(r, "mostRecentUserText returns that prompt's text",
  mostRecentUserText(lines) === "fix the bug");

{
  const t = extractTurn(lines, turnStartIndex(lines));
  check(r, "extractTurn pulls current-turn edits",
    t.editedFiles.length === 1 && t.editedFiles[0] === "src/a.ts");
  check(r, "extractTurn pulls current-turn tool output (verify block intact)",
    t.toolResultText.includes("[verify]")
      && t.toolResultText.includes("[/verify]")
      && t.toolResultText.includes("bogus-id detail page renders"));
  check(r, "extractTurn excludes prior-turn artifacts",
    !t.editedFiles.includes("old.ts")
      && !t.toolResultText.includes("old result"));
}

{
  const arrLines = jsonl(
    { type: "user", message: { content: [{ type: "text", text: "do it" }] } },
    { type: "assistant", message: { content: [
      { type: "tool_use", name: "Bash", input: { command: "bun test foo" } },
    ] } },
    { type: "user", message: { content: [
      { type: "tool_result", content: [
        { type: "text", text: "line 1" },
        { type: "text", text: FULL_BLOCK },
      ] },
    ] } },
  );
  const t = extractTurn(arrLines, turnStartIndex(arrLines));
  check(r, "extractTurn handles array-shaped tool_result content",
    t.toolResultText.includes("line 1") && t.toolResultText.includes("[verify]"));
}

{
  const t = extractTurn(lines, turnStartIndex(lines));
  const d = decide({
    editedFiles: t.editedFiles,
    toolResultText: t.toolResultText,
    mostRecentUserText: mostRecentUserText(lines),
  });
  check(r, "end-to-end: realistic transcript → decide returns pass", d.kind === "pass");
}

printAndExit(r);
