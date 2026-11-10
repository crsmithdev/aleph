/**
 * The job record: one JSON file per job, `<records>/<key>.json`, that holds the job's execution state. See
 * docs/data-model.md. This module is the only one that opens a record. `update` writes through a
 * temporary file and a rename under the record's lock, so a reader never sees half a file.
 *
 * The key is the issue the job is on (`<repo>-<n>`, the run's `on`). A run on no issue (a plain run, an old run)
 * keys by its job id. A run folder keeps the logs, `pid` and `exit`; its state is the run's entry in `runs`.
 *
 * It also owns a run's life: its end (`endRun`), the run that counts in a job (`counting`), the job's next step
 * (`next`, `stepOf`) and the run's job ID (`jobIdOf`).
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readJsonOr } from "../infra/json.ts";
import type { Ask } from "../asks/ask.ts";
import type { Entry, Run } from "./ledger.ts";
import { causeOf, policyOf } from "./outcome.ts";
import { fixRounds } from "../infra/settings.ts";
import { logEvent } from "../../../lib/layout.ts";
import { lockSync } from "../infra/locks.ts";
import { once, touch } from "../../../lib/sources.ts";
import { alephPath } from "../../../lib/paths.ts";
import { jobId, subjectOf } from "../../../lib/naming.ts";

/** A run in a record: the run and its id, the name of its run folder. */
export type RunRecord = Run & { id: string };

/** One thing that happened to the job. `kind` names it for code: `hold`, `started`, `streak`, `cap`, `rerun`, `asked`, `rescued`, `director`. */
export interface JobEvent { at: string; kind: string; what: string; run?: string; data?: unknown }

export interface JobRecord {
  /** The key: `<repo>-<n>`, or the job id of a run on no issue. */
  issue: string;
  /** What the job waits on from Chris, or null: the one Ask of the issue and its runs. */
  ask: Ask | null;
  /** The run whose Ask `ask` is, while that run waits for Chris; absent when the Ask is on the issue. */
  askRun?: string;
  /** Every Ask the record held, oldest first: when it was set and, once it is gone, when it was cleared. */
  asks?: { set: string; cleared?: string; reason?: string; recommended?: string }[];
  /** Why the issue waits to start, or null. */
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
  touch("records");
  const e = process.env;
  if (!e.ALEPH_RECORDS_DIR && e.ALEPH_JOBS_DIR) return join(e.ALEPH_JOBS_DIR, ".records");
  return alephPath("ALEPH_RECORDS_DIR", "jobs");
}

/** The archive: finished records older than `ARCHIVE_DAYS` move here, beside the records folder. */
export const archiveDir = (): string => `${recordsDir()}-archive`;
const ARCHIVE_DAYS = 7;

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

const nameOf = (key: string) => `${key.replaceAll("/", "_")}.json`;
const fileOf = (key: string) => join(recordsDir(), nameOf(key));

/** A record with nothing in it yet. */
export const empty = (key: string): JobRecord => ({ issue: key, ask: null, wait: null, rounds: 0, cost: 0, runs: [], events: [] });

/** The record of `key`, or null when there is none. */
export function read(key: string): JobRecord | null {
  return readJsonOr(fileOf(key), null) ?? readJsonOr(join(archiveDir(), nameOf(key)), null);
}

/** The folders of the records: the records folder, and with `live` false the archive too. */
const folders = (live: boolean): string[] => (live ? [recordsDir()] : [recordsDir(), archiveDir()]);

/** Every record, archived ones too; with `live` only the records that are not archived. A UI build pass reads them once (sources.ts). */
export const all = (live = false): JobRecord[] => once(`records:${live}`, ["records"], () => readAll(live));

function readAll(live: boolean): JobRecord[] {
  const out: JobRecord[] = [];
  for (const dir of folders(live)) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir).sort()) {
      if (!f.endsWith(".json")) continue;
      const r = readJsonOr<JobRecord | null>(join(dir, f), null); // null: a file renamed away since the listing
      if (r) out.push(r);
    }
  }
  return out;
}

/** Move each finished record whose newest run started over `ARCHIVE_DAYS` days before `now` into the archive. Returns the keys moved. */
export function archiveOld(now = Date.now()): string[] {
  const cut = new Date(now - ARCHIVE_DAYS * 864e5).toISOString();
  const moved: string[] = [];
  for (const { issue } of all(true)) {
    const release = lockRecord(issue);
    try {
      const r = read(issue);
      if (!r || r.ask || r.wait || !r.runs.length) continue;
      if (r.runs.some((x) => x.condition === "running" || x.condition === "waiting" || x.started >= cut)) continue;
      mkdirSync(archiveDir(), { recursive: true });
      renameSync(fileOf(issue), join(archiveDir(), nameOf(issue)));
      moved.push(issue);
    } finally { release(); }
  }
  return moved;
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

/** Take the record's lock, or another lock of that name (`start-<subject>`). Throws when it stays held. */
export function lockRecord(key: string): () => void {
  const release = lockSync(`record-${key.replaceAll("/", "_")}`);
  if (!release) throw new Error(`record ${key}: lock held by another process`);
  return release;
}

/** Read the record of `key`, apply `fn`, and write it whole, under the record's lock. Returns what was written. */
export function update(key: string, fn: (r: JobRecord) => JobRecord | void): JobRecord {
  const release = lockRecord(key);
  try {
    const draft = read(key) ?? empty(key);
    const had = draft.ask ? `ask ${draft.askRun ?? ""}` : "";
    const was = new Map(draft.runs.map((x) => [x.id, x.condition]));
    const after = derive(fn(draft) ?? draft);
    let asked: Parameters<typeof logEvent>[0][] = [];
    if ((after.ask ? `ask ${after.askRun ?? ""}` : "") !== had) {
      const at = new Date().toISOString(), open = after.asks?.find((a) => !a.cleared);
      if (open) open.cleared = at;
      if (after.ask) (after.asks ??= []).push({ set: at, reason: after.ask.reason, recommended: after.ask.recommended });
      asked = [open && { at, by: "gate", subject: key, action: "answered" }, after.ask && { at, by: "gate", subject: key, action: "question" }]
        .filter((e) => e) as Parameters<typeof logEvent>[0][];
    }
    write(after);
    logChanges(was, after.runs);
    for (const e of asked) logEvent(e);
    return after;
  } finally {
    release();
  }
}

/**
 * One event for each run whose state a write changed, by `gate` on the run's subject: `a1421 running a1421#6`. A bad word must not undo the write it reports, so it only logs.
 */
function logChanges(was: Map<string, string>, runs: RunRecord[]): void {
  for (const x of runs) {
    if (was.get(x.id) === x.condition) continue;
    const sub = x.condition === "running" ? undefined : x.cause ?? x.fate;
    try { logEvent({ by: "gate", subject: subjectOf(x), action: x.condition, sub, on: [jobIdOf({ id: x.id, run: x })], ...(x.condition === "running" ? {} : { cost: x.cost }), ...(x.condition === "landed" ? { commit: x.commit } : {}) }); }
    catch (e) { console.error(`record: no event for ${x.id}: ${(e as Error).message}`); }
  }
}

/** Write a record whole through a temporary file and a rename. Only `update` and the migration call it. */
export function write(r: JobRecord): void {
  mkdirSync(recordsDir(), { recursive: true });
  const file = fileOf(r.issue);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(r, null, 1) + "\n");
  renameSync(tmp, file);
  // A write to an archived record takes it out of the archive: one record for each issue.
  rmSync(join(archiveDir(), nameOf(r.issue)), { force: true });
}

// ---------------------------------------------------------------------------
// Runs: a run is its entry in its record, found by its id, the name of its run folder.

/** Run id to record key, for the runs this process has seen. */
const keys = new Map<string, string>();

/** The record key of run `id`: from this process's map, else from a scan of the records. */
function keyOfId(id: string): string | undefined {
  const known = keys.get(id);
  if (known) return known;
  const needle = JSON.stringify({ id }).slice(1, -1).replace(":", ": ");
  for (const dir of folders(false)) {
    if (!existsSync(dir)) continue;
    for (const f of readdirSync(dir)) {
      if (!f.endsWith(".json")) continue;
      let text: string;
      try { text = readFileSync(join(dir, f), "utf8"); } catch { continue; }
      if (!text.includes(needle)) continue;
      const r: JobRecord = JSON.parse(text);
      if (r.runs.some((x) => x.id === id)) { keys.set(id, r.issue); return r.issue; }
    }
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
    // A build, land or recheck run of the same job that joins after the run that holds the Ask decides it: the Ask comes off.
    const held = r.runs.find((x) => x.id === r.askRun);
    if (i < 0 && held?.job === run.job && ["build", "land", "recheck"].includes(run.kind)) { r.ask = null; delete r.askRun; }
    const rec = takeAsk(r, { ...run, id } as RunRecord);
    if (i >= 0) r.runs[i] = rec; else r.runs.push(rec);
    r.runs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  });
}

/**
 * Change fields of run `id`; a field set to undefined goes. `change` can be a function of the run and the record's
 * runs, called under the record's lock. Returns the run. Throws when no record holds it.
 */
export function patchRun(id: string, change: Partial<Run> | ((run: RunRecord, runs: RunRecord[]) => Partial<Run>)): RunRecord {
  const key = keyOfId(id);
  let out: RunRecord | null = null;
  if (key) update(key, (r) => {
    const i = r.runs.findIndex((x) => x.id === id);
    if (i < 0) return;
    const was = view(r, r.runs[i]);
    const merged: RunRecord = JSON.parse(JSON.stringify({ ...was, ...(typeof change === "function" ? change(was, r.runs) : change) }));
    r.runs[i] = takeAsk(r, merged);
    out = view(r, r.runs[i]);
  });
  if (!out) throw new Error(`no record holds the run ${id}`);
  return out;
}

/**
 * End run `id` in one write: `change` (its condition, `ended` and the rest) and its `next`, which `decide` gives from
 * the ended run and the land runs of its job, this one included. No reader sees the run ended with no `next`, so no
 * reader takes it for a rescue. Returns the run.
 */
export function endRun(id: string, change: Partial<Run>, decide: (run: Run, lands: Run[]) => Run["next"]): RunRecord {
  return patchRun(id, (run, runs) => {
    const ended = { ...run, ...change };
    const lands = runs.filter((x) => x.job === run.job && x.kind === "land").map((x) => (x.id === id ? ended : x));
    return { ...change, next: decide(ended, lands) };
  });
}

/** Take run `id` out of its record. */
export function removeRun(id: string): void {
  const key = keyOfId(id);
  if (key) update(key, (r) => { r.runs = r.runs.filter((x) => x.id !== id); });
  keys.delete(id);
}

/** Every run of every record, oldest first by id. */
export function allRunRecords(live = false, records = all(live)): RunRecord[] {
  const out: RunRecord[] = [];
  for (const r of records) for (const x of r.runs) { keys.set(x.id, r.issue); out.push(view(r, x)); }
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

/** What the job does next: a function of its record only. The fields are the event fields of docs/naming.md. */
export interface Step {
  step: "ask" | "run" | "worker" | "land" | "recheck" | "rescue" | "wait" | "start" | "none";
  /** The job's state word. */
  action: string;
  /** Why the run stopped, from its `cause`. */
  sub?: string;
  /** The running or waiting job, or the landed commit as its first 7 characters. */
  on?: string[];
  /** The fix round of the job: `<rounds> / <fixRounds()>`. */
  count?: string;
  /** `human` for a step that waits for Chris. */
  to?: string;
}

/** The `sub` of a step: why the run stopped, when the run states it. */
const subOf = (run: RunRecord): Pick<Step, "sub"> => { const cause = causeOf(run); return cause ? { sub: cause } : {}; };

/** The runs on `subject` in `runs`, oldest first, each with its number: its `n`, else its place in start order (a run from before job IDs). */
export function numbered<T extends { id: string; run: Run }>(subject: string, runs: T[]): { e: T; n: number }[] {
  return runs.filter((e) => subjectOf(e.run) === subject).map((e, i) => ({ e, n: e.run.n ?? i + 1 }));
}

/** The job ID of a run, `a1375#6`. A run with no `n` takes its number from `runs` (`numbered`), else reads as the first. */
export function jobIdOf(e: { id: string; run: Run }, runs: { id: string; run: Run }[] = []): string {
  const subject = subjectOf(e.run);
  return jobId(subject, e.run.n ?? numbered(subject, runs).find((x) => x.e.id === e.id)?.n ?? 1);
}

/** A run counts unless it is a director run or a land that found the job lock busy: neither changes the job. */
const counts = (run: Run): boolean => run.kind !== "director" && !(run.kind === "land" && run.condition === "failed" && causeOf(run) === "locked");

/**
 * The run that counts in a job: its last run that counts, else its last run. A director run has a job of its own
 * (agent-run.ts `openRun`), so only a director job falls back.
 */
export const counting = (j: Entry[]): Entry => j.findLast((e) => counts(e.run)) ?? j.at(-1)!;

/**
 * The next step of the job. An Ask waits for Chris; a running run waits for its end; an ended run's `next` says
 * whether the worker or a land follows; a passed run with no `next` waits for a land by hand; a returned or failed run
 * goes to the rescue, unless the factory asked Chris about it or its cause is not `rescuable` (`POLICY`): then it
 * waits; a landed, done or dropped job does nothing; an issue
 * with no open run waits for its `wait`, else starts. The run that counts is the newest one that `counts`: a director
 * run changes the step through the Ask and the `director` event it writes, never as the run that counts.
 */
export function next(r: JobRecord): Step {
  if (r.ask) return { step: "ask", action: "waiting", to: "human" };
  const last = r.runs.findLast(counts);
  if (last?.condition === "running") return { step: "run", action: "running", on: [jobIdOf({ id: last.id, run: last })] };
  if (last?.condition === "waiting") return { step: "ask", action: "waiting", on: [jobIdOf({ id: last.id, run: last })], to: "human" };
  if (last?.next === "worker") return { step: "worker", action: "returned", ...subOf(last), count: `${r.rounds} / ${fixRounds()}` };
  if (last?.next === "recheck") return { step: "recheck", action: "returned", ...subOf(last) };
  if (last?.next === "land") return { step: "land", action: last.condition };
  if (last?.condition === "passed") return { step: "wait", action: "passed", to: "human" };
  if (last && (last.condition === "returned" || last.condition === "failed")) {
    if (r.events.some((e) => e.kind === "asked" && e.run === last.id)) return { step: "wait", action: "waiting", to: "human" };
    if (!policyOf(causeOf(last)).rescuable) return { step: "wait", action: last.condition, ...subOf(last) };
    return { step: "rescue", action: last.condition, ...subOf(last) };
  }
  if (last?.condition === "landed") return { step: "none", action: "landed", ...(last.commit ? { on: [last.commit.slice(0, 7)] } : {}) };
  if (last?.condition === "dropped") return { step: "none", action: "dropped" };
  if (last?.condition === "done") return { step: "none", action: "done" };
  if (r.wait) return { step: "wait", action: "waiting" };
  return { step: "start", action: "starting" };
}

/** The job's next step: `next` over the job's runs, with the Ask, wait and events of the record of its run that counts. */
export function stepOf(j: Entry[]): Step {
  const key = keyOf(counting(j).run);
  return next({ ...(read(key) ?? empty(key)), runs: j.map((e) => ({ ...e.run, id: e.id })) });
}
