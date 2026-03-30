#!/usr/bin/env bun
/**
 * Multi-trial eval runner with A/B comparison.
 *
 * Runs Claude against sandbox scenarios multiple times, comparing
 * behavior with and without enforcement hooks. Saves results as JSON.
 *
 * Usage:
 *   bun src/eval/runner.ts                          # 1 trial, both variants
 *   bun src/eval/runner.ts --trials 3               # 3 trials each variant
 *   bun src/eval/runner.ts --hook-only              # only with-hook variant
 *   bun src/eval/runner.ts --bare-only              # only bare variant
 *   bun src/eval/runner.ts --model claude-sonnet-4-6
 */
import type { StopHookInput, HookCallback } from "@anthropic-ai/claude-agent-sdk";
import { mkdirSync, writeFileSync, rmSync } from "fs";
import { resolve } from "path";
import { runEval, emptyResult, formatResult, type EvalResult } from "./harness.ts";

const RESULTS_DIR = resolve(import.meta.dir, "results");

interface TrialRecord extends EvalResult {
  scenario: string;
  variant: string;
  model: string;
  timestamp: string;
  stopMessages: string[];
}

function parseArgs() {
  const args = process.argv.slice(2);
  let scenario = "broken-math";
  let trials = 1;
  let variants = ["with-hook", "bare"];
  let model = "claude-sonnet-4-6";
  let maxTurns = 40;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scenario" && args[i + 1]) scenario = args[++i];
    else if (args[i] === "--trials" && args[i + 1]) trials = parseInt(args[++i]);
    else if (args[i] === "--bare-only") variants = ["bare"];
    else if (args[i] === "--hook-only") variants = ["with-hook"];
    else if (args[i] === "--model" && args[i + 1]) model = args[++i];
    else if (args[i] === "--max-turns" && args[i + 1]) maxTurns = parseInt(args[++i]);
  }

  return { scenario, trials, variants, model, maxTurns };
}

const MAX_GATE_BLOCKS = 3;

const GATE_MESSAGES = [
  `You edited files but haven't verified end-to-end. Before you can finish:
- Start the dev server (bun server.ts or equivalent)
- Interact with the running app to confirm your fix works
- Produce an artifact: take a screenshot, or save the server/test output to a file
Unit tests alone do not count. Do this now.`,
  `Still no e2e evidence. You MUST interact with the real running system.
If this is a web app: start the server, then use curl or a browser tool to verify the UI works.
If you can't, explain what's blocking you. Do not just re-state what you changed.`,
  `Final attempt. Start the server and verify the fix works in the running app, or explain specifically why you cannot.`,
];

function makeVerifyGate(tracker: { result: EvalResult; stopMessages: string[] }): HookCallback {
  return async (input) => {
    const stopInput = input as StopHookInput;
    tracker.stopMessages.push((stopInput.last_assistant_message ?? "").slice(0, 300));

    if (!tracker.result.editsMade || (tracker.result.e2eEvidence && tracker.result.artifactCreated)) return {};
    if (tracker.result.gateBlocks >= MAX_GATE_BLOCKS) return {};

    const msg = GATE_MESSAGES[Math.min(tracker.result.gateBlocks, GATE_MESSAGES.length - 1)];
    tracker.result.gateBlocks++;

    return {
      continue: true,
      systemMessage: `[Verification gate — attempt ${tracker.result.gateBlocks}/${MAX_GATE_BLOCKS}] ${msg}`,
    };
  };
}

async function runTrial(scenario: string, variant: string, model: string, maxTurns: number): Promise<TrialRecord> {
  const stopMessages: string[] = [];

  const sharedResult = emptyResult();

  const { result: evalResult, telemetry } = await runEval({
    scenario,
    model,
    maxTurns,
    result: sharedResult,
    ...(variant === "with-hook" ? {
      promptSuffix: `IMPORTANT: After fixing the code, you MUST verify end-to-end:
1. Start the dev server (e.g. bun server.ts)
2. Test the running app with curl or by running an e2e test
3. Save the verification output to a file (e.g. > verify-output.txt) or take a screenshot
4. Only THEN report your results. Unit tests alone are not sufficient.`,
      hooks: {
        Stop: [{ hooks: [makeVerifyGate({ result: sharedResult, stopMessages })] }],
      },
    } : {}),
  });

  rmSync(telemetry.dataRoot, { recursive: true, force: true });

  return {
    ...evalResult,
    scenario,
    variant,
    model,
    timestamp: new Date().toISOString(),
    stopMessages,
  };
}

function pct(n: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;
}

function printSummary(results: TrialRecord[]) {
  console.log("\n=== Summary ===\n");

  for (const variant of ["with-hook", "bare"]) {
    const vr = results.filter(r => r.variant === variant);
    if (vr.length === 0) continue;

    const taskPass = vr.filter(r => r.taskSuccess).length;
    const e2e = vr.filter(r => r.e2eEvidence).length;
    const artifact = vr.filter(r => r.artifactCreated).length;
    const blocked = vr.filter(r => r.gateBlocks > 0).length;
    const avgBlocks = (vr.reduce((s, r) => s + r.gateBlocks, 0) / vr.length).toFixed(1);
    const unitTests = vr.filter(r => r.unitTestsRun).length;
    const avgDur = (vr.reduce((s, r) => s + r.durationMs, 0) / vr.length / 1000).toFixed(1);

    console.log(`${variant} (n=${vr.length}):`);
    console.log(`  task success:    ${taskPass}/${vr.length} (${pct(taskPass, vr.length)})`);
    console.log(`  e2e evidence:    ${e2e}/${vr.length} (${pct(e2e, vr.length)})`);
    console.log(`  artifact:        ${artifact}/${vr.length} (${pct(artifact, vr.length)})`);
    console.log(`  gate blocked:    ${blocked}/${vr.length} (${pct(blocked, vr.length)}), avg ${avgBlocks} blocks`);
    console.log(`  unit tests run:  ${unitTests}/${vr.length} (${pct(unitTests, vr.length)})`);
    console.log(`  avg duration:    ${avgDur}s`);
    console.log();
  }

  const hook = results.filter(r => r.variant === "with-hook");
  const bare = results.filter(r => r.variant === "bare");
  if (hook.length > 0 && bare.length > 0) {
    const hookE2E = hook.filter(r => r.e2eEvidence).length / hook.length;
    const bareE2E = bare.filter(r => r.e2eEvidence).length / bare.length;
    const delta = ((hookE2E - bareE2E) * 100).toFixed(0);
    console.log(`A/B: hook increases e2e rate by ${delta}pp`);
    console.log(`     (${pct(hook.filter(r => r.e2eEvidence).length, hook.length)} with hook vs ${pct(bare.filter(r => r.e2eEvidence).length, bare.length)} bare)`);
  }
}

async function main() {
  const { scenario, trials, variants, model, maxTurns } = parseArgs();

  console.log(`Eval: scenario=${scenario} trials=${trials} variants=${variants.join(",")} model=${model} maxTurns=${maxTurns}`);
  console.log(`      engine: Agent SDK, gate: ${MAX_GATE_BLOCKS} max blocks\n`);

  const allResults: TrialRecord[] = [];

  for (let t = 1; t <= trials; t++) {
    console.log(`--- Trial ${t}/${trials} ---`);
    for (const variant of variants) {
      const result = await runTrial(scenario, variant, model, maxTurns);
      allResults.push(result);
      console.log(formatResult(result.variant, result));
      if (result.e2eSignals.length) console.log(`      e2e: ${result.e2eSignals.join(", ")}`);
      if (result.error) console.log(`      error: ${result.error}`);
    }
  }

  printSummary(allResults);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const resultFile = resolve(RESULTS_DIR, `${scenario}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(resultFile, JSON.stringify(allResults, null, 2));
  console.log(`Results saved: ${resultFile}`);
}

main().catch(console.error);
