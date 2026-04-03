/**
 * Shared eval harness.
 *
 * Two layers:
 *   1. Hook subprocess testing — run hook scripts with crafted stdin,
 *      assert on exit codes and stdout. Used by test.ts.
 *   2. Agent SDK evals — launch Claude in a sandbox with real hook scripts
 *      registered via settings.json. Programmatic hooks observe behavior;
 *      real hooks do enforcement and write telemetry.
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
import { E2E_CMD, ARTIFACT_CMD, UNIT_TEST_CMD, GIT_COMMIT_CMD } from "./patterns.ts";

const BUN = process.argv[0];
const EVAL_ROOT = resolve(import.meta.dir);
const REPO_ROOT = resolve(EVAL_ROOT, "../..");
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
  const resolvedRoot = root ?? REPO_ROOT;
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
  trace: string;
}

function splitTrace(raw: string): { stdout: string; trace: string } {
  const lines = raw.split("\n");
  const traceLines = lines.filter(l => l.startsWith("[trace:"));
  const outLines = lines.filter(l => !l.startsWith("[trace:"));
  return { stdout: outLines.join("\n"), trace: traceLines.join("\n") };
}

/** Run a hook as a subprocess, piping stdin. Returns stdout, trace, and exit code. */
export function runHook(te: TestEnv, hookPath: string, stdin: string): HookResult {
  const absHook = join(te.root, "src", hookPath);
  const escaped = stdin.replace(/'/g, "'\\''");
  try {
    const raw = execSync(
      `echo '${escaped}' | ${BUN} ${absHook} 2>/dev/null`,
      { encoding: "utf-8", timeout: 15000, env: te.env, cwd: te.root },
    );
    const { stdout, trace } = splitTrace(raw);
    return { stdout, trace, exitCode: 0 };
  } catch (err: any) {
    const { stdout, trace } = splitTrace(err.stdout ?? "");
    return { stdout, trace, exitCode: err.status ?? 1 };
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
  info: { name: string; pass: boolean }[];
}

export function createResults(): TestResults {
  return { passed: 0, failed: 0, failures: [], info: [] };
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

/** Record an informational check (not scored). */
export function checkInfo(r: TestResults, name: string, ok: boolean) {
  r.info.push({ name, pass: ok });
}

/** Run a hook and assert exit code + stdout substrings. */
export function runAndCheck(
  te: TestEnv, r: TestResults,
  hookPath: string, name: string, stdin: string,
  opts: { expectExit?: number; expectStdout?: string[] } = {},
): HookResult {
  const expectExit = opts.expectExit ?? 0;
  const label = `${hookPath.split("/").pop()!.replace(".ts", "")}: ${name}`;
  const result = runHook(te, hookPath, stdin);
  if (expectExit !== 0 && result.exitCode !== 0) {
    check(r, label, true);
  } else if (expectExit !== 0 && result.exitCode === 0) {
    check(r, label, false, `expected exit ${expectExit}, got 0`);
  } else if (expectExit === 0 && result.exitCode !== 0) {
    check(r, label, false, `exited ${result.exitCode}`);
  } else if (opts.expectStdout) {
    for (const sub of opts.expectStdout) {
      if (!result.stdout.includes(sub)) {
        check(r, label, false, `stdout missing "${sub}"`);
        return result;
      }
    }
    check(r, label, true);
  } else {
    check(r, label, true);
  }
  return result;
}

/** Print summary and exit with appropriate code. */
export function printAndExit(r: TestResults): never {
  if (r.info.length > 0) {
    console.log("\n  Informational (not scored):");
    for (const c of r.info) console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}`);
  }
  console.log(`\n${"=".repeat(50)}`);
  console.log(`${r.passed} passed, ${r.failed} failed`);
  if (r.failures.length > 0) {
    console.log("\nFailures:");
    for (const f of r.failures) console.log(`  - ${f}`);
  }
  process.exit(r.failed > 0 ? 1 : 0);
}

/** Print summary without exiting. Returns exit code. */
export function printSummary(r: TestResults): number {
  if (r.info.length > 0) {
    console.log("\n  Informational (not scored):");
    for (const c of r.info) console.log(`  ${c.pass ? "✓" : "✗"} ${c.name}`);
  }
  const pct = r.passed + r.failed > 0 ? Math.round((r.passed / (r.passed + r.failed)) * 100) : 100;
  console.log(`\n${r.passed} passed, ${r.failed} failed (${pct}%)`);
  return r.failed > 0 ? 1 : 0;
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

// ── Sandbox hook registration ───────────────────────────────────

/** Hook types that can be registered in settings.json. */
export type HookEventName = "PreToolUse" | "PostToolUse" | "Stop" | "UserPromptSubmit";

export interface SandboxHook {
  event: HookEventName;
  command: string;
  matcher?: string;
  timeout?: number;
}

/**
 * Write a .claude/settings.json into the sandbox with real hook scripts.
 * Commands use absolute paths to the repo's hook scripts so they resolve
 * from any sandbox cwd. CONSTRUCT_DATA_ROOT must be set in the env so
 * hooks write telemetry to the sandbox's data dir, not ~/.construct.
 */
export function registerSandboxHooks(sandbox: string, hooks: SandboxHook[]) {
  const grouped: Record<string, any[]> = {};
  for (const h of hooks) {
    if (!grouped[h.event]) grouped[h.event] = [];
    const entry: any = {
      hooks: [{
        type: "command",
        command: h.command,
        timeout: h.timeout ?? 3000,
      }],
    };
    if (h.matcher) entry.matcher = h.matcher;
    grouped[h.event].push(entry);
  }

  const claudeDir = join(sandbox, ".claude");
  mkdirSync(claudeDir, { recursive: true });
  writeFileSync(join(claudeDir, "settings.json"), JSON.stringify({ hooks: grouped }, null, 2));
}

/** Resolve absolute path to a hook script in the construct repo. */
export function hookCmd(hookPath: string): string {
  return `bun ${resolve(REPO_ROOT, "src", hookPath)}`;
}

/** Standard e2e advisory hooks pointing to real scripts. */
export function qualityHooks(): SandboxHook[] {
  return [
    { event: "UserPromptSubmit", command: hookCmd("core/hooks/routing-submit-classify.ts") },
    { event: "Stop", command: hookCmd("core/hooks/quality-stop-check-e2e.ts") },
  ];
}

/**
 * Create a PreToolUse hook callback that delegates to a real hook script.
 * Runs the script as a subprocess with the same stdin the SDK provides,
 * plus CONSTRUCT_DATA_ROOT set to the eval's data dir. The script's
 * exit code determines the SDK's decision (exit 2 = block).
 */
/**
 * Run a real hook script as a subprocess, passing the SDK's input as stdin.
 * Uses execSync with `input` option to avoid shell escaping issues.
 */
function execHook(absHook: string, dataRoot: string, input: any): { stdout: string; exitCode: number } {
  const stdin = JSON.stringify(input);
  try {
    const stdout = execSync(`bun ${absHook}`, {
      input: stdin,
      encoding: "utf-8",
      timeout: 5000,
      env: { ...process.env, CONSTRUCT_DATA_ROOT: dataRoot },
      cwd: REPO_ROOT,
    });
    return { stdout: stdout.trim(), exitCode: 0 };
  } catch (err: any) {
    return { stdout: (err.stdout ?? "").trim(), exitCode: err.status ?? 1 };
  }
}

export function realHookCallback(hookPath: string, dataRoot: string): HookCallback {
  const absHook = resolve(REPO_ROOT, "src", hookPath);
  return async (input) => {
    const { stdout, exitCode } = execHook(absHook, dataRoot, input);
    if (exitCode === 2) return { decision: "block" as const, reason: stdout || "Hook blocked" };
    if (stdout) return { systemMessage: stdout };
    return {};
  };
}

export function realStopHookCallback(hookPath: string, dataRoot: string): HookCallback {
  const absHook = resolve(REPO_ROOT, "src", hookPath);
  return async (input) => {
    const { stdout } = execHook(absHook, dataRoot, input);
    if (stdout) return { systemMessage: stdout };
    return {};
  };
}

export function realQualityHooks(dataRoot: string): Partial<Record<"PostToolUse" | "Stop", HookCallbackMatcher[]>> {
  return {
    Stop: [{
      hooks: [realStopHookCallback("core/hooks/quality-stop-check-e2e.ts", dataRoot)],
    }],
  };
}

// ── Agent SDK eval runner ───────────────────────────────────────

/** Behavioral signals collected during an eval trial. */
export interface EvalResult {
  taskSuccess: boolean;
  toolCalls: string[];
  editsMade: boolean;
  filesChanged: string[];
  agentDispatched: boolean;
  unitTestsRun: boolean;
  e2eEvidence: boolean;
  artifactCreated: boolean;
  gateBlocks: number;
  e2eSignals: string[];
  artifacts: string[];
  gitCommits: number;
  durationMs: number;
  error?: string;
}

export function emptyResult(): EvalResult {
  return {
    taskSuccess: false, toolCalls: [], editsMade: false,
    filesChanged: [], agentDispatched: false, unitTestsRun: false,
    e2eEvidence: false, artifactCreated: false,
    gateBlocks: 0, e2eSignals: [], artifacts: [], gitCommits: 0, durationMs: 0,
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
    if (GIT_COMMIT_CMD.test(cmd)) {
      result.gitCommits++;
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
  /** Programmatic SDK hooks — used for behavioral tracking and custom gates. */
  hooks?: Partial<Record<"PreToolUse" | "PostToolUse" | "Stop" | "UserPromptSubmit", HookCallbackMatcher[]>>;
  systemPrompt?: string;
  /** Pass a shared result object so custom hooks can read tracker signals. */
  result?: EvalResult;
  /** Pre-created data root — if set, hooks and env use this dir for telemetry. */
  dataRoot?: string;
  /** Real hook scripts to register in the sandbox's settings.json. */
  sandboxHooks?: SandboxHook[];
}

/** Paths to telemetry files written by real hooks during an eval. */
export interface EvalTelemetry {
  /** Path to hook-events.jsonl written by real hooks via reportHook(). */
  hookEventsPath: string;
  /** Path to the signals directory (marker files, etc.). */
  signalsDir: string;
  /** Path to the CONSTRUCT_DATA_ROOT used during the eval. */
  dataRoot: string;
}

/**
 * Run Claude in a sandbox scenario and collect behavioral signals.
 *
 * Sets up a git-initialized sandbox, optionally registers real hook scripts
 * via settings.json, launches Claude via the Agent SDK, and observes
 * behavior through both programmatic hooks (EvalResult) and real hook
 * telemetry (hook-events.jsonl, marker files).
 *
 * Returns { result, telemetry } — the telemetry paths remain valid after
 * return (the data dir is NOT cleaned up; callers should clean up).
 */
export async function runEval(config: EvalConfig): Promise<{ result: EvalResult; telemetry: EvalTelemetry }> {
  const sandbox = setupSandbox(config.scenario);
  const result = config.result ?? emptyResult();
  const start = Date.now();

  // Isolated data dir for this eval — hooks write here, not to ~/.construct
  const dataRoot = config.dataRoot ?? mkdtempSync(join(tmpdir(), "eval-data-"));
  const signalsDir = join(dataRoot, "signals");
  mkdirSync(signalsDir, { recursive: true });
  const hookEventsPath = join(signalsDir, "hook-events.jsonl");

  const telemetry: EvalTelemetry = { hookEventsPath, signalsDir, dataRoot };

  // Register real hook scripts in sandbox settings.json
  if (config.sandboxHooks?.length) {
    registerSandboxHooks(sandbox, config.sandboxHooks);
  }

  let prompt = config.prompt ?? readTaskPrompt(config.scenario);
  if (config.promptSuffix) prompt += "\n\n" + config.promptSuffix;

  const tracker = makeTracker(result);

  // Programmatic hooks — tracker always runs; additional hooks from config
  const hooks: Record<string, HookCallbackMatcher[]> = {
    PostToolUse: [
      { hooks: [tracker] },
      ...(config.hooks?.PostToolUse ?? []),
    ],
    ...(config.hooks?.PreToolUse ? { PreToolUse: config.hooks.PreToolUse } : {}),
    ...(config.hooks?.Stop ? { Stop: config.hooks.Stop } : {}),
    ...(config.hooks?.UserPromptSubmit ? { UserPromptSubmit: config.hooks.UserPromptSubmit } : {}),
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
        persistSession: true,
        systemPrompt: config.systemPrompt,
        env: { ...process.env, CONSTRUCT_DATA_ROOT: dataRoot },
        hooks,
      },
    });

    for await (const _message of q) {
      // consume — hooks do the tracking
    }

    result.durationMs = Date.now() - start;

    // Check which files were modified in the sandbox
    try {
      const diff = execSync("git diff --name-only HEAD", { cwd: sandbox, encoding: "utf-8", timeout: 5000 }).trim();
      if (diff) result.filesChanged = diff.split("\n").filter(Boolean);
    } catch {}

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
    // NOTE: dataRoot is NOT cleaned up — caller reads telemetry, then cleans up
  }

  return { result, telemetry };
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
