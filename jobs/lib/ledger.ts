/**
 * The job ledger: one folder per run in ~/.aleph/jobs, the repo registry,
 * liveness and locks. See docs/specs/2026-09-24-agent-jobs.md.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { availableParallelism, homedir } from "node:os";
import { join } from "node:path";

export type State = "running" | "passed" | "needs-you" | "failed" | "stuck" | "done" | "landed" | "dropped";

/** One check that ran: its name, whether it passed (a timeout does not), and whole seconds. The hidden check adds its test counts. */
export interface CheckResult { name: string; ok: boolean; seconds: number; passed?: number; total?: number; rerun?: boolean }

export interface Run {
  kind: "agent" | "plain" | "land" | "triage" | "recheck" | "plan" | "facts" | "firefighter";
  job: string; name: string; repo?: string; branch?: string; worktree?: string;
  state: State; needs?: "manual" | "question" | "held" | "review"; phase?: string;
  reason?: string; question?: string; say?: string;
  /** The run ended with no commit. A drop replaces `reason`, so this keeps the fact for the dispatch's streak. */
  noCommit?: true;
  session?: string; model?: string; commit?: string;
  /** A land run of a job with a manual check: "open" until `aleph checked` makes it "done". */
  check?: "open" | "done";
  /** The issue that holds an open manual check. */
  checkItem?: number;
  /** The repo's issue the job works on: land marks it done, drop adds a note. */
  todo?: number;
  /** An agent run started with --land: it lands when it passes. */
  land?: boolean;
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
  /** A land of a held run, by Chris: the commit gets `Held-by: Chris`. */
  held?: boolean;
  /** Sidetone's flag: the news line went out. `shown` is the report's. */
  told: boolean; shown?: boolean; started: string; ended?: string;
  /** Milliseconds since the epoch, set under the dispatch lock: the order runs were made in. */
  made?: number;
}

export interface Check { name: string; run: string; when?: string[] }
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
}

export const OPEN: State[] = ["running", "passed", "needs-you", "failed", "stuck"];

export function expand(p: string): string {
  return p === "~" || p.startsWith("~/") ? join(homedir(), p.slice(1)) : p;
}

export const jobsDir = () => expand(process.env.ALEPH_JOBS_DIR ?? "~/.aleph/jobs");

export function loadRegistry(): Record<string, Repo> {
  const file = expand(process.env.ALEPH_REPOS ?? "~/.aleph/repos.json");
  const raw = existsSync(file) ? JSON.parse(readFileSync(file, "utf8")) : {};
  const repos: Record<string, Repo> = {};
  for (const [key, r] of Object.entries<any>(raw)) {
    repos[key] = {
      key, path: expand(r.path), env: r.env ? expand(r.env) : undefined, main: r.main ?? "main",
      setup: r.setup ?? [], checks: r.checks ?? [], manual: r.manual ?? [], note: r.note, autoland: r.autoland ?? true,
      sandbox: r.sandbox ?? false, held: r.held ?? [], hiddenRun: r.hiddenRun ?? "bun test ./.hidden",
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
  const dir = jobsDir();
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
 * A job is open while its latest run is open. A plain run is open only while
 * it is live: a failed build is news, not a job to land or drop.
 */
export function isOpen(runs: Entry[]): boolean {
  const last = runs.at(-1)!;
  if (last.run.kind === "plain") return isLive(last.folder);
  return OPEN.includes(last.run.state);
}

function cmdline(pid: number): string | null {
  try { return readFileSync(`/proc/${pid}/cmdline`, "utf8").replaceAll("\0", " "); } catch { return null; }
}

/** Sidetone's rule (spec 14.10.4): `pid`, no `exit`, and that process names the folder. */
export function isLive(folder: string): boolean {
  if (!existsSync(join(folder, "pid")) || existsSync(join(folder, "exit"))) return false;
  const pid = Number(readFileSync(join(folder, "pid"), "utf8").trim());
  if (!Number.isInteger(pid) || pid <= 0) return false;
  return cmdline(pid)?.includes(folder) ?? false;
}

/** `pid`, no `exit`, and the process is gone: the run died without an end. */
export function isLost(folder: string): boolean {
  return existsSync(join(folder, "pid")) && !existsSync(join(folder, "exit")) && !isLive(folder);
}

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === "EPERM"; }
}

/**
 * A lock is an atomic mkdir on a tmpfs that a reboot clears. It is stale when
 * the process named in `owner` is gone. Waits up to `waitMs`, then gives up.
 */
export async function lock(name: string, waitMs = 20_000): Promise<(() => void) | null> {
  const root = join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`, "aleph");
  mkdirSync(root, { recursive: true });
  const dir = join(root, name);
  const deadline = Date.now() + waitMs;
  for (;;) {
    try {
      mkdirSync(dir);
      writeFileSync(join(dir, "owner"), String(process.pid));
      return () => rmSync(dir, { recursive: true, force: true });
    } catch (e: any) {
      if (e.code !== "EEXIST") throw e;
    }
    let owner = NaN;
    try { owner = Number(readFileSync(join(dir, "owner"), "utf8")); } catch {}
    // An owner file not yet written belongs to a lock taken a moment ago.
    if (Number.isInteger(owner) && !pidAlive(owner)) {
      const stale = `${dir}.stale.${process.pid}`;
      try { renameSync(dir, stale); rmSync(stale, { recursive: true, force: true }); } catch {}
      continue;
    }
    if (Date.now() > deadline) return null;
    await Bun.sleep(50);
  }
}

/** `YYYYMMDD-HHMMSS` in local time. */
export function stamp(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** The one line of news for an ended run. */
export function newsLine(run: Run, note?: string): string {
  if (run.kind === "plain") return `${run.name} ${run.state === "done" ? "finished" : "failed"}`;
  let line = `${run.repo}/${run.name} ${run.state}`;
  if (run.state === "needs-you" && run.needs) line += ` ${run.needs}`;
  // Only a check's reason ends in "failed"; see the state rule in unit.ts.
  const check = run.state === "failed" && run.reason?.match(/^(.+) failed$/);
  if (check) line += ` ${check[1]}`;
  if (run.state === "landed" && run.check === "open") line += "; check open";
  if (run.state === "landed" && run.reason) line += `; ${run.reason}`;
  if (run.state === "landed" && note) line += `; ${note}`;
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

export type Review2 = { verdict: "land" | "back" | "chris" | "pending" | "error"; reason?: string };

/** The last `VERDICT:` line of a review: `land`, `back <reason>` or `chris <question>`; null when it is none of them. */
export function parseVerdict(result: string): Review2 | null {
  const v = result.split("\n").map((l) => l.trim()).filter((l) => l.startsWith("VERDICT:")).map((l) => l.slice(8).trim()).at(-1);
  if (v === undefined) return null;
  if (v === "land") return { verdict: "land" };
  const m = v.match(/^(back|chris)\s+(\S.*)$/);
  return m ? { verdict: m[1] as "back" | "chris", reason: m[2] } : null;
}

/**
 * The review2 of the run in `folder`, derived from its review2.md: a lone
 * `PENDING` line, a last line `ERROR: <reason>`, or the review ending in a
 * `VERDICT:` line. Undefined when there is no review2.md.
 */
export function readReview2(folder: string): Review2 | undefined {
  let text: string;
  try { text = readFileSync(join(folder, "review2.md"), "utf8"); } catch { return undefined; }
  const last = text.trim().split("\n").at(-1)?.trim() ?? "";
  if (last === "PENDING") return { verdict: "pending" };
  if (last.startsWith("ERROR:")) return { verdict: "error", reason: last.slice(6).trim() };
  return parseVerdict(text) ?? { verdict: "error", reason: "no VERDICT line" };
}

/** The reason of a land that found the job lock taken: it did nothing to the job. */
export const LOCK_BUSY = "job lock busy";

/** How many check runs of the test suite may run at once across the factory: ALEPH_CHECK_SLOTS, default 2. */
export const checkSlots = () => Math.max(1, Math.floor(Number(process.env.ALEPH_CHECK_SLOTS)) || 2);

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
