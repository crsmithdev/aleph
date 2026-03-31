#!/usr/bin/env bun
import { unlinkSync } from "fs";
import {
  createTestEnv, cleanupTestEnv, runHook, check, checkInfo, runAndCheck,
  createResults, printAndExit, userMsg, assistantMsg, writeTranscript,
} from "../eval/harness.ts";

const te = createTestEnv("quality-gate");
const r = createResults();

console.log("--- quality-stop-check-e2e ---");

function verifyGate(transcriptLines: string[], stopHookActive: any = false): string {
  const path = writeTranscript(te, "vgate", transcriptLines);
  const stdin = JSON.stringify({ transcript_path: path, stop_hook_active: stopHookActive });
  const { stdout } = runHook(te, "skills/hooks/quality-stop-check-e2e.ts", stdin);
  try { unlinkSync(path); } catch {}
  return stdout;
}

// --- Core behavior: E2E + artifact required ---

{
  const out = verifyGate([
    userMsg("fix the bug"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
  ]);
  check(r, "vgate: blocks edits without e2e evidence", out.includes("Verification gate"));
  check(r, "vgate: block message shows file", out.includes("foo.ts"));
  check(r, "vgate: block mentions e2e", out.includes("e2e") || out.includes("end-to-end"));
}

{
  const out = verifyGate([
    userMsg("fix the bug"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("running e2e", [{ name: "Bash", input: { command: "npx playwright test --screenshot" } }]),
  ]);
  check(r, "vgate: passes with playwright + screenshot", !out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("fix the bug"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("starting server", [{ name: "Bash", input: { command: "bun run dev" } }]),
    assistantMsg("checking", [{ name: "mcp__chrome-devtools__take_screenshot" }]),
  ]);
  check(r, "vgate: passes with devserver + chrome screenshot", !out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("fix the bug"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("testing", [{ name: "Bash", input: { command: "bun test" } }]),
  ]);
  check(r, "vgate: blocks edits with only unit tests", out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("testing", [{ name: "Bash", input: { command: "npm test" } }]),
  ]);
  check(r, "vgate: blocks npm test (unit tests)", out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("explain the code"),
    assistantMsg("here's what it does", [{ name: "Read", input: { file_path: "/src/foo.ts" } }]),
  ]);
  check(r, "vgate: passes read-only session", !out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("what is a monad"),
    assistantMsg("a monoid in the category of endofunctors"),
  ]);
  check(r, "vgate: passes pure-text conversation", !out.includes("Verification gate"));
}

// --- E2E signal detection ---

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("e2e", [{ name: "Bash", input: { command: "npx cypress run --screenshot" } }]),
  ]);
  check(r, "vgate: detects cypress as e2e", !out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("e2e", [{ name: "Bash", input: { command: "bun run e2e > results.txt" } }]),
  ]);
  check(r, "vgate: detects 'bun run e2e' as e2e", !out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("server", [{ name: "Bash", input: { command: "next dev" } }]),
    assistantMsg("screenshot", [{ name: "mcp__chrome-devtools__take_screenshot" }]),
  ]);
  check(r, "vgate: detects next dev as e2e", !out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("server", [{ name: "Bash", input: { command: "vite dev" } }]),
    assistantMsg("screenshot", [{ name: "mcp__chrome-devtools__take_screenshot" }]),
  ]);
  check(r, "vgate: detects vite dev as e2e", !out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("clicking", [{ name: "mcp__chrome-devtools__click" }]),
    assistantMsg("screenshot", [{ name: "mcp__chrome-devtools__take_screenshot" }]),
  ]);
  check(r, "vgate: chrome devtools click + screenshot passes", !out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("server", [{ name: "Bash", input: { command: "bun run dev" } }]),
  ]);
  check(r, "vgate: blocks e2e without artifact", out.includes("Verification gate"));
  check(r, "vgate: block mentions artifact", out.includes("artifact"));
}

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("saving", [{ name: "Bash", input: { command: "echo 'done' > results.txt" } }]),
  ]);
  check(r, "vgate: blocks artifact without e2e", out.includes("Verification gate"));
}

// --- stop_hook_active loop prevention ---

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("done", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
  ], true);
  check(r, "vgate: skips when stop_hook_active=true", !out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("done", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
  ], "true");
  check(r, "vgate: skips when stop_hook_active='true' (string truthy)", !out.includes("Verification gate"));
}

// --- Turn scoping ---

{
  const out = verifyGate([
    userMsg("first task"),
    assistantMsg("verified", [
      { name: "Bash", input: { command: "npx playwright test --screenshot" } },
    ]),
    userMsg("second task"),
    assistantMsg("editing", [{ name: "Edit", input: { file_path: "/src/bar.ts" } }]),
  ]);
  check(r, "vgate: blocks when e2e was in previous turn", out.includes("Verification gate"));
}

{
  const toolResultUser = JSON.stringify({ type: "user", message: { role: "user", content: [] } });
  const out = verifyGate([
    userMsg("fix the bug"),
    assistantMsg("reading", [{ name: "Read", input: { file_path: "/src/foo.ts" } }]),
    toolResultUser,
    assistantMsg("fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    toolResultUser,
    assistantMsg("done, the bug is fixed"),
  ]);
  check(r, "vgate: tool-result user messages don't split turn", out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("fix the bug"),
    assistantMsg("checking first", [{ name: "Bash", input: { command: "npx playwright test --screenshot" } }]),
    assistantMsg("now fixing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
  ]);
  check(r, "vgate: passes e2e-before-edit ordering", !out.includes("Verification gate"));
}

// --- Edit tool coverage ---

{
  const out = verifyGate([
    userMsg("create a file"),
    assistantMsg("creating", [{ name: "Write", input: { file_path: "/src/new.ts" } }]),
  ]);
  check(r, "vgate: detects Write tool as edit", out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("edit the notebook"),
    assistantMsg("editing", [{ name: "NotebookEdit", input: { file_path: "/nb.ipynb" } }]),
  ]);
  check(r, "vgate: detects NotebookEdit as edit", out.includes("Verification gate"));
}

// --- Known gaps (informational) ---

{
  const out = verifyGate([
    userMsg("write a file"),
    assistantMsg("writing via bash", [{ name: "Bash", input: { command: "echo 'hello' > /src/foo.ts" } }]),
  ]);
  checkInfo(r, "vgate: Bash file writes bypass gate (known gap)", !out.includes("Verification gate"));
}

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("dispatching", [{ name: "Agent", input: { prompt: "fix the bug" } }]),
  ]);
  checkInfo(r, "vgate: Agent tool edits bypass gate (known gap)", !out.includes("Verification gate"));
}

// --- Transcript edge cases ---

{
  const out = verifyGate([]);
  check(r, "vgate: empty transcript passes", !out.includes("Verification gate"));
}

{
  const out = verifyGate([
    assistantMsg("editing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
  ]);
  check(r, "vgate: no user message still detects edits", out.includes("Verification gate"));
}

{
  const path = writeTranscript(te, "vgate-malformed", [
    userMsg("fix it"),
    "not valid json at all",
    "}{garbage",
    assistantMsg("editing", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
  ]);
  const stdin = JSON.stringify({ transcript_path: path });
  const { stdout: out } = runHook(te, "skills/hooks/quality-stop-check-e2e.ts", stdin);
  check(r, "vgate: handles malformed JSON lines gracefully", out.includes("Verification gate"));
  try { unlinkSync(path); } catch {}
}

// --- File tracking ---

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("edit 1", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("edit 2", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
    assistantMsg("edit 3", [{ name: "Edit", input: { file_path: "/src/foo.ts" } }]),
  ]);
  check(r, "vgate: deduplicates file paths", out.includes("Verification gate"));
  const match = out.match(/\(([^)]+)\)/);
  if (match) {
    const count = (match[1].match(/foo\.ts/g) ?? []).length;
    check(r, "vgate: file appears only once in message", count === 1);
  } else {
    check(r, "vgate: file appears only once in message", false);
  }
}

{
  const edits = Array.from({ length: 15 }, (_, i) =>
    assistantMsg(`edit ${i}`, [{ name: "Edit", input: { file_path: `/src/file${i}.ts` } }])
  );
  const out = verifyGate([userMsg("big refactor"), ...edits]);
  check(r, "vgate: blocks with many files", out.includes("Verification gate"));
  const match = out.match(/\(([^)]+)\)/);
  if (match) {
    const fileCount = match[1].split(",").length;
    check(r, "vgate: caps displayed files at 10", fileCount <= 10);
  } else {
    check(r, "vgate: caps displayed files at 10", false);
  }
}

{
  const out = verifyGate([
    userMsg("fix it"),
    assistantMsg("editing", [{ name: "Edit", input: {} }]),
  ]);
  check(r, "vgate: edit with no file_path still triggers gate", out.includes("Verification gate"));
}

// --- Missing/invalid stdin ---

runAndCheck(te, r, "skills/hooks/quality-stop-check-e2e.ts", "malformed stdin", "not json");
runAndCheck(te, r, "skills/hooks/quality-stop-check-e2e.ts", "empty object", "{}");
runAndCheck(te, r, "skills/hooks/quality-stop-check-e2e.ts", "missing transcript_path", '{"stop_hook_active": false}');

cleanupTestEnv(te);
printAndExit(r);
