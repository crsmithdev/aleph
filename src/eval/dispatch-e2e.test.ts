#!/usr/bin/env bun
/**
 * Dispatch gate eval.
 *
 * Launches Claude via the Agent SDK with programmatic hooks that delegate
 * to the real dispatch-pre-require-subagent.ts script as a subprocess.
 * The real script writes telemetry to hook-events.jsonl and enforces
 * the dispatch gate, just like production.
 *
 * Verifies:
 *   - Claude adapts to the gate by dispatching to a subagent
 *   - The real hook script wrote events to hook-events.jsonl
 *
 * Usage:
 *   bun src/eval/dispatch-e2e.test.ts
 *   bun src/eval/dispatch-e2e.test.ts --model claude-sonnet-4-6
 *   bun src/eval/dispatch-e2e.test.ts --scenario broken-math
 */
import { rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  runEval, emptyResult, realDispatchHooks,
  createResults, check, printAndExit, formatResult,
  readHookEvents,
} from "./harness.ts";

const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
const scenario = args.includes("--scenario") ? args[args.indexOf("--scenario") + 1] : "broken-math";

const r = createResults();

console.log(`\n=== Dispatch gate eval ===`);
console.log(`scenario: ${scenario}, model: ${model ?? "default (haiku)"}\n`);

// ── Run with real dispatch gate ─────────────────────────────────

console.log("--- With dispatch gate (real hooks) ---");

// Pre-create data root so the real hooks and the eval share it
const gateDataRoot = mkdtempSync(join(tmpdir(), "eval-data-"));
mkdirSync(join(gateDataRoot, "signals"), { recursive: true });

const sharedResult = emptyResult();
const { result: withGate, telemetry: gateTelemetry } = await runEval({
  scenario,
  model,
  result: sharedResult,
  dataRoot: gateDataRoot,
  hooks: realDispatchHooks(gateDataRoot),
  promptSuffix: `IMPORTANT: You have a dispatch gate active. Direct file edits (Edit/Write) will be blocked in your main session. You MUST use the Agent tool to dispatch file modifications to a subagent. The subagent can edit freely.`,
});

console.log(formatResult("with-gate", withGate));
if (withGate.e2eSignals.length) console.log(`      e2e: ${withGate.e2eSignals.join(", ")}`);
if (withGate.error) console.log(`      error: ${withGate.error}`);

// ── Run without gate (baseline) ─────────────────────────────────

console.log("\n--- Without dispatch gate (baseline) ---");

const { result: bare, telemetry: bareTelemetry } = await runEval({ scenario, model });

console.log(formatResult("bare", bare));
if (bare.error) console.log(`      error: ${bare.error}`);

// ── Behavioral assertions ───────────────────────────────────────

console.log("\n--- Behavioral assertions ---");

check(r, "with-gate: Claude dispatched to subagent", withGate.agentDispatched);
check(r, "with-gate: task succeeded", withGate.taskSuccess);
check(r, "with-gate: edits were made (via subagent)", withGate.editsMade);

check(r, "bare: task succeeded", bare.taskSuccess);
check(r, "bare: edits were made", bare.editsMade);

if (withGate.agentDispatched && !bare.agentDispatched) {
  check(r, "gate forced dispatch (Agent used only with gate)", true);
} else if (withGate.agentDispatched) {
  check(r, "gate variant used Agent tool", true);
}

// ── Real hook telemetry assertions ──────────────────────────────

console.log("\n--- Hook telemetry assertions ---");

const hookEventsPath = join(gateDataRoot, "signals", "hook-events.jsonl");
const gateEvents = readHookEvents(hookEventsPath);

check(r, "real hooks: hook-events.jsonl exists", existsSync(hookEventsPath));
check(r, "real hooks: events written", gateEvents.length > 0, `got ${gateEvents.length}`);

const dispatchEvents = gateEvents.filter(e => e.hook === "dispatch-pre-require-subagent");
check(r, "real hooks: dispatch-pre-require-subagent fired",
  dispatchEvents.length > 0, `got ${dispatchEvents.length}`);
check(r, "real hooks: events have PreToolUse type",
  dispatchEvents.every(e => e.event === "PreToolUse"));
check(r, "real hooks: events have sessionId",
  dispatchEvents.every(e => typeof e.sessionId === "string" && e.sessionId.length > 0));
check(r, "real hooks: events have timestamps",
  dispatchEvents.every(e => typeof e.ts === "string" && e.ts.length > 0));

// Bare run has no hooks
const bareEvents = readHookEvents(bareTelemetry.hookEventsPath);
check(r, "bare: no hook events written", bareEvents.length === 0, `got ${bareEvents.length}`);

// ── Cleanup ─────────────────────────────────────────────────────

rmSync(gateDataRoot, { recursive: true, force: true });
rmSync(bareTelemetry.dataRoot, { recursive: true, force: true });

printAndExit(r);
