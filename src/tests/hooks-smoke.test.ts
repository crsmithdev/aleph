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
runAndCheck(te, r, "skills/hooks/quality-post-format.ts", "smoke", "{}");
runAndCheck(te, r, "skills/hooks/quality-post-format.ts", "missing file", '{"tool_input":{"file_path":"/nonexistent/file.ts"}}');
runAndCheck(te, r, "skills/hooks/quality-post-format.ts", "malformed", "not json", { expectExit: 1 });

// ── Notify hook ──────────────────────────────────────────────────────────────

console.log("\n--- notify ---");
runAndCheck(te, r, "skills/hooks/notify-event-toast.ts", "smoke", "{}");
runAndCheck(te, r, "skills/hooks/notify-event-toast.ts", "complete event", '{"type":"complete"}');
runAndCheck(te, r, "skills/hooks/notify-event-toast.ts", "permission event", '{"type":"permission"}');
runAndCheck(te, r, "skills/hooks/notify-event-toast.ts", "idle event", '{"type":"idle"}');
runAndCheck(te, r, "skills/hooks/notify-event-toast.ts", "malformed", "not json", { expectExit: 1 });

// ── Trace ───────────────────────────────────────────────────────────────────

console.log("\n--- trace ---");

const traceFile = resolve(te.root, "src/.trace");

// Enable tracing, run a hook, verify trace output appears
writeFileSync(traceFile, "");
const traceResult = runHook(te, "memory/hooks/session-start.ts", "{}");
check(r, "trace: produces [trace:] output when enabled", traceResult.trace.includes("[trace:session-start]"));
check(r, "trace: includes hook name in output", traceResult.trace.includes("session-start"));
check(r, "trace: normal output still works", traceResult.stdout.includes("Session Start"));

// Disable tracing, verify no trace output
try { unlinkSync(traceFile); } catch {}
const noTraceResult = runHook(te, "memory/hooks/session-start.ts", "{}");
check(r, "trace: no output when disabled", !noTraceResult.trace.includes("[trace:"));

// Verify multiple hooks produce trace
writeFileSync(traceFile, "");
const routingTrace = runHook(te, "skills/hooks/routing-submit-classify.ts", JSON.stringify({ prompt: "debug the crash in auth module" }));
check(r, "trace: routing-submit-classify traces decisions", routingTrace.trace.includes("[trace:routing-submit-classify]"));
const ratingTrace = runHook(te, "memory/hooks/rating-capture.ts", JSON.stringify({ prompt: "7" }));
check(r, "trace: rating-capture traces matches", ratingTrace.trace.includes("[trace:rating-capture]"));
try { unlinkSync(traceFile); } catch {}

cleanupTestEnv(te);
printAndExit(r);
