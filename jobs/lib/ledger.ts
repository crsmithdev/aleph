/**
 * The job ledger: one folder per run in ~/.aleph/runs, the repo registry,
 * liveness and locks. See docs/specs/2026-09-24-agent-jobs.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";
import { needsOf, type Ask } from "./ask.ts";
import { layout } from "./layout.ts";
import { isLive } from "./process.ts";
import { failedCheckOf, type Cause, type Fate } from "./outcome.ts";
import { checkSlots, reposFile } from "./settings.ts";

export type State = "running" | "passed" | "awaiting" | "failed" | "stuck" | "done" | "landed" | "dropped";

/** One check that ran: its name, whether it passed (a timeout does not), and whole seconds. The hidden check adds its test counts. */
/** `files`: the number of test files a build ran in place of the full suite. */
export interface CheckResult { name: string; ok: boolean; seconds: number; passed?: number; total?: number; rerun?: boolean; files?: number }

/** A review's call: what the reviewer decided, or `pending` while it runs and `error` when it ended without one. A `chris` VERDICT line reads as `ask`. */
export type Review = { call: "land" | "back" | "ask" | "pending" | "error"; reason?: string };

export interface Run {
  kind: "build" | "plain" | "land" | "triage" | "recheck" | "plan" | "facts" | "firefighter" | "explain" | "agent";
  job: string; name: string; repo?: string; branch?: string; worktree?: string;
  condition: State; phase?: string;
  reason?: string; question?: string; say?: string;
  /** A triage run: the route it applied to its issue. */
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
  /** A land run of a job with a manual check: "open" until `aleph checked` makes it "done". */
  check?: "open" | "done";
  /** The issue that holds an open manual check. */
  checkItem?: number;
  /** A land run the facts gate has looked at: dispatch does not read its job again. */
  facts?: true;
  /** New shape: the goal or issue the run is on, `<repo>-<n>`. */
  on?: string;
  /** New shape: what the run waits on. */
  ask?: Ask;
  /** New shape: the run's review. */
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
  /** A facts run: the titles of the notes it wrote. */
  kept?: string[];
  /** A facts run: the facts it rejected, each with its reason. */
  rejected?: { fact: string; reason: string }[];
  /** A factory run: the `DEFAULT: <question> -> <answer>` lines of its result. */
  defaults?: string[];
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
  /** Who landed a held run: absent (a run from before this field) means Chris. */
  lander?: "Chris" | "firefighter";
  /** Sidetone's flag: the news line went out. `shown` is the report's. */
  told: boolean; shown?: boolean; started: string; ended?: string;
  /** Milliseconds since the epoch, set under the dispatch lock: the order runs were made in. */
  made?: number;
}

/** `tests`: globs of the test files that `run` takes as arguments, so a land can run only the related ones. */
export interface Check { name: string; run: string; when?: string[]; tests?: string[] }
export interface Repo {
  key: string; path: string; env?: string; main: string;
  setup: string[]; checks: Check[]; manual: { when: string[]; say: string }[]; note?: string;
  /** A passed agent run lands by itself. On unless the registry says false. */
  autoland: boolean;
  /** Its agent runs are factory runs: the worker and the checks run under srt. */
  sandbox: boolean;
  /** Globs a factory run may not change without Chris. */
  held: string[];
  /** The command of the hidden check, run on `.hidden/` in the check clone. */
  hiddenRun: string;
  /** A fresh author writes each goal's hidden checks before its first worker run. */
  author?: boolean;
}

export const OPEN: State[] = ["running", "passed", "awaiting", "failed", "stuck"];

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
      key, path: expand(r.path), env: r.env ? expand(r.env) : undefined, main: r.main ?? "main",
      setup: r.setup ?? [], checks: r.checks ?? [], manual: r.manual ?? [], note: r.note, autoland: r.autoland ?? true,
      sandbox: r.sandbox ?? false, held: r.held ?? [], hiddenRun: r.hiddenRun ?? "bun test ./.hidden", author: r.author ?? false,
    };
  }
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

export function readRun(folder: string): Run | null {
  try { return JSON.parse(readFileSync(join(folder, "state.json"), "utf8")); } catch { return null; }
}

export function writeRun(folder: string, run: Run): void {
  const tmp = join(folder, `.state.json.${process.pid}`);
  writeFileSync(tmp, JSON.stringify(run, null, 2) + "\n");
  renameSync(tmp, join(folder, "state.json"));
}

export function updateRun(folder: string, change: Partial<Run>): Run {
  const run = { ...readRun(folder)!, ...change };
  writeRun(folder, run);
  return run;
}

export interface Entry { id: string; folder: string; run: Run }

/** Every run, oldest first. Folder names start with the time, so they sort. */
export function allRuns(): Entry[] {
  const dir = runsDir();
  if (!existsSync(dir)) return [];
  const out: Entry[] = [];
  for (const id of readdirSync(dir).sort()) {
    const run = readRun(join(dir, id));
    if (run) out.push({ id, folder: join(dir, id), run });
  }
  return out;
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
export const isAwaiting = (state: State): boolean => state === "awaiting";

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

/** The run's review: `review` of its state.json, else its folder's call.md. */
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

/**
 * A lock is a directory on a tmpfs that a reboot clears, with the holder's pid
 * in `owner`. It comes into being whole, by a rename onto a name that must not
 * exist, so a crash cannot leave one with no owner. It is stale when that
 * process is gone. Waits up to `waitMs`, then gives up.
 */
export async function lock(name: string, waitMs = 20_000): Promise<(() => void) | null> {
  const root = join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`, "aleph");
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

/** The one line of news for an ended run. */
export function newsLine(run: Run, note?: string): string {
  if (run.kind === "plain") return `${run.name} ${run.condition === "done" ? "finished" : "failed"}`;
  let line = `${run.repo}/${run.name} ${run.condition}`;
  const needs = needsOf(askOf(run));
  if (isAwaiting(run.condition) && needs) line += ` ${needs}`;
  const check = run.condition === "failed" && failedCheckOf(run);
  if (check) line += ` ${check}`;
  if (run.condition === "landed" && run.check === "open") line += "; check open";
  if (run.condition === "landed" && run.reason) line += `; ${run.reason}`;
  if (run.condition === "landed" && note) line += `; ${note}`;
  if (run.next === "worker") line += "; sent back to the worker";
  if (run.next === "land") line += run.kind === "land" ? "; landing again" : "; landing";
  return line;
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
  if (v === "land") return { call: "land" };
  const m = v.match(/^(back|chris)\s+(\S.*)$/);
  return m ? { call: m[1] === "chris" ? "ask" : "back", reason: m[2] } : null;
}

/** The file in a run folder where the reviewer writes: the run's call. */
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
  if (last === "PENDING") return { call: "pending" };
  if (last.startsWith("ERROR:")) return { call: "error", reason: last.slice(6).trim() };
  return parseVerdict(text) ?? { call: "error", reason: "no VERDICT line" };
}

/** The reason of a land that found the job lock taken: it did nothing to the job. */

/** How many check runs of the test suite may run at once across the factory: ALEPH_CHECK_SLOTS, default 2. */

/** Each suite run's share of the cores: cores / slots, at least 1. */
export const testParallel = () => Math.max(1, Math.floor(availableParallelism() / checkSlots()));

/**
 * Wait for a free check slot (a lock `check-slot-<n>`) and take it. The wait
 * has no end: the caller starts its time limit after this returns.
 */
export async function checkSlot(): Promise<() => void> {
  for (;;) {
    for (let n = 0; n < checkSlots(); n++) {
      const release = await lock(`check-slot-${n}`, 0);
      if (release) return release;
    }
    await Bun.sleep(100);
  }
}

/** The systemd-run properties of every factory run unit: the shell, the UI and Claude Code sessions win when the cores are busy. */
export const LOW = ["--property=CPUWeight=20", "--nice=10"];

/** The agent output tags: a line `<TAG>: <value>` in a worker's or reviewer's text. `ERROR:` is not one. */
export const TAGS = ["FOLLOWUP", "DEFAULT", "QUESTION", "FACT", "FLAKE", "SET-ASIDE", "CHECK", "VERDICT"] as const;
export type Tag = (typeof TAGS)[number];

/** One sentence for prompts that says how a tag line is read. */
export const TAG_FORMAT = "A tag line starts with the tag in capitals and a colon, such as `FACT: <sentence>`; leading spaces, backticks and `*` before the tag and trailing backticks and `*` after the value are ignored, and a lowercase tag is not read.";

const tagValue = (line: string, tag: string): string | undefined => {
  const m = line.match(/^\s*[`*]*([A-Z][A-Z-]*):(.*)$/);
  return m && m[1] === tag ? m[2].replace(/^[`*]+(?=\s)/, "").replace(/[`*\s]+$/, "").trim() : undefined;
};

/** The value of every line of the text that carries the tag; lines with an empty value are dropped. */
export const tagged = (text: string, tag: Tag | string): string[] =>
  text.split("\n").map((l) => tagValue(l, tag)).filter((v): v is string => !!v);

/** The value of the last line that carries the tag, or undefined when there is none. */
export const lastTagged = (text: string, tag: Tag | string): string | undefined =>
  text.split("\n").map((l) => tagValue(l, tag)).filter((v): v is string => v !== undefined).at(-1);
