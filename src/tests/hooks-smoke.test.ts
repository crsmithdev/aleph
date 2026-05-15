#!/usr/bin/env bun
import { writeFileSync, unlinkSync } from "fs";
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
runAndCheck(te, r, "core/hooks/security-scan-bash.ts", "malformed stdin (advisory, swallows)", "not json");

// ── Quality typecheck edit ────────────────────────────────────────────────────

console.log("\n--- quality-typecheck-edit ---");
runAndCheck(te, r, "core/hooks/quality-typecheck-edit.ts", "smoke (no file_path)", "{}");
runAndCheck(te, r, "core/hooks/quality-typecheck-edit.ts", "markdown file skipped", '{"tool_input":{"file_path":"/some/file.md"}}');
runAndCheck(te, r, "core/hooks/quality-typecheck-edit.ts", "non-ts extension skipped", '{"tool_input":{"file_path":"/some/file.css"}}');
runAndCheck(te, r, "core/hooks/quality-typecheck-edit.ts", "malformed stdin", "not json", { expectExit: 1 });

// ── Context backup precompact ─────────────────────────────────────────────────

console.log("\n--- context-backup-precompact ---");
runAndCheck(te, r, "core/hooks/context-backup-precompact.ts", "smoke (no transcript)", "{}");
runAndCheck(te, r, "core/hooks/context-backup-precompact.ts", "malformed stdin (swallows)", "not json");

// ── Context monitor stop ──────────────────────────────────────────────────────

console.log("\n--- context-monitor-stop ---");
runAndCheck(te, r, "core/hooks/context-monitor-stop.ts", "smoke (no transcript)", "{}");
runAndCheck(te, r, "core/hooks/context-monitor-stop.ts", "malformed stdin (swallows)", "not json");

// ── Context suggest edit ──────────────────────────────────────────────────────

console.log("\n--- context-suggest-edit ---");
runAndCheck(te, r, "core/hooks/context-suggest-edit.ts", "smoke (no session_id)", "{}");
runAndCheck(te, r, "core/hooks/context-suggest-edit.ts", "below threshold (count=1)", '{"session_id":"test-smoke-session"}');
runAndCheck(te, r, "core/hooks/context-suggest-edit.ts", "malformed stdin (swallows)", "not json");

// ── Git require edit ──────────────────────────────────────────────────────────

console.log("\n--- git-require-edit ---");
runAndCheck(te, r, "core/hooks/git-require-edit.ts", "smoke (no cwd)", "{}");
runAndCheck(te, r, "core/hooks/git-require-edit.ts", "nonexistent cwd (git fails, swallowed)", '{"cwd":"/nonexistent/path","session_id":"test-smoke"}');
runAndCheck(te, r, "core/hooks/git-require-edit.ts", "malformed stdin (swallows)", "not json");

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
