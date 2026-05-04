#!/usr/bin/env bun
import { check, createResults, printAndExit } from "../eval/harness.ts";
import {
  classifyChange,
  decide,
  extractTurn,
  hasAllVerifyMarkers,
  hasPassEvidence,
  isDocOnly,
  mostRecentUserText,
  scanMarkers,
  turnStartIndex,
  userAffirmedSkip,
} from "../eval/verify-policy.ts";

console.log("[verify-type] bun src/tests/verify-policy.test.ts");
console.log("[verify-surface] verify-policy pure functions: classifyChange, scanMarkers, decide, transcript helpers");
console.log("[verify-behavior] policy honors the structured-marker contract documented in src/eval/verify-policy.ts and rejects malformed input");

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

// ── scanMarkers ──────────────────────────────────────────────────────────────
console.log("--- scanMarkers ---");
{
  const m = scanMarkers(
    "[verify-type] bun run ui:smoke\n" +
    "[verify-surface] 24 routes via routes-meta\n" +
    "[verify-behavior] each page mounts with its own testid\n",
  );
  check(r, "scanMarkers: captures all three structured markers",
    m.type === "bun run ui:smoke"
      && m.surface === "24 routes via routes-meta"
      && m.behavior === "each page mounts with its own testid");
}
{
  const m = scanMarkers("foo\n3 pass\n0 fail\nbar");
  check(r, "scanMarkers: reads bun:test 'N pass / N fail' summary",
    m.passCount === 3 && m.failCount === 0);
}
{
  const m = scanMarkers("==================================================\n30 passed, 0 failed");
  check(r, "scanMarkers: reads repo-harness 'N passed, N failed' summary",
    m.passCount === 30 && m.failCount === 0);
}
{
  const m = scanMarkers("24 passed, 0 failed (3.4s, batch=6)");
  check(r, "scanMarkers: reads custom smoke summary with trailing parens",
    m.passCount === 24 && m.failCount === 0);
}
{
  const m = scanMarkers("smoke complete: all 24 smoke routes passed");
  check(r, "scanMarkers: hasAllPass set for 'all <noun> pass(ed)' phrase",
    m.hasAllPass && m.passCount === 0);
}
{
  const m = scanMarkers("smoke complete: all routes pass cleanly");
  check(r, "scanMarkers: hasAllPass set without count",
    m.hasAllPass);
}
{
  const m = scanMarkers("I would all but pass on this one");
  check(r, "scanMarkers: prose 'all ... pass' without test-noun does NOT match",
    !m.hasAllPass);
}
{
  const m = scanMarkers("3 failures in run");
  check(r, "scanMarkers: reads 'N failures' as failCount",
    m.failCount === 3);
}
{
  const m = scanMarkers("[verify-type] x\n[verify-surface] y\n[verify-behavior] z\n2 pass\n1 fail");
  check(r, "scanMarkers: non-zero failures are caught", m.failCount === 1);
}
{
  const m = scanMarkers("");
  check(r, "scanMarkers: empty output → all nulls/zeros",
    !m.type && !m.surface && !m.behavior && m.passCount === 0 && m.failCount === 0 && !m.hasAllPass);
}

// ── hasAllVerifyMarkers / hasPassEvidence ────────────────────────────────────
console.log("--- helper predicates ---");
check(r, "hasAllVerifyMarkers: requires all three",
  hasAllVerifyMarkers({ type: "a", surface: "b", behavior: "c", passCount: 0, failCount: 0, hasAllPass: false })
    && !hasAllVerifyMarkers({ type: "a", surface: "b", behavior: null, passCount: 0, failCount: 0, hasAllPass: false }));
check(r, "hasPassEvidence: numbered passes + 0 fail",
  hasPassEvidence({ type: null, surface: null, behavior: null, passCount: 5, failCount: 0, hasAllPass: false }));
check(r, "hasPassEvidence: hasAllPass alone is enough",
  hasPassEvidence({ type: null, surface: null, behavior: null, passCount: 0, failCount: 0, hasAllPass: true }));
check(r, "hasPassEvidence: any failures → false",
  !hasPassEvidence({ type: null, surface: null, behavior: null, passCount: 5, failCount: 1, hasAllPass: false }));

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
    toolResultText:
      "[verify-type] bun test src/tests/foo.test.ts\n" +
      "[verify-surface] foo() with edge inputs\n" +
      "[verify-behavior] returns expected shape on negative numbers\n" +
      "3 pass\n0 fail\n",
    mostRecentUserText: "fix the foo bug",
  });
  check(r, "code + all three markers + pass summary → pass",
    d.kind === "pass" && d.reason.includes("returns expected shape"));
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText:
      "[verify-type] bun run ui:smoke\n" +
      "[verify-surface] all routes\n" +
      "[verify-behavior] each route mounts cleanly\n" +
      "all 24 smoke routes passed",
    mostRecentUserText: "fix smoke",
  });
  check(r, "code + all markers + 'all <noun> pass' phrase → pass (no count needed)",
    d.kind === "pass");
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText:
      "[verify-type] x\n[verify-surface] y\n[verify-behavior] z\n2 pass\n1 fail",
    mostRecentUserText: "fix foo",
  });
  check(r, "all markers but tests failed → block",
    d.kind === "block" && d.reason.includes("1 test failure"));
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: "[verify-type] x\n[verify-surface] y\n3 pass\n0 fail",
    mostRecentUserText: "fix foo",
  });
  check(r, "missing one marker → block, names the missing marker",
    d.kind === "block" && d.reason.includes("[verify-behavior]"));
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: "ran some other tests\n5 pass\n0 fail",
    mostRecentUserText: "fix foo",
  });
  check(r, "pass summary but no markers at all → block (no detected: line, just generic reason)",
    d.kind === "block" && !d.reason.includes("Detected:"));
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
    editedFiles: ["src/ui/web/src/pages/Foo.tsx"],
    toolResultText: "bun run build\nclean.",
    mostRecentUserText: "fix the foo page",
  });
  check(r, "code change with no verification → block, with actionable hint",
    d.kind === "block"
      && d.reason.includes("[verify-type]")
      && d.reason.includes("[verify-surface]")
      && d.reason.includes("[verify-behavior]")
      && d.reason.includes("skip verify"));
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: "[verify-what] old format\n3 pass\n0 fail",
    mostRecentUserText: "fix foo",
  });
  check(r, "OLD [verify-what] marker is no longer accepted",
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
    { type: "tool_result", content:
      "[verify-type] bun test src/tests/a.test.ts\n" +
      "[verify-surface] a() return value\n" +
      "[verify-behavior] a behaves correctly on edge input\n" +
      "2 pass\n0 fail" },
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
  check(r, "extractTurn pulls current-turn tool output",
    t.toolResultText.includes("[verify-behavior] a behaves correctly")
      && t.toolResultText.includes("2 pass"));
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
        { type: "text", text: "[verify-type] bun test foo\n[verify-surface] foo()\n[verify-behavior] returns 42\n1 pass\n0 fail" },
      ] },
    ] } },
  );
  const t = extractTurn(arrLines, turnStartIndex(arrLines));
  check(r, "extractTurn handles array-shaped tool_result content",
    t.toolResultText.includes("line 1") && t.toolResultText.includes("[verify-type] bun test foo"));
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
