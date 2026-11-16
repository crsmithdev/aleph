/**
 * `GET /api/flow?window=hour|day|week|month` (default week)[&project=<repo>]: how fast the factory's runs are, read from the run folders'
 * state.json (no Langfuse). Runs with a `started` and an `ended` count; one longer than 4 hours
 * is a broken clock and is skipped. Hour is the last 60 minutes in 1-minute buckets, day the last 24 hours in hourly ones, week and
 * month the last 7 and 30 local days (today included) in daily ones. A percentile is the nearest rank.
 * The phases also read when each issue file first came into the work store's git history.
 */
import { existsSync } from "node:fs";
import { flakeNames, flakes } from "../../jobs/lib/gates/factory-status.ts";
import { git } from "../../jobs/lib/infra/git.ts";
import { decisions } from "../../jobs/lib/records/record.ts";
import { askHistory, type AskSpan } from "./gates.ts";
import { allRuns, isAgentRun, isBuild, onOf, type Entry, type Run } from "../../jobs/lib/records/ledger.ts";
import { activeEnd, isRunning } from "../../jobs/lib/infra/process.ts";
import { causeOf, type Cause } from "../../jobs/lib/records/outcome.ts";
import { OFFERS, readModels } from "../../jobs/lib/routing/models.ts";
import { stageRows, type StageRow } from "../../jobs/lib/learning/monitor-table.ts";
import type { Routes } from "../server.ts";
import { createdAt, everyFetched, itemsDir, projectsAt, reader, sourceOf } from "../../issues/lib/store.ts";
import { status } from "../../issues/lib/todo.ts";
import { currentFit, runShare, type Fit } from "../usage.ts";
import { LIVE_CAP, RUN_CAP } from "../../jobs/lib/infra/settings.ts";
import { clip, issueHref, NAMES, parseId, parseKey, SPEEDS, tail, type EventRow } from "../../lib/naming.ts";
import { eventIn, inProject, repoIn, scopeOf } from "./scope.ts";
import { readEvents } from "../../lib/layout.ts";
import { BUCKETS, buckets, quantile, WINDOWS, type Window } from "../../lib/windows.ts";

/** The goal a run works on, as the issue store names it (`<repo>-<n>`), or undefined for a run on no issue. */
const goalOf = (r: Pick<Run, "repo" | "target">): string | undefined => { const n = onOf(r); return n === undefined || !r.repo ? undefined : `${r.repo}-${n}`; };

const HOUR = 3600_000;

/** The repo and the ref inside it of a whole issue key: `aleph-1359.1` is `aleph` and `1359.1`; "" and "" for any other text. */
const splitId = (s: string): [string, string] => {
  const p = parseId(s);
  return p ? [p.repo, tail(p)] : ["", ""];
};

const MAX_RUN = 4 * HOUR;
/** The subjects of an event that file a follow-up: the factory's own actors, not claude and not human. */
const FOLLOWUPS = ["worker", "intake", "gate", "rule", "director", "housekeeper", "maintainer"];
/** 2026-11-13T18:09:00Z (10:09 PST): from then a filed event names the filer in its subject. Before it the subject is always `rule`, so only the issue's own `source: worker` makes the filing a follow-up. */
const NAMED_FILER = Date.parse("2026-11-13T18:09:00Z");

/** The numbers of the store's issues whose front matter says `source: worker`. */
const workerIssues = (): Set<number> => new Set(everyFetched().filter(({ item }) => sourceOf(item) === "worker").map(({ item }) => item.id));
export const KINDS = ["land", "intake"] as const;

export interface Pct { count: number; p50: number; p90: number }
/** A phase's `hist` counts times in 7 bins: under 1m, 1-5m, 5-15m, 15-30m, 30m-1h, 1-4h, over 4h (an edge falls in the upper bin). `worst` is the longest time in seconds. */
interface PhaseStat extends Pct { hist: number[]; worst: number }
export type Phase = "intake" | "queue" | "implement" | "land" | "lead";
const PHASE_KEYS: Phase[] = ["intake", "queue", "implement", "land", "lead"];
/** One issue's seconds per phase (null when the phase did not end in the window). `outcome` is "landed" once a land run landed it, else "unlanded". */
/** `filed` is the issue's filing time, ISO, or null when the store has none. */
type IssueTimes = { id: string; href: string; outcome: "landed" | "unlanded"; filed: string | null } & Record<Phase, number | null>;
/** An issue of a stage list, with its title and link while it is in the store. */

export interface Speed {
  window: Window;
  /** Issues that landed in the window: one per issue, however many land runs it had. Land runs with no issue count as one. */
  done: number;
  kinds: Record<(typeof KINDS)[number], Pct>;
  /** Intake: issue created to its first intake (or triage) end. Queue: that end, or the filing with none, to the issue's first agent start. Implement: job's first agent start to its last finish. Land: finish to landed. Lead: issue created to its last land. Each counts in the window where it ends. */
  phases: Record<Phase, PhaseStat>;
  /** Asks set in the window: `count` all of them, `manual` those that came to Chris (a director event "escalated" from the set time until the Ask cleared). */
  asks: { count: number; manual: number };
  checks: { name: string; count: number; p50: number; p90: number }[];
  /** hour: 60 buckets of 1 minute; day: 24 hourly; week: 7 and month: 30 local days; `at` is its local start as an ISO string; `cost` is the recorded cost of the agent runs that started in it, per model, and `tokens` their saved tokens (0 for a run with none). */
  /** Issues in each stage per bucket, for the Status page's chart. */
  active: Active[];
  buckets: ({ at: string; runs: number; cost: Record<string, number>; tokens: Record<string, number>; p90: Record<Phase, number | null> } & Record<Phase, number | null>)[];
  /** Every issue with a phase that ended in the window. */
  times: IssueTimes[];
  slowest: { name: string; state: string; model: string; tests: number | null; cost: number; took: number }[];
  /** The stages of the window, as the monitor counts them. */
  stages: { rows: StageRow[] };
  models: { model: string; count: number; p50: number }[];
  /** Issues filed in the window by an event of the event table: `all` of them, `followups` those the factory's own actors filed (not claude, not human). Before 2026-11-13T18:09:00Z the filer is not in the subject, so there only an issue with `source: worker` counts. */
  filed: { followups: number; all: number };
  flaky: number;
  /** The reruns by check, most first. */
  flakes: { name: string; count: number }[];
  /** Landed issues (one per issue that landed in the window) and what they cost to get there. */
  issues: {
    landed: number;
    /** Share of landed issues whose landing jobs, and the jobs they retry, had no run sent back, 0 to 1; null with none landed. */
    firstPass: number | null;
    /** Median fix rounds per landed issue; null with none landed. */
    fixRounds: number | null;
    /** Median over landed issues of the week share their agent runs took, 2 decimals; null with no fit or none landed. */
    week: number | null;
    /** The landed issues that used the most of the weekly limit, largest first, at most 8: `week` is the share of the week their agent runs took (2 decimals), `runs` how many agent runs that sums. Empty with no fit or none landed. */
    usage: { goal: string; title?: string; href?: string; week: number; runs: number }[];
  };
  classes: ClassStat[];
  notCounted: { runs: number; issues: number; hours: number };
  lost: { hours: number; share: number };
  agents: Agents;
}

/** One role of the factory's agents. `live` is the runs live now; `runs` started in the window; `hours` is their agent time inside it; `p50` and `p95` are their times in seconds. The Reviewer's are those of its own `review` jobs. */
export interface AgentRole { key: AgentKey; name: string; live: number; runs: number; hours: number; p50: number | null; p95: number | null; models: string[] }
/**
 * One role and model of the window with how its runs ended. `ended` is succeeded + failed + stuck (a running run counts in `runs` only). `rate` is succeeded over `ended` (null with none); `baseline` is the same rate over the baseline's spans (null with no data). `cost` is the recorded cost of the runs; `p50` and `p95` are their times in seconds; `from` and `to` are the first and last start of its runs in the window (ISO, null with no runs).
 * Worker rows are one per size and model: they add `size` (small, medium or large, null for a build with no size), `built` (succeeded runs of a landed job), `perBuilt` (`cost` over `built`, null with none built), `firstPass` (those whose job, and the jobs it retries, had no run sent back) and `reviewPass` (the reviewer's pass share of the verdicts on their builds, null with none); Reviewer rows add `pass` and `fail`, and their `rate` is the verdicts (`pass` + `fail`) over `ended`.
 */
interface OutcomeRow {
  role: AgentKey; model: string; runs: number; succeeded: number; failed: number; stuck: number; ended: number;
  rate: number | null; p50: number | null; p95: number | null; cost: number; baseline: number | null; from: string | null; to: string | null;
  size?: string | null;
  firstPass?: number; built?: number; perBuilt?: number | null; reviewPass?: number | null; pass?: number; fail?: number;
}
/** The agents over the window. `workers` and `cap` are the runs the live cap counts, now. `mean` and `peak` count all timed roles, and each point holds each role's mean live in its step. */
export interface Agents {
  live: number; workers: number; cap: number; mean: number; peak: number;
  roles: AgentRole[];
  outcomes: OutcomeRow[];
  /** Over the window, 0 to 1, null with no data: `success` is succeeded over ended runs of all roles but the reviewer, `baseline` the same over the baseline's spans, `firstPass` the share of landed worker builds whose job, and the jobs it retries, had no run sent back, `local` the share of runs on gpt-oss-20b. */
  rates: { success: number | null; baseline: number | null; firstPass: number | null; local: number | null };
  points: ({ at: string } & Partial<Record<AgentKey, number>>)[];
}

/** What `classify`'s `statusOf` returns for an issue that is no longer in the store: closed issues left it, so one with no landing was closed without landing. */
export const GONE = "gone";
export const CLASSES = SPEEDS;
export type Class = (typeof CLASSES)[number];
/** The classes whose work did not reach main: their hours are the lost time. */
const LOST: Class[] = ["failed", "reran", "dropped"];
const CLASS_TEXT: Record<Class, string> = {
  landed: "The run whose work landed on main.",
  returned: "A run of the landing job before the run that landed: a fix round the issue needed.",
  failed: "A run that started after its issue had landed, or found the work already on main.",
  get reran() { return `A run that a later start replaced: another job of the same issue landed, or the issue started ${RUN_CAP() + 1} or more times inside an hour.`; },
  dropped: "A run of an issue that was then dropped or closed without landing.",
};
/** The breakdown's name of each stated cause that has one. */
const CAUSE_NAME: Partial<Record<Cause, string>> = {
  review: "Reviewer sent back", check: "Checks failed",
  timeout: "Stalled or timed out", stalled: "Stalled or timed out",
  "no-commit": "No commit", conflict: "Passed, not landed",
};

/** What each cause in the breakdown means. */
const CAUSE_TEXT: Record<string, string> = {
  "First run of the job": "The job's first run landed, with no fix round.",
  "After fix rounds": "The job landed on a later run, after one or more fix rounds.",
  "Issue had landed": "The run started after its issue had landed.",
  "Work on main from another issue": "The run found the work already on main, from another issue.",
  get "Restart loop"() { return `The issue started ${RUN_CAP() + 1} or more times inside an hour.`; },
  "Needed the user": "The run waited for the user, or the user restarted or dropped it by hand.",
  "Reviewer sent back": "The reviewer did not pass the run's work.",
  "Checks failed": "The run's checks failed or timed out.",
  "Stalled or timed out": "The run stalled, passed its time box or lost its process.",
  "No commit": "The run ended with no commit.",
  "Passed, not landed": "The run passed its checks, but its work did not land, for example after a land conflict.",
  "Other": "Any other reason, or no reason recorded.",
};

export interface Measure { hours: number; week: number; runs: number }
interface ClassStat extends Measure {
  /** `lost`: the class's work did not reach main. */
  key: Class; lost: boolean; text: string; issues: number;
  causes: (Omit<Measure, "week"> & { name: string; text: string })[];
  top: (Omit<Measure, "week"> & { goal: string; title?: string; href?: string; reason: string })[];
}

const round = (n: number, d = 0) => { const k = 10 ** d; return Math.round(n * k) / k; };
const stat = (xs: number[]): Pct => ({ count: xs.length, p50: round(quantile(xs, 0.5) ?? 0), p90: round(quantile(xs, 0.9) ?? 0) });
const HIST_EDGES = [60, 300, 900, 1800, 3600, 14400];
const histOf = (xs: number[]): number[] => {
  const h = new Array(HIST_EDGES.length + 1).fill(0);
  for (const x of xs) h[HIST_EDGES.filter((e) => x >= e).length]++;
  return h;
};
const phaseStat = (xs: number[]): PhaseStat => ({ ...stat(xs), hist: histOf(xs), worst: xs.length ? round(Math.max(...xs)) : 0 });
const isTests = (name: string) => /^tests?$/.test(name);

const HOUR_MS = HOUR;
const passedState = (st: string) => st === "passed" || st === "landed" || st === "done";

/** Class every agent run of the window by what its work came to; see the parent issue's Classes list. */
export function classify(runs: Run[], statusOf: (ref: string) => string | undefined, since: number, now: number, fit: Fit | null): { classes: ClassStat[]; notCounted: { runs: number; issues: number; hours: number }; lost: { hours: number; share: number }; total: number } {
  const t0 = (r: Run) => Date.parse(r.started);
  const agentsOf = new Map<string, Run[]>(), landsOf = new Map<string, Run[]>(), firstStart = new Map<string, number>();
  for (const r of runs) {
    const t = t0(r);
    if (Number.isFinite(t)) firstStart.set(r.job, Math.min(firstStart.get(r.job) ?? Infinity, t));
    const g = goalOf(r);
    if (g === undefined) continue;
    const m = isAgentRun(r.role) ? agentsOf : r.role === "land" && r.state === "landed" ? landsOf : null;
    if (!m) continue;
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push(r);
  }
  // The landing runs of each issue, and when its last land ended.
  const landing = new Map<string, Set<Run>>(), lastLand = new Map<string, number>();
  for (const [g, lands] of landsOf) {
    for (const l of lands) {
      const end = Date.parse(l.ended ?? "");
      if (Number.isFinite(end)) lastLand.set(g, Math.max(lastLand.get(g) ?? -Infinity, end));
      // A held run lands from `waiting`, so it counts for the land of its own job.
      const cand = (agentsOf.get(g) ?? []).filter((a) => (passedState(a.state) || (a.state === "waiting" && a.job === l.job)) && t0(a) < end).sort((a, b) => t0(b) - t0(a))[0];
      if (cand) { if (!landing.has(g)) landing.set(g, new Set()); landing.get(g)!.add(cand); }
    }
  }
  type Row = { run: Run; issue: string; hours: number; week: number; cause: string };
  const rows = new Map<Class, Row[]>(CLASSES.map((c) => [c, []]));
  const skipped: Row[] = [];
  for (const r of runs) {
    const g = goalOf(r);
    if (!isAgentRun(r.role) || g === undefined) continue;
    const a = t0(r), b = Date.parse(r.ended ?? "");
    if (!(a >= since) || a > now || !(b >= a) || b - a > MAX_RUN) continue;
    const reason = r.reason ?? "";
    const row: Row = { run: r, issue: g, hours: (b - a) / 1000 / 3600, week: runShare(fit, r)?.pct ?? 0, cause: "" };
    const lands = landing.get(g) ?? new Set<Run>();
    const mine = (agentsOf.get(g) ?? []);
    const startsBefore = mine.filter((o) => a - HOUR_MS <= t0(o) && t0(o) < a).length;
    const afterLand = lastLand.has(g) && a > lastLand.get(g)!;
    let cls: Class | null = null;
    if (lands.has(r)) cls = "landed";
    else if ([...lands].some((l) => l.job === r.job && t0(l) > a)) cls = "returned";
    else if (afterLand || r.fate === "met" || r.fate === "duplicate") cls = "failed";
    else if (startsBefore >= RUN_CAP() || [...lands].some((l) => l.job !== r.job && (firstStart.get(l.job) ?? Infinity) > (firstStart.get(r.job) ?? Infinity))) cls = "reran";
    else if (["done", "dropped", GONE].includes(statusOf(g) ?? "")) cls = "dropped";
    if (!cls) { skipped.push(row); continue; }
    const stated = CAUSE_NAME[causeOf(r) ?? "other"];
    if (cls === "landed") row.cause = mine.some((o) => o.job === r.job && t0(o) < a) ? "After fix rounds" : "First run of the job";
    else if (cls === "failed") row.cause = afterLand ? "Issue had landed" : "Work on main from another issue";
    else if (cls === "reran" && startsBefore >= RUN_CAP()) row.cause = "Restart loop";
    else if (r.state === "waiting") row.cause = "Needed the user";
    else if (r.failed === "review") row.cause = "Reviewer sent back";
    else if (r.failed) row.cause = "Checks failed";
    else if (stated) row.cause = stated;
    // A drop with no stated cause has only its free prose, so this guess stays for the page's breakdown.
    else if (/reviewer/i.test(reason)) row.cause = "Reviewer sent back";
    else if (/ failed$/.test(reason)) row.cause = "Checks failed";
    else if (/time box|stalled|timed out|lost/i.test(reason)) row.cause = "Stalled or timed out";
    else if (/no commit/i.test(reason)) row.cause = "No commit";
    else if (r.fate === "manual") row.cause = "Needed the user";
    else if (passedState(r.state) || /conflict/i.test(reason)) row.cause = "Passed, not landed";
    else row.cause = "Other";
    rows.get(cls)!.push(row);
  }
  const sum = (rs: Row[]): Measure => ({ hours: rs.reduce((x, y) => x + y.hours, 0), week: rs.reduce((x, y) => x + y.week, 0), runs: rs.length });
  const rd = (m: Measure): Measure => ({ hours: round(m.hours, 2), week: round(m.week, 2), runs: m.runs });
  const classes: ClassStat[] = CLASSES.map((key) => {
    const rs = rows.get(key)!;
    const group = <K extends string>(keyOf: (r: Row) => K) => {
      const m = new Map<K, Row[]>();
      for (const r of rs) { const k = keyOf(r); if (!m.has(k)) m.set(k, []); m.get(k)!.push(r); }
      return m;
    };
    const noWeek = ({ week: _w, ...m }: Measure): Omit<Measure, "week"> => m;
    const causes = [...group((r) => r.cause)].map(([name, x]) => ({ name, sum: sum(x) })).sort((a, b) => b.sum.hours - a.sum.hours).map((c) => ({ name: c.name, text: CAUSE_TEXT[c.name], ...noWeek(rd(c.sum)) }));
    const top = [...group((r) => r.issue)].map(([issue, x]) => {
      const last = x.reduce((p, q) => (t0(q.run) > t0(p.run) ? q : p));
      const [repo, n] = splitId(issue);
      return { issue, sum: sum(x), reason: clip((last.run.reason ?? "").replace(/^agent run \S+:\s*/, "").trim(), 140), href: issueHref(`${repo}-${n}`) };
    }).sort((a, b) => b.sum.hours - a.sum.hours).slice(0, 8).map((t) => ({ goal: t.issue, href: t.href, reason: t.reason, ...noWeek(rd(t.sum)) }));
    return { key, lost: LOST.includes(key), text: CLASS_TEXT[key], ...rd(sum(rs)), issues: new Set(rs.map((r) => r.issue)).size, causes, top };
  });
  const hoursOf = (cs: readonly Class[]) => cs.reduce((x, c) => x + sum(rows.get(c)!).hours, 0);
  const total = hoursOf(CLASSES), lostH = hoursOf(LOST);
  return {
    classes,
    notCounted: { runs: skipped.length, issues: new Set(skipped.map((r) => r.issue)).size, hours: round(skipped.reduce((x, y) => x + y.hours, 0), 2) },
    lost: { hours: round(lostH, 2), share: total ? round(lostH / total, 4) : 0 },
    total: round(total, 2),
  };
}

// Bulk commits add files whose work is older: they do not say when an issue was created.
const BULK = /^(migrate:|todo: move every )/;
const FILED = /^issues\/(\d+)\/issue\.md$/;
export interface Filed { issue: Map<string, number | null> }
let filedAt: Filed & { head: string } = { head: "", issue: new Map() };

/** The commit of the store's origin/main, or "" when the store has none. */
const originMain = (dir: string): string => {
  const rev = existsSync(dir) ? git(dir, "rev-parse", "origin/main") : null;
  return rev?.ok ? rev.out : "";
};

/** When each issue was filed, in ms: its created field, else when a commit added it. Null for one with no created field that a bulk commit added. Each read adds only the commits since the last. */
export function filed(dir = itemsDir(), head = originMain(dir)): Filed {
  if (!head) return { issue: new Map() };
  if (head === filedAt.head) return filedAt;
  const known = filedAt.head && git(dir, "merge-base", "--is-ancestor", filedAt.head, head).ok;
  const next = known ? filedAt : { head, issue: new Map() };
  const log = git(dir, "log", "--reverse", "--diff-filter=A", "--no-renames", "--name-only", "--format=@%ct %s", known ? `${filedAt.head}..${head}` : head).out;
  let at: number | null = null;
  const added: [number, number | null][] = [];
  for (const line of log.split("\n")) {
    if (line.startsWith("@")) {
      const space = line.indexOf(" ");
      at = BULK.test(line.slice(space + 1)) ? null : Number(line.slice(1, space)) * 1000;
      continue;
    }
    const m = line.match(FILED);
    if (m) added.push([Number(m[1]), at]);
  }
  const projects = added.length ? projectsAt(dir, head) : new Map<number, string>();
  const created = added.length ? createdAt(dir, head) : new Map<number, number>();
  for (const [n, when] of added) {
    const name = projects.get(n);
    if (!name) continue;
    const key = `${name}-${n}`;
    // A file added again keeps the first time.
    if (!next.issue.has(key)) next.issue.set(key, created.get(n) ?? when);
  }
  filedAt = { ...next, head };
  return filedAt;
}

/** The phases of the work over `runs` and the store's history, for what ended in `since`..`now`: each one's end time and seconds. */
export function phaseTimes(runs: Run[], { issue }: Filed, since: number, now: number): Record<Phase, { at: number; secs: number }[]> & { issues: IssueTimes[] } {
  const per = new Map<string, IssueTimes>();
  const note = (key: string | undefined, k: Phase, secs: number) => {
    if (!key) return;
    const [repo, n] = splitId(key);
    if (!per.has(key)) per.set(key, { id: key, href: issueHref(`${repo}-${n}`), outcome: "unlanded", filed: issue.get(key) ? new Date(issue.get(key)!).toISOString() : null, intake: null, queue: null, implement: null, land: null, lead: null });
    per.get(key)![k] = secs;
  };
  const inWindow = (t: number) => t >= since && t <= now;
  const intake: { at: number; secs: number }[] = [], queue: { at: number; secs: number }[] = [], implement: { at: number; secs: number }[] = [], land: { at: number; secs: number }[] = [], lead: { at: number; secs: number }[] = [];
  const jobs = new Map<string, Run[]>();
  for (const r of runs) jobs.set(r.job, [...(jobs.get(r.job) ?? []), r]);
  for (const rs of jobs.values()) {
    const agents = rs.filter((r) => { const a = Date.parse(r.started), b = Date.parse(r.ended ?? ""); return isAgentRun(r.role) && b >= a && b - a <= MAX_RUN; });
    const landed = Math.min(...rs.filter((r) => r.role === "land" && (r.state === "landed" || r.state === "done")).map((r) => Date.parse(r.ended ?? "")).filter(Number.isFinite));
    // A job can run again after it lands; what finished the work is the last finish before the land.
    const ends = agents.filter((r) => passedState(r.state) || r.state === "waiting").map((r) => Date.parse(r.ended!)).filter((t) => t <= landed);
    if (!ends.length) continue;
    const key = rs.map((r) => goalOf(r)).find((k) => k !== undefined);
    const finished = Math.max(...ends), started = Math.min(...agents.map((r) => Date.parse(r.started)));
    if (inWindow(finished)) { implement.push({ at: finished, secs: (finished - started) / 1000 }); note(key, "implement", (finished - started) / 1000); }
    if (inWindow(landed)) { land.push({ at: landed, secs: (landed - finished) / 1000 }); note(key, "land", (landed - finished) / 1000); }
  }
  // Queue and Lead are per issue. A run older than its filing (a file added again) has no such span.
  const firstStart = new Map<string, number>(), lastLand = new Map<string, number>(), triaged = new Map<string, number>();
  for (const r of runs) {
    const key = goalOf(r);
    if (key === undefined) continue;
    if (isAgentRun(r.role)) {
      const a = Date.parse(r.started);
      if (a < (firstStart.get(key) ?? Infinity)) firstStart.set(key, a);
    } else if (r.role === "intake") {
      const b = Date.parse(r.ended ?? "");
      if (b < (triaged.get(key) ?? Infinity)) triaged.set(key, b);
    } else if (r.role === "land" && (r.state === "landed" || r.state === "done")) {
      const b = Date.parse(r.ended ?? "");
      if (b > (lastLand.get(key) ?? -Infinity)) lastLand.set(key, b);
    }
  }
  for (const [key, started] of firstStart) {
    const created = issue.get(key), sorted = triaged.get(key);
    if (created != null && sorted != null && sorted >= created && sorted <= started && inWindow(sorted)) { intake.push({ at: sorted, secs: (sorted - created) / 1000 }); note(key, "intake", (sorted - created) / 1000); }
    // An issue filed with a spec in a repo without author skips intake: it queues from its filing.
    const queued = sorted != null && sorted <= started ? sorted : created;
    if (queued != null && started >= queued && inWindow(started)) { queue.push({ at: started, secs: (started - queued) / 1000 }); note(key, "queue", (started - queued) / 1000); }
  }
  for (const [key, landed] of lastLand) {
    const created = issue.get(key);
    if (created != null && landed >= created && inWindow(landed)) { lead.push({ at: landed, secs: (landed - created) / 1000 }); note(key, "lead", (landed - created) / 1000); }
  }
  for (const [key, t] of per) if (lastLand.has(key)) t.outcome = "landed";
  return { intake, queue, implement, land, lead, issues: [...per.values()] };
}

/** Each phase's count, p50 and p90 over `phaseTimes`. */
export function phases(runs: Run[], filings: Filed, since: number, now: number): Speed["phases"] {
  const t = phaseTimes(runs, filings, since, now);
  return Object.fromEntries(PHASE_KEYS.map((k) => [k, phaseStat(t[k].map((x) => x.secs))])) as Speed["phases"];
}

/** Where an issue is, per bucket: the issues in intake (filed to triaged), queued (to the first agent start), running (to the land, else the last agent end) and landed in it. An issue counts once in each stage it was in during the bucket. An open issue with no agent run waits in intake from its filing to its intake run's end (else to now), then in the queue to now. `open` says whether an issue key counts as open and in the chart's project. */
export interface Active { at: string; intake: number; queue: number; running: number; landed: number }
export function activeIssues(runs: Run[], { issue }: Filed, b: ReturnType<typeof buckets>, now: number, open: (key: string) => boolean = () => false): Active[] {
  type Span = [number, number];
  const per = new Map<string, { triaged?: number; start?: number; end?: number; land?: number }>();
  for (const r of runs) {
    const key = goalOf(r);
    if (key === undefined) continue;
    const t = per.get(key) ?? {}, a = Date.parse(r.started), e = Date.parse(r.ended ?? "");
    if (isAgentRun(r.role)) {
      t.start = Math.min(a, t.start ?? Infinity);
      t.end = Math.max(Number.isFinite(e) ? e : now, t.end ?? -Infinity);
    } else if (r.role === "intake") {
      if (e < (t.triaged ?? Infinity)) t.triaged = e;
    } else if (r.role === "land" && (r.state === "landed" || r.state === "done") && e > (t.land ?? -Infinity)) t.land = e;
    per.set(key, t);
  }
  for (const key of issue.keys()) if (!per.has(key) && open(key)) per.set(key, {});
  const rows: Active[] = b.starts.map((at) => ({ at: new Date(at).toISOString(), intake: 0, queue: 0, running: 0, landed: 0 }));
  const edges = [...b.starts, b.until];
  const mark = (stage: "intake" | "queue" | "running", span: Span | null) => {
    if (!span || !(span[1] >= span[0])) return;
    rows.forEach((row, i) => { if (span[0] < edges[i + 1] && span[1] > edges[i]) row[stage]++; });
  };
  for (const [key, t] of per) {
    const created = issue.get(key);
    if (t.start === undefined) {
      if (created == null || !open(key)) continue;
      mark("intake", [created, t.triaged ?? now]);
      if (t.triaged !== undefined) mark("queue", [t.triaged, now]);
      continue;
    }
    const sorted = t.triaged !== undefined && t.triaged <= t.start ? t.triaged : undefined;
    if (created != null && sorted !== undefined) mark("intake", [created, sorted]);
    const queued = sorted ?? created;
    if (queued != null) mark("queue", [queued, t.start]);
    mark("running", [t.start, t.land ?? t.end!]);
    const slot = t.land === undefined ? -1 : b.slotOf(t.land);
    if (slot >= 0) rows[slot].landed++;
  }
  return rows;
}

// The roles with their run kind. A land and a recheck run only checks and git, so they are not agents.
const AGENT_ROLES = ([["worker", "build"], ["intake", "intake"], ["director", "director"], ["monitor", "monitor"], ["housekeeper", "housekeeper"], ["maintainer", "maintainer"], ["lens", "lens"], ["title", "title"], ["judge", "judge"], ["reviewer", "review"]] as const).map(([key, kind]) => [key, NAMES[key], kind] as const);
type AgentKey = (typeof AGENT_ROLES)[number][0];

/** "claude-opus-5-5" as "opus"; "sonnet" stays. */
const modelName = (m: string) => /^claude-([a-z]+)-/.exec(m)?.[1] ?? m;

/** A model's name without its provider prefix: "deepseek/deepseek-v4.1-flash" as "deepseek-v4.1-flash", the name the models setting carries. */
const bare = (m: string | undefined): string | undefined => m?.replace(/^.*\//, "");

/** The model a size (small, medium or large) is set to now, or undefined for any other size. */
const sizeModel = (size: string | undefined): string | undefined => (size && size in OFFERS ? readModels()[size as keyof typeof OFFERS].model : undefined);

/**
 * The jobs that had a fix round: a run of the job that a check or the reviewer sent back (`failed` set or a
 * `review.call` of `returned`), and every job that retries such a job (`retryOf`).
 */
function fixRoundJobs(entries: Entry[]): Set<string> {
  const jobs = new Set(entries.map((e) => e.run).filter((r) => r.failed || r.review?.call === "returned").map((r) => r.job));
  const jobOf = new Map(entries.map((e) => [e.id, e.run.job]));
  const retriedBy = new Map<string, string[]>();
  for (const e of entries) { const from = e.run.retryOf ? jobOf.get(e.run.retryOf) : undefined; if (from !== undefined && from !== e.run.job) retriedBy.set(from, [...(retriedBy.get(from) ?? []), e.run.job]); }
  const queue = [...jobs];
  while (queue.length) for (const j of retriedBy.get(queue.pop()!) ?? []) if (!jobs.has(j)) { jobs.add(j); queue.push(j); }
  return jobs;
}

/**
 * The rows of OutcomeRow for the runs that started in `since`..`now`, without `baseline`.
 * What "succeeded" means, from what each role's run records:
 * - Worker (build, older "agent"): the run ends `passed`, `waiting` or `landed`: its checks passed and the reviewer did not send it back. A run that a reviewer or a check sent back is `returned`: that is a fail, not stuck.
 * - Intake, Triage, Planner, Director: the run ends `passed` or `done`: the role applied its route or wrote its answer. These roles set no `failed`.
 * - Housekeeper, Maintainer: like Intake, the run ends `passed` or `done`.
 * - Reviewer: its runs, model, cost, times and ends are those of its own `review` jobs, and it succeeded when the job ended `passed` or `done`. Its pass and fail counts (and so `rate`) are read from the verdicts on the builds: a succeeded build is a pass; `failed: "review"` (or an older `review.call` of `returned`) is a fail; `review.call` of `passed` is a pass. A build with no verdict counts as neither. A verdict's model is the build's `review.model`, else that of the review run whose `prev` is the build's job, else "unset".
 * - A model counts under its name without a provider prefix, and a build with no model under its size's model, so the rows match the names the models setting carries.
 * Stuck is a run that ended `failed` with no `failed` field, or with the cause `timeout` or `stalled`. Failed is any other end that is not running. A running run counts in `runs` only.
 */
function outcomeRows(entries: Entry[], since: number, now: number): OutcomeRow[] {
  const order = (k: string) => AGENT_ROLES.findIndex(([r]) => r === k) + 1 || AGENT_ROLES.length + 1;
  const rows = new Map<string, OutcomeRow & { secs: number[]; starts: number[]; verdicts: number; landed: number }>();
  const row = (role: OutcomeRow["role"], model: string, size?: string | null) => {
    const k = `${role}\0${model}\0${size}`;
    if (!rows.has(k)) rows.set(k, { role, model, ...(size === undefined ? {} : { size }), runs: 0, succeeded: 0, failed: 0, stuck: 0, ended: 0, rate: null, p50: null, p95: null, cost: 0, baseline: null, from: null, to: null, secs: [], starts: [], verdicts: 0, landed: 0 });
    return rows.get(k)!;
  };
  const runs = entries.map((e) => e.run);
  // The review run of a build: the one whose `prev` is the build's job. Its model serves a verdict that has none.
  const reviews = new Map<string, string>();
  for (const e of entries) if (e.run.role === "review" && e.run.prev && e.run.model) reviews.set(e.run.prev, e.run.model);
  // A job landed when a land run of it landed; a fix round is the rule of fixRoundJobs.
  const landedJobs = new Set(runs.filter((r) => r.role === "land" && r.state === "landed").map((r) => r.job));
  const roundJobs = fixRoundJobs(entries);
  for (const e of entries) {
    const r = e.run;
    const a = Date.parse(r.started);
    if (!(a >= since && a < now)) continue;
    const ok = passedState(r.state) || r.state === "waiting";
    const cause = causeOf(r);
    const stuck = !ok && r.state !== "running" && (cause === "timeout" || cause === "stalled" || (r.state === "failed" && !r.failed));
    const fail = !ok && !stuck && r.state !== "running";
    const build = isBuild(r.role);
    const role = build ? "worker" : AGENT_ROLES.find(([, , kind]) => kind === r.role)?.[0];
    const model = bare(r.model) || (build ? sizeModel(r.size) : undefined) || "unset";
    const size = build ? (["small", "medium", "large"].includes(r.size ?? "") ? r.size! : null) : undefined;
    if (role) {
      const w = row(role, model, size);
      w.runs++; w.cost += r.cost ?? 0; w.starts.push(a);
      if (ok) w.succeeded++; else if (stuck) w.stuck++; else if (fail) w.failed++;
      const b = Date.parse(r.ended ?? "");
      if (b >= a && b - a <= MAX_RUN) w.secs.push((b - a) / 1000);
      if (ok && build && landedJobs.has(r.job)) {
        w.built = (w.built ?? 0) + 1;
        if (!roundJobs.has(r.job)) w.firstPass = (w.firstPass ?? 0) + 1;
      }
    }
    if (build) {
      const back = r.failed === "review" || r.review?.call === "returned", land = ok || r.review?.call === "passed";
      if (back || land) {
        const v = row("reviewer", bare(r.review?.model) || bare(reviews.get(e.id)) || "unset");
        if (back) v.fail = (v.fail ?? 0) + 1; else v.pass = (v.pass ?? 0) + 1;
        const w = row("worker", model, size);
        w.verdicts++; w.landed += back ? 0 : 1;
      }
    }
  }
  return [...rows.values()].map(({ secs, starts, verdicts, landed, ...x }) => {
    const ended = x.succeeded + x.failed + x.stuck, cost = round(x.cost, 2), done = x.role === "reviewer" ? (x.pass ?? 0) + (x.fail ?? 0) : x.succeeded;
    const iso = (t: number) => (starts.length ? new Date(t).toISOString() : null);
    return {
      ...x, ended, cost, from: iso(Math.min(...starts)), to: iso(Math.max(...starts)), rate: ended ? round(done / ended, 4) : null, p50: secs.length ? round(quantile(secs, 0.5)!) : null, p95: secs.length ? round(quantile(secs, 0.95)!) : null,
      ...(x.role === "worker" ? { firstPass: x.firstPass ?? 0, built: x.built ?? 0, perBuilt: x.built ? round(cost / x.built, 2) : null, reviewPass: verdicts ? round(landed / verdicts, 4) : null } : {}),
      ...(x.role === "reviewer" ? { pass: x.pass ?? 0, fail: x.fail ?? 0 } : {}),
    };
  }).sort((p, q) => order(p.role) - order(q.role) || q.runs - p.runs || p.model.localeCompare(q.model));
}

/** The agents by role over `since`..`now`. `before` are the baseline's spans, each a [since, now] before the window. A run with the state running ends at `now` when `alive` says so, and does not count when not. `step` is the width of a point in ms. */
export function agentStats(entries: Entry[], since: number, now: number, step: number, cap: number, alive: (e: Entry) => boolean = isRunning, before: [number, number][] = []): Agents {
  const length = Math.ceil((now - since) / step);
  const edges: [number, number][] = [];
  const points: Agents["points"] = Array.from({ length }, (_, i) => ({ at: new Date(since + i * step).toISOString() }));
  const roles: AgentRole[] = AGENT_ROLES.map(([key, name, kind]) => {
    let live = 0, ms = 0;
    const times: number[] = [], models = new Map<string, number>();
    let runs = 0;
    for (const e of entries) {
      const r = e.run;
      if (r.role !== kind) continue;
      const running = r.state === "running" && alive(e);
      if (running) live++;
      const a = Date.parse(r.started), b = r.ended ? Date.parse(r.ended) : running ? now : NaN;
      if (a >= since && a < now) {
        runs++;
        if (r.model) models.set(modelName(r.model), (models.get(modelName(r.model)) ?? 0) + 1);
        if (r.ended && b >= a && b - a <= MAX_RUN) times.push((b - a) / 1000);
      }
      if (!(b >= a) || b - a > MAX_RUN || b <= since || a >= now) continue;
      const from = Math.max(a, since), to = Math.min(b, now);
      ms += to - from;
      edges.push([from, 1], [to, -1]);
      for (let i = Math.floor((from - since) / step); i < length && since + i * step < to; i++) {
        const lo = since + i * step, part = Math.min(to, lo + step) - Math.max(from, lo);
        points[i][key] = (points[i][key] ?? 0) + part / step;
      }
    }
    return { key, name, live, runs, hours: round(ms / HOUR, 1), p50: times.length ? round(quantile(times, 0.5)!) : null, p95: times.length ? round(quantile(times, 0.95)!) : null, models: [...models].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([m]) => m) };
  });
  // An end before a start at the same moment: a run that follows another does not add one.
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let up = 0, peak = 0;
  for (const [, d] of edges) { up += d; if (up > peak) peak = up; }
  for (const p of points) for (const [key] of AGENT_ROLES) if (p[key] !== undefined) p[key] = round(p[key]!, 2);
  // The baseline rate of a role and model: the mean of its rate over the spans that have data, as averageFigures takes it.
  const prior = before.map(([a, b]) => outcomeRows(entries, a, b));
  const outcomes = outcomeRows(entries, since, now).map((o) => {
    const v = prior.map((p) => p.find((x) => x.role === o.role && x.model === o.model && x.size === o.size)?.rate).filter((n): n is number => n != null);
    return { ...o, baseline: v.length ? round(v.reduce((x, y) => x + y, 0) / v.length, 4) : null };
  });
  const success = (rows: OutcomeRow[]) => {
    const w = rows.filter((o) => o.role !== "reviewer"), ended = w.reduce((n, o) => n + o.ended, 0);
    return ended ? round(w.reduce((n, o) => n + o.succeeded, 0) / ended, 4) : null;
  };
  const base = prior.map(success).filter((n): n is number => n != null);
  const own = outcomes.filter((o) => o.role !== "reviewer"), total = own.reduce((n, o) => n + o.runs, 0), built = outcomes.reduce((n, o) => n + (o.built ?? 0), 0);
  const rates = {
    success: success(outcomes), baseline: base.length ? round(base.reduce((x, y) => x + y, 0) / base.length, 4) : null,
    firstPass: built ? round(outcomes.reduce((n, o) => n + (o.firstPass ?? 0), 0) / built, 4) : null,
    local: total ? round(own.filter((o) => o.model === "gpt-oss-20b").reduce((n, o) => n + o.runs, 0) / total, 4) : null,
  };
  const span = now - since, hours = roles.reduce((n, r) => n + r.hours, 0);
  return {
    live: roles.reduce((n, r) => n + r.live, 0), workers: roles[0].live, cap,
    mean: span ? round((hours * HOUR) / span, 1) : 0, peak,
    outcomes, rates,
    roles,
    points,
  };
}

/** `project` names one repo: then only its runs, Asks and flakes count. */
/** What `speed` reads: the Asks and the director's decisions, the store's lists and history at origin/main, and the flakes. A baseline reads them once for all its spans. */
export interface Inputs { asks: AskSpan[]; decisions: { at: string; ref: string; outcome?: string }[]; head: string; lists: ReturnType<typeof reader>; filed: Filed; flakes: ReturnType<typeof flakes> }
export function inputs(): Inputs {
  const head = originMain(itemsDir());
  return { asks: askHistory(), decisions: decisions<{ at: string; ref: string; outcome?: string }>(), head, lists: reader({ fetch: false, rev: head || undefined }), filed: filed(itemsDir(), head), flakes: flakes() };
}

export function speed(window: Window, now = new Date(), fit: Fit | null = null, project?: string, inp = inputs()): Speed {
  const b = buckets(window, now.getTime()), n = b.starts.length, since = new Date(b.since);
  const times: Record<string, number[]> = { land: [], intake: [] };
  const checks = new Map<string, number[]>();
  const agents: { name: string; state: string; model: string; tests: number | null; cost: number; took: number }[] = [];
  const models = new Map<string, number[]>();

  const { lists } = inp;
  const entries = allRuns().filter((e) => repoIn(e.run.repo, project));
  const all = entries.map((x) => x.run);
  const landed: Run[] = [];
  for (const r of all) {
    const t0 = Date.parse(r.started), t1 = Date.parse(r.ended ?? "");
    if (!(t0 >= since.getTime()) || t0 > now.getTime() || !(t1 >= t0) || t1 - t0 > MAX_RUN) continue;
    const secs = (t1 - t0) / 1000;
    const kind = isAgentRun(r.role) ? "agent" : r.role;
    if (kind in times) times[kind].push(secs);
    for (const c of r.checks ?? []) {
      if (!checks.has(c.name)) checks.set(c.name, []);
      checks.get(c.name)!.push(c.seconds);
    }
    if (kind === "land" && r.state === "landed") landed.push(r);
    if (kind !== "agent") continue;
    const model = r.model || "unset";
    if (!models.has(model)) models.set(model, []);
    models.get(model)!.push(secs);
    agents.push({ name: r.name, state: r.state, model, tests: (r.checks ?? []).find((c) => isTests(c.name))?.seconds ?? null, cost: round(r.cost ?? 0, 2), took: round(secs) });
  }
  // A fix round is a worker run of the issue that a failed check or the reviewer sent back (`failed` set).
  const rounds = new Map<string, number>();
  for (const r of all) {
    if (!isAgentRun(r.role)) continue;
    if (r.failed) rounds.set(r.job, (rounds.get(r.job) ?? 0) + 1);
  }
  // First pass reads the whole fix-round rule, as the worker rows do; `fixRounds` keeps the count of `failed` runs.
  const roundJobs = fixRoundJobs(entries);
  // Landed issues: a land run of an issue with no number all share the one key "none". An issue's fix rounds are the most any of its landing runs' jobs needed.
  const landedBy = new Map<string, Run[]>();
  for (const r of landed) {
    const k = goalOf(r) ?? "none";
    landedBy.set(k, [...(landedBy.get(k) ?? []), r]);
  }
  const issuesLanded = landedBy.size;
  const perIssue = [...landedBy.values()];
  const fixes = perIssue.map((rs) => Math.max(...rs.map((r) => rounds.get(r.job) ?? 0)));
  const issues: Speed["issues"] = {
    landed: issuesLanded,
    firstPass: issuesLanded ? round(perIssue.filter((rs) => rs.every((r) => !roundJobs.has(r.job))).length / issuesLanded, 4) : null,
    fixRounds: quantile(fixes, 0.5),
    week: null,
    usage: [],
  };
  if (fit) {
    const weekOf = new Map<string, number>();
    const keyOf = goalOf;
    for (const r of all) if (isAgentRun(r.role) && keyOf(r)) weekOf.set(keyOf(r)!, (weekOf.get(keyOf(r)!) ?? 0) + (runShare(fit, r)?.pct ?? 0));
    const keys = [...new Set(landed.map(keyOf).filter((k) => k !== undefined))];
    const per = keys.map((g) => weekOf.get(g) ?? 0);
    const nRuns = new Map<string, number>();
    for (const r of all) if (isAgentRun(r.role) && keyOf(r)) nRuns.set(keyOf(r)!, (nRuns.get(keyOf(r)!) ?? 0) + 1);
    issues.usage = keys.map((g) => {
      const [repo, n] = splitId(g);
      return { goal: g, href: issueHref(`${repo}-${n}`), week: round(weekOf.get(g) ?? 0, 2), runs: nRuns.get(g) ?? 0 };
    }).sort((a, b) => b.week - a.week).slice(0, 8);
    issues.week = per.length ? round(quantile(per, 0.5)!, 2) : null;
  }
  const statusOf = (ref: string): string | undefined => {
    const [repo, n] = splitId(ref);
    const item = repo ? lists.item(repo, n) : undefined;
    if (item) return status(item);
    // An issue that is not in a readable list left the store.
    return repo && lists.list(repo) ? GONE : undefined;
  };
  const cls = classify(entries.map(activeEnd), statusOf, since.getTime(), now.getTime(), fit);
  const stages = { rows: stageRows({ runs: entries }, since.getTime(), now.getTime()) };
  for (const t of [...cls.classes.flatMap((c) => c.top), ...issues.usage]) {
    const [repo, n] = splitId(t.goal);
    const item = lists.item(repo, n);
    t.title = item?.title;
    // The link would be a 404 for an issue that left the store.
    if (!item && lists.list(repo)) delete t.href;
  }
  const ended = phaseTimes(all, inp.filed, since.getTime(), now.getTime());
  const med = (xs: { at: number; secs: number }[], i: number, q = 0.5) => {
    const inBucket = xs.filter((x) => b.slotOf(x.at) === i).map((x) => x.secs);
    return inBucket.length ? round(quantile(inBucket, q)!) : null;
  };
  const recent = inp.flakes.filter((f) => Date.parse(f.at) >= since.getTime() && repoIn(f.repo, project));
  const started = Array.from({ length: n }, () => 0);
  const costs = Array.from({ length: n }, () => ({} as Record<string, number>));
  const tokens = Array.from({ length: n }, () => ({} as Record<string, number>));
  for (const e of entries) {
    const t = Date.parse(e.run.started);
    if (t >= since.getTime() && t < now.getTime()) started[b.slotOf(t)]++;
    if (!isAgentRun(e.run.role) || !(t >= since.getTime() && t < now.getTime())) continue;
    const spent = costs[b.slotOf(t)], model = e.run.model || "unset";
    spent[model] = round((spent[model] ?? 0) + (e.run.cost ?? 0), 4);
    const used = tokens[b.slotOf(t)];
    used[model] = (used[model] ?? 0) + (e.run.tokens ?? 0);
  }
  const filings = readEvents(since.getTime()).filter((e) => e.action === "filed" && Date.parse(e.time) <= now.getTime() && eventIn(e.object, project, e.project));
  // The filer is named in the subject only from NAMED_FILER on; before that the issue's source decides.
  let workers: Set<number> | undefined;
  const followup = (e: EventRow) => {
    if (Date.parse(e.time) >= NAMED_FILER) return FOLLOWUPS.includes(e.subject);
    const n = numOf(e.object);
    return n !== undefined && (workers ??= workerIssues()).has(n);
  };
  return {
    window,
    done: issuesLanded,
    kinds: Object.fromEntries(KINDS.map((k) => [k, stat(times[k])])) as Speed["kinds"],
    phases: Object.fromEntries(PHASE_KEYS.map((k) => [k, phaseStat(ended[k].map((x) => x.secs))])) as Speed["phases"],
    asks: asksOf(inp, project, since.getTime(), now.getTime()),
    checks: [...checks].map(([name, xs]) => ({ name, ...stat(xs) })).sort((a, b) => a.name.localeCompare(b.name)),
    buckets: b.starts.map((at, i) => ({ at: new Date(at).toISOString(), runs: started[i], cost: costs[i], tokens: tokens[i], p90: Object.fromEntries(PHASE_KEYS.map((k) => [k, med(ended[k], i, 0.9)])), ...Object.fromEntries(PHASE_KEYS.map((k) => [k, med(ended[k], i)])) }) as Speed["buckets"][number]),
    times: ended.issues,
    active: activeIssues(all, inp.filed, b, now.getTime(), (k) => inProject(k, project) && statusOf(k) === "open"),
    slowest: agents.sort((a, b) => b.took - a.took).slice(0, 6),
    stages,
    models: [...models].map(([model, xs]) => ({ model, count: xs.length, p50: round(quantile(xs, 0.5)!) })).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model)),
    issues,
    classes: cls.classes,
    notCounted: cls.notCounted,
    lost: cls.lost,
    agents: agentStats(entries, since.getTime(), now.getTime(), BUCKETS[window].fine, LIVE_CAP(), undefined, Array.from({ length: BASELINE[window].n }, (_, i): [number, number] => [since.getTime() - (i + 1) * WINDOWS[window], now.getTime() - (i + 1) * WINDOWS[window]])),
    filed: { followups: filings.filter(followup).length, all: filings.length },
    flaky: recent.length,
    flakes: [...Map.groupBy(recent.flatMap(flakeNames), (f) => f.name)].map(([name, xs]) => ({ name, count: xs.length })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

/** The number of an issue, from its key or its old `<repo>-<n>` ID. */
const numOf = (s: string): number | undefined => parseKey(s)?.n ?? parseId(s)?.n;

function asksOf(inp: Inputs, project: string | undefined, since: number, now: number): Speed["asks"] {
  const asks = inp.asks.filter((a) => inProject(a.issue, project) && Date.parse(a.set) >= since && Date.parse(a.set) <= now);
  const escalated = (a: AskSpan) => inp.decisions.some((d) => d.outcome === "escalated" && numOf(d.ref) === numOf(a.issue) && d.at >= a.set && (!a.cleared || d.at < a.cleared));
  return { count: asks.length, manual: asks.filter(escalated).length };
}

/** What a Status card shows for one span; a field is null when the span has no data for it. */
export interface Figures { lost: number | null; hours: number | null; leadP50: number | null; leadP90: number | null; asks: number | null; landed: number | null; firstPass: number | null; followups: number | null; filed: number | null }
/** The trend baseline of a window: `prev` is the span just before, `base` the average the trend compares with, `basis` says how it is taken. */
export interface Baseline { prev: Figures; base: Figures; basis: string }

export function figures(s: Speed): Figures {
  const total = s.classes.reduce((a, c) => a + c.hours, 0), any = total > 0 || s.done > 0;
  return {
    lost: total > 0 ? s.lost.share : null,
    hours: total > 0 ? s.lost.hours : null,
    leadP50: s.phases.lead.count ? s.phases.lead.p50 : null,
    leadP90: s.phases.lead.count ? s.phases.lead.p90 : null,
    asks: s.asks.count,
    landed: any ? s.done : null,
    firstPass: s.issues.firstPass,
    followups: s.filed.followups,
    filed: s.filed.all,
  };
}

/** Each field's mean over the spans that have data for it; null when none has. */
export function averageFigures(xs: Figures[]): Figures {
  const out = {} as Record<keyof Figures, number | null>;
  for (const k of Object.keys(xs[0] ?? figures0()) as (keyof Figures)[]) {
    const v = xs.map((x) => x[k]).filter((n): n is number => n !== null);
    out[k] = v.length ? round(v.reduce((a, b) => a + b, 0) / v.length, 4) : null;
  }
  return out;
}
const figures0 = (): Figures => ({ lost: null, hours: null, leadP50: null, leadP90: null, asks: null, landed: null, firstPass: null, followups: null, filed: null });

// Hour: the average of the last 12 hours; day: of the last 7 days; week and month: the span before.
const BASELINE: Record<Window, { n: number; avg: boolean; basis: string; prev: string }> = {
  hour: { n: 12, avg: true, basis: "average of the last 12 hours with data", prev: "the hour before" },
  day: { n: 7, avg: true, basis: "average of the last 7 days with data", prev: "the day before" },
  week: { n: 1, avg: false, basis: "the previous 7 days", prev: "the previous 7 days" },
  month: { n: 1, avg: false, basis: "the previous 30 days", prev: "the previous 30 days" },
};

/** The baseline in one read of its inputs: each span is computed from the same records and store. */
export function baseline(window: Window, now = new Date(), fit: Fit | null = null, project?: string, inp = inputs()): Baseline {
  const b = BASELINE[window];
  const spans = Array.from({ length: b.n }, (_, i) => figures(speed(window, new Date(now.getTime() - (i + 1) * WINDOWS[window]), fit, project, inp)));
  return { prev: spans[0], base: b.avg ? averageFigures(spans) : spans[0], basis: b.basis };
}

export const routes: Routes = {
  "GET /api/flow": async (_req, _params, url) => {
    const sc = scopeOf(url);
    if (sc instanceof Response) return sc;
    // `project`: only the runs and issues of that repo count.
    const w = sc.window as Window, project = sc.project ?? undefined;
    const fit = await currentFit(), inp = inputs(), now = new Date(), d = speed(w, now, fit, project, inp);
    // `baseline=1`: the trend baseline of the window in the same answer, so the Status page makes one request.
    // `figures`: what the Status cards show for the window, the same function the baseline's spans use.
    const out = { ...d, figures: figures(d) };
    if (url.searchParams.get("baseline") !== "1") return Response.json(out);
    return Response.json({ ...out, baseline: baseline(w, now, fit, project, inp) });
  },
};
