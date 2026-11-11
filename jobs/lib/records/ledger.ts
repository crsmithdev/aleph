/**
 * The job ledger: one folder per run in ~/.aleph/runs, the repo registry,
 * liveness and locks. See docs/data-model.md.
 */
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { loadavg } from "node:os";
import { join } from "node:path";
import { readJsonOr } from "../../../lib/json.ts";
import { needsOf, type Ask } from "../asks/ask.ts";
import { layout } from "../../../lib/layout.ts";
import * as record from "./record.ts";
import { lock } from "../infra/locks.ts";
import { isLive } from "../infra/process.ts";
import { failedCheckOf, causeOf, type Cause, type Fate } from "./outcome.ts";
import { loadLimit, reposFile } from "../infra/settings.ts";
import { touch } from "../../../lib/sources.ts";
import { expand } from "../../../lib/paths.ts";
import { contentText, fileSafe, parseId, parseJob, setCodes, subjectOf, tail } from "../../../lib/naming.ts";

/** A job's state, docs/naming.md. `returned`: a reviewer or a check sent the run back to its worker. */
export type State = "running" | "waiting" | "passed" | "returned" | "failed" | "landed" | "dropped" | "done";

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
 * The second review's call: what it decided, or `running` while it ran and `failed` when it ended without one. A `chris`
 * VERDICT line reads as `waiting`. The second review went in v6 phase 6 (3 Nov 2026); only runs from before it have one.
 */
type Review = { call: "passed" | "returned" | "waiting" | "running" | "failed"; reason?: string; model?: string };

export interface Run {
  kind: "build" | "plain" | "land" | "intake" | "recheck" | "director" | "monitor" | "chat" | "lens";
  job: string; name: string; repo?: string; branch?: string; worktree?: string;
  condition: State; phase?: string;
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
  /** The worker tier (haiku or sonnet) of a run whose model the local backend replaced. */
  tier?: string;
  /** A land run of a job with a manual check: "open" until `aleph checked` makes it "done". */
  check?: "open" | "done";
  /** The issue that holds an open manual check. */
  checkItem?: number;
  /** New shape: the issue or part the run is on, `<repo>-<n>`. */
  on?: string;
  /** New shape: what the run waits on. */
  ask?: Ask;
  /** A run from before v6 phase 6: its second review's call. */
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
  /** Milliseconds since the epoch, set under the dispatch lock: the order runs were made in. */
  made?: number;
  /** The run's number on its subject (`subjectOf`), from 1 in start order: the `n` of its job ID. A run from before job IDs has none. */
  n?: number;
}

/** `tests`: globs of the test files that `run` takes as arguments, so a land can run only the related ones. */
export interface Check { name: string; run: string; when?: string[]; tests?: string[] }
export interface Repo {
  /** The short code of its IDs (`a` in `a1430`), docs/naming.md. */
  key: string; code?: string; path: string; env?: string; main: string;
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

export const runsDir = () => layout().ledger;

export function loadRegistry(): Record<string, Repo> {
  touch("registry");
  const file = reposFile();
  const raw = readJsonOr(file, {});
  const repos: Record<string, Repo> = {};
  for (const [key, r] of Object.entries<any>(raw)) {
    repos[key] = {
      key, code: r.code, path: expand(r.path), env: r.env ? expand(r.env) : undefined, main: r.main ?? "main",
      setup: r.setup ?? [], checks: r.checks ?? [], manual: r.manual ?? [], note: r.note, autoland: r.autoland ?? true,
      sandbox: r.sandbox ?? false, held: r.held ?? [], author: r.author ?? false, critical: r.critical ?? [],
    };
  }
  const codes = Object.values(repos).filter((r) => r.code).map((r) => [r.key, r.code!] as const);
  const twice = codes.find(([k, c]) => codes.some(([k2, c2]) => c2 === c && k2 !== k));
  const bad = codes.find(([, c]) => !/^[a-z]{1,2}$/.test(c));
  if (bad) throw new Error(`repos.json: the code of ${bad[0]} is not 1 or 2 lower-case letters`);
  if (twice) throw new Error(`repos.json: the code "${twice[1]}" is on more than one repo`);
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

export interface Entry { id: string; folder: string; run: Run }

/** Every run, oldest first: ids start with the time, so they sort. */
export function allRuns(live = false, records = record.all(live)): Entry[] {
  const dir = runsDir();
  return record.allRunRecords(live, records).map(({ id, ...run }) => ({ id, folder: join(dir, id), run }));
}

/** Runs grouped by job, each group oldest first, in the order the jobs started. With `live`, only the records that are not archived. */
export function allJobs(live = false): Entry[][] {
  const jobs = new Map<string, Entry[]>();
  for (const e of allRuns(live)) {
    const list = jobs.get(e.run.job) ?? [];
    list.push(e);
    jobs.set(e.run.job, list);
  }
  return [...jobs.values()];
}

/** The run whose job ID is `id` (`a1375#6`, `monitor#14`), or undefined. A short ID needs the registry's codes: `loadRegistry` sets them. */
export function runOfJob(id: string, runs = allRuns()): Entry | undefined {
  // A run with no issue and no routine has its name as its subject: `x#1`.
  const m = /^(.+)#(\d+)$/.exec(id), p = parseJob(id) ?? (m ? { subject: m[1], n: Number(m[2]) } : null);
  return p ? record.numbered(p.subject, runs).find((x) => x.n === p.n)?.e : undefined;
}

/** The `Job:` trailer value of the job `job` (the folder name of its first run): that run's job ID, or `job` when no record holds that run. */
export function trailerOf(job: string): string {
  const runs = allRuns();
  const first = runs.find((e) => e.id === job);
  return first ? record.jobIdOf(first, runs) : job;
}

/**
 * Make the folder of a new run, `<stamp>-<subject>-<n>`, and write the run with `fill`, under the subject's lock: `n`
 * is one more than the highest number on the subject, so two starts never share it. Runs sort by folder name, so the
 * stamp comes after the stamp of each earlier run on the subject or in the job `run.job`: a follow-up started in its
 * land's second, or a run started after the wall clock steps back (WSL2 does, by about a second), would sort before it.
 */
export function makeRun(run: Pick<Run, "on" | "kind" | "name"> & { job?: string }, fill: (folder: string, n: number) => void): string {
  const subject = subjectOf(run);
  mkdirSync(runsDir(), { recursive: true });
  const release = record.lockRecord(`start-${subject}`);
  try {
    const runs = allRuns();
    const n = Math.max(0, ...record.numbered(subject, runs).map((x) => x.n)) + 1;
    const now = stamp();
    const last = runs.filter((e) => subjectOf(e.run) === subject || (run.job !== undefined && e.run.job === run.job)).map((e) => e.id.slice(0, 15)).sort().at(-1);
    const id = `${last && last >= now ? nextStamp(last) : now}-${fileSafe(`${subject}#${n}`)}`;
    mkdirSync(join(runsDir(), id));
    fill(join(runsDir(), id), n);
    return id;
  } finally {
    release();
  }
}

/**
 * A job is open while its latest run is open. A plain
 * run is open only while it is live: a failed build is news, not a job to land or drop.
 */
export function isOpen(runs: Entry[]): boolean {
  const last = record.counting(runs);
  if (!last) return false;
  if (last.run.kind === "plain") return isLive(last.folder);
  return OPEN.includes(last.run.condition);
}

/** A run waits for Chris. */
export const isWaiting = (state: State): boolean => state === "waiting";

/** A build run. */
export const isBuild = (kind: Run["kind"]): boolean => kind === "build";

/** A run of the job's agent: a build or a recheck. */
export const isAgentRun = (kind: Run["kind"]): boolean => kind === "build" || kind === "recheck";

/** The number of the run's `on` (`<repo>-<n>`, for the run's repo). A dotted `on` gives the issue's `<n>.<m>` as a string. */
export function onOf(run: Run): number | string | undefined {
  if (run.on === undefined) return undefined;
  const p = parseId(run.on);
  return p && p.repo === run.repo ? (p.sub === undefined ? p.n : tail(p)) : undefined;
}

/** The full ID of the run's issue (`aleph-1430`, `aleph-1359.1`); with `parent`, an old part's parent (`aleph-1359`). Undefined when `on` names no issue of the run's repo. */
export function issueKeyOf(run: Run, { parent = false } = {}): string | undefined {
  const p = run.on === undefined ? null : parseId(run.on);
  return p && p.repo === run.repo ? `${p.repo}-${parent ? p.n : tail(p)}` : undefined;
}

/** The runs of each issue by its full ID, in the order given. With `rollUp`, an old part's runs also count for its parent. */
export function runsByIssue(entries: Entry[], { rollUp = false } = {}): Map<string, Entry[]> {
  const out = new Map<string, Entry[]>();
  const add = (k: string, e: Entry) => { const l = out.get(k); if (l) l.push(e); else out.set(k, [e]); };
  for (const e of entries) {
    const own = issueKeyOf(e.run), up = issueKeyOf(e.run, { parent: true })!;
    if (own === undefined) continue;
    add(own, e);
    if (rollUp && up !== own) add(up, e);
  }
  return out;
}

/** `YYYYMMDD-HHMMSS` in local time. */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** The `stamp` one second after the stamp `s`. */
function nextStamp(s: string): string {
  const [y, mo, d, h, mi, se] = s.match(/^(\d{4})(\d\d)(\d\d)-(\d\d)(\d\d)(\d\d)$/)!.slice(1).map(Number);
  return stamp(new Date(y, mo - 1, d, h, mi, se + 1));
}

/**
 * The one line of news for an ended run: its job ID, its state word, its sub and its content. A waiting run takes its
 * sub from its Ask's needs; a failed run takes its cause. A landed run's reason and the repo note follow on a second
 * line, indented two spaces.
 */
export function newsLine(e: Entry, note?: string): string {
  const run = e.run;
  const needs = needsOf(run.ask);
  const sub = isWaiting(run.condition) ? needs
    : run.condition === "failed" ? causeOf(run) : undefined;
  // A failed check's name is the content. The arrow marks it: `contentText` puts one before a lone file.
  const check = failedCheckOf(run);
  const line = [`${record.jobIdOf(e)} ${run.condition}`, sub, check && contentText({ file: check })].filter(Boolean).join(" ");
  const said = run.condition === "landed" ? [run.reason, note].filter(Boolean).join(" ") : "";
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
const realAdmission: Admission = { load: () => loadavg()[0], pause: (ms) => Bun.sleep(ms) };

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
