#!/usr/bin/env bun
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import {
  createTestEnv, cleanupTestEnv, runHook, check, runAndCheck,
  createResults, printAndExit,
} from "../eval/harness.ts";

const te = createTestEnv("dispatch-gate");
const r = createResults();

// ── Dispatch gate ───────────────────────────────────────────────────────────

console.log("--- dispatch-pre-require-subagent ---");

// No current-session-id file → treat as subagent, allow (exit 0)
{
  const csidPath = resolve(te.signalsDir, "current-session-id");
  try { unlinkSync(csidPath); } catch {}
  runAndCheck(te, r, "skills/hooks/dispatch-pre-require-subagent.ts", "no marker allows",
    JSON.stringify({ session_id: `test-nomarker-${process.pid}`, tool_name: "Edit" }));
}

// Main session (matching current-session-id) → block (exit 2)
{
  const gateSessionId = `test-gate-${process.pid}`;
  writeFileSync(resolve(te.signalsDir, "current-session-id"), gateSessionId);
  runAndCheck(te, r, "skills/hooks/dispatch-pre-require-subagent.ts", "marker blocks edit",
    JSON.stringify({ session_id: gateSessionId, tool_name: "Edit" }),
    { expectExit: 2, expectStdout: ["Dispatch required"] });
  try { unlinkSync(resolve(te.signalsDir, "current-session-id")); } catch {}
}

// No session_id → allow
runAndCheck(te, r, "skills/hooks/dispatch-pre-require-subagent.ts", "no session_id allows",
  JSON.stringify({ tool_name: "Edit" }));

// Malformed stdin → fail closed (exit 1, security gate)
runAndCheck(te, r, "skills/hooks/dispatch-pre-require-subagent.ts", "malformed stdin blocks", "not json", { expectExit: 1 });

// ── Directive signal writing ────────────────────────────────────────────────

console.log("\n--- directive signals ---");

{
  const directivesFile = resolve(te.signalsDir, "directives.jsonl");
  try { unlinkSync(directivesFile); } catch {}

  // Architectural prompt → should write dispatch + full directives
  runHook(te, "skills/hooks/routing-submit-classify.ts", JSON.stringify({
    prompt: "refactor the authentication module to use a completely new pattern across all files",
    session_id: "test-directive-write",
  }));

  if (existsSync(directivesFile)) {
    const lines = readFileSync(directivesFile, "utf-8").trim().split("\n").filter(Boolean);
    const record = JSON.parse(lines[lines.length - 1]);
    check(r, "directive: written for architectural prompt", record.sessionId === "test-directive-write");
    check(r, "directive: includes dispatch", record.directives.includes("dispatch"));
    check(r, "directive: includes full", record.directives.includes("full"));
    check(r, "directive: has promptWords", record.promptWords > 0);
  } else {
    check(r, "directive: written for architectural prompt", false);
    check(r, "directive: includes dispatch", false);
    check(r, "directive: includes full", false);
    check(r, "directive: has promptWords", false);
  }

  // Quick prompt → no directive written
  const linesBefore = existsSync(directivesFile)
    ? readFileSync(directivesFile, "utf-8").trim().split("\n").filter(Boolean).length
    : 0;
  runHook(te, "skills/hooks/routing-submit-classify.ts", JSON.stringify({
    prompt: "fix the typo on line 42",
    session_id: "test-no-directive",
  }));
  const linesAfter = existsSync(directivesFile)
    ? readFileSync(directivesFile, "utf-8").trim().split("\n").filter(Boolean).length
    : 0;
  check(r, "directive: not written for quick prompt", linesAfter === linesBefore);

  // Question prompt → full but no dispatch
  runHook(te, "skills/hooks/routing-submit-classify.ts", JSON.stringify({
    prompt: "how does the authentication module work and what is the overall architecture of the system",
    session_id: "test-question-directive",
  }));
  if (existsSync(directivesFile)) {
    const lines = readFileSync(directivesFile, "utf-8").trim().split("\n").filter(Boolean);
    const record = JSON.parse(lines[lines.length - 1]);
    check(r, "directive: question gets full but not dispatch",
      record.directives.includes("full") && !record.directives.includes("dispatch"));
  } else {
    check(r, "directive: question gets full but not dispatch", false);
  }

  // Current-session-id creation
  {
    const markerSessionId = `test-marker-${process.pid}`;
    const csidPath = resolve(te.signalsDir, "current-session-id");
    try { unlinkSync(csidPath); } catch {}

    runHook(te, "skills/hooks/routing-submit-classify.ts", JSON.stringify({
      prompt: "refactor the entire authentication system to use OAuth2",
      session_id: markerSessionId,
    }));

    const written = existsSync(csidPath) && readFileSync(csidPath, "utf-8").trim() === markerSessionId;
    check(r, "directive: dispatch marker created", written);
    try { unlinkSync(csidPath); } catch {}
  }

  try { unlinkSync(directivesFile); } catch {}
}

cleanupTestEnv(te);
printAndExit(r);
