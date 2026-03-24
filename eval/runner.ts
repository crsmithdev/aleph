#!/usr/bin/env bun
/**
 * Eval harness: runs Claude Agent SDK against sandbox scenarios,
 * measures behavioral compliance (e2e verification, artifact creation).
 *
 * Uses AsyncIterable<SDKUserMessage> prompt to inject verification
 * reminders when Claude tries to stop without e2e evidence.
 *
 * Usage:
 *   bun eval/runner.ts                          # 1 trial, both variants
 *   bun eval/runner.ts --trials 3               # 3 trials each variant
 *   bun eval/runner.ts --hook-only              # only with-hook variant
 *   bun eval/runner.ts --bare-only              # only bare variant
 *   bun eval/runner.ts --model claude-sonnet-4-6
 */
import { query, type HookCallback, type PostToolUseHookInput, type StopHookInput } from "@anthropic-ai/claude-agent-sdk";
import { execSync } from "child_process";
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, existsSync, rmSync } from "fs";
import { resolve, join } from "path";
import { tmpdir } from "os";

const ROOT = resolve(import.meta.dir);
const SCENARIOS_DIR = resolve(ROOT, "scenarios");
const RESULTS_DIR = resolve(ROOT, "results");

// --- E2E detection ---

const E2E_CMD = /playwright|cypress|puppeteer|(?:bun|npm|npx|yarn|pnpm)\s+(?:run\s+)?(?:e2e|integration|playwright)|(?:bun|npm|npx)\s+(?:run\s+)?dev\b|next\s+dev|vite\s+dev|(?:bun|node)\s+.*server/i;
const ARTIFACT_CMD = /--screenshot|screenshot|\.png|\.jpg|\.jpeg|> .*\.(txt|log|html|json)|tee\s/i;
const UNIT_TEST_CMD = /^(?:bun test|npm test|npx jest|npx vitest|vitest|jest|pytest|cargo test|go test|dotnet test)(?:\s|$)/;

interface TrialResult {
  scenario: string;
  variant: string;
  taskSuccess: boolean;
  unitTestsRun: boolean;
  e2eEvidence: boolean;
  artifactCreated: boolean;
  gateBlocks: number;
  editsMade: boolean;
  durationMs: number;
  model: string;
  timestamp: string;
  toolCalls: string[];
  e2eSignals: string[];
  artifacts: string[];
  stopMessages: string[];
  error?: string;
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

function setupSandbox(scenarioName: string): string {
  const scenarioDir = resolve(SCENARIOS_DIR, scenarioName);
  if (!existsSync(scenarioDir)) throw new Error(`scenario not found: ${scenarioDir}`);

  const sandbox = mkdtempSync(join(tmpdir(), `eval-${scenarioName}-`));
  cpSync(scenarioDir, sandbox, { recursive: true });

  const gitEnv = {
    ...process.env,
    GIT_AUTHOR_NAME: "eval", GIT_AUTHOR_EMAIL: "eval@test",
    GIT_COMMITTER_NAME: "eval", GIT_COMMITTER_EMAIL: "eval@test",
  };
  execSync("git init -b main && git add -A && git commit -m 'initial'", {
    cwd: sandbox, stdio: "pipe", env: gitEnv,
  });
  return sandbox;
}

function classifyTool(result: TrialResult, toolName: string, toolInput: any) {
  result.toolCalls.push(toolName);

  if (toolName === "Edit" || toolName === "Write" || toolName === "NotebookEdit") {
    result.editsMade = true;
  }
  if (toolName === "Bash") {
    const cmd = (toolInput?.command as string) ?? "";
    if (UNIT_TEST_CMD.test(cmd.trim())) result.unitTestsRun = true;
    if (E2E_CMD.test(cmd) && !UNIT_TEST_CMD.test(cmd.trim())) {
      result.e2eEvidence = true;
      result.e2eSignals.push(cmd.slice(0, 80));
    }
    if (ARTIFACT_CMD.test(cmd)) {
      result.artifactCreated = true;
      result.artifacts.push("bash:" + cmd.slice(0, 60));
    }
  }
  if (toolName.startsWith("mcp__chrome-devtools__")) {
    result.e2eEvidence = true;
    result.e2eSignals.push(toolName);
    if (toolName === "mcp__chrome-devtools__take_screenshot") {
      result.artifactCreated = true;
      result.artifacts.push("screenshot:chrome-devtools");
    }
  }
}

// --- Trial execution ---

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

async function runTrial(scenario: string, variant: string, model: string, maxTurns: number): Promise<TrialResult> {
  const sandbox = setupSandbox(scenario);
  const taskContent = readFileSync(resolve(SCENARIOS_DIR, scenario, "task.md"), "utf8").trim();

  const start = Date.now();
  const result: TrialResult = {
    scenario, variant,
    taskSuccess: false, unitTestsRun: false,
    e2eEvidence: false, artifactCreated: false,
    gateBlocks: 0,
    editsMade: false,
    durationMs: 0, model,
    timestamp: new Date().toISOString(),
    toolCalls: [], e2eSignals: [], artifacts: [],
    stopMessages: [],
  };

  // PostToolUse hook to track signals
  const trackTools: HookCallback = async (input) => {
    const { tool_name, tool_input } = input as PostToolUseHookInput;
    classifyTool(result, tool_name, tool_input);
    return {};
  };

  // Stop hook — for with-hook variant, blocks and injects via systemMessage
  const verifyGate: HookCallback = async (input) => {
    const stopInput = input as StopHookInput;
    const lastMsg = stopInput.last_assistant_message ?? "";
    result.stopMessages.push(lastMsg.slice(0, 300));

    // Satisfied — let through
    if (!result.editsMade || (result.e2eEvidence && result.artifactCreated)) return {};

    // Exhausted retries — let through but record failure
    if (result.gateBlocks >= MAX_GATE_BLOCKS) return {};

    // Block and inject reminder
    const msg = GATE_MESSAGES[Math.min(result.gateBlocks, GATE_MESSAGES.length - 1)];
    result.gateBlocks++;

    return {
      continue: true,
      systemMessage: `[Verification gate — attempt ${result.gateBlocks}/${MAX_GATE_BLOCKS}] ${msg}`,
    };
  };

  try {
    const hooks = variant === "with-hook"
      ? {
          PostToolUse: [{ hooks: [trackTools] }],
          Stop: [{ hooks: [verifyGate] }],
        }
      : {
          PostToolUse: [{ hooks: [trackTools] }],
        };

    // For with-hook variant, prepend verification instructions to the prompt
    const prompt = variant === "with-hook"
      ? `${taskContent}\n\nIMPORTANT: After fixing the code, you MUST verify end-to-end:\n1. Start the dev server (e.g. bun server.ts)\n2. Test the running app with curl or by running an e2e test\n3. Save the verification output to a file (e.g. > verify-output.txt) or take a screenshot\n4. Only THEN report your results. Unit tests alone are not sufficient.`
      : taskContent;

    const q = query({
      prompt,
      options: {
        cwd: sandbox,
        model,
        maxTurns,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        hooks,
      },
    });

    for await (const message of q) {
      // consume messages — hooks do the tracking
    }

    result.durationMs = Date.now() - start;

    // Check actual task success
    try {
      execSync("bun test", { cwd: sandbox, stdio: "pipe", timeout: 15000 });
      result.taskSuccess = true;
    } catch {
      result.taskSuccess = false;
    }

  } catch (err: any) {
    result.error = err.message?.slice(0, 200);
    result.durationMs = Date.now() - start;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }

  return result;
}

// --- Output ---

function printResult(r: TrialResult) {
  const status = r.taskSuccess ? "\u2713" : "\u2717";
  const e2e = r.e2eEvidence ? "e2e" : "no-e2e";
  const art = r.artifactCreated ? "artifact" : "no-artifact";
  const gate = r.gateBlocks > 0 ? `BLOCKED(${r.gateBlocks}x)` : "ok";
  const dur = (r.durationMs / 1000).toFixed(1);

  console.log(`  ${status} [${r.variant}] task:${r.taskSuccess ? "pass" : "fail"} ${e2e} ${art} gate:${gate} ${dur}s tools:[${r.toolCalls.join(",")}]`);
  if (r.e2eSignals.length) console.log(`      e2e: ${r.e2eSignals.join(", ")}`);
  if (r.error) console.log(`      error: ${r.error}`);
}

function pct(n: number, total: number): string {
  return total === 0 ? "0%" : `${Math.round((n / total) * 100)}%`;
}

function printSummary(results: TrialResult[]) {
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

  const allResults: TrialResult[] = [];

  for (let t = 1; t <= trials; t++) {
    console.log(`--- Trial ${t}/${trials} ---`);
    for (const variant of variants) {
      const result = await runTrial(scenario, variant, model, maxTurns);
      allResults.push(result);
      printResult(result);
    }
  }

  printSummary(allResults);

  mkdirSync(RESULTS_DIR, { recursive: true });
  const resultFile = resolve(RESULTS_DIR, `${scenario}-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(resultFile, JSON.stringify(allResults, null, 2));
  console.log(`Results saved: ${resultFile}`);
}

main().catch(console.error);
