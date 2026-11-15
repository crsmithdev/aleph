/**
 * The job ledger: one row per job in aleph.db (record.ts) and one folder per job in ~/.aleph/jobs, the repo registry,
 * liveness and locks. See docs/data-model.md.
 */
import { existsSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { needsOf, type Ask } from "../asks/ask.ts";
import { layout } from "../../../lib/layout.ts";
import * as record from "./record.ts";
import { lock } from "../infra/locks.ts";
import { isLive } from "../infra/process.ts";
import { jobFolder } from "./run-files.ts";
import { failedCheckOf, causeOf, type Cause, type Fate } from "./outcome.ts";
import { loadLimit } from "../infra/settings.ts";
import { readProjects } from "../../../issues/lib/projects.ts";
import { touch } from "../../../lib/sources.ts";
import { expand } from "../../../lib/paths.ts";
import { parseKey, setCodes, type Role, type State } from "../../../lib/naming.ts";

export type { State };

/** One check that ran: its name, whether it passed (a timeout does not), and whole seconds. A run from before 4 Nov 2026 may have a hidden check with its test counts. */
/** `files`: the number of test files a build or a land ran in place of the full suite. */
/** `tests`: the record of a check that ran `bun test`, from its JUnit report. */
/** `noVerdict`: a clock or a signal ended the check, so it neither passed nor failed. */
export interface CheckResult { name: string; ok: boolean; seconds: number; passed?: number; total?: number; rerun?: boolean; files?: number; tests?: TestRecord; noVerdict?: true }

/** A failed test: its file, its name with its `describe` names (`a > b`), and the first 20 lines of its failure. */
export interface FailedTest { file: string; name: string; message: string }

/** The tests of one check: the counts, and the failed tests, at most 20. `ran` is the tests that passed or failed. */
export interface TestRecord { ran: number; passed: number; failed: number; skipped: number; failures: FailedTest[] }

/**
 * The reviewer's call on the run: `passed`, `returned` (a hold sent back as a fix round), `waiting` (a hold after the
 * last round) or `failed` (no verdict); `running` is an older run's second review in progress. A call the API refused for credit records none. `sessions` (one per reviewer call) and `cost` are the reviewer's own, so its dollars count under `model`, not the run's; `seconds` is the time of the reviewer's calls, in whole seconds; a run from before it has none.
 */
type Review = { call: "passed" | "returned" | "waiting" | "running" | "failed"; reason?: string; model?: string; sessions?: string[]; cost?: number; seconds?: number };

/**
 * A job as code reads it: its row in aleph.db (record.ts) with the long tail of fields from the row's `extra`. `role` is
 * what the job does; `target` the key of its issue, project or idea; `prev` the job before it in its work and `retryOf`
 * the job it redoes. The row holds `pid` and `exit_code` after the end.
 */
export interface Run {
  role: Role;
  /** The first job of its `prev` chain: the work this job belongs to. Derived on read, never written. */
  job: string;
  /** The work's name: the issue key a build is on, or the title of a plain run or a routine. Locks, branches and CLI verbs use it. */
  name: string; repo?: string; branch?: string; worktree?: string;
  state: State; phase?: string;
  reason?: string; question?: string; say?: string;
  /** An intake run (a triage run before it): the route it applied to its issue. `plan` is a triage route only. */
  route?: "build" | "plan" | "close" | "done" | "ask";
  /** Why the run stopped: read it with `causeOf`. A drop replaces `reason` and keeps this. */
  cause?: Cause;
  /** The cause `check`: the check's name. */
  checkName?: string;
  /** What a drop means; `cause` says why the run stopped. Only a drop writes it. */
  fate?: Fate;
  /** A run from before `cause`: a drop set this when the run had ended with no commit. */
  noCommit?: true;
  session?: string; model?: string; commit?: string;
  /** A housekeeper run: counts of what it did by word (`reviewed`, `dropped`, ...), and the issues it changed as keys; `changes` lists each applied action as `{id, do}`; its `done` event carries all three. */
  tally?: Record<string, number>; touched?: string[]; changes?: { id: string; do: string }[];
  /** The size a build was routed to: small, medium or large. */
  size?: string;
  /** A land run of a job with a manual check: "open" until `aleph checked` makes it "done". */
  check?: "open" | "done";
  /** The issue that holds an open manual check. */
  checkItem?: number;
  /** The key of what the job is on: `issue.<n>`, `project.<n>` or `idea.<n>`. */
  target?: string;
  /** The job before this one in its work: a fix round's earlier build, a land's build, a reviewer's build. */
  prev?: string;
  /** The job this one redoes: a build started again after the earlier one was dropped or ended. */
  retryOf?: string;
  /** Who started the job: `human`, `rule`, `gate` or `claude`. */
  by?: string;
  /** What the job waits on: it lives in issue_state (`ask_job` is this job), and the run reads it as its own. */
  ask?: Ask;
  /** The run asked about its issue: when, the question and, for a spec question, the spec's version. Set by `markAsked`. */
  asked?: { at: string; question: string; spec?: string };
  /** The case key of the rescue that took this run (`markRescued`). */
  rescued?: string;
  /** A director run: the decision it made. */
  decision?: unknown;
  /** The reviewer's call on a build run. */
  review?: Review;
  /** An agent run started with --land: it lands when it passes. */
  land?: boolean;
  /** A run that only merges main into the branch after a land conflict: short prompt, short limit. */
  merge?: true;
  /** A land run's conflicted paths, read before the rebase abort. */
  conflicts?: string[];
  /** A factory run stopped by a failing check that goes back to its worker: the check's name. */
  failed?: string;
  /** A factory run after fix rounds: how many fix rounds the job had before it. */
  round?: number;
  /** What the unit started after this run ended: the worker again, or another land. */
  next?: "worker" | "land" | "recheck";
  /** A factory run: the price of its worker's `result` event, at API rates. */
  cost?: number;
  /** A factory run: the worker's `defaults`, each as `<choice> -> <what it chose>`. */
  defaults?: string[];
  /** A factory run: the titles of the worker's `followups`. */
  followups?: string[];
  /** A factory run: the worker's evidence that the issue is already met, when it says so. */
  alreadyMet?: string;
  /** An agent or land run: each check that ran, skipped `when` checks left out. */
  checks?: CheckResult[];
  /** An agent run whose checks passed: origin/<main> as the checks saw it. A land with main still there skips the checks. */
  checkedBase?: string;
  /** The branch tip those checks saw. The skip needs both. */
  checkedTip?: string;
  /** A run that needs Chris for a held path or a test edit: the diff stat. */
  stat?: string;
  /** A land of a held run: the commit gets `Held-by: <lander>`. */
  held?: boolean;
  /** Who landed a held run: absent (a run from before this field) means Chris; `firefighter` is from before the director. */
  lander?: "Chris" | "firefighter" | "director" | "timeout";
  /** Sidetone's flag: the news line went out. `shown` is the report's. */
  told: boolean; shown?: boolean; started: string; ended?: string;
  /** Milliseconds since the epoch when the job was made. */
  made: number;
}

/** `tests`: globs of the test files that `run` takes as arguments, so a land can run only the related ones. */
export interface Check { name: string; run: string; when?: string[]; tests?: string[] }
export interface Repo {
  /** The name of its project, the registry key (`aleph`). `n` is the number in `projects/<n>/`, so the project's key is `project.<n>`. `code` is the short code shown in its IDs (`a` in `a-01430`), docs/naming.md. */
  key: string; n: number; code?: string; description?: string; path: string; env?: string; main: string;
  setup: string[]; checks: Check[]; manual: { when: string[]; say: string }[]; note?: string;
  /** A passed agent run lands by itself. On unless the registry says false. */
  autoland: boolean;
  /** Its agent runs are factory runs: the worker verdict, the checks and the reviewer decide the run. */
  sandbox: boolean;
  /** Globs a factory run may not change without Chris. */
  held: string[];
  /** Intake also takes in an issue filed with a spec, before its first worker run. */
  author?: boolean;
  /** Globs of test files that every land runs, besides the tests its change reaches. */
  critical?: string[];
}

const OPEN: State[] = ["running", "passed", "waiting", "returned", "failed"];

/** The folder that holds a folder for each job. */
export const jobsDir = () => layout().jobs;

/** The repos: the projects of the items repo that have a `path`, by name (`projects/<n>/project.md`). */
export function loadRegistry(): Record<string, Repo> {
  touch("registry");
  const repos: Record<string, Repo> = {};
  for (const { n, name: key, description, fields: r } of readProjects().filter((p) => p.fields.path)) {
    repos[key] = {
      key, n, code: r.code, path: expand(r.path), env: r.env ? expand(r.env) : undefined, main: r.main ?? "main", description: description || undefined,
      setup: r.setup ?? [], checks: r.checks ?? [], manual: r.manual ?? [], note: r.note, autoland: r.autoland ?? true,
      sandbox: r.sandbox ?? false, held: r.held ?? [], author: r.author ?? false, critical: r.critical ?? [],
    };
  }
  const codes = Object.values(repos).filter((r) => r.code).map((r) => [r.key, r.code!] as const);
  const twice = codes.find(([k, c]) => codes.some(([k2, c2]) => c2 === c && k2 !== k));
  const bad = codes.find(([, c]) => !/^[a-z]{1,2}$/.test(c));
  if (bad) throw new Error(`projects: the code of ${bad[0]} is not 1 or 2 lower-case letters`);
  if (twice) throw new Error(`projects: the code "${twice[1]}" is on more than one project`);
  setCodes(Object.fromEntries(codes));
  return repos;
}

/** `KEY=VALUE` lines, as systemd reads an EnvironmentFile. */
export function readEnvFile(file: string | undefined): Record<string, string> {
  if (!file || !existsSync(file)) return {};
  const env: Record<string, string> = {};
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
    if (!m) continue;
    env[m[1]] = m[2].trim().replace(/^(["'])(.*)\1$/, "$2");
  }
  return env;
}

/** A job and its folder: `id` is the job key (`job.6802`), `folder` is `<jobsDir>/<n>`. */
export interface Entry { id: string; folder: string; run: Run }

/** Every job, oldest first by number. */
export function allRuns(): Entry[] {
  return record.allRunRecords().map(({ id, ...run }) => ({ id, folder: jobFolder(id), run }));
}

/** Runs grouped by work (the `prev` chain of each), each group oldest first, in the order the work started. */
export function allJobs(): Entry[][] {
  const jobs = new Map<string, Entry[]>();
  for (const e of allRuns()) {
    const list = jobs.get(e.run.job) ?? [];
    list.push(e);
    jobs.set(e.run.job, list);
  }
  return [...jobs.values()];
}

/** The job with key `id`, or undefined. */
export function runOfJob(id: string, runs = allRuns()): Entry | undefined {
  return runs.find((e) => e.id === id);
}

/**
 * A job is open while its latest run is open. A plain
 * run is open only while it is live: a failed build is news, not a job to land or drop.
 */
export function isOpen(runs: Entry[]): boolean {
  const last = record.counting(runs);
  if (!last) return false;
  if (last.run.role === "plain") return isLive(last.folder);
  return OPEN.includes(last.run.state);
}

/** A run waits for Chris. */
export const isWaiting = (state: State): boolean => state === "waiting";

/** A build run. */
export const isBuild = (role: Run["role"]): boolean => role === "build";

/** A run of the job's agent: a build or a recheck. */
export const isAgentRun = (role: Run["role"]): boolean => role === "build" || role === "recheck";

/** The number of the run's issue, or undefined when its target is not an issue. */
export function onOf(run: Pick<Run, "target">): number | undefined {
  const k = parseKey(run.target);
  return k?.kind === "issue" ? k.n : undefined;
}

/** The key of the run's issue (`issue.1430`), or undefined when its target is not an issue. */
export const issueKeyOf = (run: Pick<Run, "target">): string | undefined => (onOf(run) === undefined ? undefined : run.target);

/** The runs of each issue by its key, in the order given. */
export function runsByIssue(entries: Entry[]): Map<string, Entry[]> {
  const out = new Map<string, Entry[]>();
  for (const e of entries) {
    const own = issueKeyOf(e.run);
    if (own === undefined) continue;
    const l = out.get(own);
    if (l) l.push(e); else out.set(own, [e]);
  }
  return out;
}

/**
 * The one line of news for an ended run: its job ID, its state word, its sub and its content. A waiting run takes its
 * sub from its Ask's needs; a failed run takes its cause. A landed run's reason and the repo note follow on a second
 * line, indented two spaces.
 */
export function newsLine(e: Entry, note?: string): string {
  const run = e.run;
  const needs = needsOf(run.ask);
  const sub = isWaiting(run.state) ? needs
    : run.state === "failed" ? causeOf(run) : undefined;
  // A failed check's name is the content. The arrow marks it.
  const check = failedCheckOf(run);
  const line = [`${e.id} ${run.state}`, sub, check && `→ ${check.split("/").at(-1)}`].filter(Boolean).join(" ");
  const said = run.state === "landed" ? [run.reason, note].filter(Boolean).join(" ") : "";
  return said ? `${line}\n  ${said}` : line;
}

/** POST one line to Sidetone's /tell. True on a 2xx reply. */
export async function tell(line: string): Promise<boolean> {
  const url = process.env.SIDETONE_TELL_URL ?? "https://127.0.0.1:3100/tell";
  // The certificate names the tailnet host, not the loopback, so skip the check there only.
  const loopback = ["127.0.0.1", "localhost", "[::1]"].includes(new URL(url).hostname);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: line }),
      signal: AbortSignal.timeout(10_000),
      tls: loopback ? { rejectUnauthorized: false } : undefined,
    } as RequestInit);
    return res.ok;
  } catch {
    return false;
  }
}

/** The reason of a land that found the job lock taken: it did nothing to the job. */

/** How the admission reads the load and waits: `load` gives the 1-minute load average. Tests give both. */
export interface Admission { load: () => number; pause: (ms: number) => Promise<void> }
export const realAdmission: Admission = { load: () => loadavg()[0], pause: (ms) => Bun.sleep(ms) };

/** How long a start that had to wait keeps the queue, so the load average shows it before the next start reads the load. */
const ADMIT_GAP_MS = 15_000;

/**
 * Wait until the 1-minute load average is under `loadLimit()`. A check, a worker and a land call it before they start.
 * The waiters queue on the lock `admit`, so one reads the load at a time; one that had to wait keeps the lock for
 * ADMIT_GAP_MS after it starts. The wait has no end, fails nothing and counts against no time limit. `say` gets the
 * reason of each wait, for the run's phase.
 */
export async function admit(say: (line: string) => void = () => {}, a: Admission = realAdmission): Promise<void> {
  let release = await lock("admit", 0);
  if (!release) {
    say("waiting: queued behind another start under load");
    release = (await lock("admit", Infinity))!;
  }
  let waited = false;
  for (let load = a.load(); load >= loadLimit(); load = a.load()) {
    say(`waiting: load ${load.toFixed(1)} is at or over ${loadLimit()}`);
    waited = true;
    await a.pause(5000);
  }
  if (!waited) return release();
  const free = release;
  void a.pause(ADMIT_GAP_MS).then(free);
}

/** The systemd-run properties of every factory run unit: the shell, the UI and Claude Code sessions win when the cores are busy. */
export const LOW = ["--property=CPUWeight=20", "--nice=10"];

/** The agent output tags that a parser reads: a line `<TAG>: <value>` in a worker's or reviewer's text. `ERROR:` is not one. */
const TAGS = ["QUESTION", "VERDICT"] as const;
export type Tag = (typeof TAGS)[number];

/** One sentence for prompts that says how a tag line is read. */
export const TAG_FORMAT = "A tag line starts with the tag in capitals and a colon, such as `<TAG>: <value>`; leading spaces, backticks and `*` before the tag and trailing backticks and `*` after the value are ignored, and a lowercase tag is not read.";

const tagValue = (line: string, tag: string): string | undefined => {
  const m = line.match(/^\s*[`*]*([A-Z][A-Z-]*):(.*)$/);
  return m && m[1] === tag ? m[2].replace(/^[`*]+(?=\s)/, "").replace(/[`*\s]+$/, "").trim() : undefined;
};

/** The value of the last line that carries the tag, or undefined when there is none. */
export const lastTagged = (text: string, tag: Tag | string): string | undefined =>
  text.split("\n").map((l) => tagValue(l, tag)).filter((v): v is string => v !== undefined).at(-1);
