#!/usr/bin/env bun
/**
 * Dispatch gate E2E test.
 *
 * Tests the full dispatch lifecycle by running hooks as real subprocesses
 * with a shared temp signals directory. Verifies the entire pipeline:
 *
 *   routing-submit-classify (UserPromptSubmit)
 *     → writes directives, creates current-session-id marker
 *   dispatch-pre-require-subagent (PreToolUse)
 *     → blocks main session edits, allows subagents + inline overrides
 *   dispatch-stop-remind (Stop)
 *     → periodic reminder at every 5th stop
 */

import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, unlinkSync, rmSync } from "fs";
import { join, resolve } from "path";
import { tmpdir } from "os";

const BUN = process.argv[0];
// __tests__ → hooks → skills → src → repo root
const ROOT = resolve(import.meta.dir, "../../../..");
const hook = (path: string) => join(ROOT, "src", path);

const tmpBase = mkdtempSync(join(tmpdir(), "construct-dispatch-e2e-"));
const signalsDir = join(tmpBase, "signals");
mkdirSync(signalsDir, { recursive: true });

const env = { ...process.env, CONSTRUCT_DATA_ROOT: tmpBase };

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${name}`);
    passed++;
  } else {
    const msg = detail ? `${name} — ${detail}` : name;
    console.log(`  ✗ ${msg}`);
    failures.push(msg);
    failed++;
  }
}

function runHook(hookPath: string, stdin: string): { stdout: string; exitCode: number } {
  try {
    const stdout = execSync(
      `echo '${stdin.replace(/'/g, "'\\''")}' | ${BUN} ${hook(hookPath)} 2>/dev/null`,
      { encoding: "utf-8", timeout: 15000, env, cwd: ROOT },
    );
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout ?? "", exitCode: err.status ?? 1 };
  }
}

function clearFile(path: string) {
  try { unlinkSync(path); } catch {}
}

const MAIN_SESSION_ID = `e2e-main-${process.pid}`;
const SUB_SESSION_ID = `e2e-sub-${process.pid}`;

const csidPath = join(signalsDir, "current-session-id");
const overridePath = join(signalsDir, `inline-override-${MAIN_SESSION_ID}`);
const directivesPath = join(signalsDir, "directives.jsonl");
const counterPath = join(signalsDir, "dispatch-stop-remind-count");

// ═══════════════════════════════════════════════════════════════════════════
// Phase 1: Routing classifier creates dispatch state
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 1: Routing classifier ---");

// Architectural prompt → DISPATCH MODE + directives + session marker
{
  clearFile(csidPath);
  clearFile(directivesPath);

  const { stdout } = runHook("skills/hooks/routing-submit-classify.ts", JSON.stringify({
    prompt: "refactor the authentication module to use a completely new pattern across all files",
    session_id: MAIN_SESSION_ID,
  }));

  check("architectural prompt emits DISPATCH MODE", stdout.includes("DISPATCH MODE"));
  check("architectural prompt emits verification gate", stdout.includes("Verification gate"));
  check("architectural prompt emits FULL depth", stdout.includes("FULL"));

  check("current-session-id marker created", existsSync(csidPath));
  const writtenId = existsSync(csidPath) ? readFileSync(csidPath, "utf-8").trim() : "";
  check("marker contains correct session ID", writtenId === MAIN_SESSION_ID,
    `got="${writtenId}" expected="${MAIN_SESSION_ID}"`);

  check("directives file created", existsSync(directivesPath));
  if (existsSync(directivesPath)) {
    const lines = readFileSync(directivesPath, "utf-8").trim().split("\n").filter(Boolean);
    const record = JSON.parse(lines[lines.length - 1]);
    check("directive includes 'dispatch'", record.directives.includes("dispatch"));
    check("directive includes 'full'", record.directives.includes("full"));
    check("directive has session ID", record.sessionId === MAIN_SESSION_ID);
    check("directive has promptWords > 0", record.promptWords > 0);
  }
}

// Quick prompt → no dispatch, no directives
{
  clearFile(directivesPath);

  const { stdout } = runHook("skills/hooks/routing-submit-classify.ts", JSON.stringify({
    prompt: "fix the typo on line 42",
    session_id: "test-quick",
  }));

  check("quick prompt does NOT emit DISPATCH MODE", !stdout.includes("DISPATCH MODE"));
  check("quick prompt does NOT emit FULL", !stdout.includes("FULL"));
  const directives = existsSync(directivesPath) ? readFileSync(directivesPath, "utf-8").trim() : "";
  check("quick prompt writes no directives", directives === "");
}

// Question prompt → full but no dispatch
{
  clearFile(directivesPath);

  const { stdout } = runHook("skills/hooks/routing-submit-classify.ts", JSON.stringify({
    prompt: "how does the authentication module work and what is the overall architecture of the system",
    session_id: "test-question",
  }));

  check("question emits FULL depth", stdout.includes("FULL"));
  check("question does NOT emit DISPATCH MODE", !stdout.includes("DISPATCH MODE"));

  if (existsSync(directivesPath)) {
    const lines = readFileSync(directivesPath, "utf-8").trim().split("\n").filter(Boolean);
    const record = JSON.parse(lines[lines.length - 1]);
    check("question directive has 'full' but not 'dispatch'",
      record.directives.includes("full") && !record.directives.includes("dispatch"));
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 2: Dispatch gate blocks/allows based on session identity
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 2: Dispatch gate enforcement ---");

writeFileSync(csidPath, MAIN_SESSION_ID);
clearFile(overridePath);

// Main session Edit → BLOCKED (exit 2)
{
  const { stdout, exitCode } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: MAIN_SESSION_ID,
    tool_name: "Edit",
  }));
  check("main session Edit blocked", exitCode === 2, `exitCode=${exitCode}`);
  check("block message mentions dispatch", stdout.includes("Dispatch required"));
}

// Main session Write → BLOCKED (exit 2)
{
  const { exitCode } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: MAIN_SESSION_ID,
    tool_name: "Write",
  }));
  check("main session Write blocked", exitCode === 2, `exitCode=${exitCode}`);
}

// Subagent (different session ID) Edit → ALLOWED (exit 0)
{
  const { exitCode } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: SUB_SESSION_ID,
    tool_name: "Edit",
  }));
  check("subagent Edit allowed", exitCode === 0, `exitCode=${exitCode}`);
}

// Subagent Write → ALLOWED
{
  const { exitCode } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: SUB_SESSION_ID,
    tool_name: "Write",
  }));
  check("subagent Write allowed", exitCode === 0, `exitCode=${exitCode}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 3: Inline override lifts the gate
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 3: Inline override ---");

writeFileSync(overridePath, "");

// Main session Edit with override → ALLOWED
{
  const { exitCode } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: MAIN_SESSION_ID,
    tool_name: "Edit",
  }));
  check("main session Edit allowed with inline override", exitCode === 0, `exitCode=${exitCode}`);
}

// Remove override → blocked again
clearFile(overridePath);
{
  const { exitCode } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: MAIN_SESSION_ID,
    tool_name: "Edit",
  }));
  check("main session Edit blocked after override removed", exitCode === 2, `exitCode=${exitCode}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 4: Edge cases
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 4: Edge cases ---");

// No current-session-id file → treat as subagent, allow
{
  clearFile(csidPath);
  const { exitCode } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: "unknown-session",
    tool_name: "Edit",
  }));
  check("no marker file → allowed (treated as subagent)", exitCode === 0, `exitCode=${exitCode}`);
}

// No session_id in input → allow
{
  writeFileSync(csidPath, MAIN_SESSION_ID);
  const { exitCode } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    tool_name: "Edit",
  }));
  check("no session_id in input → allowed", exitCode === 0, `exitCode=${exitCode}`);
}

// Malformed stdin → allow (graceful, no crash)
{
  const { exitCode } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", "not json at all");
  check("malformed stdin → allowed (graceful exit)", exitCode === 0, `exitCode=${exitCode}`);
}

// Empty session_id → allow
{
  const { exitCode } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: "",
    tool_name: "Edit",
  }));
  check("empty session_id → allowed", exitCode === 0, `exitCode=${exitCode}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 5: Stop reminder lifecycle
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 5: Stop reminder counter ---");

clearFile(counterPath);

// Run stop hook 5 times — reminder should appear on 5th
{
  let reminderCount = 0;
  for (let i = 1; i <= 5; i++) {
    const { stdout } = runHook("skills/hooks/dispatch-stop-remind.ts", JSON.stringify({
      session_id: MAIN_SESSION_ID,
    }));
    if (stdout.includes("Reminder")) reminderCount++;

    if (i < 5) {
      check(`stop #${i}: no reminder`, !stdout.includes("Reminder"));
    } else {
      check(`stop #${i}: reminder emitted`, stdout.includes("Reminder"));
    }
  }
  check("exactly 1 reminder in 5 stops", reminderCount === 1, `got=${reminderCount}`);

  check("counter file exists", existsSync(counterPath));
  if (existsSync(counterPath)) {
    const counterVal = parseInt(readFileSync(counterPath, "utf-8").trim(), 10);
    check("counter at 5 after 5 invocations", counterVal === 5, `got=${counterVal}`);
  }
}

// Run 5 more (6-10) — reminder on 10th
{
  let gotReminder = false;
  for (let i = 6; i <= 10; i++) {
    const { stdout } = runHook("skills/hooks/dispatch-stop-remind.ts", JSON.stringify({
      session_id: MAIN_SESSION_ID,
    }));
    if (i === 10) {
      gotReminder = stdout.includes("Reminder");
      check("stop #10: reminder emitted", gotReminder);
    }
  }
  if (existsSync(counterPath)) {
    const counterVal = parseInt(readFileSync(counterPath, "utf-8").trim(), 10);
    check("counter at 10 after 10 invocations", counterVal === 10, `got=${counterVal}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 6: Full lifecycle simulation
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 6: Full lifecycle ---");

{
  clearFile(csidPath);
  clearFile(overridePath);
  clearFile(directivesPath);

  // Step 1: User submits architectural prompt
  const { stdout: classifyOut } = runHook("skills/hooks/routing-submit-classify.ts", JSON.stringify({
    prompt: "migrate the database schema to support multi-tenancy across all services",
    session_id: MAIN_SESSION_ID,
  }));
  check("lifecycle: classifier emits DISPATCH MODE", classifyOut.includes("DISPATCH MODE"));

  // Step 2: Main session tries to edit → blocked
  const { exitCode: mainBlocked } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: MAIN_SESSION_ID,
    tool_name: "Edit",
  }));
  check("lifecycle: main session blocked after classify", mainBlocked === 2, `exitCode=${mainBlocked}`);

  // Step 3: Subagent edits → allowed
  const { exitCode: subAllowed } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: SUB_SESSION_ID,
    tool_name: "Write",
  }));
  check("lifecycle: subagent allowed", subAllowed === 0, `exitCode=${subAllowed}`);

  // Step 4: User creates inline override
  writeFileSync(overridePath, "");
  const { exitCode: overrideAllowed } = runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: MAIN_SESSION_ID,
    tool_name: "Edit",
  }));
  check("lifecycle: main session allowed after override", overrideAllowed === 0, `exitCode=${overrideAllowed}`);

  // Step 5: Verify state files
  check("lifecycle: directives file exists", existsSync(directivesPath));
  check("lifecycle: current-session-id exists", existsSync(csidPath));
}

// ═══════════════════════════════════════════════════════════════════════════
// Phase 7: Hook event reporting
// ═══════════════════════════════════════════════════════════════════════════

console.log("\n--- Phase 7: Hook event reporting ---");

{
  const hookEventsPath = join(signalsDir, "hook-events.jsonl");
  clearFile(hookEventsPath);

  writeFileSync(csidPath, MAIN_SESSION_ID);
  clearFile(overridePath);

  runHook("skills/hooks/dispatch-pre-require-subagent.ts", JSON.stringify({
    session_id: MAIN_SESSION_ID,
    tool_name: "Edit",
  }));

  check("hook-events.jsonl created", existsSync(hookEventsPath));
  if (existsSync(hookEventsPath)) {
    const lines = readFileSync(hookEventsPath, "utf-8").trim().split("\n").filter(Boolean);
    const lastEvent = JSON.parse(lines[lines.length - 1]);
    check("hook event has correct hook name", lastEvent.hook === "dispatch-pre-require-subagent");
    check("hook event has correct event type", lastEvent.event === "PreToolUse");
    check("hook event has session ID", lastEvent.sessionId === MAIN_SESSION_ID);
    check("hook event has timestamp", typeof lastEvent.ts === "string" && lastEvent.ts.length > 0);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Cleanup & results
// ═══════════════════════════════════════════════════════════════════════════

try { rmSync(tmpBase, { recursive: true }); } catch {}

console.log(`\n${"=".repeat(50)}`);
console.log(`${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log("\nFailures:");
  for (const f of failures) console.log(`  - ${f}`);
}
process.exit(failed > 0 ? 1 : 0);
