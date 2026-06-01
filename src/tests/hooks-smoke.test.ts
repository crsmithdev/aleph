#!/usr/bin/env bun
import { writeFileSync, unlinkSync, readFileSync, existsSync } from "fs";
import { resolve } from "path";
import {
  createTestEnv, cleanupTestEnv, runHook, check, runAndCheck,
  createResults, printAndExit,
} from "../eval/harness.ts";

const te = createTestEnv("hooks-smoke");
const r = createResults();

// ── Quality hook ─────────────────────────────────────────────────────────────

console.log("--- quality ---");
runAndCheck(te, r, "core/hooks/quality-format-edit.ts", "smoke", "{}");
runAndCheck(te, r, "core/hooks/quality-format-edit.ts", "missing file", '{"tool_input":{"file_path":"/nonexistent/file.ts"}}');
runAndCheck(te, r, "core/hooks/quality-format-edit.ts", "malformed", "not json", { expectExit: 1 });

// ── Git hygiene stop ─────────────────────────────────────────────────────────

console.log("\n--- git-hygiene-stop ---");
runAndCheck(te, r, "core/hooks/git-hygiene-stop.ts", "smoke (no cwd)", "{}");
runAndCheck(te, r, "core/hooks/git-hygiene-stop.ts", "stop_hook_active guard", '{"stop_hook_active":true}');
runAndCheck(te, r, "core/hooks/git-hygiene-stop.ts", "non-end_of_turn stop_reason", '{"stop_reason":"interrupt"}');
runAndCheck(te, r, "core/hooks/git-hygiene-stop.ts", "malformed stdin", "not json", { expectExit: 1 });

// ── Quality check stop ───────────────────────────────────────────────────────

console.log("\n--- quality-check-stop ---");
runAndCheck(te, r, "core/hooks/quality-check-stop.ts", "smoke (no transcript)", "{}");
runAndCheck(te, r, "core/hooks/quality-check-stop.ts", "stop_hook_active guard", '{"stop_hook_active":true}');
runAndCheck(te, r, "core/hooks/quality-check-stop.ts", "non-end_of_turn stop_reason", '{"stop_reason":"interrupt"}');
runAndCheck(te, r, "core/hooks/quality-check-stop.ts", "malformed stdin", "not json", { expectExit: 1 });

// ── Isolation block SQL ──────────────────────────────────────────────────────

console.log("\n--- isolation-block-sql ---");
runAndCheck(te, r, "core/hooks/isolation-block-sql.ts", "smoke (no tool_name)", "{}");
runAndCheck(te, r, "core/hooks/isolation-block-sql.ts", "non-SQL tool allowed", '{"tool_name":"Bash","tool_input":{"command":"ls"}}');
runAndCheck(te, r, "core/hooks/isolation-block-sql.ts", "execute_sql safe SELECT", '{"tool_name":"execute_sql","tool_input":{"query":"SELECT * FROM users WHERE id = 1"}}');
runAndCheck(te, r, "core/hooks/isolation-block-sql.ts", "execute_sql DROP TABLE blocked", '{"tool_name":"execute_sql","tool_input":{"query":"DROP TABLE users"}}', { expectExit: 2 });
runAndCheck(te, r, "core/hooks/isolation-block-sql.ts", "execute_sql TRUNCATE blocked", '{"tool_name":"execute_sql","tool_input":{"query":"TRUNCATE users"}}', { expectExit: 2 });
runAndCheck(te, r, "core/hooks/isolation-block-sql.ts", "malformed stdin", "not json", { expectExit: 1 });

// ── Security scan bash ───────────────────────────────────────────────────────

console.log("\n--- security-scan-bash ---");
runAndCheck(te, r, "core/hooks/security-scan-bash.ts", "smoke (no command)", "{}");
runAndCheck(te, r, "core/hooks/security-scan-bash.ts", "non-commit command", '{"tool_input":{"command":"ls -la"}}');
runAndCheck(te, r, "core/hooks/security-scan-bash.ts", "malformed stdin", "not json", { expectExit: 1 });

// ── Quality typecheck edit ────────────────────────────────────────────────────

console.log("\n--- quality-typecheck-edit ---");
runAndCheck(te, r, "core/hooks/quality-typecheck-edit.ts", "smoke (no file_path)", "{}");
runAndCheck(te, r, "core/hooks/quality-typecheck-edit.ts", "markdown file skipped", '{"tool_input":{"file_path":"/some/file.md"}}');
runAndCheck(te, r, "core/hooks/quality-typecheck-edit.ts", "non-ts extension skipped", '{"tool_input":{"file_path":"/some/file.css"}}');
runAndCheck(te, r, "core/hooks/quality-typecheck-edit.ts", "malformed stdin", "not json", { expectExit: 1 });

// ── Context backup precompact ─────────────────────────────────────────────────

console.log("\n--- context-backup-precompact ---");
runAndCheck(te, r, "core/hooks/context-backup-precompact.ts", "smoke (no transcript)", "{}");
runAndCheck(te, r, "core/hooks/context-backup-precompact.ts", "malformed stdin", "not json", { expectExit: 1 });

// ── Context monitor stop ──────────────────────────────────────────────────────

console.log("\n--- context-monitor-stop ---");
runAndCheck(te, r, "core/hooks/context-monitor-stop.ts", "smoke (no transcript)", "{}");
runAndCheck(te, r, "core/hooks/context-monitor-stop.ts", "malformed stdin", "not json", { expectExit: 1 });

// ── Context suggest edit ──────────────────────────────────────────────────────

console.log("\n--- context-suggest-edit ---");
runAndCheck(te, r, "core/hooks/context-suggest-edit.ts", "smoke (no session_id)", "{}");
runAndCheck(te, r, "core/hooks/context-suggest-edit.ts", "below threshold (count=1)", '{"session_id":"test-smoke-session"}');
runAndCheck(te, r, "core/hooks/context-suggest-edit.ts", "malformed stdin", "not json", { expectExit: 1 });

// ── Git require edit ──────────────────────────────────────────────────────────

console.log("\n--- git-require-edit ---");
runAndCheck(te, r, "core/hooks/git-require-edit.ts", "smoke (no cwd)", "{}");
runAndCheck(te, r, "core/hooks/git-require-edit.ts", "nonexistent cwd (git fails, swallowed)", '{"cwd":"/nonexistent/path","session_id":"test-smoke"}');
runAndCheck(te, r, "core/hooks/git-require-edit.ts", "malformed stdin", "not json", { expectExit: 1 });

// ── Context restore start behavioral ─────────────────────────────────────────

console.log("\n--- context-restore-start behavioral ---");

const restoreResult = runHook(te, "memory/hooks/context-restore-start.ts", '{"cwd":"/tmp"}');
check(r, "context-restore-start: exits 0", restoreResult.exitCode === 0);
check(r, "context-restore-start: prints Session Start header", restoreResult.stdout.includes("=== Session Start ==="));
check(r, "context-restore-start: prints Sessions: line", restoreResult.stdout.includes("Sessions:"));
check(r, "context-restore-start: Sessions: 0 in empty env", restoreResult.stdout.includes("Sessions: 0"));
runAndCheck(te, r, "memory/hooks/context-restore-start.ts", "context-restore-start: malformed stdin", "not json", { expectExit: 1 });

// ── Routing classify behavioral ──────────────────────────────────────────────

console.log("\n--- routing-classify-submit behavioral ---");

// < 3 words → skip immediately, no stdout
const shortResult = runHook(te, "core/hooks/routing-classify-submit.ts", '{"prompt":"fix bug"}');
check(r, "routing: <3 words exits 0", shortResult.exitCode === 0);
check(r, "routing: <3 words no stdout", shortResult.stdout.trim() === "");

// No mode trigger → no mode block
const noModeResult = runHook(te, "core/hooks/routing-classify-submit.ts", '{"prompt":"update the button color to blue"}');
check(r, "routing: no trigger → no Modes block", !noModeResult.stdout.includes("[Aleph] Modes active"));

// Mode activation via trigger keyword → names + inlines the mode
const modeResult = runHook(te, "core/hooks/routing-classify-submit.ts", '{"prompt":"go ahead and implement it now"}');
check(r, "routing: trigger → Modes active line", modeResult.stdout.includes("[Aleph] Modes active: execution"));
check(r, "routing: mode body inlined", modeResult.stdout.includes("# Execution Mode"));

// Skill matching — "audit the code" is triggered by code-review
const skillResult = runHook(te, "core/hooks/routing-classify-submit.ts", '{"prompt":"audit the code on this branch"}');
check(r, "routing: skill match emits Matched skills line", skillResult.stdout.includes("[Aleph] Matched skills:"));
check(r, "routing: code-review skill matched", skillResult.stdout.includes("code-review"));

// Malformed stdin → exit 1
runAndCheck(te, r, "core/hooks/routing-classify-submit.ts", "routing: malformed stdin", "not json", { expectExit: 1 });

// ── reportHook() telemetry ────────────────────────────────────────────────────

console.log("\n--- hook telemetry (reportHook) ---");

// All hooks run above have written entries. Read the accumulated JSONL.
const hookEventsPath = resolve(te.tmpBase, "signals/events.jsonl");
check(r, "events.jsonl exists", existsSync(hookEventsPath));

if (existsSync(hookEventsPath)) {
  const lines = readFileSync(hookEventsPath, "utf8").trim().split("\n").filter(Boolean);
  check(r, "events.jsonl has entries", lines.length > 0);

  // Every line must be valid JSON with required fields
  const entries = lines.map(l => { try { return JSON.parse(l); } catch { return null; } });
  check(r, "all hook-events lines are valid JSON", entries.every(e => e !== null));
  check(r, "all entries have ts field", entries.every(e => typeof e?.ts === "string"));
  check(r, "all entries have hook field", entries.every(e => typeof e?.hook === "string"));
  check(r, "all entries have event field", entries.every(e => typeof e?.event === "string"));

  // Verify specific hook names appear (proves hooks ran and reported)
  const hooks = new Set(entries.map(e => e?.hook));
  check(r, "quality-format-edit appears in telemetry", hooks.has("quality-format-edit"));
  check(r, "isolation-block-sql appears in telemetry", hooks.has("isolation-block-sql"));
  check(r, "routing-classify-submit appears in telemetry", hooks.has("routing-classify-submit"));

  // isolation-block-sql only calls reportHook once (on entry), before the block check
  const sqlEntries = entries.filter(e => e?.hook === "isolation-block-sql");
  check(r, "isolation-block-sql event=PreToolUse", sqlEntries.every(e => e?.event === "PreToolUse"));
}

// ── Trace ───────────────────────────────────────────────────────────────────

console.log("\n--- trace ---");

const traceFile = resolve(te.root, "src/.trace");

// Enable tracing, run a hook, verify trace output appears
writeFileSync(traceFile, "");
const traceResult = runHook(te, "memory/hooks/context-restore-start.ts", "{}");
check(r, "trace: produces [trace:] output when enabled", traceResult.trace.includes("[trace:context-restore-start]"));
check(r, "trace: includes hook name in output", traceResult.trace.includes("context-restore-start"));
check(r, "trace: normal output still works", traceResult.stdout.includes("Session Start"));

// Disable tracing, verify no trace output
try { unlinkSync(traceFile); } catch {}
const noTraceResult = runHook(te, "memory/hooks/context-restore-start.ts", "{}");
check(r, "trace: no output when disabled", !noTraceResult.trace.includes("[trace:"));

// Verify multiple hooks produce trace
writeFileSync(traceFile, "");
const routingTrace = runHook(te, "core/hooks/routing-classify-submit.ts", JSON.stringify({ prompt: "debug the crash in auth module" }));
check(r, "trace: routing-classify-submit traces decisions", routingTrace.trace.includes("[trace:routing-classify-submit]"));
const ratingTrace = runHook(te, "memory/hooks/rating-capture-submit.ts", JSON.stringify({ prompt: "7" }));
check(r, "trace: rating-capture-submit traces matches", ratingTrace.trace.includes("[trace:rating-capture-submit]"));
try { unlinkSync(traceFile); } catch {}

cleanupTestEnv(te);
printAndExit(r);
