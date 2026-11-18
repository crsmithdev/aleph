/**
 * A `claude -p` call for a role that gives one reply, and the run in the ledger that holds it:
 * the folder, the call, the cost, the ending, and the cleanup after a dead process.
 * `ALEPH_<ROLE>_CMD` replaces `claude`, which is how a test gives a fake, and
 * `ALEPH_<ROLE>_TIMEOUT` replaces the role's time box, in seconds.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { type Run } from "../records/ledger.ts";
import { getRun, makeJob, patchRun, setState, allRuns } from "../records/record.ts";
import { lock, lockSync } from "../../../lib/locks.ts";
import { roleSeconds } from "../infra/settings.ts";
import { logStream, logTo, runFile } from "../records/run-files.ts";
import { callAgent, type Ask, type Reply } from "./agent-call.ts";
import type { AgentRole } from "../../../lib/naming.ts";

interface Call extends Pick<Ask, "cmd" | "fallback" | "slot" | "onSpawn"> {
  /** The role the call is made as, for its command, its time box and its reply cost (agent-call.ts). */
  role: string;
  /** The role's name in a failure: `${who} exited 1`. */
  who: string;
  model: string;
  seconds: number;
  /** The arguments after the model: the role's tools and what they may do. */
  flags: string[];
  cwd?: string;
  /** Variables added to this process's env for the call; an undefined one is removed. */
  env?: Record<string, string | undefined>;
  /** The JSON schema of the reply: the call then gives the reply's `structured_output` as `data`. */
  schema?: object;
}

/** The job a role's run makes. Its target is the issue or idea the run is on; its name is its title. */
export interface Opening extends Call {
  /** A `review` run calls as the `reviewer`. */
  role: AgentRole | "review";
  name: string;
  /** The first line of the `command` section of log.txt. */
  command: string;
  shown: boolean;
  /** false: `aleph jobs --news` tells its ending, as for a reviewer; else the run tells nothing. */
  told?: false;
  /** The run this one follows: a reviewer's build. */
  prev?: string;
  repo?: string;
  /** The key of what the run is on: `issue.<n>`, `project.<n>` or `idea.<n>`. */
  target?: string;
  /** The session the run resumes: the run's session key, so the turns of one conversation share it. Without it the key is the reply's session. */
  session?: string;
  /** Names a lock from the run's key: the run holds it from before it is `running` until `end`, so `endLost` leaves it alone. */
  lock?: (id: string) => string;
}

interface AgentRun {
  /** The job's key. */
  id: string;
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
  /** As `ask`, the whole reply, and it does not throw: the caller reads its `cause`. */
  reply(input: string, cwd?: string): Promise<Reply>;
  /**
   * The run is `done`: a role's run has no land or drop, whatever its reply was; a reviewer with no verdict is
   * `failed`. It then frees the opening's `lock`.
   */
  end(reason: string, fields?: Partial<Run>, state?: "done" | "failed"): void;
}

/** The env of an agent that works in a worktree: it cannot push to github or reach gh; see "No push, no gh" in the spec. */
export function agentEnv(env: Record<string, string | undefined>, folder: string): Record<string, string | undefined> {
  const ghDir = runFile(folder, "gh");
  mkdirSync(ghDir, { recursive: true });
  return {
    ...env, GIT_CONFIG_COUNT: "1", GIT_CONFIG_KEY_0: "url.aleph-no-push:.pushInsteadOf", GIT_CONFIG_VALUE_0: "git@github.com:",
    GH_CONFIG_DIR: ghDir, GH_TOKEN: undefined, GITHUB_TOKEN: undefined, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1",
  };
}

/** Make the run's job and folder. The caller ends the run, on every path. */
export function openRun(o: Opening): AgentRun {
  let release: (() => void) | undefined;
  const { id, folder } = makeJob({
    role: o.role, name: o.name, ...(o.prev !== undefined ? { prev: o.prev } : {}), ...(o.repo !== undefined ? { repo: o.repo } : {}), ...(o.target !== undefined ? { target: o.target } : {}), ...(o.session ? { session: o.session } : {}),
    state: "running", phase: o.role, model: o.model, told: o.told ?? true, shown: o.shown,
  }, (dir, key) => {
    // No other process takes a lock named from a job with no row yet.
    if (o.lock) release = lockSync(o.lock(key), 0)!;
    logTo(dir, "command", o.command);
  });
  let prev: { input: string; session?: string } | undefined;
  let spent: number | undefined;
  let tokens: number | undefined;
  let credit = false;
  const call = async (input: string, cwd?: string, again = false): Promise<Reply> => {
    const write = again ? appendFileSync : writeFileSync;
    const resume = again ? prev?.session : undefined;
    const sent = again && !resume ? `${prev?.input ?? ""}\n\n${input}` : input;
    write(runFile(folder, "prompt.md"), again ? `\n\n---\n\n${sent}` : sent);
    const log = runFile(folder, "transcript.jsonl");
    if (!again) writeFileSync(log, "");
    const r = await callAgent(o.role === "review" ? "reviewer" : o.role, sent, {
      model: o.model, flags: resume ? [...o.flags, "--resume", resume] : o.flags, schema: o.schema, cwd: cwd ?? o.cwd,
      env: o.env && { ...process.env, ANTHROPIC_API_KEY: undefined, CLAUDECODE: undefined, ...o.env },
      stdout: log, stderr: logStream(folder, "stderr"), limit: roleSeconds(o.role.toUpperCase(), o.seconds),
      cmd: o.cmd, fallback: o.fallback, slot: o.slot, onSpawn: o.onSpawn,
    });
    prev = { input: sent, session: r.session };
    if (!o.session && r.session) patchRun(id, { session: r.session });
    if (r.tokens !== undefined) { tokens = (tokens ?? 0) + r.tokens; patchRun(id, { tokens }); }
    if (r.cost !== undefined) { spent = (spent ?? 0) + r.cost; patchRun(id, { cost: spent }); }
    if (o.fallback && r.model === o.fallback) patchRun(id, { model: r.model });
    if (r.cause?.kind === "credit") credit = true;
    return r;
  };
  const checked = async (input: string, cwd?: string, again = false) => {
    const r = await call(input, cwd, again);
    // Exit 0 with no result event is what a test's fake prints: its stdout is the reply.
    if (r.cause && (r.found || r.step.code !== 0)) throw new Error(`${o.who}: ${r.cause.reason}`);
    return r;
  };
  return {
    id,
    folder,
    ask: async (input, cwd) => (await checked(input, cwd)).text,
    askData: async (input, cwd) => (await checked(input, cwd)).data,
    askAgain: async (input, cwd) => (await checked(input, cwd, true)).data,
    reply: (input, cwd) => call(input, cwd),
    end: (reason, fields = {}, state = "done") => { endAgentRun(id, reason, credit ? { ...fields, cause: "credit" } : fields, state); release?.(); },
  };
}

function endAgentRun(id: string, reason: string, fields: Partial<Omit<Run, "state">> = {}, state: "done" | "failed" = "done"): void {
  setState(id, state, { reason, ...fields, phase: undefined });
}

/**
 * End the role's runs that a dead process left `running`. A live run's process holds a lock for the
 * whole run, and `lockOf` names it, or gives null for a run to leave alone. When no wait gets the
 * lock, no process is running that run. A run whose lock is held stays as it is.
 */
export async function endLost(role: Opening["role"], lockOf: (run: Run) => string | null, before = "a reply"): Promise<void> {
  for (const { id, run } of allRuns()) {
    if (run.role !== role || run.state !== "running") continue;
    const name = lockOf(run);
    const release = name && await lock(name, 0);
    if (!release) continue;
    try {
      // Read again under the lock: the run may have ended since the list was read.
      if (getRun(id)?.state === "running") endAgentRun(id, `failed: its process ended before ${before}`, { cause: "unanswered" });
    } finally {
      release();
    }
  }
}
