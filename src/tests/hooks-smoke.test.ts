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
