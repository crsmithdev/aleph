/**
 * A `claude -p` call for a role that gives one reply, and the run in the ledger that holds it:
 * the folder, the spawn, the time box, the cost, the ending, and the cleanup after a dead process.
 * `ALEPH_<ROLE>_CMD` replaces `claude`, which is how a test gives a fake, and
 * `ALEPH_<ROLE>_TIMEOUT` replaces the role's time box, in seconds.
 * `agentCall` is the other kind: a sandboxed `claude` call (the worker and the reviewer) under srt.
 */
import { NO_SKILLS } from "./role-skill.ts";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gitPrelude, q } from "./agent-call.ts";
import { outcome, replyOf, type Outcome } from "./gate.ts";
import { sandboxed, stallReason, type Step } from "./sandbox.ts";
import { allRuns, lock, readRun, runsDir, stamp, updateRun, writeRun, type Run } from "./ledger.ts";
import { roleCmd, roleSeconds } from "./settings.ts";
import { runFile } from "./run-files.ts";

export interface Call {
  role: string;
  /** The role's name in a failure: `${who} exited 1`. */
  who: string;
  model: string;
  seconds: number;
  /** The arguments after the model: the role's tools and what they may do. */
  flags: string[];
  cwd?: string;
}

async function spawn(c: Call, input: string): Promise<{ output: string; text: string; cost?: number; failure?: string }> {
  const role = c.role.toUpperCase();
  const argv = [roleCmd(role), "-p", "--strict-mcp-config", NO_SKILLS, "--output-format", "stream-json", "--verbose", "--model", c.model, ...c.flags];
  const p = Bun.spawn(argv, { cwd: c.cwd, env: { ...process.env, ANTHROPIC_API_KEY: undefined, CLAUDECODE: undefined }, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; p.kill(); }, roleSeconds(role, c.seconds) * 1000);
  try {
    const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited]);
    const failure = timedOut ? `${c.who} timed out` : code !== 0 ? `${c.who} exited ${code}` : undefined;
    return { output: out + err, ...replyOf(out), failure };
  } finally {
    clearTimeout(timer);
  }
}

/** One call with no run of its own. It throws on a time-out or a non-zero exit. */
export async function callAgent(c: Call, input: string): Promise<{ text: string; cost?: number }> {
  const r = await spawn(c, input);
  if (r.failure) throw new Error(r.failure);
  return { text: r.text, cost: r.cost };
}

/** The ledger's line for a role's run. `job` defaults to the folder's own name. */
export interface Opening extends Call {
  role: "triage" | "plan" | "facts" | "director" | "monitor";
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
  /** The run is `done`: a role's run has no land or drop, whatever its reply was. */
  end(reason: string, fields?: Partial<Run>): void;
}

/** Make the run's folder and state. The caller ends the run, on every path. */
export function openRun(o: Opening): AgentRun {
  mkdirSync(runsDir(), { recursive: true });
  let folder = "";
  for (let n = 0; !folder; n++) {
    const path = join(runsDir(), `${stamp()}-${o.name}${n ? `-${n}` : ""}-${o.role}`);
    try { mkdirSync(path); folder = path; } catch (e: any) { if (e.code !== "EEXIST") throw e; }
  }
  writeRun(folder, { kind: o.role, job: o.job ?? folder.split("/").at(-1)!, name: o.name, ...(o.repo !== undefined ? { repo: o.repo } : {}), ...(o.on !== undefined ? { on: o.on } : {}), condition: "running", phase: o.role, model: o.model, told: true, shown: o.shown, started: new Date().toISOString(), made: Date.now() });
  writeFileSync(runFile(folder, "command.txt"), `${o.command}\n`);
  return {
    folder,
    async ask(input, cwd) {
      writeFileSync(runFile(folder, "prompt.md"), input);
      const r = await spawn(cwd === undefined ? o : { ...o, cwd }, input);
      writeFileSync(runFile(folder, "output.log"), r.output);
      if (r.cost !== undefined) updateRun(folder, { cost: r.cost });
      if (r.failure) throw new Error(r.failure);
      return r.text;
    },
    end: (reason, fields = {}) => endRun(folder, reason, fields),
  };
}

export function endRun(folder: string, reason: string, fields: Partial<Run> = {}): void {
  updateRun(folder, { condition: "done", reason, ...fields, phase: undefined, ended: new Date().toISOString() });
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
      if (readRun(folder)?.condition === "running") endRun(folder, `failed: its process ended before ${before}`, { cause: "no-answer" });
    } finally {
      release();
    }
  }
}

/** The two sandboxed `claude` calls. */
export type AgentRole = "worker" | "scenario reviewer";

/** A git bundle the script fetches `refs` from before the setup lines, which run with stdout on stderr. */
export interface AgentBundle { bundle: string; refs: string[]; setup: string[] }

/** Why a sandboxed call gave no usable reply, and its kind. */
export interface AgentCause { kind: "stalled" | "time-box" | "other"; reason: string }

export type AgentOptions = Parameters<typeof sandboxed>[2];

/**
 * The call's script. With a bundle, setup output goes to stderr, so the agent's own stdout is the whole log;
 * without one, the script only runs the argv.
 */
export function agentScript(argv: string[], bundle?: AgentBundle): string {
  const run = `exec ${argv.map(q).join(" ")}`;
  if (!bundle) return run;
  return ["set -e", "exec 3>&1 1>&2", ...gitPrelude(bundle.bundle, bundle.refs), ...bundle.setup, "exec 1>&3 3>&-", run].join("\n");
}

/** The cause the call states: a stall, the time box, or a reply that is not ok; null when the reply is ok. */
export function agentCause(r: Step, o: Outcome): AgentCause | null {
  if (r.stalled) return { kind: "stalled", reason: stallReason() };
  if (r.timedOut) return { kind: "time-box", reason: "time box" };
  if (!o.ok) return { kind: "other", reason: o.line || `exit ${r.code}` };
  return null;
}

/**
 * One sandboxed `claude` call in the run folder `dir`: it runs the script under srt and reads the stdout log,
 * or "" when the log is missing. The caller keeps its own paths, env, limits and writes.
 */
export async function agentCall(role: AgentRole, dir: string, bundle: AgentBundle | undefined, argv: string[], o: AgentOptions):
  Promise<{ role: AgentRole; outcome: Outcome; step: Step; cause: AgentCause | null }> {
  const step = await sandboxed(dir, agentScript(argv, bundle), o);
  const out = outcome(existsSync(o.stdout) ? readFileSync(o.stdout, "utf8") : "");
  return { role, outcome: out, step, cause: agentCause(step, out) };
}
