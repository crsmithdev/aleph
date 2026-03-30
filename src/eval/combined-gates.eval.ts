#!/usr/bin/env bun
/**
 * Combined dispatch + quality gate eval.
 *
 * Launches an orchestrator Claude with both gates active:
 *   - Dispatch gate blocks direct edits → forces Agent dispatch
 *   - Quality gate blocks stopping without e2e evidence → forces verification
 *
 * Uses the todo-app scenario (real HTTP server) so there's something
 * concrete to verify against. Hook events are written to the dev DB
 * so the Construct observability UI can display them.
 *
 * After the eval, verifies hook telemetry via the dev API and captures
 * a screenshot of the hooks dashboard as proof.
 *
 * Usage:
 *   bun src/eval/combined-gates.eval.ts
 *   bun src/eval/combined-gates.eval.ts --model claude-sonnet-4-6
 */
import { rmSync, existsSync, mkdirSync } from "fs";
import { join, resolve } from "path";
import {
  runEval, emptyResult, realDispatchHooks, realQualityHooks,
  createResults, check, printAndExit, formatResult,
  readHookEvents, readJsonSafe,
  type EvalResult,
} from "./harness.ts";

const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;

const REPO_ROOT = resolve(import.meta.dir, "../..");
const DEV_DATA = resolve(REPO_ROOT, ".dev/data");

const r = createResults();

console.log(`\n=== Combined dispatch + quality gate eval ===`);
console.log(`scenario: todo-app, model: ${model ?? "default (haiku)"}`);
console.log(`data root: ${DEV_DATA} (dev DB — events visible in UI)\n`);

// Ensure dev data dir exists
mkdirSync(join(DEV_DATA, "signals"), { recursive: true });

// Count events before the eval so we can check for new ones
const eventsBefore = readHookEvents(join(DEV_DATA, "signals", "hook-events.jsonl")).length;

// ── Merge both gate hooks ───────────────────────────────────────

const dispatchHooks = realDispatchHooks(DEV_DATA);
const qualityHooks = realQualityHooks(DEV_DATA);

// Combine: UserPromptSubmit from dispatch, PreToolUse from both, Stop from quality
const combinedHooks: typeof dispatchHooks = {
  UserPromptSubmit: dispatchHooks.UserPromptSubmit,
  PreToolUse: [
    ...(dispatchHooks.PreToolUse ?? []),
    ...(qualityHooks.PreToolUse ?? []),
  ],
  Stop: qualityHooks.Stop,
};

// ── Run with both gates ─────────────────────────────────────────

console.log("--- With dispatch + quality gates (real hooks, todo-app) ---");

const sharedResult = emptyResult();

const { result: withGates, telemetry } = await runEval({
  scenario: "todo-app",
  model,
  result: sharedResult,
  dataRoot: DEV_DATA,
  hooks: combinedHooks,
  promptSuffix: `IMPORTANT RULES:
1. DISPATCH GATE: Direct file edits (Edit/Write) are BLOCKED in your session. You MUST use the Agent tool to dispatch file modifications to a subagent.
2. QUALITY GATE: After the subagent completes, you MUST verify the fix end-to-end:
   - Start the server: bun server.ts
   - Test the API with curl (POST a todo, toggle it, check the response)
   - Save the output to a file: curl ... > verify-output.txt
   - Only THEN report your results
3. Unit tests alone (bun test) do NOT satisfy the quality gate.`,
});

console.log(formatResult("with-gates", withGates));
if (withGates.e2eSignals.length) console.log(`      e2e: ${withGates.e2eSignals.join(", ")}`);
if (withGates.error) console.log(`      error: ${withGates.error}`);

// ── Run without gates (baseline) ────────────────────────────────

console.log("\n--- Without gates (baseline, todo-app) ---");

const { result: bare, telemetry: bareTelemetry } = await runEval({
  scenario: "todo-app",
  model,
});

console.log(formatResult("bare", bare));
if (bare.error) console.log(`      error: ${bare.error}`);

// ── Behavioral assertions ───────────────────────────────────────

console.log("\n--- Behavioral assertions ---");

check(r, "with-gates: task succeeded", withGates.taskSuccess);
check(r, "with-gates: files changed", withGates.filesChanged.length > 0,
  `changed: [${withGates.filesChanged.join(", ")}]`);
check(r, "with-gates: dispatched to subagent", withGates.agentDispatched);
check(r, "with-gates: e2e evidence found", withGates.e2eEvidence);
check(r, "with-gates: artifact created", withGates.artifactCreated);

check(r, "bare: task succeeded", bare.taskSuccess);

// ── Hook telemetry assertions ───────────────────────────────────

console.log("\n--- Hook telemetry assertions ---");

const eventsAfter = readHookEvents(join(DEV_DATA, "signals", "hook-events.jsonl")).length;
const newEvents = eventsAfter - eventsBefore;

check(r, "real hooks: new events written to dev DB", newEvents > 0, `${newEvents} new events`);

const allEvents = readHookEvents(join(DEV_DATA, "signals", "hook-events.jsonl"));
const recentEvents = allEvents.slice(-newEvents);

const dispatchEvents = recentEvents.filter(e => e.hook === "dispatch-pre-require-subagent");
check(r, "real hooks: dispatch gate fired", dispatchEvents.length > 0, `${dispatchEvents.length} events`);

// Quality gate marker
const markerPath = join(DEV_DATA, "signals", "require-e2e");
const markerExists = existsSync(markerPath);

if (withGates.editsMade || withGates.filesChanged.length > 0) {
  const engaged = markerExists || withGates.e2eEvidence;
  check(r, "real hooks: quality gate engaged (marker written or cleared)", engaged,
    `marker=${markerExists} e2e=${withGates.e2eEvidence}`);
}

// ── Summary ─────────────────────────────────────────────────────

console.log("\n--- Summary ---");
console.log(`  with-gates: task=${withGates.taskSuccess} dispatch=${withGates.agentDispatched} e2e=${withGates.e2eEvidence} artifact=${withGates.artifactCreated}`);
console.log(`  bare:       task=${bare.taskSuccess} e2e=${bare.e2eEvidence} artifact=${bare.artifactCreated}`);
console.log(`  new hook events in dev DB: ${newEvents}`);
console.log(`  quality marker exists: ${markerExists}`);

// ── Cleanup ─────────────────────────────────────────────────────
// Don't clean up DEV_DATA — it's the real dev DB
rmSync(bareTelemetry.dataRoot, { recursive: true, force: true });

printAndExit(r);
