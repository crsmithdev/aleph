/**
 * Shared eval harness.
 *
 * Two layers:
 *   1. Hook subprocess testing — run hook scripts with crafted stdin,
 *      assert on exit codes and stdout. Used by test.ts.
 *   2. Agent SDK evals — launch Claude in a sandbox, wire up enforcement
 *      hooks, observe behavioral compliance. Used by eval tests.
 *
 * Also: temp dir management, transcript builders, assertions, telemetry.
 */
import { execSync } from "child_process";
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, appendFileSync,
  existsSync, unlinkSync, rmSync, cpSync,
} from "fs";
import { join, resolve, dirname } from "path";
import { tmpdir } from "os";
import {
  query,
  type HookCallback,
  type HookCallbackMatcher,
  type PreToolUseHookInput,
  type PostToolUseHookInput,
  type StopHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { E2E_CMD, ARTIFACT_CMD, UNIT_TEST_CMD } from "./patterns.ts";

const BUN = process.argv[0];
const EVAL_ROOT = resolve(import.meta.dir);
const SCENARIOS_DIR = resolve(EVAL_ROOT, "scenarios");

// ── Temp environment ────────────────────────────────────────────

export interface TestEnv {
  tmpBase: string;
  signalsDir: string;
  env: Record<string, string | undefined>;
  root: string;
}

/** Create an isolated temp directory with a signals subdirectory. */
export function createTestEnv(prefix: string, root?: string): TestEnv {
  const resolvedRoot = root ?? resolve(import.meta.dir, "../..");
  const tmpBase = mkdtempSync(join(tmpdir(), `construct-${prefix}-`));
  const signalsDir = join(tmpBase, "signals");
  mkdirSync(signalsDir, { recursive: true });
  return {
    tmpBase,
    signalsDir,
    env: { ...process.env, CONSTRUCT_DATA_ROOT: tmpBase },
    root: resolvedRoot,
  };
}

/** Remove the temp directory. Swallows errors. */
export function cleanupTestEnv(te: TestEnv) {
  try { rmSync(te.tmpBase, { recursive: true }); } catch {}
}

// ── Hook subprocess execution ───────────────────────────────────

export interface HookResult {
  stdout: string;
  exitCode: number;
}

/** Run a hook as a subprocess, piping stdin. Returns stdout and exit code. */
export function runHook(te: TestEnv, hookPath: string, stdin: string): HookResult {
  const absHook = join(te.root, "src", hookPath);
  const escaped = stdin.replace(/'/g, "'\\''");
  try {
    const stdout = execSync(
      `echo '${escaped}' | ${BUN} ${absHook} 2>/dev/null`,
      { encoding: "utf-8", timeout: 15000, env: te.env, cwd: te.root },
    );
    return { stdout, exitCode: 0 };
  } catch (err: any) {
    return { stdout: err.stdout ?? "", exitCode: err.status ?? 1 };
  }
}

// ── File helpers ────────────────────────────────────────────────

/** Delete a file if it exists. Swallows errors. */
export function clearFile(path: string) {
  try { unlinkSync(path); } catch {}
}

/** Read a file as UTF-8, or return undefined if missing. */
export function readFileSafe(path: string): string | undefined {
  try { return readFileSync(path, "utf-8"); } catch { return undefined; }
}

/** Check if a file exists and parse it as JSON, or return undefined. */
export function readJsonSafe(path: string): any | undefined {
  const raw = readFileSafe(path);
  if (raw === undefined) return undefined;
  try { return JSON.parse(raw); } catch { return undefined; }
}

// ── Transcript builders ─────────────────────────────────────────

/** Build a JSONL user message line. */
export function userMsg(text: string): string {
  return JSON.stringify({
    type: "user",
    message: { role: "user", content: [{ type: "text", text }] },
  });
}

/** Build a JSONL assistant message line, optionally with tool_use blocks. */
export function assistantMsg(
  text: string,
  toolUses: { name: string; input?: Record<string, any> }[] = [],
): string {
  const content: any[] = [{ type: "text", text }];
  for (const t of toolUses) {
    content.push({
      type: "tool_use",
      name: t.name,
      input: t.input ?? {},
      id: `toolu_${Math.random().toString(36).slice(2)}`,
    });
  }
  return JSON.stringify({
    type: "assistant",
    message: { role: "assistant", content },
  });
}

/** Write transcript lines to a temp JSONL file. Returns the path. */
export function writeTranscript(te: TestEnv, name: string, lines: string[]): string {
  const path = join(te.tmpBase, `transcript-${name}-${Date.now()}.jsonl`);
  writeFileSync(path, lines.join("\n") + "\n");
  return path;
}

// ── Assertions ──────────────────────────────────────────────────

export interface TestResults {
  passed: number;
  failed: number;
  failures: string[];
}

export function createResults(): TestResults {
  return { passed: 0, failed: 0, failures: [] };
}

/** Assert a named boolean condition. Prints ✓/✗ and tracks results. */
export function check(r: TestResults, name: string, ok: boolean, detail?: string) {
  if (ok) {
    console.log(`  ✓ ${name}`);
    r.passed++;
  } else {
    const msg = detail ? `${name} — ${detail}` : name;
    console.log(`  ✗ ${msg}`);
    r.failures.push(msg);
    r.failed++;
  }
}

/** Print summary and exit with appropriate code. */
export function printAndExit(r: TestResults): never {
  console.log(`\n${"=".repeat(50)}`);
  console.log(`${r.passed} passed, ${r.failed} failed`);
  if (r.failures.length > 0) {
    console.log("\nFailures:");
    for (const f of r.failures) console.log(`  - ${f}`);
  }
  process.exit(r.failed > 0 ? 1 : 0);
}

// ── Sandbox / scenario management ───────────────────────────────

/** Copy a scenario into a temp sandbox with git init. Returns sandbox path. */
export function setupSandbox(scenarioName: string): string {
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

/** Read task.md from a scenario directory. */
export function readTaskPrompt(scenarioName: string): string {
  return readFileSync(resolve(SCENARIOS_DIR, scenarioName, "task.md"), "utf8").trim();
}

// ── Agent SDK eval runner ───────────────────────────────────────

/** Behavioral signals collected during an eval trial. */
export interface EvalResult {
  taskSuccess: boolean;
  toolCalls: string[];
  editsMade: boolean;
  agentDispatched: boolean;
  unitTestsRun: boolean;
  e2eEvidence: boolean;
  artifactCreated: boolean;
  gateBlocks: number;
  e2eSignals: string[];
  artifacts: string[];
  durationMs: number;
  error?: string;
}

export function emptyResult(): EvalResult {
  return {
    taskSuccess: false, toolCalls: [], editsMade: false,
    agentDispatched: false, unitTestsRun: false,
    e2eEvidence: false, artifactCreated: false,
    gateBlocks: 0, e2eSignals: [], artifacts: [], durationMs: 0,
  };
}

/** Classify a tool call and update the result with behavioral signals. */
export function classifyToolCall(result: EvalResult, toolName: string, toolInput: any) {
  result.toolCalls.push(toolName);

  if (toolName === "Edit" || toolName === "Write" || toolName === "NotebookEdit") {
    result.editsMade = true;
  }
  if (toolName === "Agent") {
    result.agentDispatched = true;
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

/** PostToolUse hook that tracks all tool calls into an EvalResult. */
export function makeTracker(result: EvalResult): HookCallback {
  return async (input) => {
    const { tool_name, tool_input } = input as PostToolUseHookInput;
    classifyToolCall(result, tool_name, tool_input);
    return {};
  };
}

// ── Eval telemetry ──────────────────────────────────────────────

/** A hook event entry, matching the format of hook-events.jsonl. */
export interface HookEvent {
  ts: string;
  hook: string;
  event: string;
  sessionId: string;
  [key: string]: unknown;
}

/** Append a hook event to a JSONL telemetry file. */
export function writeHookEvent(path: string, event: HookEvent) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(event) + "\n");
}

/** Read all hook events from a JSONL file. */
export function readHookEvents(path: string): HookEvent[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf-8").trim().split("\n")
    .filter(Boolean)
    .map(line => { try { return JSON.parse(line); } catch { return null; } })
    .filter((e): e is HookEvent => e !== null);
}

// ── Eval config and runner ──────────────────────────────────────

export interface EvalConfig {
  scenario: string;
  prompt?: string;
  promptSuffix?: string;
  model?: string;
  maxTurns?: number;
  hooks?: Partial<Record<"PreToolUse" | "PostToolUse" | "Stop", HookCallbackMatcher[]>>;
  systemPrompt?: string;
  /** Pass a shared result object so custom hooks can read tracker signals (e.g. editsMade). */
  result?: EvalResult;
  /** Path to write hook telemetry JSONL. If set, eval hooks write events here. */
  telemetryPath?: string;
}

/**
 * Run Claude in a sandbox scenario and collect behavioral signals.
 *
 * Sets up a git-initialized sandbox from the scenario, launches Claude
 * via the Agent SDK, observes tool usage through hooks, and checks
 * task success by running `bun test` in the sandbox afterward.
 */
export async function runEval(config: EvalConfig): Promise<EvalResult> {
  const sandbox = setupSandbox(config.scenario);
  const result = config.result ?? emptyResult();
  const start = Date.now();

  let prompt = config.prompt ?? readTaskPrompt(config.scenario);
  if (config.promptSuffix) prompt += "\n\n" + config.promptSuffix;

  const tracker = makeTracker(result);

  // Wrap tracker to also emit telemetry if configured
  const trackerWithTelemetry: HookCallback = async (input, toolUseID, opts) => {
    const out = await tracker(input, toolUseID, opts);
    if (config.telemetryPath) {
      const { tool_name } = input as PostToolUseHookInput;
      writeHookEvent(config.telemetryPath, {
        ts: new Date().toISOString(),
        hook: "eval-tracker",
        event: "PostToolUse",
        sessionId: (input as any).session_id ?? "eval",
        tool: tool_name,
      });
    }
    return out;
  };

  const hooks: Record<string, HookCallbackMatcher[]> = {
    PostToolUse: [
      { hooks: [trackerWithTelemetry] },
      ...(config.hooks?.PostToolUse ?? []),
    ],
    ...(config.hooks?.PreToolUse ? { PreToolUse: config.hooks.PreToolUse } : {}),
    ...(config.hooks?.Stop ? { Stop: config.hooks.Stop } : {}),
  };

  try {
    const q = query({
      prompt,
      options: {
        cwd: sandbox,
        model: config.model ?? "claude-haiku-4-5-20251001",
        maxTurns: config.maxTurns ?? 30,
        permissionMode: "bypassPermissions",
        allowDangerouslySkipPermissions: true,
        persistSession: false,
        systemPrompt: config.systemPrompt,
        hooks,
      },
    });

    for await (const _message of q) {
      // consume — hooks do the tracking
    }

    result.durationMs = Date.now() - start;

    try {
      execSync("bun test", { cwd: sandbox, stdio: "pipe", timeout: 15000 });
      result.taskSuccess = true;
    } catch {
      result.taskSuccess = false;
    }
  } catch (err: any) {
    result.error = err.message?.slice(0, 300);
    result.durationMs = Date.now() - start;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }

  return result;
}

/** Format a single eval result as a one-line summary. */
export function formatResult(label: string, r: EvalResult): string {
  const status = r.taskSuccess ? "✓" : "✗";
  const e2e = r.e2eEvidence ? "e2e" : "no-e2e";
  const art = r.artifactCreated ? "artifact" : "no-artifact";
  const agent = r.agentDispatched ? "dispatched" : "inline";
  const gate = r.gateBlocks > 0 ? `BLOCKED(${r.gateBlocks}x)` : "ok";
  const dur = (r.durationMs / 1000).toFixed(1);
  const tools = [...new Set(r.toolCalls)].join(",");
  return `  ${status} [${label}] task:${r.taskSuccess ? "pass" : "fail"} ${e2e} ${art} ${agent} gate:${gate} ${dur}s tools:[${tools}]`;
}
