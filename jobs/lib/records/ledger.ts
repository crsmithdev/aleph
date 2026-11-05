/**
 * The job ledger: one folder per run in ~/.aleph/runs, the repo registry,
 * liveness and locks. See docs/specs/2026-09-24-agent-jobs.md.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, loadavg } from "node:os";
import { basename, join } from "node:path";
import { needsOf, type Ask } from "../asks/ask.ts";
import { layout } from "../infra/layout.ts";
import * as record from "./record.ts";
import { isLive } from "../infra/process.ts";
import { failedCheckOf, causeOf, type Cause, type Fate } from "./outcome.ts";
import { loadLimit, reposFile } from "../infra/settings.ts";
import { contentText, fileSafe, jobId, setCodes, subjectOf } from "../../../lib/naming.ts";

/** A job's state, docs/naming.md. `returned`: a reviewer or a check sent the run back to its worker. A record keeps old words; record.ts reads them as these. */
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
export type Review = { call: "passed" | "returned" | "waiting" | "running" | "failed"; reason?: string };

export interface Run {
  /**
   * `firefighter` is read only: runs from before the firefighter became code (v6) keep it. `triage` and `plan` are read only
   * too: runs from before intake took their work (4 Nov 2026) keep them.
   */
  kind: "build" | "plain" | "land" | "intake" | "triage" | "recheck" | "plan" | "facts" | "firefighter" | "director" | "explain" | "agent" | "monitor";
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
  /** New shape: the goal or issue the run is on, `<repo>-<n>`. */
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
  next?: "worker" | "land";
  /** A factory run: the price of its worker's `result` event, at API rates. */
  cost?: number;
  /** A factory run: the worker's `defaults`, each as `<choice> -> <what it chose>`. */
  defaults?: string[];
  /** A factory run: the titles of the worker's `followups`. */
  followups?: string[];
  /** A factory run: the worker's evidence that the goal is already met, when it says so. */
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
  lander?: "Chris" | "firefighter" | "director";
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

export const OPEN: State[] = ["running", "passed", "waiting", "returned", "failed"];

export function expand(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

export const runsDir = () => layout().ledger;

export function loadRegistry(): Record<string, Repo> {
  const file = expand(reposFile());
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
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

/** The run in `folder`: its entry in its job record (record.ts). */
export function readRun(folder: string): Run | null {
  const r = record.getRun(basename(folder));
  if (!r) return null;
  const { id: _, ...run } = r;
  return run;
}

export function writeRun(folder: string, run: Run): void {
  record.putRun(basename(folder), run);
}

export function updateRun(folder: string, change: Partial<Run>): Run {
  const r = record.patchRun(basename(folder), change);
  if (!r) throw new Error(`no record holds the run ${basename(folder)}`);
  const { id: _, ...run } = r;
  return run;
}

export interface Entry { id: string; folder: string; run: Run }

/** Every run, oldest first: ids start with the time, so they sort. */
export function allRuns(): Entry[] {
  const dir = runsDir();
  return record.allRunRecords().map(({ id, ...run }) => ({ id, folder: join(dir, id), run }));
}

/** Runs grouped by job, each group oldest first, in the order the jobs started. */
export function allJobs(): Entry[][] {
  const jobs = new Map<string, Entry[]>();
  for (const e of allRuns()) {
    const list = jobs.get(e.run.job) ?? [];
    list.push(e);
    jobs.set(e.run.job, list);
  }
  return [...jobs.values()];
}

/** The runs on `subject`, oldest first, each with its number: the stored `n`, else its place in start order (a run from before job IDs). */
function numbered(subject: string, runs: Entry[]): { e: Entry; n: number }[] {
  return runs.filter((e) => subjectOf(e.run) === subject).map((e, i) => ({ e, n: e.run.n ?? i + 1 }));
}

/** The job ID of a run, `a1375#6`. `runs` gives the start order for a run with no stored `n`. */
export function jobIdOf(e: Entry, runs?: Entry[]): string {
  const subject = subjectOf(e.run);
  return jobId(subject, e.run.n ?? numbered(subject, runs ?? allRuns()).find((x) => x.e.id === e.id)?.n ?? 1);
}

/** The `Job:` trailer value of the job `job` (the folder name of its first run): that run's job ID, or `job` when no record holds that run. */
export function trailerOf(job: string): string {
  const runs = allRuns();
  const first = runs.find((e) => e.id === job);
  return first ? jobIdOf(first, runs) : job;
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
  const release = record.lockSync(`start-${subject}`);
  try {
    const runs = allRuns();
    const n = Math.max(0, ...numbered(subject, runs).map((x) => x.n)) + 1;
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
 * A job is open while its latest run is open. A facts run (the reviewer of a
 * landed job) does not count: a landed job stays closed while it runs. A plain
 * run is open only while it is live: a failed build is news, not a job to land or drop.
 */
export function isOpen(runs: Entry[]): boolean {
  const last = runs.findLast((e) => e.run.kind !== "facts");
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

/** The number of the run's `on` (`<repo>-<n>`, for the run's repo). A dotted `on` gives the goal's `<n>.<m>` as a string. */
export function onOf(run: Run): number | string | undefined {
  if (run.on === undefined) return undefined;
  const m = run.on.match(/^(.+)-(\d+(?:\.\d+)?)$/);
  return m && m[1] === run.repo ? (m[2].includes(".") ? m[2] : Number(m[2])) : undefined;
}

/** The run's ask. Undefined when the run asks nothing. */
export const askOf = (run: Run): Ask | undefined => run.ask;

/** The second review of a run from before v6 phase 6: `review` of its state.json, else its folder's call.md. */
export function reviewOf(e: Entry): Review | undefined {
  return e.run.review ?? readCall(e.folder);
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === "EPERM"; }
}

/** How long a lock with no readable owner may stand: only a version before the atomic rename can leave one. */
const OWNERLESS_MS = 60_000;

/** The one way to remove a lock: another process's rename cannot land on a half-removed directory. */
function remove(dir: string): void {
  const gone = `${dir}.gone.${process.pid}.${crypto.randomUUID()}`;
  try { renameSync(dir, gone); } catch { return; }
  rmSync(gone, { recursive: true, force: true });
}

/** True when the lock has no live owner: a dead pid, or no readable pid for longer than OWNERLESS_MS. */
function isStale(dir: string): boolean {
  let text = "";
  try { text = readFileSync(join(dir, "owner"), "utf8"); } catch {}
  if (/^\d+$/.test(text)) return !pidAlive(Number(text));
  try { return Date.now() - statSync(dir).mtimeMs > OWNERLESS_MS; } catch { return false; }
}

/**
 * Remove a stale lock under a guard, so that two waiters who both saw the dead
 * owner cannot remove the live lock one of them then took. The holder of the
 * guard checks again, and only a guard holder removes a lock. A guard left by
 * a crash goes after a short age.
 */
function reclaim(dir: string): void {
  const guard = `${dir}.reclaim`;
  try { mkdirSync(guard); } catch {
    try { if (Date.now() - statSync(guard).mtimeMs > 10_000) rmSync(guard, { recursive: true, force: true }); } catch {}
    return;
  }
  try { if (isStale(dir)) remove(dir); } finally { rmSync(guard, { recursive: true, force: true }); }
}

const lockRoot = () => join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`, "aleph");

/** True when a live process holds the lock `name`. */
export function held(name: string): boolean {
  const dir = join(lockRoot(), name);
  return existsSync(dir) && !isStale(dir);
}

/**
 * A lock is a directory on a tmpfs that a reboot clears, with the holder's pid
 * in `owner`. It comes into being whole, by a rename onto a name that must not
 * exist, so a crash cannot leave one with no owner. It is stale when that
 * process is gone. Waits up to `waitMs`, then gives up.
 */
export async function lock(name: string, waitMs = 20_000): Promise<(() => void) | null> {
  const root = lockRoot();
  mkdirSync(root, { recursive: true });
  const dir = join(root, name);
  const deadline = Date.now() + waitMs;
  const made = `${dir}.new.${process.pid}.${crypto.randomUUID()}`;
  mkdirSync(made);
  writeFileSync(join(made, "owner"), String(process.pid));
  try {
    for (;;) {
      try {
        renameSync(made, dir); // A non-empty directory at `dir` refuses it.
        return () => remove(dir);
      } catch (e: any) {
        if (e.code !== "EEXIST" && e.code !== "ENOTEMPTY") throw e;
      }
      if (isStale(dir)) { reclaim(dir); await Bun.sleep(5); continue; }
      if (Date.now() > deadline) return null;
      await Bun.sleep(50);
    }
  } finally {
    rmSync(made, { recursive: true, force: true });
  }
}

/** `YYYYMMDD-HHMMSS` in local time. */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** The `stamp` one second after the stamp `s`. */
export function nextStamp(s: string): string {
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
  const needs = needsOf(askOf(run));
  const sub = isWaiting(run.condition) ? needs
    : run.condition === "failed" ? causeOf(run) : undefined;
  // A failed check's name is the content. The arrow marks it: `contentText` puts one before a lone file.
  const check = failedCheckOf(run);
  const line = [`${jobIdOf(e)} ${run.condition}`, sub, check && contentText({ file: check })].filter(Boolean).join(" ");
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

/** The last `VERDICT:` line of a review: `land`, `back <reason>` or `chris <question>`; null when it is none of them. */
export function parseVerdict(result: string): Review | null {
  const v = lastTagged(result, "VERDICT");
  if (v === undefined) return null;
  if (v === "land") return { call: "passed" };
  const m = v.match(/^(back|chris)\s+(\S.*)$/);
  return m ? { call: m[1] === "chris" ? "waiting" : "returned", reason: m[2] } : null;
}

/** The file in a run folder where the second review wrote its call. Runs from before v6 phase 6 keep it. */
export const CALL_FILE = "call.md";

/**
 * The review of the run in `folder`, derived from its call.md: a lone
 * `PENDING` line, a last line `ERROR: <reason>`, or the review ending in a
 * `VERDICT:` line. Undefined when there is no call.md.
 */
export const readCall = (folder: string): Review | undefined => readVerdictFile(join(folder, CALL_FILE));

/** The review a verdict file holds, as `Review` shows it, or undefined when the file is not there. */
function readVerdictFile(file: string): Review | undefined {
  let text: string;
  try { text = readFileSync(file, "utf8"); } catch { return undefined; }
  const last = text.trim().split("\n").at(-1)?.trim() ?? "";
  if (last === "PENDING") return { call: "running" };
  if (last.startsWith("ERROR:")) return { call: "failed", reason: last.slice(6).trim() };
  return parseVerdict(text) ?? { call: "failed", reason: "no VERDICT line" };
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
export const TAGS = ["QUESTION", "VERDICT"] as const;
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
