/**
 * The job record: one JSON file per job, `<records>/<key>.json`, that holds the job's execution state. See
 * docs/specs/2026-11-04-job-record.md. This module is the only one that opens a record. `update` writes through a
 * temporary file and a rename under the record's lock, so a reader never sees half a file.
 *
 * The key is the issue the job is on (`<repo>-<n>`, the run's `on`). A run on no issue (a plain run, an old run)
 * keys by its job id. A run folder keeps the logs, `pid` and `exit`; its state is the run's entry in `runs`.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Ask } from "./ask.ts";
import type { Run } from "./ledger.ts";
import { causeOf } from "./outcome.ts";

/** A run in a record: the run and its id, the name of its run folder. */
export type RunRecord = Run & { id: string };

/** One thing that happened to the job. `kind` names it for code: `hold`, `started`, `streak`, `cap`, `rerun`, `asked`, `rescued`, `director`. */
export interface JobEvent { at: string; kind: string; what: string; run?: string; data?: unknown }

export interface JobRecord {
  /** The key: `<repo>-<n>`, or the job id of a run on no issue. */
  issue: string;
  /** What the job waits on from Chris, or null: the one Ask of the issue and its runs. */
  ask: Ask | null;
  /** The run whose Ask `ask` is, while that run awaits Chris; absent when the Ask is on the issue. */
  askRun?: string;
  /** Every Ask the record held, oldest first: when it was set and, once it is gone, when it was cleared. */
  asks?: { set: string; cleared?: string; reason?: string }[];
  /** Why the goal waits to start, or null. */
  wait: { kind: string; reason: string; since: string } | null;
  /** The fix rounds of the newest job: its build runs that a check or the reviewer sent back. */
  rounds: number;
  /** The sum of the runs' costs, in dollars at API rates. */
  cost: number;
  /** Oldest first. */
  runs: RunRecord[];
  /** Oldest first. */
  events: JobEvent[];
  /**
   * The red GitHub CI on main the issue was filed for (firefighter.ts): its run, its commit and the failure the briefs
   * quote. `landed` is the commit the job landed as: the issue closes when a CI run at or after it is green.
   */
  ci?: { url: string; commit: string; failure: string; landed?: string };
}

/** The folder of the records: `ALEPH_RECORDS_DIR`, else beside a ledger the environment names, else ~/.aleph/jobs. */
export function recordsDir(): string {
  const e = process.env;
  if (e.ALEPH_RECORDS_DIR) return e.ALEPH_RECORDS_DIR;
  if (e.ALEPH_JOBS_DIR) return join(e.ALEPH_JOBS_DIR, ".records");
  return join(e.HOME || homedir(), ".aleph", "jobs");
}

/** The record key of a run: the issue it is on, else its job id. */
export const keyOf = (run: Pick<Run, "on" | "job">): string => run.on ?? run.job;

/** The Ask on the issue: the record's Ask when no run owns it. */
export const issueAsk = (r: JobRecord | null): Ask | null => (r && !r.askRun ? r.ask : null);

/** Put the Ask on the issue `key`, or with null take the issue's Ask off. A run's Ask stays. */
export function setIssueAsk(key: string, ask: Ask | null): void {
  update(key, (r) => {
    if (ask) { r.ask = ask; delete r.askRun; return; }
    if (!r.askRun) r.ask = null;
  });
}

/** A run as readers see it: with the record's Ask when the run owns it. */
const view = (r: JobRecord, x: RunRecord): RunRecord => (r.askRun === x.id && r.ask ? { ...x, ask: r.ask } : x);

/** Keep a run's Ask in the record, not in the run: a run that has `ask` owns the record's Ask; one that drops it gives it up. */
function takeAsk(r: JobRecord, x: RunRecord): RunRecord {
  const { ask, ...run } = x;
  if (ask) { r.ask = ask; r.askRun = x.id; }
  else if (r.askRun === x.id) { r.ask = null; delete r.askRun; }
  return run as RunRecord;
}

const fileOf = (key: string) => join(recordsDir(), `${key.replaceAll("/", "_")}.json`);

/** A record with nothing in it yet. */
export const empty = (key: string): JobRecord => ({ issue: key, ask: null, wait: null, rounds: 0, cost: 0, runs: [], events: [] });

/** The record of `key`, or null when there is none. */
export function read(key: string): JobRecord | null {
  try { return JSON.parse(readFileSync(fileOf(key), "utf8")); } catch { return null; }
}

/** Every record. */
export function all(): JobRecord[] {
  const dir = recordsDir();
  if (!existsSync(dir)) return [];
  const out: JobRecord[] = [];
  for (const f of readdirSync(dir).sort()) {
    if (!f.endsWith(".json")) continue;
    try { out.push(JSON.parse(readFileSync(join(dir, f), "utf8"))); } catch { /* a file mid-rename is not there yet */ }
  }
  return out;
}

/** The fields a write derives from the runs: `cost` and `rounds`. */
function derive(r: JobRecord): JobRecord {
  const job = r.runs.at(-1)?.job;
  return {
    ...r,
    cost: Math.round(r.runs.reduce((s, x) => s + (x.cost ?? 0), 0) * 1e6) / 1e6,
    rounds: r.runs.filter((x) => x.job === job && x.kind === "build" && x.failed).length,
  };
}

const LOCK_WAIT_MS = 20_000;

function pidAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (e: any) { return e.code === "EPERM"; }
}

/** Take the record's lock: a directory with the owner's pid, made whole by a rename. A dead owner's lock goes. */
function lockSync(key: string): () => void {
  const root = join(process.env.XDG_RUNTIME_DIR ?? `/run/user/${process.getuid!()}`, "aleph");
  mkdirSync(root, { recursive: true });
  const dir = join(root, `record-${key.replaceAll("/", "_")}`);
  const made = `${dir}.new.${process.pid}.${crypto.randomUUID()}`;
  mkdirSync(made);
  writeFileSync(join(made, "owner"), String(process.pid));
  const free = () => { const gone = `${dir}.gone.${process.pid}.${crypto.randomUUID()}`; try { renameSync(dir, gone); rmSync(gone, { recursive: true, force: true }); } catch {} };
  const deadline = Date.now() + LOCK_WAIT_MS;
  try {
    for (;;) {
      try { renameSync(made, dir); return free; } catch (e: any) { if (e.code !== "EEXIST" && e.code !== "ENOTEMPTY") throw e; }
      let owner = "";
      try { owner = readFileSync(join(dir, "owner"), "utf8"); } catch {}
      const stale = /^\d+$/.test(owner) ? !pidAlive(Number(owner)) : (() => { try { return Date.now() - statSync(dir).mtimeMs > 60_000; } catch { return false; } })();
      if (stale) { free(); continue; }
      if (Date.now() > deadline) throw new Error(`record ${key}: lock held by ${owner || "an unknown process"}`);
      Bun.sleepSync(5);
    }
  } finally {
    rmSync(made, { recursive: true, force: true });
  }
}

/** Read the record of `key`, apply `fn`, and write it whole, under the record's lock. Returns what was written. */
export function update(key: string, fn: (r: JobRecord) => JobRecord | void): JobRecord {
  const release = lockSync(key);
  try {
    const draft = read(key) ?? empty(key);
    const had = draft.ask ? `ask ${draft.askRun ?? ""}` : "";
    const after = derive(fn(draft) ?? draft);
    if ((after.ask ? `ask ${after.askRun ?? ""}` : "") !== had) {
      const at = new Date().toISOString(), open = after.asks?.find((a) => !a.cleared);
      if (open) open.cleared = at;
      if (after.ask) (after.asks ??= []).push({ set: at, reason: after.ask.reason });
    }
    write(after);
    return after;
  } finally {
    release();
  }
}

/** Write a record whole through a temporary file and a rename. Only `update` and the migration call it. */
export function write(r: JobRecord): void {
  mkdirSync(recordsDir(), { recursive: true });
  const file = fileOf(r.issue);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(r, null, 1) + "\n");
  renameSync(tmp, file);
}

// ---------------------------------------------------------------------------
// Runs. The ledger's run accessors call these.

/** Run id to record key, for the runs this process has seen. */
const keys = new Map<string, string>();

/** The record key of run `id`: from this process's map, else from a scan of the records. */
function keyOfId(id: string): string | undefined {
  const known = keys.get(id);
  if (known) return known;
  const dir = recordsDir();
  if (!existsSync(dir)) return undefined;
  const needle = JSON.stringify({ id }).slice(1, -1).replace(":", ": ");
  for (const f of readdirSync(dir)) {
    if (!f.endsWith(".json")) continue;
    let text: string;
    try { text = readFileSync(join(dir, f), "utf8"); } catch { continue; }
    if (!text.includes(needle)) continue;
    const r: JobRecord = JSON.parse(text);
    if (r.runs.some((x) => x.id === id)) { keys.set(id, r.issue); return r.issue; }
  }
  return undefined;
}

/** Run `id`, or null when no record holds it. */
export function getRun(id: string): RunRecord | null {
  const key = keyOfId(id);
  const r = key ? read(key) : null;
  const x = r?.runs.find((x) => x.id === id);
  return r && x ? view(r, x) : null;
}

/** Write run `id` whole: replace it, or add it at the end. */
export function putRun(id: string, run: Run): void {
  const key = keyOf(run) ?? id;
  // A run whose `on` changed leaves the record it was in.
  const was = keyOfId(id);
  if (was && was !== key) update(was, (r) => { r.runs = r.runs.filter((x) => x.id !== id); });
  keys.set(id, key);
  update(key, (r) => {
    const i = r.runs.findIndex((x) => x.id === id);
    const rec = takeAsk(r, { ...run, id } as RunRecord);
    if (i >= 0) r.runs[i] = rec; else r.runs.push(rec);
    r.runs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  });
}

/** Change fields of run `id`; a field set to undefined goes. Returns the run, or null when no record holds it. */
export function patchRun(id: string, change: Partial<Run>): RunRecord | null {
  const key = keyOfId(id);
  if (!key) return null;
  let out: RunRecord | null = null;
  update(key, (r) => {
    const i = r.runs.findIndex((x) => x.id === id);
    if (i < 0) return;
    const merged: RunRecord = JSON.parse(JSON.stringify({ ...view(r, r.runs[i]), ...change }));
    r.runs[i] = takeAsk(r, merged);
    out = view(r, r.runs[i]);
  });
  return out;
}

/** Take run `id` out of its record. */
export function removeRun(id: string): void {
  const key = keyOfId(id);
  if (key) update(key, (r) => { r.runs = r.runs.filter((x) => x.id !== id); });
  keys.delete(id);
}

/** Every run of every record, oldest first by id. */
export function allRunRecords(): RunRecord[] {
  const out: RunRecord[] = [];
  for (const r of all()) for (const x of r.runs) { keys.set(x.id, r.issue); out.push(view(r, x)); }
  return out.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

// ---------------------------------------------------------------------------
// Events.

/** Add an event to the record of `key`. */
export function addEvent(key: string, e: Omit<JobEvent, "at"> & { at?: string }): JobRecord {
  return update(key, (r) => { r.events.push({ at: e.at ?? new Date().toISOString(), ...e } as JobEvent); });
}

/** The newest event of `kind` in the record of `key`. */
export const lastEvent = (key: string, kind: string): JobEvent | undefined => read(key)?.events.findLast((e) => e.kind === kind);

// ---------------------------------------------------------------------------
// The next step.

/** What the job does next: a function of its record only. */
export type Step =
  | { step: "ask"; why: string }
  | { step: "run"; why: string }
  | { step: "worker"; why: string }
  | { step: "land"; why: string }
  | { step: "rescue"; why: string }
  | { step: "wait"; why: string }
  | { step: "start"; why: string }
  | { step: "none"; why: string };

/**
 * The next step of the job. An Ask waits for Chris; a running run waits for its end; an ended run's `next` says
 * whether the worker or a land follows; a passed run with no `next` waits for a land by hand; a stuck or failed run
 * goes to the rescue, unless the factory asked Chris about it; a landed, done or dropped job does nothing; a goal
 * with no open run waits for its `wait`, else starts. The run that counts is the newest one that is not a facts run
 * and not a land that lost the lock race (job.ts `lastReal`).
 */
export function next(r: JobRecord): Step {
  if (r.ask) return { step: "ask", why: `asks for your ${r.ask.kind}: ${r.ask.reason}` };
  const last = r.runs.findLast((x) => x.kind !== "facts" && !(x.kind === "land" && x.condition === "failed" && causeOf(x) === "lock-busy"));
  if (last?.condition === "running") return { step: "run", why: `${last.kind} run ${last.id} is running` };
  if (last?.condition === "awaiting") return { step: "ask", why: `${last.kind} run ${last.id} awaits Chris` };
  if (last?.next === "worker") return { step: "worker", why: `${last.failed ?? "a check"} sent it back: fix round ${r.rounds}` };
  if (last?.next === "land") return { step: "land", why: last.kind === "land" ? "it lands again" : "it passed" };
  if (last?.condition === "passed") return { step: "wait", why: "it passed and waits for aleph land" };
  if (last && (last.condition === "stuck" || last.condition === "failed")) {
    if (r.events.some((e) => e.kind === "asked" && e.run === last.id)) return { step: "wait", why: `the factory asked Chris about run ${last.id}` };
    return { step: "rescue", why: last.reason ?? `its run is ${last.condition}` };
  }
  if (last?.condition === "landed") return { step: "none", why: `landed${last.commit ? ` as ${last.commit.slice(0, 7)}` : ""}` };
  if (last?.condition === "dropped") return { step: "none", why: `dropped: ${last.reason ?? ""}`.trim().replace(/:$/, "") };
  if (last?.condition === "done") return { step: "none", why: "its run is done" };
  if (r.wait) return { step: "wait", why: r.wait.reason };
  return { step: "start", why: "no run has started it" };
}
