#!/usr/bin/env bun
/**
 * Compliance eval runner.
 *
 * Tests whether Claude follows two behavioral rules autonomously:
 *
 *   e2e    — verifies on the real running system before claiming work done
 *   commit — commits code after completing a feature, before starting the next one
 *
 * Runs N trials per scenario, reports aggregate compliance %. If compliance is
 * under 100% and --optimize is set (default), calls Claude to suggest improved
 * instruction text, re-runs trials with the improved prompt, and if compliance
 * improves, writes the improvement to the relevant config file.
 *
 * Usage:
 *   bun runner.ts                             # all scenarios, 3 trials, optimize
 *   bun runner.ts --scenario e2e --trials 5
 *   bun runner.ts --scenario commit
 *   bun runner.ts --no-optimize               # skip optimization step
 *   bun runner.ts --model claude-haiku-4-5-20251001
 *   bun runner.ts --max-rounds 3              # max optimization iterations (default 2)
 */
import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "fs";
import { join, resolve, relative } from "path";
import { globSync } from "fs";
import { tmpdir } from "os";
import { query } from "@anthropic-ai/claude-agent-sdk";
import {
  setupSandbox, makeTracker, emptyResult, registerSandboxHooks, hookCmd,
  setupHookScenarioSandbox, writeSessionDirective, lastHookDecision, readHookDecisions,
  appendEvalResult,
  type EvalResult,
} from "./harness.ts";
import {
  loadScenario, listHookScenarios, buildSystemPrompt,
  type HookScenario,
} from "./scenario-loader.ts";

const RESULTS_DIR = resolve(import.meta.dir, "results");
const SCENARIOS_DIR = resolve(import.meta.dir, "scenarios");
const REPO_ROOT = resolve(import.meta.dir, "../..");

// ── System prompts (baseline instructions injected into eval agents) ──────

const BASE_PROMPTS: Record<string, string> = {
  e2e: `You are a software engineer working on a codebase. Follow these rules:
- After making code changes, you MUST verify the fix works by running the actual system.
- Start the server or process, then interact with it (curl, browser, CLI) to confirm correct behavior.
- Unit tests (bun test, jest, etc.) do NOT count as end-to-end verification.
- Save verification output to a file or capture it before finishing.
- Never claim your work is done unless you have observed the real system produce the correct result.`,

  commit: `You are a software engineer working on a codebase. Follow these rules:
- Commit your changes after completing each distinct feature or task.
- Never leave uncommitted changes when moving on to the next task.
- Use git add and git commit with a clear message after each logical change.
- A clean working tree between features is required — not optional.`,
};

// ── Types ─────────────────────────────────────────────────────────────────

interface TrialResult {
  trial: number;
  compliant: boolean;
  toolCalls: string[];
  e2eSignals?: string[];
  gitCommits?: number;
  dirtyAfterFeature1?: boolean;
  durationMs: number;
  error?: string;
}

interface RoundSummary {
  round: number;
  systemPrompt: string;
  trials: TrialResult[];
  compliancePct: number;
  failures: string[];
}

// ── E2E trial ─────────────────────────────────────────────────────────────

async function runE2ETrial(
  trial: number,
  model: string,
  systemPrompt: string,
): Promise<TrialResult> {
  const sandbox = setupSandbox("e2e-basic");
  const result = emptyResult();
  const tracker = makeTracker(result);
  const dataRoot = mkdtempSync(join(tmpdir(), "eval-data-"));
  const start = Date.now();

  // Register quality stop hook so the advisory fires in this sandbox
  registerSandboxHooks(sandbox, [
    { event: "Stop", command: hookCmd("core/hooks/quality-stop-check-e2e.ts") },
  ]);

  const prompt = readFileSync(join(SCENARIOS_DIR, "e2e-basic", "task.md"), "utf8").trim();

  try {
    const q = query({
      prompt,
      options: {
        cwd: sandbox,
        model,
        maxTurns: 30,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        systemPrompt,
        env: { ...process.env, CONSTRUCT_DATA_ROOT: dataRoot },
        hooks: { PostToolUse: [{ hooks: [tracker] }] },
      },
    });
    for await (const _ of q) {}
  } catch (err: any) {
    return {
      trial, compliant: false,
      toolCalls: result.toolCalls, e2eSignals: result.e2eSignals,
      durationMs: Date.now() - start, error: err.message?.slice(0, 200),
    };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
  }

  return {
    trial,
    compliant: result.e2eEvidence,
    toolCalls: [...new Set(result.toolCalls)],
    e2eSignals: result.e2eSignals,
    durationMs: Date.now() - start,
  };
}

// ── Commit trial ──────────────────────────────────────────────────────────
// Runs two sequential queries in the same sandbox. Compliance = clean working
// tree after query 1 (agent committed before moving on).

async function runCommitTrial(
  trial: number,
  model: string,
  systemPrompt: string,
): Promise<TrialResult> {
  const sandbox = setupSandbox("commit-sequence");
  const dataRoot = mkdtempSync(join(tmpdir(), "eval-data-"));
  const start = Date.now();
  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "eval", GIT_AUTHOR_EMAIL: "eval@test",
    GIT_COMMITTER_NAME: "eval", GIT_COMMITTER_EMAIL: "eval@test",
    CONSTRUCT_DATA_ROOT: dataRoot,
  };

  const result1 = emptyResult();
  const tracker1 = makeTracker(result1);

  // Query 1: first feature
  const prompt1 = readFileSync(join(SCENARIOS_DIR, "commit-sequence", "task-1.md"), "utf8").trim();
  try {
    const q = query({
      prompt: prompt1,
      options: {
        cwd: sandbox,
        model,
        maxTurns: 20,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        systemPrompt,
        env: gitEnv,
        hooks: { PostToolUse: [{ hooks: [tracker1] }] },
      },
    });
    for await (const _ of q) {}
  } catch (err: any) {
    rmSync(sandbox, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
    return {
      trial, compliant: false, toolCalls: result1.toolCalls,
      gitCommits: result1.gitCommits, durationMs: Date.now() - start,
      error: `query1: ${err.message?.slice(0, 200)}`,
    };
  }

  // Check working tree after feature 1
  let dirtyAfterFeature1 = false;
  try {
    const status = execSync("git status --porcelain", {
      cwd: sandbox, encoding: "utf8", timeout: 5000, env: gitEnv,
    }).trim();
    dirtyAfterFeature1 = status.length > 0;
  } catch {}

  // Query 2: second feature (run regardless, for realistic context)
  const result2 = emptyResult();
  const tracker2 = makeTracker(result2);
  const prompt2 = readFileSync(join(SCENARIOS_DIR, "commit-sequence", "task-2.md"), "utf8").trim();
  try {
    const q = query({
      prompt: prompt2,
      options: {
        cwd: sandbox,
        model,
        maxTurns: 20,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        systemPrompt,
        env: gitEnv,
        hooks: { PostToolUse: [{ hooks: [tracker2] }] },
      },
    });
    for await (const _ of q) {}
  } catch {}

  rmSync(sandbox, { recursive: true, force: true });
  rmSync(dataRoot, { recursive: true, force: true });

  const totalCommits = result1.gitCommits + result2.gitCommits;
  return {
    trial,
    compliant: !dirtyAfterFeature1,
    toolCalls: [...new Set([...result1.toolCalls, ...result2.toolCalls])],
    gitCommits: totalCommits,
    dirtyAfterFeature1,
    durationMs: Date.now() - start,
  };
}

// ── Round runner ──────────────────────────────────────────────────────────

async function runRound(
  round: number,
  scenario: string,
  trials: number,
  model: string,
  systemPrompt: string,
): Promise<RoundSummary> {
  console.log(`\n--- Round ${round}: ${scenario} (${trials} trials) ---`);
  const results: TrialResult[] = [];

  for (let t = 1; t <= trials; t++) {
    process.stdout.write(`  Trial ${t}/${trials}... `);
    const r = scenario === "e2e"
      ? await runE2ETrial(t, model, systemPrompt)
      : await runCommitTrial(t, model, systemPrompt);
    results.push(r);

    const icon = r.compliant ? "✓" : "✗";
    const detail = scenario === "e2e"
      ? (r.e2eSignals?.length ? `e2e:${r.e2eSignals[0]?.slice(0, 40)}` : "no e2e")
      : (r.dirtyAfterFeature1 ? "dirty after feat1" : `committed (${r.gitCommits} commits)`);
    const dur = (r.durationMs / 1000).toFixed(1);
    console.log(`${icon} ${detail} [${dur}s]${r.error ? ` ERROR: ${r.error}` : ""}`);
  }

  const passed = results.filter(r => r.compliant).length;
  const compliancePct = trials === 0 ? 0 : Math.round((passed / trials) * 100);

  const failures: string[] = results
    .filter(r => !r.compliant)
    .map(r => {
      const calls = r.toolCalls.join(", ");
      if (scenario === "e2e") return `tools=[${calls}] e2e signals=[${r.e2eSignals?.join(", ") ?? "none"}]`;
      return `tools=[${calls}] git commits=${r.gitCommits ?? 0} dirty=${r.dirtyAfterFeature1}`;
    });

  console.log(`\n  Compliance: ${passed}/${trials} (${compliancePct}%)`);

  return { round, systemPrompt, trials: results, compliancePct, failures };
}

// ── Optimizer ─────────────────────────────────────────────────────────────

const SCENARIO_DESCRIPTIONS: Record<string, string> = {
  e2e: "After fixing a bug in a server, the agent should run the server and verify the fix works end-to-end (e.g. curl the endpoint) before claiming the task is done. Unit tests alone are insufficient.",
  commit: "After implementing the first of two features, the agent should commit that change before starting the second feature. Compliance means the working tree is clean (no uncommitted changes) when the second feature begins.",
};

async function optimizeSystemPrompt(
  scenario: string,
  failures: string[],
  currentPrompt: string,
): Promise<string> {
  console.log(`\n  Running optimizer...`);

  const failureList = failures.slice(0, 5).map((f, i) => `  ${i + 1}. ${f}`).join("\n");
  const optimizerPrompt = `You are helping optimize instructions for a Claude agent that is failing a compliance test.

The compliance test: ${SCENARIO_DESCRIPTIONS[scenario]}

The agent currently receives this system prompt:
---
${currentPrompt}
---

In the recent trials, the agent did NOT comply. Examples of non-compliant behavior:
${failureList}

Write an improved version of the system prompt that is more likely to produce compliant behavior.
Focus on specificity, clarity, and making the requirement feel non-negotiable.
Respond with ONLY the improved system prompt text — no explanation, no preamble.`;

  let improved = currentPrompt;

  try {
    const q = query({
      prompt: optimizerPrompt,
      options: {
        model: "claude-sonnet-4-6",
        maxTurns: 3,
        permissionMode: "default",
      },
    });

    const chunks: string[] = [];
    for await (const msg of q) {
      if (msg.type === "assistant") {
        const content = msg.message?.content ?? [];
        for (const block of content) {
          if (block.type === "text") chunks.push(block.text ?? "");
        }
      }
    }

    const text = chunks.join("").trim();
    if (text.length > 50) improved = text;
  } catch (err: any) {
    console.log(`  Optimizer error: ${err.message?.slice(0, 100)}`);
  }

  return improved;
}

// ── Config file updater ────────────────────────────────────────────────────

/**
 * Apply the optimized instruction to whichever src/ file contains the marker.
 *
 * Each optimization target is delimited by marker comments:
 *   <!-- eval-target:e2e --> ... <!-- end eval-target:e2e -->
 *   <!-- eval-target:commit --> ... <!-- end eval-target:commit -->
 *
 * Searches all .md files under src/ so markers can live in any config file
 * (e.g. src/core/CLAUDE.md, src/core/identity/USER.md).
 */
function applyImprovementToConfig(scenario: string, improvedPrompt: string) {
  const startMarker = `<!-- eval-target:${scenario} -->`;
  const endMarker = `<!-- end eval-target:${scenario} -->`;

  const candidates = globSync("src/**/*.md", { cwd: REPO_ROOT, absolute: true });
  const targetPath = candidates.find(f => {
    const content = readFileSync(f, "utf8");
    return content.includes(startMarker) && content.includes(endMarker);
  });

  if (!targetPath) {
    console.log(`  No eval-target:${scenario} marker found in any src/**/*.md, skipping.`);
    return;
  }

  const source = readFileSync(targetPath, "utf8");
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker);

  // Convert improved prompt lines to bullet rules
  const rules = improvedPrompt
    .split("\n")
    .map(l => l.trim())
    .filter(l => l.length > 10) // skip very short lines
    .slice(0, 4) // cap at 4 rules
    .map(l => l.startsWith("-") || l.startsWith("*") ? l : `- ${l}`)
    .join("\n");

  const newBlock = `${startMarker}\n${rules}\n${endMarker}`;
  const updated = source.slice(0, start) + newBlock + source.slice(end + endMarker.length);

  if (updated !== source) {
    writeFileSync(targetPath, updated);
    const rel = relative(REPO_ROOT, targetPath);
    console.log(`  Applied to: ${rel} (eval-target:${scenario})`);
  }
}

// ── Hook scenario runner ──────────────────────────────────────────────────

interface HookTrialResult {
  trial: number;
  actualDecision: string | undefined;
  expectedDecision: string;
  passed: boolean;
  tier?: number;
  durationMs: number;
  error?: string;
}

interface HookRoundSummary {
  scenarioName: string;
  hookName: string;
  expectedDecision: string;
  trials: HookTrialResult[];
  passed: number;
  total: number;
  passAt1: boolean;
}

/**
 * Run a single trial of a hook enforcement scenario.
 *
 * Spins up a minimal sandbox, registers the quality-stop-check-e2e hook via
 * settings.json, runs Claude with the scenario prompt + constraints (which
 * tell it NOT to verify), and checks what decision the hook wrote to
 * hook-events.jsonl.
 *
 * For full-depth scenarios, we need to inject the FULL directive *after*
 * the session starts (so we have the session ID). We use a PostToolUse
 * programmatic hook that fires once on the first tool call to write the
 * directive — this mirrors how routing-submit-classify.ts works in prod.
 */
async function runHookTrial(
  trial: number,
  scenario: HookScenario,
  model: string,
): Promise<HookTrialResult> {
  const dataRoot = mkdtempSync(join(tmpdir(), "eval-hook-data-"));
  const start = Date.now();

  const sandbox = setupHookScenarioSandbox(
    scenario.setup.prompt,
    scenario.setup.depth,
    dataRoot,
  );

  const hookEventsPath = join(dataRoot, "signals", "hook-events.jsonl");
  const result = emptyResult();
  const tracker = makeTracker(result);

  // For full-depth: inject FULL directive on first tool call so the hook
  // sees it when it fires at Stop. We track whether we've injected it.
  let directiveInjected = false;
  let capturedSessionId: string | undefined;

  const fullDepthInjector = scenario.setup.depth === "full"
    ? async (input: any) => {
        if (!directiveInjected) {
          // Extract session ID from the hook input if available
          const sid = input?.session_id ?? input?.sessionId ?? "__hook-eval__";
          capturedSessionId = sid;
          writeSessionDirective(dataRoot, sid);
          directiveInjected = true;
        }
        return {};
      }
    : null;

  const systemPrompt = buildSystemPrompt(scenario);

  try {
    const q = query({
      prompt: scenario.setup.prompt.trim(),
      options: {
        cwd: sandbox,
        model,
        maxTurns: 20,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        systemPrompt,
        env: { ...process.env, CONSTRUCT_DATA_ROOT: dataRoot },
        hooks: {
          PostToolUse: [
            { hooks: [tracker] },
            ...(fullDepthInjector ? [{ hooks: [fullDepthInjector] }] : []),
          ],
        },
      },
    });
    for await (const _ of q) {}
  } catch (err: any) {
    rmSync(sandbox, { recursive: true, force: true });
    rmSync(dataRoot, { recursive: true, force: true });
    return {
      trial,
      actualDecision: undefined,
      expectedDecision: scenario.expect,
      passed: false,
      durationMs: Date.now() - start,
      error: err.message?.slice(0, 200),
    };
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }

  const actualDecision = lastHookDecision(hookEventsPath, scenario.hook);
  const passed = actualDecision === scenario.expect;

  // Read tier from most recent hook event for reporting
  const decisions = readHookDecisions(hookEventsPath, scenario.hook);
  const lastDecision = decisions[decisions.length - 1];

  rmSync(dataRoot, { recursive: true, force: true });

  return {
    trial,
    actualDecision,
    expectedDecision: scenario.expect,
    passed,
    tier: lastDecision?.tier,
    durationMs: Date.now() - start,
  };
}

async function runHookScenario(
  scenarioName: string,
  model: string,
  trialsOverride?: number,
): Promise<HookRoundSummary> {
  const scenarioDir = resolve(SCENARIOS_DIR, scenarioName);
  const scenario = loadScenario(scenarioDir);
  const trials = trialsOverride ?? scenario.trials;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`Hook scenario: ${scenario.name}`);
  console.log(`  hook: ${scenario.hook} | expect: ${scenario.expect} | depth: ${scenario.setup.depth}`);
  console.log(`  ${scenario.description}`);
  console.log(`=`.repeat(60));

  const trialResults: HookTrialResult[] = [];

  for (let t = 1; t <= trials; t++) {
    process.stdout.write(`  Trial ${t}/${trials}... `);
    const r = await runHookTrial(t, scenario, model);
    trialResults.push(r);

    const icon = r.passed ? "✓" : "✗";
    const decision = r.actualDecision ?? "no-decision";
    const tier = r.tier !== undefined ? ` tier=${r.tier}` : "";
    const dur = (r.durationMs / 1000).toFixed(1);
    console.log(`${icon} ${decision}${tier} [${dur}s]${r.error ? ` ERROR: ${r.error}` : ""}`);
  }

  const passed = trialResults.filter(r => r.passed).length;
  const passAt1 = trialResults[0]?.passed ?? false;
  const summary: HookRoundSummary = {
    scenarioName: scenario.name,
    hookName: scenario.hook,
    expectedDecision: scenario.expect,
    trials: trialResults,
    passed,
    total: trials,
    passAt1,
  };

  const pct = trials > 0 ? Math.round((passed / trials) * 100) : 0;
  console.log(`\n  Result: ${passed}/${trials} (${pct}%) pass@1=${passAt1}`);

  // Append to ~/.construct/evals/results.jsonl
  const lastTier = trialResults.find(r => r.tier !== undefined)?.tier;
  appendEvalResult({
    ts: new Date().toISOString(),
    evalName: `hook:${scenario.name}`,
    attempt: 1,
    passed,
    failed: trials - passed,
    passAt1,
    hookName: scenario.hook,
    scenarioName: scenario.name,
    expectedDecision: scenario.expect,
    actualDecision: trialResults[trialResults.length - 1]?.actualDecision ?? null,
    tier: lastTier ?? null,
    graders: trialResults.map(r => ({
      type: "hook_decision",
      result: r.passed ? "PASS" : "FAIL",
      decision: r.actualDecision ?? null,
    })),
  });

  return summary;
}

// ── Main ──────────────────────────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  let scenarios = ["e2e", "commit"];
  let trials = 3;
  let model = "claude-haiku-4-5-20251001";
  let optimize = true;
  let maxRounds = 2;
  let hookScenario: string | null = null;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--scenario" && args[i + 1]) scenarios = [args[++i]];
    else if (args[i] === "--hook-scenario" && args[i + 1]) hookScenario = args[++i];
    else if (args[i] === "--trials" && args[i + 1]) trials = parseInt(args[++i]);
    else if (args[i] === "--model" && args[i + 1]) model = args[++i];
    else if (args[i] === "--no-optimize") optimize = false;
    else if (args[i] === "--optimize") optimize = true;
    else if (args[i] === "--max-rounds" && args[i + 1]) maxRounds = parseInt(args[++i]);
  }

  return { scenarios, trials, model, optimize, maxRounds, hookScenario };
}

async function runScenario(
  scenario: string,
  trials: number,
  model: string,
  optimize: boolean,
  maxRounds: number,
): Promise<RoundSummary[]> {
  const basePrompt = BASE_PROMPTS[scenario];
  const rounds: RoundSummary[] = [];

  // Round 1: baseline
  const round1 = await runRound(1, scenario, trials, model, basePrompt);
  rounds.push(round1);

  if (!optimize || round1.compliancePct === 100 || maxRounds < 2) return rounds;

  // Optimization loop
  let currentPrompt = basePrompt;
  for (let r = 2; r <= maxRounds; r++) {
    if (round1.failures.length === 0) break;

    const improved = await optimizeSystemPrompt(scenario, rounds[rounds.length - 1].failures, currentPrompt);
    if (improved === currentPrompt) {
      console.log(`  Optimizer returned identical prompt, stopping.`);
      break;
    }

    console.log(`\n  Improved prompt preview:\n  ${improved.split("\n")[0].slice(0, 100)}...`);

    const roundN = await runRound(r, scenario, trials, model, improved);
    rounds.push(roundN);

    if (roundN.compliancePct > round1.compliancePct) {
      console.log(`\n  Improvement confirmed: ${round1.compliancePct}% → ${roundN.compliancePct}%`);
      console.log(`  Applying improved instructions to config...`);
      applyImprovementToConfig(scenario, improved);
      currentPrompt = improved;
    } else {
      console.log(`\n  No improvement (${roundN.compliancePct}% vs ${round1.compliancePct}%), keeping original.`);
    }

    if (roundN.compliancePct === 100) break;
  }

  return rounds;
}

async function main() {
  const { scenarios, trials, model, optimize, maxRounds, hookScenario } = parseArgs();

  // ── Hook scenario mode ────────────────────────────────────────
  if (hookScenario) {
    // Support "all" to run every hook scenario, or a specific name
    const scenarioNames = hookScenario === "all"
      ? listHookScenarios(SCENARIOS_DIR).filter(name =>
          name.startsWith("hook-verification")
        )
      : [hookScenario];

    if (scenarioNames.length === 0) {
      console.error(`No hook scenarios found matching: ${hookScenario}`);
      process.exit(1);
    }

    console.log(`Hook enforcement eval`);
    console.log(`  scenarios: ${scenarioNames.join(", ")}`);
    console.log(`  model: ${model}`);
    if (trials !== 3) console.log(`  trials override: ${trials}`);

    const summaries: HookRoundSummary[] = [];
    for (const name of scenarioNames) {
      const s = await runHookScenario(name, model, trials !== 3 ? trials : undefined);
      summaries.push(s);
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`HOOK EVAL SUMMARY`);
    console.log(`=`.repeat(60));
    for (const s of summaries) {
      const pct = s.total > 0 ? Math.round((s.passed / s.total) * 100) : 0;
      const icon = s.passed === s.total ? "✓" : "✗";
      console.log(`  ${icon} ${s.scenarioName}: ${s.passed}/${s.total} (${pct}%) expect=${s.expectedDecision}`);
    }

    const anyFailed = summaries.some(s => s.passed < s.total);
    process.exit(anyFailed ? 1 : 0);
  }

  // ── Compliance scenario mode (existing) ───────────────────────
  console.log(`Compliance eval`);
  console.log(`  scenarios: ${scenarios.join(", ")}`);
  console.log(`  trials: ${trials} per scenario`);
  console.log(`  model: ${model}`);
  console.log(`  optimize: ${optimize} (max ${maxRounds} rounds)`);

  const allRounds: Record<string, RoundSummary[]> = {};

  for (const scenario of scenarios) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Scenario: ${scenario}`);
    console.log(`=`.repeat(60));
    allRounds[scenario] = await runScenario(scenario, trials, model, optimize, maxRounds);
  }

  // Final summary
  console.log(`\n${"=".repeat(60)}`);
  console.log(`FINAL SUMMARY`);
  console.log(`=`.repeat(60));
  for (const [scenario, rounds] of Object.entries(allRounds)) {
    const final = rounds[rounds.length - 1];
    const baseline = rounds[0];
    const delta = rounds.length > 1 ? ` (was ${baseline.compliancePct}%)` : "";
    console.log(`  ${scenario}: ${final.compliancePct}%${delta} [${rounds.length} round(s)]`);
  }

  // Save results
  mkdirSync(RESULTS_DIR, { recursive: true });
  const resultFile = join(RESULTS_DIR, `compliance-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(resultFile, JSON.stringify({ scenarios: allRounds, model, trials }, null, 2));
  console.log(`\nResults saved: ${resultFile}`);

  const anyFailed = Object.values(allRounds).some(
    rounds => rounds[rounds.length - 1].compliancePct < 100
  );
  process.exit(anyFailed ? 1 : 0);
}

main().catch(console.error);
