/**
 * A `claude -p` call for a role that gives one reply, and the run in the ledger that holds it:
 * the folder, the spawn, the time box, the cost, the ending, and the cleanup after a dead process.
 * `ALEPH_<ROLE>_CMD` replaces `claude`, which is how a test gives a fake, and
 * `ALEPH_<ROLE>_TIMEOUT` replaces the role's time box, in seconds.
 * `agentCall` runs every call: the stall watch, the time box and the credit check.
 */
import { modelArgv, modelEnv, onGpu, readModels, viaOfRun } from "../routing/models.ts";
import { gpuSlot, holdBackend } from "../gates/factory-status.ts";
import { appendFileSync, closeSync, openSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { outcome, replyOf, type Outcome } from "../gates/gate.ts";
import { allRuns, makeRun, runsDir, type Run } from "../records/ledger.ts";
import { getRun, patchRun, putRun } from "../records/record.ts";
import { lock } from "../infra/locks.ts";
import { roleCmd, roleSeconds } from "../infra/settings.ts";
import { runFile } from "../records/run-files.ts";
import { schemaFlags, sessionOf, structuredOf } from "./structured.ts";

export interface Call {
  role: string;
  /** The role's name in a failure: `${who} exited 1`. */
  who: string;
  model: string;
  seconds: number;
  /** The arguments after the model: the role's tools and what they may do. */
  flags: string[];
  cwd?: string;
  /** The JSON schema of the reply: the call then gives the reply's `structured_output` as `data`. */
  schema?: object;
}

/** How long a call that the time box or the stall watch stopped gets after SIGTERM before SIGKILL. */
const KILL_AFTER_MS = 30_000;

/** Signal the process group that `pid` leads, and `pid` itself when the group is gone. */
function killGroup(pid: number, signal: NodeJS.Signals): void {
  try { process.kill(-pid, signal); } catch { try { process.kill(pid, signal); } catch {} }
}

/** The ledger's line for a role's run. `job` defaults to the folder's own name. The run's subject is `on`, else `monitor` for the monitor, else `name`. */
export interface Opening extends Call {
  role: "intake" | "director" | "monitor";
  name: string;
  /** The first line of command.txt. */
  command: string;
  shown: boolean;
  job?: string;
  repo?: string;
  on?: string;
}

export interface AgentRun {
  folder: string;
  /**
   * The reply's text. It writes prompt.md and output.log and records the cost, and then throws on a time-out or a non-zero exit.
   * `cwd` replaces the opening's working directory for this call.
   */
  ask(input: string, cwd?: string): Promise<string>;
  /** As `ask`, for an opening with a `schema`: the reply's structured output, or undefined when it has none. */
  askData(input: string, cwd?: string): Promise<unknown>;
  /**
   * As `askData`, a second turn after the last call: it resumes that call's session with `input`, or, when the
   * reply named no session, sends the last input and `input` as a new call. prompt.md and output.log get it appended, and the run's cost is the sum.
   */
  askAgain(input: string, cwd?: string): Promise<unknown>;
  /** The run is `done`: a role's run has no land or drop, whatever its reply was. */
  end(reason: string, fields?: Partial<Run>): void;
}

/** Make the run's folder and state. The caller ends the run, on every path. */
export function openRun(o: Opening): AgentRun {
  const id = makeRun({ kind: o.role, name: o.name, on: o.on, job: o.job }, (folder, n) => {
    putRun(basename(folder), { kind: o.role, job: o.job ?? basename(folder), name: o.name, ...(o.repo !== undefined ? { repo: o.repo } : {}), ...(o.on !== undefined ? { on: o.on } : {}), condition: "running", phase: o.role, model: o.model, told: true, shown: o.shown, started: new Date().toISOString(), made: Date.now(), n });
  });
  const folder = join(runsDir(), id);
  writeFileSync(runFile(folder, "command.txt"), `${o.command}\n`);
  let prev: { input: string; session?: string } | undefined;
  let spent: number | undefined;
  let credit = false;
  const call = async (input: string, cwd?: string, again = false) => {
    const write = again ? appendFileSync : writeFileSync;
    const resume = again ? prev?.session : undefined;
    const sent = again && !resume ? `${prev?.input ?? ""}\n\n${input}` : input;
    write(runFile(folder, "prompt.md"), again ? `\n\n---\n\n${sent}` : sent);
    const c = resume ? { ...o, flags: [...o.flags, "--resume", resume] } : o;
    const role = o.role.toUpperCase();
    const log = runFile(folder, "output.log");
    if (!again) writeFileSync(log, "");
    const seen = statSync(log).size;
    const argv = modelArgv(roleCmd(role), o.model, ["--output-format", "stream-json", "--verbose", ...c.flags, ...(o.schema ? schemaFlags(o.schema) : [])]);
    let release: (() => void) | null = null;
    if (onGpu(o.model)) release = await gpuSlot(roleSeconds(role, o.seconds) * 1000);
    let w;
    try {
      w = await agentCall(o.role, argv, {
        cwd: cwd ?? o.cwd, env: { ...process.env, ANTHROPIC_API_KEY: undefined, CLAUDECODE: undefined, ...modelEnv(o.model) }, stdin: sent,
        stdout: log, stderr: runFile(folder, "stderr.log"), limit: roleSeconds(role, o.seconds), stall: stallSeconds(),
      });
    } finally {
      release?.();
    }
    const out = readFileSync(log).subarray(seen).toString();
    const r = { ...replyOf(out), data: structuredOf(out) };
    prev = { input: sent, session: sessionOf(out) };
    if (r.cost !== undefined) { spent = (spent ?? 0) + r.cost; patchRun(basename(folder), { cost: spent }); }
    if (w.cause?.kind === "credit") {
      credit = true;
      await holdBackend(viaOfRun(o, readModels()), w.cause.reason);
    }
    const failure = w.step.stalled ? stallReason() : w.step.timedOut ? `${o.who} timed out` : w.step.code !== 0 ? `${o.who} exited ${w.step.code}` : undefined;
    if (failure) throw new Error(failure);
    return r;
  };
  return {
    folder,
    ask: async (input, cwd) => (await call(input, cwd)).text,
    askData: async (input, cwd) => (await call(input, cwd)).data,
    askAgain: async (input, cwd) => (await call(input, cwd, true)).data,
    end: (reason, fields = {}) => endRun(folder, reason, credit ? { ...fields, cause: "credit" } : fields),
  };
}

export function endRun(folder: string, reason: string, fields: Partial<Run> = {}): void {
  patchRun(basename(folder), { condition: "done", reason, ...fields, phase: undefined, ended: new Date().toISOString() });
}

/**
 * End the role's runs that a dead process left `running`. A live run's process holds a lock for the
 * whole run, and `lockOf` names it, or gives null for a run to leave alone. When no wait gets the
 * lock, no process is running that run. A run whose lock is held stays as it is.
 */
export async function endLost(role: Opening["role"], lockOf: (run: Run) => string | null, before = "a reply"): Promise<void> {
  for (const { folder, run } of allRuns()) {
    if (run.kind !== role || run.condition !== "running") continue;
    const name = lockOf(run);
    const release = name && await lock(name, 0);
    if (!release) continue;
    try {
      // Read again under the lock: the run may have ended since the list was read.
      if (getRun(basename(folder))?.condition === "running") endRun(folder, `failed: its process ended before ${before}`, { cause: "unanswered" });
    } finally {
      release();
    }
  }
}

/** The roles that call `claude` through `agentCall`. */
export type AgentRole = "worker" | "reviewer" | "title" | "judge" | Opening["role"];

/** Why a call gave no usable reply, and its kind. */
export interface AgentCause { kind: "stalled" | "timeout" | "credit" | "other"; reason: string }

/** How a call ended: its exit code, and whether the time box or the stall watch stopped it. */
export interface Step { code: number; timedOut: boolean; stalled: boolean }

/** How long an agent call may print nothing before the stall watch stops it. */
export const stallSeconds = (): number => Number(process.env.ALEPH_STALL_SECONDS ?? 600);
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

/** Where and how an agent call runs: `limit` is the time box and `stall` the stall watch, both in seconds. */
export interface AgentOptions {
  cwd?: string; env: Record<string, string | undefined>; stdin: string; stdout: string; stderr: string; limit: number; stall: number;
  onSpawn?: (p: ReturnType<typeof Bun.spawn>) => void;
}

/**
 * One `claude` call, `argv`, in `o.cwd` and a process group of its own, with stdout and stderr appended to their files.
 * The time box, and the stall watch when stdout has not grown for `o.stall` seconds, stop the whole group: SIGTERM,
 * then SIGKILL. It reads the stdout log for the outcome.
 */
export async function agentCall(role: AgentRole, argv: string[], o: AgentOptions):
  Promise<{ role: AgentRole; outcome: Outcome; step: Step; cause: AgentCause | null }> {
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
    if (performance.now() - last < o.stall * 1000) return;
    stalled = true;
    end();
  }, Math.min(1000, o.stall * 250));
  const code = await p.exited;
  clearTimeout(box);
  clearInterval(watch);
  closeSync(out);
  if (err !== out) closeSync(err);
  const step = { code, timedOut: timedOut && !stalled, stalled };
  const res = outcome(readFileSync(o.stdout, "utf8"));
  return { role, outcome: res, step, cause: agentCause(step, res) };
}
