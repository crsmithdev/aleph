/**
 * One `claude -p` call of an agent role, and the only place that builds one: the argv and the env from MODELS,
 * the GPU slot, the time box and the stall watch, the credit check and the backend hold, the cost, and the
 * structured reply. `--json-schema` makes the agent end with a value that the schema validates, and the stream's
 * `result` event carries it as `structured_output`. A top-level schema must be `"type": "object"` with no
 * top-level `oneOf`, `anyOf` or `allOf`: the API refuses those.
 */
import { closeSync, openSync, readFileSync, statSync } from "node:fs";
import { BACKENDS, modelArgv, modelEnv, onGpu, viaOf } from "../routing/models.ts";
import { gpuSlot, holdBackend } from "../gates/factory-status.ts";
import { policyOf } from "../records/outcome.ts";
import { roleCmd, stallSeconds } from "../infra/settings.ts";
import { logEvent } from "../../../lib/layout.ts";
import { costDetails, type Usage } from "../../../lib/pricing.ts";

/** The roles that call `claude`. */
export type AgentRole = "worker" | "reviewer" | "title" | "judge" | "intake" | "director" | "monitor" | "chat";

/** Why a call gave no usable reply, and its kind. */
export interface AgentCause { kind: "stalled" | "timeout" | "credit" | "other"; reason: string }

/** How a call ended: its exit code, and whether the time box or the stall watch stopped it. */
export interface Step { code: number; timedOut: boolean; stalled: boolean }

/** Where and how a call runs. */
export interface Ask {
  model: string | undefined;
  /** The arguments after the model: the role's tools and what they may do. */
  flags: string[];
  /** The JSON schema of the reply: the reply's `structured_output` is then its `data`. */
  schema?: object;
  /** The command in place of `claude`; else `ALEPH_<ROLE>_CMD`, else `claude`. */
  cmd?: string;
  cwd?: string;
  /** The env before the model's; else this process's with no API key and no CLAUDECODE, so the call bills the subscription. */
  env?: Record<string, string | undefined>;
  /** The files that the call's stdout and stderr are appended to. */
  stdout: string;
  stderr: string;
  /** The time box in seconds. A call on the GPU waits as long for the slot. */
  limit: number;
  /** false: the call takes no GPU slot, as the worker's run counts against LOCAL_CAP itself. */
  slot?: false;
  /** The model of a call on the GPU whose slot stays taken; without one, the call runs on its own model without the slot. */
  fallback?: string;
  onSpawn?: (p: ReturnType<typeof Bun.spawn>) => void;
}

/** A call's reply: its text, its structured output, its session, its cost in USD, how it ended, and why it gave no usable reply, or null. */
export interface Reply { text: string; data: unknown; session?: string; cost?: number; step: Step; cause: AgentCause | null }

/** How long a call that the time box or the stall watch stopped gets after SIGTERM before SIGKILL. */
const KILL_AFTER_MS = 30_000;

/** The reason of a call that the stall watch stopped. */
export const stallReason = (): string => {
  const s = stallSeconds();
  return `stalled: no output for ${s % 60 === 0 ? `${s / 60} minutes` : `${s} seconds`}`;
};

/** The API credit error the CLI reports when the account has no credit: the call did no work. */
const CREDIT_ERROR = /API Error: 402/;

/** The cause the call states: a stall, the time box, the API credit error, or a reply that is not ok; null when the reply is ok. */
export function agentCause(r: Step, o: Outcome): AgentCause | null {
  if (r.stalled) return { kind: "stalled", reason: stallReason() };
  if (r.timedOut) return { kind: "timeout", reason: "time box" };
  if (!o.ok) return CREDIT_ERROR.test(o.line) ? { kind: "credit", reason: o.line } : { kind: "other", reason: o.line || `exit ${r.code}` };
  return null;
}

/**
 * What a stream-json stdout says. `found`: it has a `result` event. `usage` is that event's tokens, in the shape
 * `costDetails` takes; `data` its `structured_output`; `line` why it is not ok, else empty.
 */
export interface Outcome { found: boolean; ok: boolean; line: string; result: string; cost?: number; usage?: Usage; session?: string; data?: unknown }

/**
 * The only read of a stream-json stdout's answer: its last `result` event. Lines that are not JSON and other events
 * are skipped, so a line after the result does not change the answer. It is ok only when the event says `is_error`
 * false; an event with no `is_error` is not ok. With no result event it is not ok, and `line` is the last line that is
 * not a `command_lifecycle` event, which the command adds after the agent's output.
 */
export function resultOf(stdout: string): Outcome {
  let last: string | undefined;
  for (const line of stdout.trimEnd().split("\n").reverse()) {
    let ev: any;
    try { ev = JSON.parse(line); } catch { last ??= line; continue; }
    if (ev?.type !== "result") { if (ev?.type !== "command_lifecycle") last ??= line; continue; }
    const result = typeof ev.result === "string" ? ev.result : "";
    const ok = ev.is_error === false, u = ev.usage;
    const usage = typeof u?.input_tokens === "number" && typeof u?.output_tokens === "number"
      ? { input: u.input_tokens, output: u.output_tokens, cache_read_input_tokens: u.cache_read_input_tokens ?? 0, cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0 }
      : undefined;
    return {
      found: true, ok, line: ok ? "" : (result || line).slice(0, 300), result,
      cost: typeof ev.total_cost_usd === "number" ? ev.total_cost_usd : undefined, ...(usage ? { usage } : {}),
      session: typeof ev.session_id === "string" ? ev.session_id : undefined, data: ev.structured_output ?? undefined,
    };
  }
  return { found: false, ok: false, line: (last ?? "").slice(0, 300) || "no output", result: "" };
}

/** Claude Code knows Claude's prices only: a call on another model is priced from its tokens. */
const costOf = (model: string | undefined, o: Outcome): number | undefined =>
  viaOf(model) === "claude" ? o.cost : costDetails(model!, o.usage ?? { input: 0, output: 0 })?.total;

/**
 * Call `role` with `prompt` on stdin. A call that the API refused for credit holds its model's backend.
 * A call that exited 0 with no `result` event, as a test's fake prints, has its stdout as its text.
 */
export async function callAgent(role: AgentRole, prompt: string, o: Ask): Promise<Reply> {
  const gpu = onGpu(o.model) && o.slot !== false;
  const release = gpu ? await gpuSlot(o.limit * 1000) : null;
  const model = gpu && !release && o.fallback ? o.fallback : o.model;
  if (model !== o.model) logEvent({ by: "rule", subject: role, action: "gpu", note: `the GPU slot stayed taken for ${o.limit} s; the call falls back to ${BACKENDS[viaOf(model)]}` });
  const argv = modelArgv(o.cmd ?? roleCmd(role.toUpperCase()), model, ["--output-format", "stream-json", "--verbose", ...o.flags, ...(o.schema ? ["--json-schema", JSON.stringify(o.schema)] : [])]);
  const env = { ...(o.env ?? { ...process.env, ANTHROPIC_API_KEY: undefined, CLAUDECODE: undefined }), ...modelEnv(model) };
  const seen = statSync(o.stdout, { throwIfNoEntry: false })?.size ?? 0;
  let step: Step;
  try {
    step = await spawn(argv, { ...o, env, stdin: prompt });
  } finally {
    release?.();
  }
  const out = readFileSync(o.stdout).subarray(seen).toString();
  const res = resultOf(out);
  const cause = agentCause(step, res);
  if (cause && policyOf(cause.kind).holdsBackend) await holdBackend(viaOf(model), cause.reason);
  return { text: step.code === 0 && !res.found ? out : res.result, data: res.data, session: res.session, cost: costOf(model, res), step, cause };
}

/** Signal the process group that `pid` leads, and `pid` itself when the group is gone. */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch {} }
}

/**
 * Run `argv` in `o.cwd` and a process group of its own, with stdout and stderr appended to their files.
 * The time box, and the stall watch when stdout has not grown for `stallSeconds`, stop the whole group: SIGTERM,
 * then SIGKILL.
 */
async function spawn(argv: string[], o: Ask & { env: Record<string, string | undefined>; stdin: string }): Promise<Step> {
  const stall = stallSeconds();
  const out = openSync(o.stdout, "a");
  const err = o.stderr === o.stdout ? out : openSync(o.stderr, "a");
  const p = Bun.spawn(argv, { cwd: o.cwd, env: o.env, stdin: new Blob([o.stdin]), stdout: out, stderr: err, detached: true });
  o.onSpawn?.(p);
  let timedOut = false, stalled = false;
  const end = () => {
    clearTimeout(box);
    clearInterval(watch);
    killGroup(p.pid, "SIGTERM");
    setTimeout(() => killGroup(p.pid, "SIGKILL"), KILL_AFTER_MS).unref();
  };
  const box = setTimeout(() => { timedOut = true; end(); }, o.limit * 1000);
  let size = statSync(o.stdout).size;
  let last = performance.now();
  const watch = setInterval(() => {
    const now = statSync(o.stdout, { throwIfNoEntry: false })?.size;
    if (now !== size) { size = now ?? 0; last = performance.now(); return; }
    if (performance.now() - last < stall * 1000) return;
    stalled = true;
    end();
  }, Math.min(1000, stall * 250));
  const code = await p.exited;
  clearTimeout(box);
  clearInterval(watch);
  closeSync(out);
  if (err !== out) closeSync(err);
  return { code, timedOut: timedOut && !stalled, stalled };
}
