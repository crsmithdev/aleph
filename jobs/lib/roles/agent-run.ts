/**
 * A `claude -p` call for a role that gives one reply, and the run in the ledger that holds it:
 * the folder, the call, the cost, the ending, and the cleanup after a dead process.
 * `ALEPH_<ROLE>_CMD` replaces `claude`, which is how a test gives a fake, and
 * `ALEPH_<ROLE>_TIMEOUT` replaces the role's time box, in seconds.
 */
import { appendFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { allRuns, makeRun, runsDir, type Run } from "../records/ledger.ts";
import { getRun, patchRun, putRun } from "../records/record.ts";
import { lock } from "../infra/locks.ts";
import { roleSeconds } from "../infra/settings.ts";
import { runFile } from "../records/run-files.ts";
import { callAgent, stallReason } from "./agent-call.ts";

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
    const log = runFile(folder, "output.log");
    if (!again) writeFileSync(log, "");
    const r = await callAgent(o.role, sent, {
      model: o.model, flags: resume ? [...o.flags, "--resume", resume] : o.flags, schema: o.schema, cwd: cwd ?? o.cwd,
      stdout: log, stderr: runFile(folder, "stderr.log"), limit: roleSeconds(o.role.toUpperCase(), o.seconds),
    });
    prev = { input: sent, session: r.session };
    if (r.cost !== undefined) { spent = (spent ?? 0) + r.cost; patchRun(basename(folder), { cost: spent }); }
    if (r.cause?.kind === "credit") credit = true;
    const failure = r.step.stalled ? stallReason() : r.step.timedOut ? `${o.who} timed out` : r.step.code !== 0 ? `${o.who} exited ${r.step.code}` : undefined;
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
