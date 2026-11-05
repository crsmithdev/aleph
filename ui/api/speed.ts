/**
 * `GET /api/speed?window=hour|day|week|month` (default week)[&project=<repo>]: how fast the factory's runs are, read from the run folders'
 * state.json (no Langfuse). Runs with a `started` and an `ended` count; one longer than 4 hours
 * is a broken clock and is skipped. Hour is the last 60 minutes in 1-minute buckets, day the last 24 hours in hourly ones, week and
 * month the last 7 and 30 local days (today included) in daily ones. A percentile is the nearest rank.
 * The phases also read when each issue file first came into the work store's git history.
 */
import { existsSync } from "node:fs";
import { flakeNames, flakes } from "../../jobs/lib/gates/factory-status.ts";
import { git } from "../../jobs/lib/infra/git.ts";
import { all as allRecords } from "../../jobs/lib/records/record.ts";
import { allRuns, isAgentRun, isBuild, onOf, type Entry, type Run } from "../../jobs/lib/records/ledger.ts";
import { activeEnd, isLive, isStarting } from "../../jobs/lib/infra/process.ts";
import { causeOf, type Cause } from "../../jobs/lib/records/outcome.ts";
import type { Routes } from "../server.ts";
import { staleSync } from "../stale.ts";
import { reader, storeDir, uiFetchTtl } from "../../issues/lib/store.ts";
import { status } from "../../issues/lib/todo.ts";
import { currentFit, share, type Fit } from "../usage.ts";
import { LIVE_CAP } from "../../jobs/lib/infra/settings.ts";

const HOUR = 3600_000, DAY = 24 * HOUR;
/** The issue number of a run, from `on` or old `todo`; a goal run "860.1" reads as 860. Undefined when the run has none. */
function issueOf(r: Run): number | undefined {
  const o = onOf(r);
  return o === undefined ? undefined : Math.trunc(Number(o));
}

export const MAX_RUN = 4 * HOUR;
export const KINDS = ["agent", "land", "intake", "triage", "plan"] as const;

export interface Pct { count: number; p50: number; p90: number }
/** A phase's `hist` counts times in 7 bins: under 1m, 1-5m, 5-15m, 15-30m, 30m-1h, 1-4h, over 4h (an edge falls in the upper bin). `worst` is the longest time in seconds. */
export interface PhaseStat extends Pct { hist: number[]; worst: number }
export type Phase = "intake" | "queue" | "implement" | "land" | "lead";
const PHASE_KEYS: Phase[] = ["intake", "queue", "implement", "land", "lead"];
/** One issue's seconds per phase (null when the phase did not end in the window). `outcome` is "landed" once a land run landed it, else "unlanded". */
/** `filed` is the issue's filing time in ms, or null when the store has none. */
export type IssueTimes = { id: string; href: string; outcome: "landed" | "unlanded"; filed: number | null } & Record<Phase, number | null>;
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
  /** hour: 60 buckets of 1 minute; day: 24 hourly; week: 7 and month: 30 local days; `at` is its local start as an ISO string; `cost` is the recorded cost of the agent runs that started in it, per model. */
  buckets: ({ at: string; runs: number; cost: Record<string, number>; p90: Record<Phase, number | null> } & Record<Phase, number | null>)[];
  /** Every issue with a phase that ended in the window. */
  times: IssueTimes[];
  slowest: { name: string; condition: string; model: string; tests: number | null; cost: number; took: number }[];
  models: { model: string; count: number; p50: number }[];
  flaky: number;
  /** The reruns by check, most first. */
  flakes: { name: string; count: number }[];
  /** Landed issues (one per issue that landed in the window) and what they cost to get there. */
  issues: {
    landed: number;
    /** Share of landed issues with 0 fix rounds, 0 to 1; null with none landed. */
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
  hasWeek: boolean;
  agents: Agents;
}

/** One role of the factory's agents. `live` is the runs live now; `runs` started in the window; `hours` is their agent time inside it. A reviewer works inside a held run and records no times, so it has only `runs`: `live`, `hours` and `p50` are null. */
export interface AgentRole { key: AgentKey | "reviewer"; name: string; live: number | null; runs: number; hours: number | null; p50: number | null; models: string[] }
/**
 * One role and model of the window with how its runs ended. `rate` is succeeded over the runs that ended (null with none); `baseline` is the same rate over the baseline's spans (null with no data). `cost` is the recorded cost of the runs (a reviewer records none, so 0).
 * Worker rows add `built` (succeeded runs of a landed job), `firstPass` (those with no fix round) and `reviewPass` (the reviewer's pass share of the verdicts on their builds, null with none); Reviewer rows add `pass` and `fail`.
 */
export interface OutcomeRow {
  role: AgentKey | "reviewer"; model: string; runs: number; succeeded: number; failed: number; stuck: number;
  rate: number | null; p50: number | null; cost: number; baseline: number | null;
  firstPass?: number; built?: number; reviewPass?: number | null; pass?: number; fail?: number;
}
/** The agents over the window. `workers` and `cap` are the runs the live cap counts, now. `mean` and `peak` count all timed roles, and each point holds each role's mean live in its step. */
export interface Agents {
  live: number; workers: number; cap: number; mean: number; peak: number;
  roles: AgentRole[];
  outcomes: OutcomeRow[];
  /** Over the window, 0 to 1, null with no data: `success` is succeeded over ended runs of all roles but the reviewer, `baseline` the same over the baseline's spans, `firstPass` the share of landed worker builds with no fix round, `local` the share of runs on gpt-oss-20b. */
  rates: { success: number | null; baseline: number | null; firstPass: number | null; local: number | null };
  points: ({ at: string } & Partial<Record<AgentKey, number>>)[];
}

/** What `classify`'s `statusOf` returns for an issue that is no longer in the store: closed issues left it, so one with no landing was closed without landing. */
export const GONE = "gone";
export const CLASSES = ["landed", "fixed", "nothing", "restarted", "dropped"] as const;
export type Class = (typeof CLASSES)[number];
export const CLASS_NAME: Record<Class, string> = { landed: "Landed", fixed: "Fixed", nothing: "Late", restarted: "Restarted", dropped: "Dropped" };
export const CLASS_TEXT: Record<Class, string> = {
  landed: "The run whose work landed on main.",
  fixed: "A run of the landing job before the run that landed: a fix round the issue needed.",
  nothing: "A run that started after its issue had landed, or found the work already on main.",
  restarted: "A run that a later start replaced: another job of the same issue landed, or the issue started 4 or more times inside an hour.",
  dropped: "A run of an issue that was then dropped or closed without landing.",
};
/** The breakdown's name of each stated cause that has one. */
const CAUSE_NAME: Partial<Record<Cause, string>> = {
  reviewer: "Reviewer sent back", check: "Checks failed",
  "time-box": "Stalled or timed out", stalled: "Stalled or timed out",
  "no-commit": "No commit", conflict: "Passed, not landed",
};

/** What each cause in the breakdown means. */
const CAUSE_TEXT: Record<string, string> = {
  "First run of the job": "The job's first run landed, with no fix round.",
  "After fix rounds": "The job landed on a later run, after one or more fix rounds.",
  "Issue had landed": "The run started after its issue had landed.",
  "Work on main from another issue": "The run found the work already on main, from another issue.",
  "Restart loop": "The issue started 4 or more times inside an hour.",
  "Needed Chris": "The run waited for Chris, or Chris restarted or dropped it by hand.",
  "Reviewer sent back": "The reviewer did not pass the run's work.",
  "Checks failed": "The run's checks failed or timed out.",
  "Stalled or timed out": "The run stalled, passed its time box or lost its process.",
  "No commit": "The run ended with no commit.",
  "Passed, not landed": "The run passed its checks, but its work did not land, for example after a land conflict.",
  "Other": "Any other reason, or no reason recorded.",
};

export interface Measure { hours: number; week: number; runs: number }
export interface ClassStat extends Measure {
  key: Class; name: string; text: string; issues: number;
  causes: (Omit<Measure, "week"> & { name: string; text: string })[];
  top: (Omit<Measure, "week"> & { goal: string; title?: string; href?: string; reason: string })[];
}

/** The nearest-rank percentile `p` (0..1) of `xs`; 0 for none. */
export function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
}
const round = (n: number, d = 0) => { const k = 10 ** d; return Math.round(n * k) / k; };
const stat = (xs: number[]): Pct => ({ count: xs.length, p50: round(pct(xs, 0.5)), p90: round(pct(xs, 0.9)) });
const HIST_EDGES = [60, 300, 900, 1800, 3600, 14400];
export const histOf = (xs: number[]): number[] => {
  const h = new Array(HIST_EDGES.length + 1).fill(0);
  for (const x of xs) h[HIST_EDGES.filter((e) => x >= e).length]++;
  return h;
};
const phaseStat = (xs: number[]): PhaseStat => ({ ...stat(xs), hist: histOf(xs), worst: xs.length ? round(Math.max(...xs)) : 0 });
const isTests = (name: string) => /^tests?$/.test(name);

export const WINDOWS = ["hour", "day", "week", "month"] as const;
export type Window = (typeof WINDOWS)[number];
const STEP: Record<Window, number> = { hour: 60_000, day: HOUR, week: DAY, month: DAY };
const COUNT: Record<Window, number> = { hour: 60, day: 24, week: 7, month: 30 };

const HOUR_MS = HOUR;
const passedState = (st: string) => st === "passed" || st === "landed" || st === "done";

/** Class every agent run of the window by what its work came to; see the parent goal's Classes list. */
export function classify(runs: Run[], statusOf: (ref: string) => string | undefined, since: number, now: number, fit: Fit | null): { classes: ClassStat[]; notCounted: { runs: number; issues: number; hours: number }; lost: { hours: number; share: number }; total: number } {
  const keyOf = (r: Run) => `${r.repo}-${onOf(r)}`;
  const t0 = (r: Run) => Date.parse(r.started);
  const agentsOf = new Map<string, Run[]>(), landsOf = new Map<string, Run[]>(), firstStart = new Map<string, number>();
  for (const r of runs) {
    const t = t0(r);
    if (Number.isFinite(t)) firstStart.set(r.job, Math.min(firstStart.get(r.job) ?? Infinity, t));
    if (issueOf(r) === undefined) continue;
    const m = isAgentRun(r.kind) ? agentsOf : r.kind === "land" && r.condition === "landed" ? landsOf : null;
    if (!m) continue;
    const g = keyOf(r);
    if (!m.has(g)) m.set(g, []);
    m.get(g)!.push(r);
  }
  // The landing runs of each goal, and when its last land ended.
  const landing = new Map<string, Set<Run>>(), lastLand = new Map<string, number>();
  for (const [g, lands] of landsOf) {
    for (const l of lands) {
      const end = Date.parse(l.ended ?? "");
      if (Number.isFinite(end)) lastLand.set(g, Math.max(lastLand.get(g) ?? -Infinity, end));
      // A held run lands from `awaiting`, so it counts for the land of its own job.
      const cand = (agentsOf.get(g) ?? []).filter((a) => (passedState(a.condition) || (a.condition === "awaiting" && a.job === l.job)) && t0(a) < end).sort((a, b) => t0(b) - t0(a))[0];
      if (cand) { if (!landing.has(g)) landing.set(g, new Set()); landing.get(g)!.add(cand); }
    }
  }
  type Row = { run: Run; issue: string; hours: number; week: number; cause: string };
  const rows = new Map<Class, Row[]>(CLASSES.map((c) => [c, []]));
  const skipped: Row[] = [];
  for (const r of runs) {
    if (!isAgentRun(r.kind) || issueOf(r) === undefined) continue;
    const a = t0(r), b = Date.parse(r.ended ?? "");
    if (!(a >= since) || a > now || !(b >= a) || b - a > MAX_RUN) continue;
    const g = keyOf(r), reason = r.reason ?? "";
    const row: Row = { run: r, issue: g, hours: (b - a) / 1000 / 3600, week: share(fit, r.cost, r.model)?.pct ?? 0, cause: "" };
    const lands = landing.get(g) ?? new Set<Run>();
    const mine = (agentsOf.get(g) ?? []);
    const startsBefore = mine.filter((o) => a - HOUR_MS <= t0(o) && t0(o) < a).length;
    const afterLand = lastLand.has(g) && a > lastLand.get(g)!;
    let cls: Class | null = null;
    if (lands.has(r)) cls = "landed";
    else if ([...lands].some((l) => l.job === r.job && t0(l) > a)) cls = "fixed";
    else if (afterLand || r.fate === "already-met" || r.fate === "duplicate") cls = "nothing";
    else if (startsBefore >= 3 || [...lands].some((l) => l.job !== r.job && (firstStart.get(l.job) ?? Infinity) > (firstStart.get(r.job) ?? Infinity))) cls = "restarted";
    else if (["done", "dropped", GONE].includes(statusOf(g) ?? "")) cls = "dropped";
    if (!cls) { skipped.push(row); continue; }
    const stated = CAUSE_NAME[causeOf(r) ?? "other"];
    if (cls === "landed") row.cause = mine.some((o) => o.job === r.job && t0(o) < a) ? "After fix rounds" : "First run of the job";
    else if (cls === "nothing") row.cause = afterLand ? "Issue had landed" : "Work on main from another issue";
    else if (cls === "restarted" && startsBefore >= 3) row.cause = "Restart loop";
    else if (r.condition === "awaiting") row.cause = "Needed Chris";
    else if (r.failed === "review") row.cause = "Reviewer sent back";
    else if (r.failed) row.cause = "Checks failed";
    else if (stated) row.cause = stated;
    // A drop with no stated cause has only its free prose, so this guess stays for the page's breakdown.
    else if (/reviewer/i.test(reason)) row.cause = "Reviewer sent back";
    else if (/ failed$/.test(reason)) row.cause = "Checks failed";
    else if (/time box|stalled|timed out|lost/i.test(reason)) row.cause = "Stalled or timed out";
    else if (/no commit/i.test(reason)) row.cause = "No commit";
    else if (r.fate === "by-hand") row.cause = "Needed Chris";
    else if (passedState(r.condition) || /conflict/i.test(reason)) row.cause = "Passed, not landed";
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
      const m = issue.lastIndexOf("-");
      return { issue, sum: sum(x), reason: clip((last.run.reason ?? "").replace(/^agent run \S+:\s*/, "").trim(), 140), href: `#/issues/${encodeURIComponent(issue.slice(0, m))}/${issue.slice(m + 1)}` };
    }).sort((a, b) => b.sum.hours - a.sum.hours).slice(0, 8).map((t) => ({ goal: t.issue, href: t.href, reason: t.reason, ...noWeek(rd(t.sum)) }));
    return { key, name: CLASS_NAME[key], text: CLASS_TEXT[key], ...rd(sum(rs)), issues: new Set(rs.map((r) => r.issue)).size, causes, top };
  });
  const raw = CLASSES.map((c) => sum(rows.get(c)!).hours);
  const total = raw.reduce((x, y) => x + y, 0), lostH = raw.slice(2).reduce((x, y) => x + y, 0);
  return {
    classes,
    notCounted: { runs: skipped.length, issues: new Set(skipped.map((r) => r.issue)).size, hours: round(skipped.reduce((x, y) => x + y.hours, 0), 2) },
    lost: { hours: round(lostH, 2), share: total ? round(lostH / total, 4) : 0 },
    total: round(total, 2),
  };
}

// Bulk commits add files whose work is older: they do not say when an issue or a goal was created.
const BULK = /^(migrate:|todo: move every )/;
const FILED = /^([^/]+)\/backlog\/tasks\/\1-(\d+)((?:\.\d+)*)\.md$/;
export interface Filed { issue: Map<string, number | null> }
let filedAt: Filed & { head: string } = { head: "", issue: new Map() };

/** When each issue came into the store, in ms. Null for one that a bulk commit added. Each read adds only the commits since the last. */
export function filed(dir = storeDir()): Filed {
  const rev = existsSync(dir) ? git(dir, "rev-parse", "origin/main") : null;
  if (!rev?.ok) return { issue: new Map() };
  const head = rev.out;
  if (head === filedAt.head) return filedAt;
  const known = filedAt.head && git(dir, "merge-base", "--is-ancestor", filedAt.head, head).ok;
  const next = known ? filedAt : { head, issue: new Map() };
  const log = git(dir, "log", "--reverse", "--diff-filter=A", "--no-renames", "--name-only", "--format=@%ct %s", known ? `${filedAt.head}..${head}` : head).out;
  let at: number | null = null;
  for (const line of log.split("\n")) {
    if (line.startsWith("@")) {
      const space = line.indexOf(" ");
      at = BULK.test(line.slice(space + 1)) ? null : Number(line.slice(1, space)) * 1000;
      continue;
    }
    const m = line.match(FILED);
    if (!m || m[3]) continue;
    const key = `${m[1]}-${m[2]}`;
    // A file added again keeps the first time.
    if (!next.issue.has(key)) next.issue.set(key, at);
  }
  filedAt = { ...next, head };
  return filedAt;
}

/** The phases of the work over `runs` and the store's history, for what ended in `since`..`now`: each one's end time and seconds. */
export function phaseTimes(runs: Run[], { issue }: Filed, since: number, now: number): Record<Phase, { at: number; secs: number }[]> & { issues: IssueTimes[] } {
  const per = new Map<string, IssueTimes>();
  const note = (key: string | undefined, k: Phase, secs: number) => {
    if (!key) return;
    const m = key.lastIndexOf("-");
    if (!per.has(key)) per.set(key, { id: key, href: `#/issues/${encodeURIComponent(key.slice(0, m))}/${key.slice(m + 1)}`, outcome: "unlanded", filed: issue.get(key) ?? null, intake: null, queue: null, implement: null, land: null, lead: null });
    per.get(key)![k] = secs;
  };
  const inWindow = (t: number) => t >= since && t <= now;
  const intake: { at: number; secs: number }[] = [], queue: { at: number; secs: number }[] = [], implement: { at: number; secs: number }[] = [], land: { at: number; secs: number }[] = [], lead: { at: number; secs: number }[] = [];
  const jobs = new Map<string, Run[]>();
  for (const r of runs) jobs.set(r.job, [...(jobs.get(r.job) ?? []), r]);
  for (const rs of jobs.values()) {
    const agents = rs.filter((r) => { const a = Date.parse(r.started), b = Date.parse(r.ended ?? ""); return isAgentRun(r.kind) && b >= a && b - a <= MAX_RUN; });
    const landed = Math.min(...rs.filter((r) => r.kind === "land" && (r.condition === "landed" || r.condition === "done")).map((r) => Date.parse(r.ended ?? "")).filter(Number.isFinite));
    // A job can run again after it lands; what finished the work is the last finish before the land.
    const ends = agents.filter((r) => passedState(r.condition) || r.condition === "awaiting").map((r) => Date.parse(r.ended!)).filter((t) => t <= landed);
    if (!ends.length) continue;
    const owner = rs.find((r) => issueOf(r) !== undefined), key = owner && `${owner.repo}-${issueOf(owner)}`;
    const finished = Math.max(...ends), started = Math.min(...agents.map((r) => Date.parse(r.started)));
    if (inWindow(finished)) { implement.push({ at: finished, secs: (finished - started) / 1000 }); note(key, "implement", (finished - started) / 1000); }
    if (inWindow(landed)) { land.push({ at: landed, secs: (landed - finished) / 1000 }); note(key, "land", (landed - finished) / 1000); }
  }
  // Queue and Lead are per issue. A run older than its filing (a file added again) has no such span.
  const firstStart = new Map<string, number>(), lastLand = new Map<string, number>(), triaged = new Map<string, number>();
  for (const r of runs) {
    const n = issueOf(r);
    if (n === undefined) continue;
    const key = `${r.repo}-${n}`;
    if (isAgentRun(r.kind)) {
      const a = Date.parse(r.started);
      if (a < (firstStart.get(key) ?? Infinity)) firstStart.set(key, a);
    } else if (r.kind === "intake" || r.kind === "triage") {
      const b = Date.parse(r.ended ?? "");
      if (b < (triaged.get(key) ?? Infinity)) triaged.set(key, b);
    } else if (r.kind === "land" && (r.condition === "landed" || r.condition === "done")) {
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

// The roles with their run kind. A land and a recheck run only checks and git, so they are not agents.
export const AGENT_ROLES = [["worker", "Worker", "build"], ["intake", "Intake", "intake"], ["triage", "Triage", "triage"], ["planner", "Planner", "plan"], ["firefighter", "Firefighter", "firefighter"], ["director", "Director", "director"]] as const;
export type AgentKey = (typeof AGENT_ROLES)[number][0];

/** "claude-opus-5-5" as "opus"; "sonnet" stays. */
const modelName = (m: string) => /^claude-([a-z]+)-/.exec(m)?.[1] ?? m;

/**
 * The rows of OutcomeRow for the runs that started in `since`..`now`, without `baseline`.
 * What "succeeded" means, from what each role's run records:
 * - Worker (build, older "agent"): the run ends `passed`, `awaiting` or `landed`: its checks passed and the reviewer did not send it back. A reviewer or check that sent it back sets `failed`: that is a fail, not stuck.
 * - Intake, Triage, Planner, Firefighter, Director: the run ends `passed` or `done`: the role applied its route or wrote its answer. These roles set no `failed`.
 * - Reviewer: it runs inside the build run and records no run, model or cost. Its verdict is read from the build: a succeeded build is a pass; `failed: "review"` (or an older `review.call` of `back`) is a fail; `review.call` of `land` is a pass. A reviewer that gave no verdict counts as neither. Its model is not recorded, so its row has the model "unset".
 * Stuck is a run that ended `stuck` with no `failed`, or with the cause `time-box` or `stalled`. Failed is any other end that is not running. A running run counts in `runs` only.
 */
function outcomeRows(entries: Entry[], since: number, now: number): OutcomeRow[] {
  const order = (k: string) => AGENT_ROLES.findIndex(([r]) => r === k) + 1 || AGENT_ROLES.length + 1;
  const rows = new Map<string, OutcomeRow & { secs: number[]; verdicts: number; landed: number }>();
  const row = (role: OutcomeRow["role"], model: string) => {
    const k = `${role}\0${model}`;
    if (!rows.has(k)) rows.set(k, { role, model, runs: 0, succeeded: 0, failed: 0, stuck: 0, rate: null, p50: null, cost: 0, baseline: null, secs: [], verdicts: 0, landed: 0 });
    return rows.get(k)!;
  };
  const runs = entries.map((e) => e.run as Run);
  // A job landed when a land run of it landed; a job had a fix round when one of its runs was sent back.
  const landedJobs = new Set(runs.filter((r) => r.kind === "land" && r.condition === "landed").map((r) => r.job));
  const roundJobs = new Set(runs.filter((r) => r.failed).map((r) => r.job));
  for (const r of runs) {
    const a = Date.parse(r.started);
    if (!(a >= since && a < now)) continue;
    const ok = passedState(r.condition) || r.condition === "awaiting";
    const cause = causeOf(r);
    const stuck = !ok && r.condition !== "running" && (cause === "time-box" || cause === "stalled" || (r.condition === "stuck" && !r.failed));
    const fail = !ok && !stuck && r.condition !== "running";
    const build = isBuild(r.kind) || r.kind === "agent";
    const role = build ? "worker" : AGENT_ROLES.find(([, , kind]) => kind === r.kind)?.[0];
    if (role) {
      const w = row(role, r.model || "unset");
      w.runs++; w.cost += r.cost ?? 0;
      if (ok) w.succeeded++; else if (stuck) w.stuck++; else if (fail) w.failed++;
      const b = Date.parse(r.ended ?? "");
      if (b >= a && b - a <= MAX_RUN) w.secs.push((b - a) / 1000);
      if (ok && build && landedJobs.has(r.job)) {
        w.built = (w.built ?? 0) + 1;
        if (!roundJobs.has(r.job)) w.firstPass = (w.firstPass ?? 0) + 1;
      }
    }
    if (build) {
      const back = r.failed === "review" || r.review?.call === "back", land = ok || r.review?.call === "land";
      if (back || land) {
        const v = row("reviewer", "unset");
        v.runs++;
        if (back) { v.fail = (v.fail ?? 0) + 1; v.failed++; } else { v.pass = (v.pass ?? 0) + 1; v.succeeded++; }
        const w = row("worker", r.model || "unset");
        w.verdicts++; w.landed += back ? 0 : 1;
      }
    }
  }
  return [...rows.values()].map(({ secs, verdicts, landed, ...x }) => {
    const ended = x.succeeded + x.failed + x.stuck;
    return {
      ...x, cost: round(x.cost, 2), rate: ended ? round(x.succeeded / ended, 4) : null, p50: secs.length ? round(pct(secs, 0.5)) : null,
      ...(x.role === "worker" ? { firstPass: x.firstPass ?? 0, built: x.built ?? 0, reviewPass: verdicts ? round(landed / verdicts, 4) : null } : {}),
      ...(x.role === "reviewer" ? { pass: x.pass ?? 0, fail: x.fail ?? 0 } : {}),
    };
  }).sort((p, q) => order(p.role) - order(q.role) || q.runs - p.runs || p.model.localeCompare(q.model));
}

/** The agents by role over `since`..`now`. `before` are the baseline's spans, each a [since, now] before the window. A run with the condition running ends at `now` when `alive` says so, and does not count when not. `step` is the width of a point in ms. */
export function agentStats(entries: Entry[], since: number, now: number, step: number, cap: number, alive: (e: Entry) => boolean = (e) => isLive(e.folder) || isStarting(e), before: [number, number][] = []): Agents {
  const length = Math.ceil((now - since) / step);
  const edges: [number, number][] = [];
  const points: Agents["points"] = Array.from({ length }, (_, i) => ({ at: new Date(since + i * step).toISOString() }));
  const roles: AgentRole[] = AGENT_ROLES.map(([key, name, kind]) => {
    let live = 0, ms = 0;
    const times: number[] = [], models = new Map<string, number>();
    let runs = 0;
    for (const e of entries) {
      const r = e.run as Run;
      // Older worker runs have the kind "agent".
      if (r.kind !== kind && !(key === "worker" && r.kind === "agent")) continue;
      const running = r.condition === "running" && alive(e);
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
    return { key, name, live, runs, hours: round(ms / HOUR, 1), p50: times.length ? round(pct(times, 0.5)) : null, models: [...models].sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0])).map(([m]) => m) };
  });
  // An end before a start at the same moment: a run that follows another does not add one.
  edges.sort((x, y) => x[0] - y[0] || x[1] - y[1]);
  let up = 0, peak = 0;
  for (const [, d] of edges) { up += d; if (up > peak) peak = up; }
  for (const p of points) for (const [key] of AGENT_ROLES) if (p[key] !== undefined) p[key] = round(p[key]!, 2);
  const inWindow = entries.map((e) => e.run as Run).filter((r) => (isBuild(r.kind) || r.kind === "agent") && Date.parse(r.started) >= since && Date.parse(r.started) < now);
  const reviews = inWindow.reduce((n, r) => n + (r.review ? 1 : 0), 0);
  // The baseline rate of a role and model: the mean of its rate over the spans that have data, as averageFigures takes it.
  const prior = before.map(([a, b]) => outcomeRows(entries, a, b));
  const outcomes = outcomeRows(entries, since, now).map((o) => {
    const v = prior.map((p) => p.find((x) => x.role === o.role && x.model === o.model)?.rate).filter((n): n is number => n != null);
    return { ...o, baseline: v.length ? round(v.reduce((x, y) => x + y, 0) / v.length, 4) : null };
  });
  const success = (rows: OutcomeRow[]) => {
    const w = rows.filter((o) => o.role !== "reviewer"), ended = w.reduce((n, o) => n + o.succeeded + o.failed + o.stuck, 0);
    return ended ? round(w.reduce((n, o) => n + o.succeeded, 0) / ended, 4) : null;
  };
  const base = prior.map(success).filter((n): n is number => n != null);
  const own = outcomes.filter((o) => o.role !== "reviewer"), total = own.reduce((n, o) => n + o.runs, 0), built = outcomes.reduce((n, o) => n + (o.built ?? 0), 0);
  const rates = {
    success: success(outcomes), baseline: base.length ? round(base.reduce((x, y) => x + y, 0) / base.length, 4) : null,
    firstPass: built ? round(outcomes.reduce((n, o) => n + (o.firstPass ?? 0), 0) / built, 4) : null,
    local: total ? round(own.filter((o) => o.model === "gpt-oss-20b").reduce((n, o) => n + o.runs, 0) / total, 4) : null,
  };
  const span = now - since, hours = roles.reduce((n, r) => n + (r.hours ?? 0), 0);
  return {
    live: roles.reduce((n, r) => n + (r.live ?? 0), 0), workers: roles[0].live ?? 0, cap,
    mean: span ? round((hours * HOUR) / span, 1) : 0, peak,
    outcomes, rates,
    roles: [...roles, { key: "reviewer", name: "Reviewer", live: null, runs: reviews, hours: null, p50: null, models: [] }],
    points,
  };
}

// The width of an agents point: fine enough that a short burst shows.
const AGENT_STEP: Record<Window, number> = { hour: 60_000, day: 15 * 60_000, week: HOUR, month: 6 * HOUR };

/** `project` names one repo: then only its runs, Asks and flakes count. */
export function speed(window: Window, now = new Date(), fit: Fit | null = null, project?: string): Speed {
  const n = COUNT[window];
  const daily = window === "week" || window === "month";
  const stepMs = STEP[window];
  // The first bucket starts at the local midnight (week, month), the full hour (day) or the minute mark (hour), n - 1 steps before the bucket that holds `now`.
  const last = daily ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : new Date(Math.floor(now.getTime() / stepMs) * stepMs);
  const startOf = (i: number) => (daily ? new Date(last.getFullYear(), last.getMonth(), last.getDate() - (n - 1 - i)) : new Date(last.getTime() - (n - 1 - i) * stepMs));
  const since = startOf(0);
  const slot = (t: number): number => (daily ? Math.round((new Date(t).setHours(0, 0, 0, 0) - since.getTime()) / DAY) : Math.floor((t - since.getTime()) / stepMs));
  const times: Record<string, number[]> = { agent: [], land: [], intake: [], triage: [], plan: [] };
  const checks = new Map<string, number[]>();
  const agents: { name: string; condition: string; model: string; tests: number | null; cost: number; took: number }[] = [];
  const models = new Map<string, number[]>();

  const entries = allRuns().filter((e) => !project || e.run.repo === project);
  const all = entries.map((x) => x.run as Run);
  const landed: Run[] = [];
  for (const r of all) {
    const t0 = Date.parse(r.started), t1 = Date.parse(r.ended ?? "");
    if (!(t0 >= since.getTime()) || t0 > now.getTime() || !(t1 >= t0) || t1 - t0 > MAX_RUN) continue;
    const secs = (t1 - t0) / 1000;
    const kind = isAgentRun(r.kind) ? "agent" : r.kind;
    if (kind in times) times[kind].push(secs);
    for (const c of r.checks ?? []) {
      if (!checks.has(c.name)) checks.set(c.name, []);
      checks.get(c.name)!.push(c.seconds);
    }
    if (kind === "land" && r.condition === "landed") landed.push(r);
    if (kind !== "agent") continue;
    const model = r.model || "unset";
    if (!models.has(model)) models.set(model, []);
    models.get(model)!.push(secs);
    agents.push({ name: r.name, condition: r.condition, model, tests: (r.checks ?? []).find((c) => isTests(c.name))?.seconds ?? null, cost: round(r.cost ?? 0, 2), took: round(secs) });
  }
  // A fix round is a worker run of the goal that a failed check or the reviewer sent back (`failed` set).
  const rounds = new Map<string, number>();
  for (const r of all) {
    if (!isAgentRun(r.kind)) continue;
    if (r.failed) rounds.set(r.job, (rounds.get(r.job) ?? 0) + 1);
  }
  // Landed issues: a land run of an issue with no number all share the one key "none". An issue's fix rounds are the most any of its landing runs' jobs needed.
  const landedBy = new Map<string, Run[]>();
  for (const r of landed) {
    const k = issueOf(r) === undefined ? "none" : `${r.repo}-${issueOf(r)}`;
    landedBy.set(k, [...(landedBy.get(k) ?? []), r]);
  }
  const issuesLanded = landedBy.size;
  const fixes = [...landedBy.values()].map((rs) => Math.max(...rs.map((r) => rounds.get(r.job) ?? 0)));
  const issues: Speed["issues"] = {
    landed: issuesLanded,
    firstPass: issuesLanded ? round(fixes.filter((f) => f === 0).length / issuesLanded, 4) : null,
    fixRounds: issuesLanded ? pct(fixes, 0.5) : null,
    week: null,
    usage: [],
  };
  if (fit) {
    const weekOf = new Map<string, number>();
    for (const r of all) if (isAgentRun(r.kind) && issueOf(r) !== undefined) weekOf.set(`${r.repo}-${issueOf(r)}`, (weekOf.get(`${r.repo}-${issueOf(r)}`) ?? 0) + (share(fit, r.cost, r.model)?.pct ?? 0));
    const keys = [...new Set(landed.filter((r) => issueOf(r) !== undefined).map((r) => `${r.repo}-${issueOf(r)}`))];
    const per = keys.map((g) => weekOf.get(g) ?? 0);
    const nRuns = new Map<string, number>();
    for (const r of all) if (isAgentRun(r.kind) && issueOf(r) !== undefined) nRuns.set(`${r.repo}-${issueOf(r)}`, (nRuns.get(`${r.repo}-${issueOf(r)}`) ?? 0) + 1);
    issues.usage = keys.map((g) => {
      const m = g.lastIndexOf("-");
      return { goal: g, href: `#/issues/${encodeURIComponent(g.slice(0, m))}/${g.slice(m + 1)}`, week: round(weekOf.get(g) ?? 0, 2), runs: nRuns.get(g) ?? 0 };
    }).sort((a, b) => b.week - a.week).slice(0, 8);
    issues.week = per.length ? round(pct(per, 0.5), 2) : null;
  }
  const lists = reader({ fetch: false });
  const statusOf = (ref: string): string | undefined => {
    const m = ref.lastIndexOf("-");
    const item = m < 0 ? undefined : lists.item(ref.slice(0, m), ref.slice(m + 1));
    if (item) return status(item);
    // An issue that is not in a readable list left the store.
    return m >= 0 && lists.list(ref.slice(0, m)) ? GONE : undefined;
  };
  const cls = classify(entries.map(activeEnd), statusOf, since.getTime(), now.getTime(), fit);
  for (const c of cls.classes) for (const t of c.top) {
    const m = t.goal.lastIndexOf("-");
    const item = lists.item(t.goal.slice(0, m), t.goal.slice(m + 1));
    t.title = item?.title;
    // The link would be a 404 for an issue that left the store.
    if (!item && lists.list(t.goal.slice(0, m))) delete t.href;
  }
  for (const u of issues.usage) {
    const m = u.goal.lastIndexOf("-");
    const item = lists.item(u.goal.slice(0, m), Number(u.goal.slice(m + 1)));
    if (item) u.title = item.title;
    else if (lists.list(u.goal.slice(0, m))) delete u.href;
  }
  const ended = phaseTimes(all, filed(), since.getTime(), now.getTime());
  const med = (xs: { at: number; secs: number }[], i: number, q = 0.5) => {
    const inBucket = xs.filter((x) => Math.min(n - 1, Math.max(0, slot(x.at))) === i).map((x) => x.secs);
    return inBucket.length ? round(pct(inBucket, q)) : null;
  };
  const recent = flakes().filter((f) => Date.parse(f.at) >= since.getTime() && (!project || f.repo === project));
  const started = Array.from({ length: n }, () => 0);
  const costs = Array.from({ length: n }, () => ({} as Record<string, number>));
  for (const e of entries) {
    const t = Date.parse(e.run.started);
    if (t >= since.getTime() && t < now.getTime()) started[Math.min(n - 1, Math.max(0, slot(t)))]++;
    if (!isAgentRun(e.run.kind) || !(t >= since.getTime() && t < now.getTime())) continue;
    const spent = costs[Math.min(n - 1, Math.max(0, slot(t)))], model = e.run.model || "unset";
    spent[model] = round((spent[model] ?? 0) + (e.run.cost ?? 0), 4);
  }
  return {
    window,
    done: issuesLanded,
    kinds: Object.fromEntries(KINDS.map((k) => [k, stat(times[k])])) as Speed["kinds"],
    phases: Object.fromEntries(PHASE_KEYS.map((k) => [k, phaseStat(ended[k].map((x) => x.secs))])) as Speed["phases"],
    asks: asksOf(since.getTime(), now.getTime(), project),
    checks: [...checks].map(([name, xs]) => ({ name, ...stat(xs) })).sort((a, b) => a.name.localeCompare(b.name)),
    buckets: Array.from({ length: n }, (_, i) => {
      const d = startOf(i);
      return { at: d.toISOString(), runs: started[i], cost: costs[i], p90: Object.fromEntries(PHASE_KEYS.map((k) => [k, med(ended[k], i, 0.9)])), ...Object.fromEntries(PHASE_KEYS.map((k) => [k, med(ended[k], i)])) } as Speed["buckets"][number];
    }),
    times: ended.issues,
    slowest: agents.sort((a, b) => b.took - a.took).slice(0, 6),
    models: [...models].map(([model, xs]) => ({ model, count: xs.length, p50: round(pct(xs, 0.5)) })).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model)),
    issues,
    classes: cls.classes,
    notCounted: cls.notCounted,
    lost: cls.lost,
    hasWeek: fit !== null,
    agents: agentStats(entries, since.getTime(), now.getTime(), AGENT_STEP[window], LIVE_CAP(), undefined, Array.from({ length: BASELINE[window].n }, (_, i): [number, number] => [since.getTime() - (i + 1) * BASELINE[window].step, now.getTime() - (i + 1) * BASELINE[window].step])),
    flaky: recent.length,
    flakes: [...Map.groupBy(recent.flatMap(flakeNames), (f) => f.name)].map(([name, xs]) => ({ name, count: xs.length })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

function asksOf(since: number, now: number, project?: string): Speed["asks"] {
  const inWindow = (t: number) => t >= since && t <= now;
  const asks = allRecords().filter((r) => !project || r.issue.startsWith(`${project}-`)).flatMap((r) => (r.asks ?? []).filter((a) => inWindow(Date.parse(a.set))).map((a) => ({ a, r })));
  const escalated = ({ a, r }: (typeof asks)[number]) => r.events.some((e) => e.kind === "director" && (e.data as { outcome?: string } | undefined)?.outcome === "escalated" && e.at >= a.set && (!a.cleared || e.at < a.cleared));
  return { count: asks.length, manual: asks.filter(escalated).length };
}

const cache = staleSync<Speed>();
export const clearCache = () => cache.clear();
/** `speed`, kept `ALEPH_UI_FETCH_TTL` seconds like the other fetches. */
export const cachedSpeed = (window: Window, fit: Fit | null = null, project?: string): Speed => cache.get(project ? `${window}:${project}` : window, uiFetchTtl() * 1000, () => speed(window, new Date(), fit, project));

/** What a Status card shows for one span; a field is null when the span has no data for it. */
export interface Figures { lost: number | null; hours: number | null; leadP50: number | null; leadP90: number | null; asks: number | null; landed: number | null; firstPass: number | null }
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
const figures0 = (): Figures => ({ lost: null, hours: null, leadP50: null, leadP90: null, asks: null, landed: null, firstPass: null });

// Hour: the average of the last 12 hours; day: of the last 7 days; week and month: the span before.
const BASELINE: Record<Window, { step: number; n: number; avg: boolean; basis: string; prev: string }> = {
  hour: { step: HOUR, n: 12, avg: true, basis: "average of the last 12 hours with data", prev: "the hour before" },
  day: { step: 24 * HOUR, n: 7, avg: true, basis: "average of the last 7 days with data", prev: "the day before" },
  week: { step: 7 * 24 * HOUR, n: 1, avg: false, basis: "the previous 7 days", prev: "the previous 7 days" },
  month: { step: 30 * 24 * HOUR, n: 1, avg: false, basis: "the previous 30 days", prev: "the previous 30 days" },
};

export function baseline(window: Window, now = new Date(), fit: Fit | null = null, project?: string): Baseline {
  const b = BASELINE[window];
  const spans = Array.from({ length: b.n }, (_, i) => figures(speed(window, new Date(now.getTime() - (i + 1) * b.step), fit, project)));
  return { prev: spans[0], base: b.avg ? averageFigures(spans) : spans[0], basis: b.basis };
}

const baselines = staleSync<Baseline>();
export const cachedBaseline = (window: Window, fit: Fit | null = null, project?: string): Baseline => baselines.get(project ? `${window}:${project}` : window, uiFetchTtl() * 1000, () => baseline(window, new Date(), fit, project));

/**
 * Fills the cache for the windows the Status page reads (week, day, month) once the server is up, so the
 * first page load after a land finds them computed. `speed` is synchronous (250-750 ms each), so each window
 * runs in its own turn of the event loop and a request that arrives meanwhile waits for one, not all three.
 */
export async function warm(): Promise<void> {
  const fit = await currentFit().catch(() => null);
  for (const w of ["week", "day", "month"] as const) {
    await new Promise<void>((r) => setTimeout(r, 0));
    cachedSpeed(w, fit);
    await new Promise<void>((r) => setTimeout(r, 0));
    cachedBaseline(w, fit);
  }
}

export const routes: Routes = {
  "GET /api/speed": async (_req, _params, url) => {
    const w = url.searchParams.get("window") ?? "week";
    if (!(WINDOWS as readonly string[]).includes(w)) return Response.json({ error: "window must be hour, day, week or month" }, { status: 400 });
    // `project`: only the runs and issues of that repo count.
    const project = url.searchParams.get("project") || undefined;
    const fit = await currentFit().catch(() => null), d = cachedSpeed(w as Window, fit, project);
    // `baseline=1`: the trend baseline of the window in the same answer, so the Status page makes one request.
    if (url.searchParams.get("baseline") !== "1") return Response.json(d);
    // `day` and `month` are the answers the Efficiency page reads (its last-24-h and 30-day-average trends), so opening it after Status finds them.
    const others = Object.fromEntries((["day", "month"] as const).filter((k) => k !== w).map((k) => [k, cachedSpeed(k, fit, project)]));
    return Response.json({ ...d, baseline: cachedBaseline(w as Window, fit, project), others });
  },
};

/** `s` cut to at most `max` characters at a word end, with "…" when anything was cut. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1), sp = cut.lastIndexOf(" ");
  return (sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s.,;:]+$/, "") + "…";
}
