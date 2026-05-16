#!/usr/bin/env bun
import { check, createResults, printAndExit } from "../eval/harness.ts";
import {
  classifyChange,
  decide,
  detectPassingTestRun,
  extractTurn,
  isDocOnly,
  isTestFile,
  missingRequiredFields,
  mostRecentUserText,
  RECOGNISED_KEYS,
  REQUIRED_KEYS,
  scanVerifyBlock,
  turnStartIndex,
  userAffirmedSkip,
} from "../eval/verify-policy.ts";

console.log("[verify]");
console.log("scope: src/eval/verify-policy.ts (REQUIRED_KEYS, RECOGNISED_KEYS, scanVerifyBlock, missingRequiredFields, decide), src/tests/verify-policy.test.ts (this file)");
console.log("method: invoke each exported pure function with synthetic strings and JSONL transcript fixtures; assert return values via check()");
console.log("assertions: REQUIRED_KEYS is exactly (scope, method, assertions); RECOGNISED_KEYS still captures failure-mode/gaps; partial block missing one of the three required keys blocks; partial block with only the three required keys passes; full five-key block still passes and parses every recognised key");
console.log("[/verify]");

const r = createResults();

// ── isDocOnly ────────────────────────────────────────────────────────────────
console.log("--- isDocOnly ---");
check(r, "*.md anywhere is docs",
  isDocOnly("README.md") && isDocOnly("src/skills/foo/SKILL.md") && isDocOnly("/abs/path/CLAUDE.md"));
check(r, "markup formats are docs (.md .rst .txt .adoc .asciidoc .ad .html .csv)",
  isDocOnly("notes.txt") && isDocOnly("foo.rst") && isDocOnly("guide.adoc")
    && isDocOnly("spec.asciidoc") && isDocOnly("ref.ad")
    && isDocOnly("mockup.html") && isDocOnly("data.csv"));
check(r, "lock files are docs (generated, not executed)",
  isDocOnly("bun.lockb") && isDocOnly("package-lock.json") && isDocOnly("yarn.lock"));
check(r, "binary/media assets are docs — no path reference needed",
  isDocOnly("logo.png") && isDocOnly("icon.svg") && isDocOnly("font.woff2") && isDocOnly("clip.mp4"));
check(r, "source code is NOT docs",
  !isDocOnly("src/core/hooks/quality-check-stop.ts")
    && !isDocOnly("src/ui/web/src/App.tsx")
    && !isDocOnly("install.ts"));
check(r, "behavior-shipping config is NOT docs",
  !isDocOnly("settings.json")
    && !isDocOnly("src/core/hooks/settings-hooks.json")
    && !isDocOnly("package.json")
    && !isDocOnly("src/skills/skill-rules.json"));

// ── classifyChange ───────────────────────────────────────────────────────────
console.log("--- classifyChange ---");
check(r, "no files → skip", classifyChange([]) === "skip");
check(r, "only markup + assets → skip",
  classifyChange(["README.md", "logo.png", "src/skills/x/SKILL.md", "guide.adoc"]) === "skip");
check(r, "assets + lock files alone → skip",
  classifyChange(["logo.png", "font.woff2", "bun.lockb"]) === "skip");
check(r, "any json → required (no path exemptions)",
  classifyChange(["src/skills/skill-rules.json"]) === "required"
    && classifyChange(["evals/fixtures.json"]) === "required");
check(r, "any code mixed in → required",
  classifyChange(["README.md", "src/foo.ts"]) === "required");
check(r, "config alone → required",
  classifyChange(["settings.json"]) === "required");

// ── isTestFile ───────────────────────────────────────────────────────────────
console.log("--- isTestFile ---");
check(r, "JS/TS: .test.ts, .spec.ts",
  isTestFile("src/foo.test.ts") && isTestFile("src/bar.spec.tsx") && isTestFile("lib/util.test.js"));
check(r, "Python: test_foo.py, foo_test.py",
  isTestFile("test_models.py") && isTestFile("models_test.py"));
check(r, "Go: foo_test.go",
  isTestFile("handler_test.go") && isTestFile("pkg/server_test.go"));
check(r, "Java/Kotlin: FooTest.java, FooTests.kt",
  isTestFile("UserTest.java") && isTestFile("UserTests.kt") && isTestFile("OrderSpec.scala"));
check(r, "Ruby: foo_spec.rb, foo_test.rb",
  isTestFile("user_spec.rb") && isTestFile("order_test.rb"));
check(r, "test directories: __tests__/, tests/, spec/",
  isTestFile("src/__tests__/utils.ts") && isTestFile("tests/integration.ts") && isTestFile("spec/models/user.rb"));
check(r, "regular source files are NOT test files",
  !isTestFile("src/foo.ts") && !isTestFile("lib/util.py") && !isTestFile("handler.go"));

// ── detectPassingTestRun ──────────────────────────────────────────────────────
console.log("--- detectPassingTestRun ---");
check(r, "bun: '67 pass, 0 fail'",
  detectPassingTestRun("67 pass\n0 fail\nRan 67 tests across 6 files."));
check(r, "jest: 'Tests: 5 passed'",
  detectPassingTestRun("Tests: 5 passed, 5 total\nTest Suites: 1 passed"));
check(r, "pytest: '5 passed'",
  detectPassingTestRun("======================== 5 passed in 0.12s ========================"));
check(r, "go test: 'ok  pkg/name'",
  detectPassingTestRun("ok  github.com/foo/bar\t0.012s"));
check(r, "no pass signal → false",
  !detectPassingTestRun("compilation succeeded\nno test output"));
check(r, "failures present → false even with passing count",
  !detectPassingTestRun("5 passed, 2 failed\nFAILED"));
check(r, "FAILED alone → false",
  !detectPassingTestRun("FAILED src/foo.test.ts"));

// ── REQUIRED_KEYS / RECOGNISED_KEYS shape ────────────────────────────────────
console.log("--- REQUIRED_KEYS / RECOGNISED_KEYS ---");
check(r, "required keys are exactly (scope, method, assertions)",
  REQUIRED_KEYS.join(",") === "scope,method,assertions");
check(r, "failure-mode and gaps are no longer required",
  !(REQUIRED_KEYS as readonly string[]).includes("failure-mode")
    && !(REQUIRED_KEYS as readonly string[]).includes("gaps"));
check(r, "RECOGNISED_KEYS still includes failure-mode and gaps for telemetry capture",
  RECOGNISED_KEYS.join(",") === "scope,method,assertions,failure-mode,gaps");
check(r, "old keys (type, input, output) are not recognised",
  !(RECOGNISED_KEYS as readonly string[]).includes("type")
    && !(RECOGNISED_KEYS as readonly string[]).includes("input")
    && !(RECOGNISED_KEYS as readonly string[]).includes("output"));

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
  check(r, "scanVerifyBlock: parses every recognised key (required + optional)",
    b !== null
      && b.fields.scope.startsWith("src/ui/web/src/routes-meta.ts:30-44")
      && b.fields.method.startsWith("playwright nav")
      && b.fields.assertions.startsWith("page testid renders")
      && b.fields["failure-mode"].includes("first selector times out")
      && b.fields.gaps.startsWith("only the 404"));
}
{
  const b = scanVerifyBlock(FULL_BLOCK);
  check(r, "scanVerifyBlock: missingRequiredFields returns [] when all required present",
    missingRequiredFields(b).length === 0);
}
{
  const b = scanVerifyBlock("");
  check(r, "scanVerifyBlock: empty input → null, missing list is the three-tuple",
    b === null && missingRequiredFields(b).length === 3);
}
{
  const b = scanVerifyBlock("[verify]\nscope: foo.ts:1-10\nmethod: ran a thing\n[/verify]");
  check(r, "scanVerifyBlock: missing only `assertions` when scope+method present",
    b !== null && missingRequiredFields(b).join(",") === "assertions");
}
{
  // Trimmed three-key block is now sufficient.
  const b = scanVerifyBlock("[verify]\nscope: foo.ts:1-10\nmethod: ran a thing\nassertions: exit code 0\n[/verify]");
  check(r, "scanVerifyBlock: three required keys → no missing fields",
    b !== null && missingRequiredFields(b).length === 0);
}
{
  const noisy = "blah blah\nrunning tests...\n" + FULL_BLOCK + "\nmore noise\n151 failures elsewhere";
  const b = scanVerifyBlock(noisy);
  check(r, "scanVerifyBlock: extracts block from surrounding noise",
    b !== null && b.fields.scope.startsWith("src/ui/web/src/routes-meta.ts"));
}
{
  const b = scanVerifyBlock("[verify]\nscope:\nmethod: x\nassertions: y\n[/verify]");
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
  check(r, "partial block missing `assertions` → block, names it as missing",
    d.kind === "block" && d.reason.includes("assertions"));
}
{
  // Three required keys is now enough — failure-mode/gaps are optional.
  const trimmed = "[verify]\nscope: foo.ts:1-10\nmethod: ran a thing\nassertions: exit 0\n[/verify]";
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: trimmed,
    mostRecentUserText: "fix",
  });
  check(r, "trimmed three-key block → pass (failure-mode/gaps not required)",
    d.kind === "pass");
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
  const d = decide({
    editedFiles: ["src/tests/memory.test.ts", "src/__tests__/util.test.ts"],
    toolResultText: "67 pass\n0 fail\nRan 67 tests across 6 files.",
    mostRecentUserText: "fix the test",
  });
  check(r, "test-only edits + passing run → fast-path pass",
    d.kind === "pass" && d.reason.includes("test-only"));
}
{
  const d = decide({
    editedFiles: ["src/tests/memory.test.ts", "src/memory/extract.ts"],
    toolResultText: "67 pass\n0 fail",
    mostRecentUserText: "fix",
  });
  check(r, "test + non-test edits → fast-path does NOT apply",
    d.kind === "block");
}
{
  const d = decide({
    editedFiles: ["src/tests/memory.test.ts"],
    toolResultText: "FAILED src/tests/memory.test.ts",
    mostRecentUserText: "fix",
  });
  check(r, "test-only edits but failing run → still blocks",
    d.kind === "block");
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
