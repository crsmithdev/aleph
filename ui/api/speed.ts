/**
 * `GET /api/speed?window=hour|day|week|month` (default week): how fast the factory's runs are, read from the run folders'
 * state.json (no Langfuse). Runs with a `started` and an `ended` count; one longer than 4 hours
 * is a broken clock and is skipped. Hour is the last 60 minutes in 1-minute buckets, day the last 24 hours in hourly ones, week and
 * month the last 7 and 30 local days (today included) in daily ones. A percentile is the nearest rank.
 * The phases also read when each issue file first came into the work store's git history.
 */
import { existsSync } from "node:fs";
import { flakes, LIVE_CAP } from "../../jobs/lib/factory.ts";
import { git } from "../../jobs/lib/git.ts";
import { allRuns, isBuild, isLive, isStarting, onOf, type Entry, type Run } from "../../jobs/lib/ledger.ts";
import type { Routes } from "../server.ts";
import { staleSync } from "../stale.ts";
import { reader, storeDir, uiFetchTtl } from "../../todo/lib/store.ts";
import { status } from "../../todo/lib/todo.ts";
import { currentFit, share, type Fit } from "../usage.ts";

const HOUR = 3600_000, DAY = 24 * HOUR;
/** The issue number of a run, from `on` or old `todo`; a goal run "860.1" reads as 860. Undefined when the run has none. */
function issueOf(r: Run): number | undefined {
  const o = onOf(r);
  return o === undefined ? undefined : Math.trunc(Number(o));
}

export const MAX_RUN = 4 * HOUR;
export const KINDS = ["agent", "land", "triage", "plan"] as const;

export interface Pct { count: number; p50: number; p90: number }
/** A phase's `hist` counts times in 7 bins: under 1m, 1-5m, 5-15m, 15-30m, 30m-1h, 1-4h, over 4h (an edge falls in the upper bin). `worst` is the longest time in seconds. */
export interface PhaseStat extends Pct { hist: number[]; worst: number }
export type Phase = "intake" | "queue" | "implement" | "land" | "lead";
const PHASE_KEYS: Phase[] = ["intake", "queue", "implement", "land", "lead"];
export interface Speed {
  window: Window;
  /** Issues that landed in the window: one per issue, however many land runs it had. Land runs with no issue count as one. */
  done: number;
  kinds: Record<(typeof KINDS)[number], Pct>;
  /** Intake: issue created to its first triage end. Queue: that end, or the filing with no triage, to the issue's first agent start. Implement: job's first agent start to its last finish. Land: finish to landed. Lead: issue created to its last land. Each counts in the window where it ends. */
  phases: Record<Phase, PhaseStat>;
  checks: { name: string; count: number; p50: number; p90: number }[];
  /** hour: 60 buckets of 1 minute; day: 24 hourly; week: 7 and month: 30 local days; `at` is its local start as an ISO string. */
  buckets: ({ label: string; at: string; runs: number } & Record<Phase, number | null>)[];
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
/** The agents over the window. `workers` and `cap` are the runs the live cap counts, now. `mean` and `peak` count all timed roles, and each point holds each role's mean live in its step. */
export interface Agents {
  live: number; workers: number; cap: number; mean: number; peak: number;
  roles: AgentRole[];
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
const pad = (n: number) => String(n).padStart(2, "0");
const isTests = (name: string) => /^tests?$/.test(name);

export const WINDOWS = ["hour", "day", "week", "month"] as const;
export type Window = (typeof WINDOWS)[number];
const STEP: Record<Window, number> = { hour: 60_000, day: HOUR, week: DAY, month: DAY };
const COUNT: Record<Window, number> = { hour: 60, day: 24, week: 7, month: 30 };

const HOUR_MS = HOUR;
const isAgent = (r: Run) => isBuild(r.kind) || r.kind === "recheck";
const passedState = (st: string) => st === "passed" || st === "landed" || st === "done";

/** Class every agent run of the window by what its work came to; see the parent goal's Classes list. */
export function classify(runs: Run[], statusOf: (goal: string) => string | undefined, since: number, now: number, fit: Fit | null): { classes: ClassStat[]; notCounted: { runs: number; issues: number; hours: number }; lost: { hours: number; share: number }; total: number } {
  const goalOf = (r: Run) => `${r.repo}-${issueOf(r)}`;
  const t0 = (r: Run) => Date.parse(r.started);
  const agentsOf = new Map<string, Run[]>(), landsOf = new Map<string, Run[]>(), firstStart = new Map<string, number>();
  for (const r of runs) {
    const t = t0(r);
    if (Number.isFinite(t)) firstStart.set(r.job, Math.min(firstStart.get(r.job) ?? Infinity, t));
    if (issueOf(r) === undefined) continue;
    const m = isAgent(r) ? agentsOf : r.kind === "land" && r.condition === "landed" ? landsOf : null;
    if (!m) continue;
    const g = goalOf(r);
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
  type Row = { run: Run; goal: string; hours: number; week: number; cause: string };
  const rows = new Map<Class, Row[]>(CLASSES.map((c) => [c, []]));
  const skipped: Row[] = [];
  for (const r of runs) {
    if (!isAgent(r) || issueOf(r) === undefined) continue;
    const a = t0(r), b = Date.parse(r.ended ?? "");
    if (!(a >= since) || a > now || !(b >= a) || b - a > MAX_RUN) continue;
    const g = goalOf(r), reason = r.reason ?? "";
    const row: Row = { run: r, goal: g, hours: (b - a) / 1000 / 3600, week: share(fit, r.cost, r.model)?.pct ?? 0, cause: "" };
    const lands = landing.get(g) ?? new Set<Run>();
    const mine = (agentsOf.get(g) ?? []);
    const startsBefore = mine.filter((o) => a - HOUR_MS <= t0(o) && t0(o) < a).length;
    const afterLand = lastLand.has(g) && a > lastLand.get(g)!;
    let cls: Class | null = null;
    if (lands.has(r)) cls = "landed";
    else if ([...lands].some((l) => l.job === r.job && t0(l) > a)) cls = "fixed";
    else if (afterLand || /already (met|done|on main)|duplicate|folded into/i.test(reason)) cls = "nothing";
    else if (startsBefore >= 3 || [...lands].some((l) => l.job !== r.job && (firstStart.get(l.job) ?? Infinity) > (firstStart.get(r.job) ?? Infinity))) cls = "restarted";
    else if (["done", "dropped", GONE].includes(statusOf(g) ?? "")) cls = "dropped";
    if (!cls) { skipped.push(row); continue; }
    if (cls === "landed") row.cause = mine.some((o) => o.job === r.job && t0(o) < a) ? "After fix rounds" : "First run of the job";
    else if (cls === "nothing") row.cause = afterLand ? "Issue had landed" : "Work on main from another issue";
    else if (cls === "restarted" && startsBefore >= 3) row.cause = "Restart loop";
    else if (r.condition === "awaiting") row.cause = "Needed Chris";
    else if (r.failed === "review" || /reviewer/i.test(reason)) row.cause = "Reviewer sent back";
    else if (r.failed || / failed$|^timed out: check /.test(reason)) row.cause = "Checks failed";
    else if (/time box|stalled|timed out|lost/i.test(reason)) row.cause = "Stalled or timed out";
    else if (r.noCommit || /no commit/i.test(reason)) row.cause = "No commit";
    else if (/by hand|aleph drop/i.test(reason)) row.cause = "Needed Chris";
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
    const top = [...group((r) => r.goal)].map(([goal, x]) => {
      const last = x.reduce((p, q) => (t0(q.run) > t0(p.run) ? q : p));
      const m = goal.lastIndexOf("-");
      return { goal, sum: sum(x), reason: clip((last.run.reason ?? "").replace(/^agent run \S+:\s*/, "").trim(), 140), href: `#/issues/${encodeURIComponent(goal.slice(0, m))}/${goal.slice(m + 1)}` };
    }).sort((a, b) => b.sum.hours - a.sum.hours).slice(0, 8).map((t) => ({ goal: t.goal, href: t.href, reason: t.reason, ...noWeek(rd(t.sum)) }));
    return { key, name: CLASS_NAME[key], text: CLASS_TEXT[key], ...rd(sum(rs)), issues: new Set(rs.map((r) => r.goal)).size, causes, top };
  });
  const raw = CLASSES.map((c) => sum(rows.get(c)!).hours);
  const total = raw.reduce((x, y) => x + y, 0), lostH = raw.slice(2).reduce((x, y) => x + y, 0);
  return {
    classes,
    notCounted: { runs: skipped.length, issues: new Set(skipped.map((r) => r.goal)).size, hours: round(skipped.reduce((x, y) => x + y.hours, 0), 2) },
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
export function phaseTimes(runs: Run[], { issue }: Filed, since: number, now: number): Record<Phase, { at: number; secs: number }[]> {
  const inWindow = (t: number) => t >= since && t <= now;
  const intake: { at: number; secs: number }[] = [], queue: { at: number; secs: number }[] = [], implement: { at: number; secs: number }[] = [], land: { at: number; secs: number }[] = [], lead: { at: number; secs: number }[] = [];
  const jobs = new Map<string, Run[]>();
  for (const r of runs) jobs.set(r.job, [...(jobs.get(r.job) ?? []), r]);
  for (const rs of jobs.values()) {
    const agents = rs.filter((r) => { const a = Date.parse(r.started), b = Date.parse(r.ended ?? ""); return isAgent(r) && b >= a && b - a <= MAX_RUN; });
    const landed = Math.min(...rs.filter((r) => r.kind === "land" && (r.condition === "landed" || r.condition === "done")).map((r) => Date.parse(r.ended ?? "")).filter(Number.isFinite));
    // A job can run again after it lands; what finished the work is the last finish before the land.
    const ends = agents.filter((r) => passedState(r.condition) || r.condition === "awaiting").map((r) => Date.parse(r.ended!)).filter((t) => t <= landed);
    if (!ends.length) continue;
    const finished = Math.max(...ends), started = Math.min(...agents.map((r) => Date.parse(r.started)));
    if (inWindow(finished)) implement.push({ at: finished, secs: (finished - started) / 1000 });
    if (inWindow(landed)) land.push({ at: landed, secs: (landed - finished) / 1000 });
  }
  // Queue and Lead are per issue. A run older than its filing (a file added again) has no such span.
  const firstStart = new Map<string, number>(), lastLand = new Map<string, number>(), triaged = new Map<string, number>();
  for (const r of runs) {
    const n = issueOf(r);
    if (n === undefined) continue;
    const key = `${r.repo}-${n}`;
    if (isAgent(r)) {
      const a = Date.parse(r.started);
      if (a < (firstStart.get(key) ?? Infinity)) firstStart.set(key, a);
    } else if (r.kind === "triage") {
      const b = Date.parse(r.ended ?? "");
      if (b < (triaged.get(key) ?? Infinity)) triaged.set(key, b);
    } else if (r.kind === "land" && (r.condition === "landed" || r.condition === "done")) {
      const b = Date.parse(r.ended ?? "");
      if (b > (lastLand.get(key) ?? -Infinity)) lastLand.set(key, b);
    }
  }
  for (const [key, started] of firstStart) {
    const created = issue.get(key), sorted = triaged.get(key);
    if (created != null && sorted != null && sorted >= created && sorted <= started && inWindow(sorted)) intake.push({ at: sorted, secs: (sorted - created) / 1000 });
    // An issue filed with a spec skips triage: it queues from its filing.
    const queued = sorted != null && sorted <= started ? sorted : created;
    if (queued != null && started >= queued && inWindow(started)) queue.push({ at: started, secs: (started - queued) / 1000 });
  }
  for (const [key, landed] of lastLand) {
    const created = issue.get(key);
    if (created != null && landed >= created && inWindow(landed)) lead.push({ at: landed, secs: (landed - created) / 1000 });
  }
  return { intake, queue, implement, land, lead };
}

/** Each phase's count, p50 and p90 over `phaseTimes`. */
export function phases(runs: Run[], filings: Filed, since: number, now: number): Speed["phases"] {
  const t = phaseTimes(runs, filings, since, now);
  return Object.fromEntries(PHASE_KEYS.map((k) => [k, phaseStat(t[k].map((x) => x.secs))])) as Speed["phases"];
}

// The roles with their run kind. A land and a recheck run only checks and git, so they are not agents.
export const AGENT_ROLES = [["worker", "Worker", "build"], ["triage", "Triage", "triage"], ["planner", "Planner", "plan"], ["facts", "Fact checker", "facts"], ["firefighter", "Firefighter", "firefighter"]] as const;
export type AgentKey = (typeof AGENT_ROLES)[number][0];

/** "claude-opus-5-5" as "opus"; "sonnet" stays. */
const modelName = (m: string) => /^claude-([a-z]+)-/.exec(m)?.[1] ?? m;

/** The agents by role over `since`..`now`. A run with the condition running ends at `now` when `alive` says so, and does not count when not. `step` is the width of a point in ms. */
export function agentStats(entries: Entry[], since: number, now: number, step: number, cap: number, alive: (e: Entry) => boolean = (e) => isLive(e.folder) || isStarting(e)): Agents {
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
      if (r.kind !== kind && !(key === "worker" && (r.kind as string) === "agent")) continue;
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
  const inWindow = entries.map((e) => e.run as Run).filter((r) => (isBuild(r.kind) || (r.kind as string) === "agent") && Date.parse(r.started) >= since && Date.parse(r.started) < now);
  const reviews = inWindow.reduce((n, r) => n + (r.review ? 1 : 0), 0);
  const span = now - since, hours = roles.reduce((n, r) => n + (r.hours ?? 0), 0);
  return {
    live: roles.reduce((n, r) => n + (r.live ?? 0), 0), workers: roles[0].live ?? 0, cap,
    mean: span ? round((hours * HOUR) / span, 1) : 0, peak,
    roles: [...roles, { key: "reviewer", name: "Reviewer", live: null, runs: reviews, hours: null, p50: null, models: [] }],
    points,
  };
}

// The width of an agents point: fine enough that a short burst shows.
const AGENT_STEP: Record<Window, number> = { hour: 60_000, day: 15 * 60_000, week: HOUR, month: 6 * HOUR };

export function speed(window: Window, now = new Date(), fit: Fit | null = null): Speed {
  const n = COUNT[window];
  const daily = window === "week" || window === "month";
  const stepMs = STEP[window];
  // The first bucket starts at the local midnight (week, month), the full hour (day) or the minute mark (hour), n - 1 steps before the bucket that holds `now`.
  const last = daily ? new Date(now.getFullYear(), now.getMonth(), now.getDate()) : new Date(Math.floor(now.getTime() / stepMs) * stepMs);
  const startOf = (i: number) => (daily ? new Date(last.getFullYear(), last.getMonth(), last.getDate() - (n - 1 - i)) : new Date(last.getTime() - (n - 1 - i) * stepMs));
  const since = startOf(0);
  const slot = (t: number): number => (daily ? Math.round((new Date(t).setHours(0, 0, 0, 0) - since.getTime()) / DAY) : Math.floor((t - since.getTime()) / stepMs));
  const times: Record<string, number[]> = { agent: [], land: [], triage: [], plan: [] };
  const checks = new Map<string, number[]>();
  const agents: { name: string; condition: string; model: string; tests: number | null; cost: number; took: number }[] = [];
  const models = new Map<string, number[]>();

  const entries = allRuns();
  const all = entries.map((x) => x.run as Run);
  const landed: Run[] = [];
  for (const r of all) {
    const t0 = Date.parse(r.started), t1 = Date.parse(r.ended ?? "");
    if (!(t0 >= since.getTime()) || t0 > now.getTime() || !(t1 >= t0) || t1 - t0 > MAX_RUN) continue;
    const secs = (t1 - t0) / 1000;
    const kind = r.kind === "recheck" || r.kind === "build" ? "agent" : r.kind;
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
    if (!isAgent(r)) continue;
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
    for (const r of all) if (isAgent(r) && issueOf(r) !== undefined) weekOf.set(`${r.repo}-${issueOf(r)}`, (weekOf.get(`${r.repo}-${issueOf(r)}`) ?? 0) + (share(fit, r.cost, r.model)?.pct ?? 0));
    const keys = [...new Set(landed.filter((r) => issueOf(r) !== undefined).map((r) => `${r.repo}-${issueOf(r)}`))];
    const per = keys.map((g) => weekOf.get(g) ?? 0);
    const nRuns = new Map<string, number>();
    for (const r of all) if (isAgent(r) && issueOf(r) !== undefined) nRuns.set(`${r.repo}-${issueOf(r)}`, (nRuns.get(`${r.repo}-${issueOf(r)}`) ?? 0) + 1);
    issues.usage = keys.map((g) => {
      const m = g.lastIndexOf("-");
      return { goal: g, href: `#/issues/${encodeURIComponent(g.slice(0, m))}/${g.slice(m + 1)}`, week: round(weekOf.get(g) ?? 0, 2), runs: nRuns.get(g) ?? 0 };
    }).sort((a, b) => b.week - a.week).slice(0, 8);
    issues.week = per.length ? round(pct(per, 0.5), 2) : null;
  }
  const lists = reader({ fetch: false });
  const statusOf = (goal: string): string | undefined => {
    const m = goal.lastIndexOf("-");
    const item = m < 0 ? undefined : lists.item(goal.slice(0, m), Number(goal.slice(m + 1)));
    if (item) return status(item);
    // An issue that is not in a readable list left the store.
    return m >= 0 && lists.list(goal.slice(0, m)) ? GONE : undefined;
  };
  const cls = classify(all, statusOf, since.getTime(), now.getTime(), fit);
  for (const c of cls.classes) for (const t of c.top) {
    const m = t.goal.lastIndexOf("-");
    const item = lists.item(t.goal.slice(0, m), Number(t.goal.slice(m + 1)));
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
  const med = (xs: { at: number; secs: number }[], i: number) => {
    const inBucket = xs.filter((x) => Math.min(n - 1, Math.max(0, slot(x.at))) === i).map((x) => x.secs);
    return inBucket.length ? round(pct(inBucket, 0.5)) : null;
  };
  const recent = flakes().filter((f) => Date.parse(f.at) >= since.getTime());
  const started = Array.from({ length: n }, () => 0);
  for (const e of entries) {
    const t = Date.parse(e.run.started);
    if (t >= since.getTime() && t < now.getTime()) started[Math.min(n - 1, Math.max(0, slot(t)))]++;
  }
  return {
    window,
    done: issuesLanded,
    kinds: Object.fromEntries(KINDS.map((k) => [k, stat(times[k])])) as Speed["kinds"],
    phases: Object.fromEntries(PHASE_KEYS.map((k) => [k, phaseStat(ended[k].map((x) => x.secs))])) as Speed["phases"],
    checks: [...checks].map(([name, xs]) => ({ name, ...stat(xs) })).sort((a, b) => a.name.localeCompare(b.name)),
    buckets: Array.from({ length: n }, (_, i) => {
      const d = startOf(i);
      return { label: daily ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : `${pad(d.getHours())}:${pad(d.getMinutes())}`, at: d.toISOString(), runs: started[i], ...Object.fromEntries(PHASE_KEYS.map((k) => [k, med(ended[k], i)])) } as Speed["buckets"][number];
    }),
    slowest: agents.sort((a, b) => b.took - a.took).slice(0, 6),
    models: [...models].map(([model, xs]) => ({ model, count: xs.length, p50: round(pct(xs, 0.5)) })).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model)),
    issues,
    classes: cls.classes,
    notCounted: cls.notCounted,
    lost: cls.lost,
    hasWeek: fit !== null,
    agents: agentStats(entries, since.getTime(), now.getTime(), AGENT_STEP[window], LIVE_CAP()),
    flaky: recent.length,
    flakes: [...Map.groupBy(recent, (f) => f.check)].map(([name, xs]) => ({ name, count: xs.length })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  };
}

const cache = staleSync<Speed>();
export const clearCache = () => cache.clear();
/** `speed`, kept `ALEPH_UI_FETCH_TTL` seconds like the other fetches. */
export const cachedSpeed = (window: Window, fit: Fit | null = null): Speed => cache.get(window, uiFetchTtl() * 1000, () => speed(window, new Date(), fit));

export const routes: Routes = {
  "GET /api/speed": async (_req, _params, url) => {
    const w = url.searchParams.get("window") ?? "week";
    if (!(WINDOWS as readonly string[]).includes(w)) return Response.json({ error: "window must be hour, day, week or month" }, { status: 400 });
    return Response.json(cachedSpeed(w as Window, await currentFit().catch(() => null)));
  },
};

/** `s` cut to at most `max` characters at a word end, with "…" when anything was cut. */
function clip(s: string, max: number): string {
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1), sp = cut.lastIndexOf(" ");
  return (sp > max / 2 ? cut.slice(0, sp) : cut).replace(/[\s.,;:]+$/, "") + "…";
}
