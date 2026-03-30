#!/usr/bin/env bun
/**
 * Quality (verification) gate eval.
 *
 * Launches Claude via the Agent SDK with a Stop hook that blocks
 * completion when edits lack e2e verification evidence. Compares
 * behavior with and without the gate. Verifies telemetry is written.
 *
 * Usage:
 *   bun src/eval/quality-gate-e2e.test.ts
 *   bun src/eval/quality-gate-e2e.test.ts --model claude-sonnet-4-6
 *   bun src/eval/quality-gate-e2e.test.ts --scenario todo-app
 */
import type { StopHookInput, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { join } from "path";
import { mkdtempSync } from "fs";
import { tmpdir } from "os";
import {
  runEval, emptyResult, createResults, check, printAndExit, formatResult,
  writeHookEvent, readHookEvents,
  type EvalResult, type HookEvent,
} from "./harness.ts";

const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
const scenario = args.includes("--scenario") ? args[args.indexOf("--scenario") + 1] : "broken-math";

const r = createResults();
const telemetryDir = mkdtempSync(join(tmpdir(), "eval-telemetry-"));

console.log(`\n=== Quality gate eval ===`);
console.log(`scenario: ${scenario}, model: ${model ?? "default (haiku)"}\n`);

// ── Quality gate hook ───────────────────────────────────────────

const MAX_BLOCKS = 3;

const GATE_MESSAGES = [
  `You edited files but haven't verified end-to-end. Before you can finish:
- Start the dev server (bun server.ts or equivalent) or run an e2e test
- Interact with the running app to confirm your fix works
- Produce an artifact: take a screenshot, or save the server/test output to a file (e.g. > verify-output.txt)
Unit tests alone do not count. Do this now.`,
  `Still no e2e evidence. You MUST interact with the real running system.
Run a command like: bun run dev, or curl the server, or run playwright. Then save the output.`,
  `Final attempt. Start the server and verify the fix works in the running app, or explain specifically why you cannot.`,
];

function makeQualityGate(result: EvalResult, telemetryPath: string): HookCallback {
  return async (input) => {
    const sessionId = (input as any).session_id ?? "eval";

    if (!result.editsMade || (result.e2eEvidence && result.artifactCreated)) {
      writeHookEvent(telemetryPath, {
        ts: new Date().toISOString(),
        hook: "quality-gate",
        event: "Stop",
        sessionId,
        decision: "allow",
        hasEdits: result.editsMade,
        hasE2E: result.e2eEvidence,
        hasArtifact: result.artifactCreated,
      });
      return {};
    }

    if (result.gateBlocks >= MAX_BLOCKS) {
      writeHookEvent(telemetryPath, {
        ts: new Date().toISOString(),
        hook: "quality-gate",
        event: "Stop",
        sessionId,
        decision: "exhausted",
        gateBlocks: result.gateBlocks,
      });
      return {};
    }

    const msg = GATE_MESSAGES[Math.min(result.gateBlocks, GATE_MESSAGES.length - 1)];
    result.gateBlocks++;

    writeHookEvent(telemetryPath, {
      ts: new Date().toISOString(),
      hook: "quality-gate",
      event: "Stop",
      sessionId,
      decision: "block",
      gateBlocks: result.gateBlocks,
      hasE2E: result.e2eEvidence,
      hasArtifact: result.artifactCreated,
    });

    return {
      continue: true,
      systemMessage: `[Verification gate — attempt ${result.gateBlocks}/${MAX_BLOCKS}] ${msg}`,
    };
  };
}

// ── Run with gate ───────────────────────────────────────────────

console.log("--- With quality gate ---");

const gateTelemetry = join(telemetryDir, "with-gate.jsonl");
const sharedResult = emptyResult();

const withGate = await runEval({
  scenario,
  model,
  result: sharedResult,
  telemetryPath: join(telemetryDir, "with-gate-tracker.jsonl"),
  promptSuffix: `IMPORTANT: After fixing the code, you MUST verify end-to-end:
1. Start the dev server (e.g. bun server.ts) or run an e2e/integration test
2. Test the running app with curl or by running the test suite against the live server
3. Save the verification output to a file (e.g. > verify-output.txt) or take a screenshot
4. Only THEN report your results. Unit tests alone (bun test, jest) are not sufficient.`,
  hooks: {
    Stop: [{ hooks: [makeQualityGate(sharedResult, gateTelemetry)] }],
  },
});

console.log(formatResult("with-gate", withGate));
if (withGate.e2eSignals.length) console.log(`      e2e: ${withGate.e2eSignals.join(", ")}`);
if (withGate.error) console.log(`      error: ${withGate.error}`);

// ── Run without gate (baseline) ─────────────────────────────────

console.log("\n--- Without quality gate (baseline) ---");

const bare = await runEval({
  scenario, model,
  telemetryPath: join(telemetryDir, "bare-tracker.jsonl"),
});

console.log(formatResult("bare", bare));
if (bare.e2eSignals.length) console.log(`      e2e: ${bare.e2eSignals.join(", ")}`);
if (bare.error) console.log(`      error: ${bare.error}`);

// ── Behavioral assertions ───────────────────────────────────────

console.log("\n--- Behavioral assertions ---");

check(r, "with-gate: task succeeded", withGate.taskSuccess);
check(r, "with-gate: edits were made", withGate.editsMade);
check(r, "with-gate: e2e evidence found", withGate.e2eEvidence);
check(r, "with-gate: artifact created", withGate.artifactCreated);

check(r, "bare: task succeeded", bare.taskSuccess);

const gateImprovedE2E = withGate.e2eEvidence && !bare.e2eEvidence;
const gateImprovedArtifact = withGate.artifactCreated && !bare.artifactCreated;
if (gateImprovedE2E) check(r, "gate improved e2e rate (only with-gate produced e2e)", true);
if (gateImprovedArtifact) check(r, "gate improved artifact rate", true);

// ── Telemetry assertions ────────────────────────────────────────

console.log("\n--- Telemetry assertions ---");

const gateEvents = readHookEvents(gateTelemetry);
const trackerEvents = readHookEvents(join(telemetryDir, "with-gate-tracker.jsonl"));
const bareTrackerEvents = readHookEvents(join(telemetryDir, "bare-tracker.jsonl"));

check(r, "gate telemetry: events written", gateEvents.length > 0, `got ${gateEvents.length}`);
check(r, "gate telemetry: all have Stop event type",
  gateEvents.every(e => e.event === "Stop"));
check(r, "gate telemetry: has decision field",
  gateEvents.every(e => typeof e.decision === "string"));
check(r, "gate telemetry: tracks e2e/artifact state",
  gateEvents.some(e => "hasE2E" in e || "hasArtifact" in e));

check(r, "tracker telemetry: events written for with-gate", trackerEvents.length > 0, `got ${trackerEvents.length}`);
check(r, "tracker telemetry: events written for bare", bareTrackerEvents.length > 0, `got ${bareTrackerEvents.length}`);
check(r, "tracker telemetry: records tool names",
  trackerEvents.some(e => typeof e.tool === "string" && e.tool.length > 0));

// ── Summary ─────────────────────────────────────────────────────

console.log("\n--- Summary ---");
console.log(`  with-gate: e2e=${withGate.e2eEvidence} artifact=${withGate.artifactCreated} blocks=${withGate.gateBlocks}`);
console.log(`  bare:      e2e=${bare.e2eEvidence} artifact=${bare.artifactCreated}`);
console.log(`  gate events: ${gateEvents.length} (${gateEvents.filter(e => e.decision === "block").length} blocks, ${gateEvents.filter(e => e.decision === "allow").length} allows)`);

printAndExit(r);
