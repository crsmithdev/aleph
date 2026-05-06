#!/usr/bin/env bun
import { check, createResults, printAndExit } from "../eval/harness.ts";
import {
  classifyChange,
  decide,
  extractTurn,
  isDocOnly,
  missingRequiredFields,
  mostRecentUserText,
  REQUIRED_KEYS,
  scanVerifyBlock,
  turnStartIndex,
  userAffirmedSkip,
} from "../eval/verify-policy.ts";

console.log("[verify]");
console.log("scope: src/eval/verify-policy.ts:78-95 (REQUIRED_KEYS, scanVerifyBlock, missingRequiredFields), src/tests/verify-policy.test.ts (this file), src/hook-report.ts:6-16 (HookDecision.meta)");
console.log("method: invoke each exported pure function in verify-policy with synthetic strings and JSONL transcript fixtures; assert return values via check(); REQUIRED_KEYS is the new five-tuple (scope, method, assertions, failure-mode, gaps), no [verify-X] / type / input / output legacy");
console.log("assertions: full block parses each required key; missing-key block surfaces exactly the absent keys; partial / empty / noisy inputs handled; old [verify-X] tags rejected; old type/input/output keys are NOT in REQUIRED_KEYS; full block in synthetic transcript drives decide() to pass");
console.log("failure-mode: regression in VERIFY_BLOCK_RE / KV_RE → 'parses all five' check fails; regression in REQUIRED_KEYS list → 'names exactly the absent keys' check names the wrong set; if scope/method/assertions/failure-mode/gaps drop out of the required tuple, the 'missing names exactly' check breaks; old-tag regression rejection inverts");
console.log("gaps: does not exercise the live Stop-hook stdin/exit-code path through quality-check-stop.ts; does not cover the new hook-report meta payload (covered by code review and runtime telemetry inspection); content-quality of `gaps` / `failure-mode` / `scope` answers is not (and cannot be) checked here — that's a code-review responsibility per the policy's design");
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

// ── REQUIRED_KEYS shape ──────────────────────────────────────────────────────
console.log("--- REQUIRED_KEYS ---");
check(r, "required keys are exactly the five-tuple in canonical order",
  REQUIRED_KEYS.join(",") === "scope,method,assertions,failure-mode,gaps");
check(r, "old keys (type, input, output) are no longer required",
  !(REQUIRED_KEYS as readonly string[]).includes("type")
    && !(REQUIRED_KEYS as readonly string[]).includes("input")
    && !(REQUIRED_KEYS as readonly string[]).includes("output"));

// ── scanVerifyBlock ──────────────────────────────────────────────────────────
console.log("--- scanVerifyBlock ---");

const FULL_BLOCK = [
  "[verify]",
  "scope: src/ui/web/src/routes-meta.ts:30-44, src/ui/e2e/ui-smoke.test.ts:140-152",
  "method: playwright nav to /research/__smoke_none__, wait for [data-testid=\"page-research-detail\"], then [data-testid=\"error-state\"]",
  "assertions: page testid renders within 15s; error-state visible; no /api/ 4xx outside allowedApi404 list",
  "failure-mode: missing testid on Layout → first selector times out; missing data-testid on ErrorState → second selector times out",
  "gaps: only the 404/empty path is covered, not populated detail rendering",
  "[/verify]",
].join("\n");

{
  const b = scanVerifyBlock(FULL_BLOCK);
  check(r, "scanVerifyBlock: parses all five required keys",
    b !== null
      && b.fields.scope.startsWith("src/ui/web/src/routes-meta.ts:30-44")
      && b.fields.method.startsWith("playwright nav")
      && b.fields.assertions.startsWith("page testid renders")
      && b.fields["failure-mode"].includes("first selector times out")
      && b.fields.gaps.startsWith("only the 404"));
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
  const b = scanVerifyBlock("[verify]\nscope: foo.ts:1-10\nmethod: ran a thing\n[/verify]");
  check(r, "scanVerifyBlock: missingRequiredFields names exactly the absent keys",
    b !== null
      && missingRequiredFields(b).join(",") === "assertions,failure-mode,gaps");
}
{
  const noisy = "blah blah\nrunning tests...\n" + FULL_BLOCK + "\nmore noise\n151 failures elsewhere";
  const b = scanVerifyBlock(noisy);
  check(r, "scanVerifyBlock: extracts block from surrounding noise",
    b !== null && b.fields.scope.startsWith("src/ui/web/src/routes-meta.ts"));
}
{
  const b = scanVerifyBlock("[verify]\nscope:\nmethod: x\nassertions: y\nfailure-mode: z\ngaps: w\n[/verify]");
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
    d.kind === "pass" && d.reason.includes("playwright nav"));
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
  const partial = "[verify]\nscope: foo.ts:1-10\nmethod: ran a thing\n[/verify]";
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: partial,
    mostRecentUserText: "fix",
  });
  check(r, "partial block → block, names assertions/failure-mode/gaps as missing",
    d.kind === "block"
      && d.reason.includes("assertions")
      && d.reason.includes("failure-mode")
      && d.reason.includes("gaps"));
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
  // Old type/input/output keys must NOT cause a pass even if every old key is present.
  const oldShape = [
    "[verify]",
    "type: e2e",
    "scope: foo.ts",
    "input: a",
    "output: b",
    "method: c",
    "[/verify]",
  ].join("\n");
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: oldShape,
    mostRecentUserText: "fix",
  });
  check(r, "old required-key list (type/input/output) does NOT pass anymore",
    d.kind === "block" && d.reason.includes("assertions"));
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
      && t.toolResultText.includes("playwright nav"));
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
