#!/usr/bin/env bun
import { check, createResults, printAndExit } from "../eval/harness.ts";
import {
  classifyChange,
  decide,
  extractTurn,
  isDocOnly,
  mostRecentUserText,
  scanMarkers,
  turnStartIndex,
  userAffirmedSkip,
} from "../eval/verify-policy.ts";

console.log("[verify-what] verify-policy classifier, marker scanner, affirmation detector, and decide() all behave per the contract documented in src/eval/verify-policy.ts");

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
  const m = scanMarkers("[verify-what] research graph canvas non-zero size on first paint");
  check(r, "scanMarkers: captures verify-what description",
    m.hasWhat && m.whatText === "research graph canvas non-zero size on first paint");
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
  const m = scanMarkers("[verify-what] x\n2 pass\n1 fail");
  check(r, "scanMarkers: non-zero failures are caught", m.failCount === 1);
}
{
  const m = scanMarkers("");
  check(r, "scanMarkers: empty output → all zeros",
    !m.hasWhat && m.passCount === 0 && m.failCount === 0);
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
    toolResultText: "[verify-what] foo returns expected shape\n3 pass\n0 fail\n",
    mostRecentUserText: "fix the foo bug",
  });
  check(r, "code + verify-what + pass summary → pass",
    d.kind === "pass" && d.reason.includes("foo returns expected shape"));
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: "[verify-what] foo\n2 pass\n1 fail",
    mostRecentUserText: "fix foo",
  });
  check(r, "marker present but tests failed → block", d.kind === "block");
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: "ran some other tests\n5 pass\n0 fail",
    mostRecentUserText: "fix foo",
  });
  check(r, "pass summary but no verify-what → block", d.kind === "block");
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
      && d.reason.includes("[verify-what]")
      && d.reason.includes("skip verify"));
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
    { type: "tool_result", content: "[verify-what] a behaves correctly\n2 pass\n0 fail" },
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
    t.toolResultText.includes("[verify-what] a behaves correctly")
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
        { type: "text", text: "[verify-what] x\n1 pass\n0 fail" },
      ] },
    ] } },
  );
  const t = extractTurn(arrLines, turnStartIndex(arrLines));
  check(r, "extractTurn handles array-shaped tool_result content",
    t.toolResultText.includes("line 1") && t.toolResultText.includes("[verify-what] x"));
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
