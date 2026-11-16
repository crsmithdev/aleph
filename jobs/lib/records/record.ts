/**
 * The jobs: one row in the `jobs` table of aleph.db for each execution (docs/naming.md, docs/data-model.md). This module
 * is the only one that reads or writes a row. `makeJob` is the one creator; `setState` and `endRun` are the two writers of a
 * job's state, and each logs the state as an event in the same transaction as the write (`endRun` writes the state, the end and `next` together). The columns hold what every job has; the rest of a run's
 * fields are the row's `extra`, a JSON object. The folder of a job, `<jobs>/<n>/`, holds its files (run-files.ts).
 *
 * What the issue and its jobs share lives in `issue_state` (one row while an Ask or a CI result is live): the Ask
 * of the issue and of the run that waits, and `ci`. A job's work is its `prev` chain: `Run.job` is the first
 * job of the chain, derived on read. `rounds` and `cost` are queries over the jobs of one target.
 *
 * It also owns a run's life: its end (`endRun`), the run that counts in a work (`counting`) and the work's next step (`next`, `stepOf`).
 */
import { mkdirSync } from "node:fs";
import type { Database } from "bun:sqlite";
import type { Ask } from "../asks/ask.ts";
import type { Entry, Run } from "./ledger.ts";
import { causeOf, policyOf } from "./outcome.ts";
import { fixRounds } from "../infra/settings.ts";
import { conn, next as nextNumber, tx } from "../../../lib/db.ts";
import { logEvent } from "../../../lib/layout.ts";
import { readEnd } from "../infra/process.ts";
import { once } from "../../../lib/sources.ts";
import { because, type State } from "../../../lib/naming.ts";
import { jobFolder } from "./run-files.ts";

/** A run with its job key. */
export type RunRecord = Run & { id: string };

/** The columns of a row, as the table gives them. */
export interface Row {
  id: string; role: string; by: string; state: string; project: string | null; made: number; started: string; ended: string | null;
  model: string | null; size: string | null; cost: number | null; commit_sha: string | null; pid: number | null; exit_code: number | null;
  target: string | null; prev: string | null; retry_of: string | null; extra: string | null;
}

/** What a run changes: any field but its state, which only `setState` and `endRun` write. */
type Change = Partial<Omit<Run, "state" | "job">>;

// The fields of a run that are columns; every other field of a run is in `extra`. The project column holds the run's repo key.
const COLUMNS = new Set(["id", "role", "state", "started", "ended", "model", "size", "cost", "commit", "target", "prev", "retryOf", "repo", "made", "by", "job", "ask"]);

const projectOf = (repo: string | undefined): string | null => repo ?? null;
const repoOf = (project: string | null): string | undefined => project ?? undefined;

/** The rows' order: the job number, so job.10 comes after job.9. */
const ORDER = "ORDER BY CAST(substr(id, 5) AS INTEGER)";

// Reading.

/** The first job of the `prev` chain of each row of `rows` (which are in number order, a job after its `prev`). */
function rootsOf(rows: Row[]): Map<string, string> {
  const roots = new Map<string, string>();
  for (const r of rows) roots.set(r.id, (r.prev && roots.get(r.prev)) || r.id);
  return roots;
}

function fromRow(r: Row, root: string, ask: Ask | undefined): RunRecord {
  const run: Record<string, unknown> = { ...JSON.parse(r.extra ?? "{}"), id: r.id, job: root, role: r.role, by: r.by, state: r.state, made: r.made, started: r.started };
  const col = { ended: r.ended, model: r.model, size: r.size, cost: r.cost, commit: r.commit_sha, target: r.target, prev: r.prev, retryOf: r.retry_of, repo: repoOf(r.project) };
  for (const [k, v] of Object.entries(col)) if (v !== null && v !== undefined) run[k] = v;
  if (ask) run.ask = ask;
  return run as unknown as RunRecord;
}

function toRow(id: string, run: Partial<Run>): Omit<Row, "pid" | "exit_code" | "was"> {
  const extra = Object.fromEntries(Object.entries(run).filter(([k, v]) => !COLUMNS.has(k) && v !== undefined));
  return {
    id, role: run.role!, by: run.by ?? "rule", state: run.state!, project: projectOf(run.repo), made: run.made!, started: run.started!, ended: run.ended ?? null,
    model: run.model ?? null, size: run.size ?? null, cost: run.cost ?? null, commit_sha: run.commit ?? null, target: run.target ?? null, prev: run.prev ?? null,
    retry_of: run.retryOf ?? null, extra: Object.keys(extra).length ? JSON.stringify(extra) : null,
  };
}

/** The Ask of each run that owns one, by run key. */
const runAsks = (d: Database): Map<string, Ask> =>
  new Map((d.query("SELECT ask_job, ask FROM issue_state WHERE ask_job IS NOT NULL AND ask IS NOT NULL").all() as { ask_job: string; ask: string }[]).map((r) => [r.ask_job, JSON.parse(r.ask)]));

/** Every job, oldest first. A UI build pass reads them once (sources.ts). */
export const allRunRecords = (): RunRecord[] => once("jobs", ["events", "records"], () => {
  const d = conn(), rows = d.query(`SELECT * FROM jobs ${ORDER}`).all() as Row[], roots = rootsOf(rows), asks = runAsks(d);
  return rows.map((r) => fromRow(r, roots.get(r.id)!, asks.get(r.id)));
});

const rowOf = (d: Database, id: string): Row | null => d.query("SELECT * FROM jobs WHERE id = ?").get(id) as Row | null;

/** The first job of the chain that holds `id`: follow `prev` up. */
function rootOf(d: Database, id: string): string {
  let at = id;
  for (let r = rowOf(d, at); r?.prev; r = rowOf(d, at)) at = r.prev;
  return at;
}

/** Job `id`, or null when no row holds it. */
export function getRun(id: string): RunRecord | null {
  const d = conn(), r = rowOf(d, id);
  return r ? fromRow(r, rootOf(d, id), runAsks(d).get(id)) : null;
}

/** The jobs of the work that starts at `root`, oldest first. */
const workOf = (d: Database, root: string): RunRecord[] => {
  const rows = d.query(`SELECT * FROM jobs ${ORDER}`).all() as Row[], roots = rootsOf(rows), asks = runAsks(d);
  return rows.filter((r) => roots.get(r.id) === root).map((r) => fromRow(r, root, asks.get(r.id)));
};

/** The `rounds` of the newest work on `target`, or of the work of the job with key `target` when it has none: its build runs that a check or the reviewer sent back. */
export function roundsOf(target: string): number {
  const rows = (conn().query(`SELECT * FROM jobs WHERE target = ? OR id = ? ${ORDER}`).all(target, target) as Row[]);
  if (!rows.length) return 0;
  const last = rows.at(-1)!, root = rootOf(conn(), last.id);
  return workOf(conn(), root).filter((x) => x.role === "build" && x.failed).length;
}

/** The sum of the costs of the jobs on `target`, in dollars at API rates. */
export const costOf = (target: string): number =>
  Math.round((conn().query("SELECT coalesce(sum(cost), 0) AS c FROM jobs WHERE target = ?").get(target) as { c: number }).c * 1e6) / 1e6;

// Writing a job.

/** The fields of a new job: `role` and `name`; the rest has defaults. `state` starts at `running`. */
export type NewJob = Change & Pick<Run, "role" | "name"> & { state?: State };

/** Log the state of a job: `gate <state> job.<n>`, or by the reviewer's job when it sent a build back. A bad word must not undo the write it reports, so it only logs. */
function logState(d: Database, x: RunRecord): void {
  const review = x.state === "returned" && x.cause === "review" ? (d.query("SELECT id FROM jobs WHERE prev = ? AND role = 'review' ORDER BY made DESC LIMIT 1").get(x.id) as { id: string } | null)?.id : undefined;
  const subject = review ?? "gate";
  const detail = x.state === "running" || review ? "" : x.state === "failed" && x.cause === "check" && x.reason ? x.reason : because(x.cause ?? x.fate ?? "");
  try { logEvent({ subject, action: x.state, object: x.id, detail }); }
  catch (e) { console.error(`record: no event for ${x.id}: ${(e as Error).message}`); }
}

/** An Ask on a run decides the issue's Ask: a later build, land or recheck of the same work takes it off. */
const decides = (role: Run["role"]): boolean => ["build", "land", "recheck"].includes(role);

/**
 * The one creator of a job: the row, its folder and the event of its first state, in one transaction. `fill` writes the
 * files of the folder the job starts with. The job number is the next of the `job` counter, so two starts never share it.
 */
export function makeJob(job: NewJob, fill?: (folder: string, id: string) => void): { id: string; folder: string; run: RunRecord } {
  return tx((d) => {
    const id = `job.${nextNumber("job")}`, folder = jobFolder(id);
    const run = { ...job, state: job.state ?? "running", made: job.made ?? Date.now(), started: job.started ?? new Date().toISOString(), by: job.by ?? "rule", told: job.told ?? false } as Run;
    const r = toRow(id, run);
    d.query("INSERT INTO jobs (id, role, by, state, project, made, started, ended, model, size, cost, commit_sha, target, prev, retry_of, extra) VALUES ($id, $role, $by, $state, $project, $made, $started, $ended, $model, $size, $cost, $commit_sha, $target, $prev, $retry_of, $extra)")
      .run(Object.fromEntries(Object.entries(r).map(([k, v]) => [`$${k}`, v])) as never);
    // A build, land or recheck of the work that holds an Ask decides that Ask.
    const target = run.target ?? id;
    const held = (d.query("SELECT ask_job FROM issue_state WHERE issue = ? AND ask_job IS NOT NULL").get(target) as { ask_job: string } | null)?.ask_job;
    if (held && run.prev && decides(run.role) && rootOf(d, held) === rootOf(d, id)) editState(d, target, (s) => { s.ask = null; s.askJob = undefined; });
    if (run.ask) takeAsk(d, id, target, run.ask);
    mkdirSync(folder, { recursive: true });
    fill?.(folder, id);
    const made = fromRow(rowOf(d, id)!, rootOf(d, id), run.ask);
    logState(d, made);
    return { id, folder, run: made };
  });
}

/** Keep a run's Ask in `issue_state`, not in the row. */
function takeAsk(d: Database, id: string, target: string, ask: Ask | null): void {
  editState(d, target, (s) => {
    if (ask) { s.ask = ask; s.askJob = id; return; }
    if (s.askJob === id) { s.ask = null; s.askJob = undefined; }
  });
}

/** Write the fields `change` into the row of `id`, inside a transaction. Returns the run as it was and as it is. */
function write(d: Database, id: string, state: State | undefined, change: Change): { was: RunRecord; now: RunRecord } {
  const r = rowOf(d, id);
  if (!r) throw new Error(`no record holds the run ${id}`);
  const root = rootOf(d, id), was = fromRow(r, root, runAsks(d).get(id));
  const { ask, ...rest } = change as Change & { ask?: Ask };
  const merged = JSON.parse(JSON.stringify({ ...was, ...rest, ...(state ? { state } : {}) })) as RunRecord;
  delete (merged as Partial<RunRecord>).ask;
  const row = toRow(id, merged);
  d.query("UPDATE jobs SET role=$role, by=$by, state=$state, project=$project, made=$made, started=$started, ended=$ended, model=$model, size=$size, cost=$cost, commit_sha=$commit_sha, target=$target, prev=$prev, retry_of=$retry_of, extra=$extra WHERE id=$id")
    .run(Object.fromEntries(Object.entries(row).map(([k, v]) => [`$${k}`, v])) as never);
  if ("ask" in change) takeAsk(d, id, merged.target ?? id, ask ?? null);
  const owned = "ask" in change ? ask : was.ask;
  if (owned) merged.ask = owned;
  return { was, now: merged };
}

/** Copy the `pid` and `exit` files of a job's folder to its row: the row keeps them after the folder goes. */
export function copyEnd(id: string): void {
  const end = readEnd(jobFolder(id));
  conn().query("UPDATE jobs SET pid = coalesce(?, pid), exit_code = coalesce(?, exit_code) WHERE id = ?").run(end.pid, end.exit, id);
}

/** One of the two writers of a job's state (the other is `endRun`): the state, the fields `fields` that go with it, and the event of the change, in one transaction. */
export function setState(id: string, state: State, fields: Change = {}): RunRecord {
  return tx((d) => {
    const { was, now } = write(d, id, state, fields);
    if (was.state !== state) logState(d, now);
    return now;
  });
}

/** Change fields of job `id` but not its state; a field set to undefined goes. `change` can be a function of the run and its work's runs. Throws when no row holds it. */
export function patchRun(id: string, change: Change | ((run: RunRecord, runs: RunRecord[]) => Change)): RunRecord {
  return tx((d) => {
    const was = getRun(id);
    if (!was) throw new Error(`no record holds the run ${id}`);
    return write(d, id, undefined, typeof change === "function" ? change(was, workOf(d, was.job)) : change).now;
  });
}

/**
 * End job `id` in one write: `change` (its state, `ended` and the rest) and its `next`, which `decide` gives from the
 * ended run and the land runs of its work, this one included. No reader sees the run ended with no `next`, so no
 * reader takes it for a rescue. Returns the run.
 */
export function endRun(id: string, change: Partial<Run> & { state: State }, decide: (run: Run, lands: Run[]) => Run["next"]): RunRecord {
  return tx((d) => {
    const was = getRun(id);
    if (!was) throw new Error(`no record holds the run ${id}`);
    const ended = { ...was, ...change } as RunRecord;
    const lands = workOf(d, was.job).filter((x) => x.role === "land").map((x) => (x.id === id ? ended : x));
    const { state, ...rest } = change;
    const { was: before, now } = write(d, id, state, { ...rest, next: decide(ended, lands) });
    if (before.state !== state) logState(d, now);
    return now;
  });
}

/** The decisions of the director runs, oldest first: each is the `decision` of its run's row. */
export const decisions = <T>(): T[] =>
  (conn().query(`SELECT json_extract(extra, '$.decision') AS d FROM jobs WHERE role = 'director' AND json_extract(extra, '$.decision') IS NOT NULL ${ORDER}`).all() as { d: string }[]).map((r) => JSON.parse(r.d));

// What the issue and its jobs share.

/** The live machine state of one issue: its Ask and its CI result. */
export interface IssueState {
  /** What the issue or its run waits on from Chris, or null. */
  ask: Ask | null;
  /** The run whose Ask `ask` is, while that run waits for Chris; absent when the Ask is on the issue. */
  askJob?: string;
  /**
   * The red GitHub CI on main the issue was filed for (firefighter.ts): its run, its commit and the failure the briefs
   * quote. `landed` is the commit the job landed as: the issue closes when a CI run at or after it is green.
   */
  ci?: { url: string; commit: string; failure: string; landed?: string };
}

interface StateRow { issue: string; ask: string | null; ask_job: string | null; ci: string | null }

const stateOfRow = (r: StateRow): IssueState => ({
  ask: r.ask ? JSON.parse(r.ask) : null, ...(r.ask_job ? { askJob: r.ask_job } : {}),
  ...(r.ci ? { ci: JSON.parse(r.ci) } : {}),
});

/** The state of `key` (an issue key, or the job key of a run on no issue), or null when nothing is live. */
export const read = (key: string): IssueState | null => {
  const r = conn().query("SELECT * FROM issue_state WHERE issue = ?").get(key) as StateRow | null;
  return r ? stateOfRow(r) : null;
};

/** Every row of `issue_state`, by key. */
export const allIssueStates = (): Map<string, IssueState> =>
  new Map((conn().query("SELECT * FROM issue_state").all() as StateRow[]).map((r) => [r.issue, stateOfRow(r)]));

/**
 * Read the state of `key`, apply `fn`, and write it: the row goes when nothing is live. A change of the Ask logs `answered`
 * for the Ask that went and `question` for the Ask that came, by `gate` on `key`.
 */
function editState(d: Database, key: string, fn: (s: IssueState) => void): void {
  const r = d.query("SELECT * FROM issue_state WHERE issue = ?").get(key) as StateRow | null;
  const s = r ? stateOfRow(r) : { ask: null } as IssueState, had = s.ask ? `${s.askJob ?? ""}:${s.ask.reason}` : null, was = s.ask;
  fn(s);
  const has = s.ask ? `${s.askJob ?? ""}:${s.ask.reason}` : null;
  if (!s.ask && !s.ci) d.query("DELETE FROM issue_state WHERE issue = ?").run(key);
  else d.query("INSERT INTO issue_state (issue, ask, ask_job, ci) VALUES (?, ?, ?, ?) ON CONFLICT (issue) DO UPDATE SET ask = excluded.ask, ask_job = excluded.ask_job, ci = excluded.ci")
    .run(key, s.ask ? JSON.stringify(s.ask) : null, s.askJob ?? null, s.ci ? JSON.stringify(s.ci) : null);
  if (has === had) return;
  if (was) logEvent({ subject: "gate", action: "answered", object: key });
  if (s.ask) logEvent({ subject: "gate", action: "question", object: key, detail: s.ask.facts ? `${s.ask.reason}: ${s.ask.facts}` : s.ask.reason });
}

/** Read-modify-write the state of `key` under the write lock. */
export const editIssueState = (key: string, fn: (s: IssueState) => void): void => tx((d) => editState(d, key, fn));

/** The Ask on the issue: the state's Ask when no run owns it. */
export const issueAsk = (s: IssueState | null): Ask | null => (s && !s.askJob ? s.ask : null);

/** Put the Ask on the issue `key`, or with null take the issue's Ask off. A run's Ask stays. */
export function setIssueAsk(key: string, ask: Ask | null): void {
  editIssueState(key, (s) => {
    if (ask) { s.ask = ask; s.askJob = undefined; return; }
    if (!s.askJob) s.ask = null;
  });
}

/** Delete the row of `key` when its issue closes: the Ask (the run's too) and the CI result. */
export const clearIssueState = (key: string): void => editIssueState(key, (s) => { s.ask = null; s.askJob = undefined; s.ci = undefined; });

// The next step.

/** What the work does next: a function of its runs and its issue's state only. The fields are the event fields of docs/naming.md. */
export interface Step {
  step: "ask" | "run" | "worker" | "land" | "recheck" | "rescue" | "wait" | "start" | "none";
  /** The work's state word. */
  action: string;
  /** Why the run stopped, from its `cause`. */
  sub?: string;
  /** The running or waiting job, or the landed commit as its first 7 characters. */
  on?: string[];
  /** The fix round of the work: `<rounds> / <fixRounds()>`. */
  count?: string;
  /** `human` for a step that waits for Chris. */
  to?: string;
}

/** The `sub` of a step: why the run stopped, when the run states it. */
const subOf = (run: Run): Pick<Step, "sub"> => { const cause = causeOf(run); return cause ? { sub: cause } : {}; };

/** A run counts unless it is a director or reviewer run, or a land that found the work's lock busy: none changes the work. */
const counts = (run: Run): boolean => run.role !== "director" && run.role !== "review" && !(run.role === "land" && run.state === "failed" && causeOf(run) === "locked");

/**
 * The run that counts in a work: its last run that counts, else its last run. A director run has a work of its own
 * (agent-run.ts `openRun`), so only a director work falls back.
 */
export const counting = (j: Entry[]): Entry => j.findLast((e) => counts(e.run)) ?? j.at(-1)!;

/** What `next` reads besides the runs: the issue's Ask. */
export interface Live { ask: Ask | null }

/**
 * The next step of the work. An Ask waits for Chris; a running run waits for its end; an ended run's `next` says
 * whether the worker or a land follows; a passed run with no `next` waits for a land by hand; a returned or failed run
 * goes to the rescue, unless the factory asked Chris about it after it ended or its cause is not `rescuable` (`POLICY`): then it
 * waits; a landed, done or dropped work does nothing; an issue
 * with no open run starts. The run that counts is the newest one that `counts`: a director
 * run changes the step through the Ask and the decision it writes, never as the run that counts.
 */
export function next(runs: RunRecord[], live: Live = { ask: null }): Step {
  if (live.ask) return { step: "ask", action: "waiting", to: "human" };
  const last = runs.findLast(counts);
  const rounds = runs.filter((x) => x.role === "build" && x.failed).length;
  if (last?.state === "running") return { step: "run", action: "running", on: [last.id] };
  if (last?.state === "waiting") return { step: "ask", action: "waiting", on: [last.id], to: "human" };
  if (last?.next === "worker") return { step: "worker", action: "returned", ...subOf(last), count: `${rounds} / ${fixRounds()}` };
  if (last?.next === "recheck") return { step: "recheck", action: "returned", ...subOf(last) };
  if (last?.next === "land") return { step: "land", action: last.state };
  if (last?.state === "passed") return { step: "wait", action: "passed", to: "human" };
  if (last && (last.state === "returned" || last.state === "failed")) {
    // An Ask made while the run was live (a slow land) was about the live run, not about this end.
    if (last.asked && !(last.ended && last.asked.at < last.ended)) return { step: "wait", action: "waiting", to: "human" };
    if (!policyOf(causeOf(last)).rescuable) return { step: "wait", action: last.state, ...subOf(last) };
    return { step: "rescue", action: last.state, ...subOf(last) };
  }
  if (last?.state === "landed") return { step: "none", action: "landed", ...(last.commit ? { on: [last.commit.slice(0, 7)] } : {}) };
  if (last?.state === "dropped") return { step: "none", action: "dropped" };
  if (last?.state === "done") return { step: "none", action: "done" };
  return { step: "start", action: "starting" };
}

/** The work's next step: `next` over its runs, with the Ask of its run that counts. */
export function stepOf(j: Entry[]): Step {
  const target = counting(j).run.target ?? counting(j).id, s = read(target);
  return next(j.map((e) => ({ ...e.run, id: e.id })), { ask: s?.ask ?? null });
}
