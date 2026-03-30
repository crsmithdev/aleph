#!/usr/bin/env bun
/**
 * Quality (verification) gate eval.
 *
 * Launches Claude via the Agent SDK with programmatic hooks that delegate
 * to the real quality-stop-check-e2e.ts and quality-pre-require-e2e.ts
 * scripts as subprocesses. The real scripts write marker files and
 * telemetry, just like production.
 *
 * Verifies:
 *   - Claude does e2e verification when the gate blocks completion
 *   - The real hooks wrote marker files (require-e2e)
 *   - Compares with/without gate behavior
 *
 * Usage:
 *   bun src/eval/quality-gate-e2e.test.ts
 *   bun src/eval/quality-gate-e2e.test.ts --model claude-sonnet-4-6
 *   bun src/eval/quality-gate-e2e.test.ts --scenario todo-app
 */
import { rmSync, existsSync, mkdirSync, mkdtempSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import {
  runEval, emptyResult, realQualityHooks,
  createResults, check, printAndExit, formatResult,
  readHookEvents, readJsonSafe,
} from "./harness.ts";

const args = process.argv.slice(2);
const model = args.includes("--model") ? args[args.indexOf("--model") + 1] : undefined;
const scenario = args.includes("--scenario") ? args[args.indexOf("--scenario") + 1] : "broken-math";

const r = createResults();

console.log(`\n=== Quality gate eval ===`);
console.log(`scenario: ${scenario}, model: ${model ?? "default (haiku)"}\n`);

// ── Run with real quality gate ──────────────────────────────────

console.log("--- With quality gate (real hooks) ---");

const gateDataRoot = mkdtempSync(join(tmpdir(), "eval-data-"));
mkdirSync(join(gateDataRoot, "signals"), { recursive: true });

const sharedResult = emptyResult();
const { result: withGate, telemetry: gateTelemetry } = await runEval({
  scenario,
  model,
  result: sharedResult,
  dataRoot: gateDataRoot,
  hooks: realQualityHooks(gateDataRoot),
  promptSuffix: `IMPORTANT: After fixing the code, you MUST verify end-to-end:
1. Start the dev server (e.g. bun server.ts) or run an e2e/integration test
2. Test the running app with curl or by running the test suite against the live server
3. Save the verification output to a file (e.g. > verify-output.txt) or take a screenshot
4. Only THEN report your results. Unit tests alone (bun test, jest) are not sufficient.`,
});

console.log(formatResult("with-gate", withGate));
if (withGate.e2eSignals.length) console.log(`      e2e: ${withGate.e2eSignals.join(", ")}`);
if (withGate.error) console.log(`      error: ${withGate.error}`);

// ── Run without gate (baseline) ─────────────────────────────────

console.log("\n--- Without quality gate (baseline) ---");

const { result: bare, telemetry: bareTelemetry } = await runEval({ scenario, model });

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

// ── Real hook telemetry assertions ──────────────────────────────

console.log("\n--- Hook telemetry assertions ---");

const markerPath = join(gateDataRoot, "signals", "require-e2e");
const markerExists = existsSync(markerPath);
const marker = readJsonSafe(markerPath);

// If edits were made, the stop hook should have engaged:
// either the marker still exists (Claude didn't clear it) or Claude cleared
// it by providing e2e evidence.
if (withGate.editsMade) {
  const markerOrCleared = markerExists || withGate.e2eEvidence;
  check(r, "real hooks: stop hook engaged (marker written or cleared after e2e)",
    markerOrCleared, `marker=${markerExists} e2e=${withGate.e2eEvidence}`);
}

if (markerExists && marker) {
  check(r, "real hooks: marker has files field", typeof marker.files === "string");
  check(r, "real hooks: marker has missing field", Array.isArray(marker.missing));
  check(r, "real hooks: marker has timestamp", typeof marker.ts === "string");
}

// Bare run has no hooks
const bareMarker = join(bareTelemetry.signalsDir, "require-e2e");
check(r, "bare: no marker file", !existsSync(bareMarker));

// ── Summary ─────────────────────────────────────────────────────

const hookEventsPath = join(gateDataRoot, "signals", "hook-events.jsonl");
const gateEvents = readHookEvents(hookEventsPath);

console.log("\n--- Summary ---");
console.log(`  with-gate: e2e=${withGate.e2eEvidence} artifact=${withGate.artifactCreated} blocks=${withGate.gateBlocks}`);
console.log(`  bare:      e2e=${bare.e2eEvidence} artifact=${bare.artifactCreated}`);
console.log(`  hook events: ${gateEvents.length}, marker exists: ${markerExists}`);

// ── Cleanup ─────────────────────────────────────────────────────

rmSync(gateDataRoot, { recursive: true, force: true });
rmSync(bareTelemetry.dataRoot, { recursive: true, force: true });

printAndExit(r);
