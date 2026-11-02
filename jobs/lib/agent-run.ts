/**
 * A `claude -p` call for a role that gives one reply, and the run in the ledger that holds it:
 * the folder, the spawn, the time box, the cost, the ending, and the cleanup after a dead process.
 * `ALEPH_<ROLE>_CMD` replaces `claude`, which is how a test gives a fake, and
 * `ALEPH_<ROLE>_TIMEOUT` replaces the role's time box, in seconds.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { replyOf } from "./gate.ts";
import { allRuns, lock, readRun, runsDir, stamp, updateRun, writeRun, type Run } from "./ledger.ts";

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
  const argv = [process.env[`ALEPH_${role}_CMD`] ?? "claude", "-p", "--output-format", "stream-json", "--verbose", "--model", c.model, ...c.flags];
  const p = Bun.spawn(argv, { cwd: c.cwd, env: { ...process.env, ANTHROPIC_API_KEY: undefined, CLAUDECODE: undefined }, stdin: new Blob([input]), stdout: "pipe", stderr: "pipe" });
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; p.kill(); }, Number(process.env[`ALEPH_${role}_TIMEOUT`] ?? c.seconds) * 1000);
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
  role: "triage" | "plan" | "facts" | "firefighter" | "explain";
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
  /** The reply's text. It writes prompt.md and output.log and records the cost, and then throws on a time-out or a non-zero exit. */
  ask(input: string): Promise<string>;
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
  writeFileSync(join(folder, "command.txt"), `${o.command}\n`);
  return {
    folder,
    async ask(input) {
      writeFileSync(join(folder, "prompt.md"), input);
      const r = await spawn(o, input);
      writeFileSync(join(folder, "output.log"), r.output);
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
