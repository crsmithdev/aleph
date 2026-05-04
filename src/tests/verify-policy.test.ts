#!/usr/bin/env bun
import { check, createResults, printAndExit } from "../eval/harness.ts";
import {
  classifyChange,
  decide,
  extractTurn,
  hasAllVerifyMarkers,
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
  const m = scanMarkers("");
  check(r, "scanMarkers: empty output → all nulls",
    !m.type && !m.surface && !m.behavior);
}
{
  const m = scanMarkers("only [verify-type] X here");
  check(r, "scanMarkers: partial output → only present markers populated",
    m.type === "X here" && !m.surface && !m.behavior);
}

// ── hasAllVerifyMarkers ──────────────────────────────────────────────────────
console.log("--- hasAllVerifyMarkers ---");
check(r, "all three present → true",
  hasAllVerifyMarkers({ type: "a", surface: "b", behavior: "c" }));
check(r, "any one missing → false",
  !hasAllVerifyMarkers({ type: "a", surface: "b", behavior: null })
    && !hasAllVerifyMarkers({ type: null, surface: "b", behavior: "c" })
    && !hasAllVerifyMarkers({ type: "a", surface: null, behavior: "c" }));

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
      "[verify-behavior] returns expected shape on negative numbers\n",
    mostRecentUserText: "fix the foo bug",
  });
  check(r, "code + all three markers → pass (no test summary required)",
    d.kind === "pass" && d.reason.includes("returns expected shape"));
}
{
  // The whole point of this redesign: the policy does not look for fail
  // counts in tool output, so prose mentioning failures cannot block when
  // the markers are present.
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText:
      "[verify-type] bun test\n" +
      "[verify-surface] foo()\n" +
      "[verify-behavior] foo() handles edge case\n" +
      "...the system processed 151 failures during the migration window last week",
    mostRecentUserText: "fix",
  });
  check(r, "stray 'N failures' prose with all three markers → pass (no false-positive block)",
    d.kind === "pass");
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: "[verify-type] x\n[verify-surface] y",
    mostRecentUserText: "fix foo",
  });
  check(r, "missing one marker → block, names the missing marker",
    d.kind === "block" && d.reason.includes("[verify-behavior]"));
}
{
  const d = decide({
    editedFiles: ["src/foo.ts"],
    toolResultText: "ran some tests; 5 pass, 0 fail, looked good",
    mostRecentUserText: "fix foo",
  });
  check(r, "test summary alone (no markers) → block",
    d.kind === "block");
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
    toolResultText: "[verify-what] old format — no longer accepted",
    mostRecentUserText: "fix foo",
  });
  check(r, "OLD [verify-what] marker is not accepted",
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
      "[verify-behavior] a behaves correctly on edge input" },
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
    t.toolResultText.includes("[verify-behavior] a behaves correctly"));
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
        { type: "text", text: "[verify-type] bun test foo\n[verify-surface] foo()\n[verify-behavior] returns 42" },
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
