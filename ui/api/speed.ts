/**
 * `GET /api/speed?window=hour|day|week|month` (default week): how fast the factory's runs are, read from the run folders'
 * state.json (no Langfuse). Runs with a `started` and an `ended` count; one longer than 4 hours
 * is a broken clock and is skipped. Hour is the last 60 minutes in 1-minute buckets, day the last 24 hours in hourly ones, week and
 * month the last 7 and 30 local days (today included) in daily ones. A percentile is the nearest rank.
 */
import { flakes } from "../../jobs/lib/factory.ts";
import { allRuns, type Run } from "../../jobs/lib/ledger.ts";
import type { Routes } from "../server.ts";
import { staleSync } from "../stale.ts";
import { reader, uiFetchTtl } from "../../todo/lib/store.ts";
import { status } from "../../todo/lib/todo.ts";
import { currentFit, share, type Fit } from "../usage.ts";

const HOUR = 3600_000, DAY = 24 * HOUR;
export const MAX_RUN = 4 * HOUR;
export const KINDS = ["agent", "land", "triage", "plan"] as const;
export const END_STATES = ["passed", "dropped", "stuck", "needs-you"] as const;
type End = (typeof END_STATES)[number];

export interface Pct { count: number; p50: number; p90: number }
export interface Speed {
  window: Window;
  /** Land runs that landed in the window: the issues done. */
  done: number;
  kinds: Record<(typeof KINDS)[number], Pct>;
  checks: { name: string; count: number; p50: number; p90: number }[];
  ends: Record<End, { hours: number; cost: number; count: number }>;
  /** Dropped and stuck agent hours over all agent hours, 0 to 1; 0 with no agent hours. */
  wasted: number;
  /** hour: 60 buckets of 1 minute; day: 24 hourly; week: 7 and month: 30 local days; `at` is its local start as an ISO string. */
  buckets: { label: string; at: string; agent: number | null; tests: number | null; lands: number }[];
  slowest: { name: string; state: string; model: string; tests: number | null; cost: number; took: number }[];
  models: { model: string; count: number; p50: number }[];
  flaky: number;
  /** Landed goals (land runs that landed in the window) and what they cost to get there. */
  goals: {
    landed: number;
    /** Share of landed goals with 0 fix rounds, 0 to 1; null with none landed. */
    firstPass: number | null;
    /** Median fix rounds per landed goal; null with none landed. */
    fixRounds: number | null;
    /** Median over landed goals of the week share their agent runs took, 2 decimals; null with no fit or none landed. */
    week: number | null;
  };
  classes: ClassStat[];
  notCounted: { runs: number; goals: number; hours: number };
  lost: { hours: number; share: number };
  hasWeek: boolean;
}

export const CLASSES = ["landed", "fixed", "nothing", "loop", "restarted", "dropped"] as const;
export type Class = (typeof CLASSES)[number];
export const CLASS_NAME: Record<Class, string> = { landed: "Landed", fixed: "Fixed in place", nothing: "Nothing to do", loop: "Loop", restarted: "Restarted", dropped: "Dropped" };
export const CLASS_TEXT: Record<Class, string> = {
  landed: "The run whose work landed on main.",
  fixed: "A run of the landing job before the run that landed: a fix round the goal needed.",
  nothing: "A run that started after its goal had landed, or found the work already on main.",
  loop: "A run that was the 4th or later start of its goal inside an hour.",
  restarted: "A run of an earlier job of a goal whose later job landed.",
  dropped: "A run of a goal that was then dropped or closed without landing.",
};
export interface Measure { hours: number; week: number; runs: number }
export interface ClassStat extends Measure {
  key: Class; name: string; goals: number;
  causes: (Measure & { name: string })[];
  top: (Measure & { goal: string; href: string; reason: string })[];
}

/** The nearest-rank percentile `p` (0..1) of `xs`; 0 for none. */
export function pct(xs: number[], p: number): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil(p * s.length) - 1)];
}
const round = (n: number, d = 0) => { const k = 10 ** d; return Math.round(n * k) / k; };
const stat = (xs: number[]): Pct => ({ count: xs.length, p50: round(pct(xs, 0.5)), p90: round(pct(xs, 0.9)) });
const pad = (n: number) => String(n).padStart(2, "0");
const isTests = (name: string) => /^tests?$/.test(name);
/** The end state an agent run counts under: a failed run is stuck, a landed or done one passed; a running one has none. */
const endOf = (state: string): End | null =>
  state === "passed" || state === "landed" || state === "done" ? "passed" : state === "failed" ? "stuck" : (END_STATES as readonly string[]).includes(state) ? (state as End) : null;

export const WINDOWS = ["hour", "day", "week", "month"] as const;
export type Window = (typeof WINDOWS)[number];
const STEP: Record<Window, number> = { hour: 60_000, day: HOUR, week: DAY, month: DAY };
const COUNT: Record<Window, number> = { hour: 60, day: 24, week: 7, month: 30 };

const HOUR_MS = HOUR;
const isAgent = (r: Run) => r.kind === "agent" || r.kind === "recheck";
const passedState = (st: string) => st === "passed" || st === "landed" || st === "done";

/** Class every agent run of the window by what its work came to; see the parent goal's Classes list. */
export function classify(runs: Run[], statusOf: (goal: string) => string | undefined, since: number, now: number, fit: Fit | null): { classes: ClassStat[]; notCounted: { runs: number; goals: number; hours: number }; lost: { hours: number; share: number }; total: number } {
  const goalOf = (r: Run) => `${r.repo}-${r.todo}`;
  const t0 = (r: Run) => Date.parse(r.started);
  const agentsOf = new Map<string, Run[]>(), landsOf = new Map<string, Run[]>(), firstStart = new Map<string, number>();
  for (const r of runs) {
    const t = t0(r);
    if (Number.isFinite(t)) firstStart.set(r.job, Math.min(firstStart.get(r.job) ?? Infinity, t));
    if (r.todo === undefined) continue;
    const m = isAgent(r) ? agentsOf : r.kind === "land" && r.state === "landed" ? landsOf : null;
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
      const cand = (agentsOf.get(g) ?? []).filter((a) => passedState(a.state) && t0(a) < end).sort((a, b) => t0(b) - t0(a))[0];
      if (cand) { if (!landing.has(g)) landing.set(g, new Set()); landing.get(g)!.add(cand); }
    }
  }
  type Row = { run: Run; goal: string; hours: number; week: number; cause: string };
  const rows = new Map<Class, Row[]>(CLASSES.map((c) => [c, []]));
  const skipped: Row[] = [];
  for (const r of runs) {
    if (!isAgent(r) || r.todo === undefined) continue;
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
    else if (startsBefore >= 3) cls = "loop";
    else if ([...lands].some((l) => l.job !== r.job && (firstStart.get(l.job) ?? Infinity) > (firstStart.get(r.job) ?? Infinity))) cls = "restarted";
    else if (["done", "dropped"].includes(statusOf(g) ?? "")) cls = "dropped";
    if (!cls) { skipped.push(row); continue; }
    if (cls === "landed") row.cause = mine.some((o) => o.job === r.job && t0(o) < a) ? "After fix rounds" : "First run of the job";
    else if (cls === "nothing") row.cause = afterLand ? "Goal had landed" : "Work on main from other goal";
    else if (cls === "loop") row.cause = startsBefore + 1 >= 10 ? "10+ starts in an hour" : "4–9 starts in an hour";
    else if (r.state === "needs-you") row.cause = "Waited on Chris";
    else if (r.failed === "review" || /reviewer/i.test(reason)) row.cause = "Reviewer sent back";
    else if (r.failed || / failed$|^timed out: check /.test(reason)) row.cause = "Checks failed";
    else if (/time box|stalled|timed out|lost/i.test(reason)) row.cause = "Stalled or timed out";
    else if (/conflict/i.test(reason)) row.cause = "Land conflict";
    else if (r.noCommit || /no commit/i.test(reason)) row.cause = "No commit";
    else if (/by hand|aleph drop/i.test(reason)) row.cause = "Restarted by hand";
    else if (passedState(r.state)) row.cause = "Passed, not landed";
    else if (!r.reason) row.cause = "No reason recorded";
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
    const causes = [...group((r) => r.cause)].map(([name, x]) => ({ name, sum: sum(x) })).sort((a, b) => b.sum.hours - a.sum.hours).map((c) => ({ name: c.name, ...rd(c.sum) }));
    const top = [...group((r) => r.goal)].map(([goal, x]) => {
      const last = x.reduce((p, q) => (t0(q.run) > t0(p.run) ? q : p));
      const m = goal.lastIndexOf("-");
      return { goal, sum: sum(x), reason: (last.run.reason ?? "").replace(/^agent run \S+:\s*/, "").slice(0, 140), href: `#/issues/${encodeURIComponent(goal.slice(0, m))}/${goal.slice(m + 1)}` };
    }).sort((a, b) => b.sum.hours - a.sum.hours).slice(0, 8).map((t) => ({ goal: t.goal, href: t.href, reason: t.reason, ...rd(t.sum) }));
    return { key, name: CLASS_NAME[key], ...rd(sum(rs)), goals: new Set(rs.map((r) => r.goal)).size, causes, top };
  });
  const raw = CLASSES.map((c) => sum(rows.get(c)!).hours);
  const total = raw.reduce((x, y) => x + y, 0), lostH = raw.slice(2).reduce((x, y) => x + y, 0);
  return {
    classes,
    notCounted: { runs: skipped.length, goals: new Set(skipped.map((r) => r.goal)).size, hours: round(skipped.reduce((x, y) => x + y.hours, 0), 2) },
    lost: { hours: round(lostH, 2), share: total ? round(lostH / total, 4) : 0 },
    total: round(total, 2),
  };
}

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
  const ends = Object.fromEntries(END_STATES.map((s) => [s, { hours: 0, cost: 0, count: 0 }])) as Speed["ends"];
  const agentIn: number[][] = Array.from({ length: n }, () => []);
  const testsIn: number[][] = Array.from({ length: n }, () => []);
  const lands = new Array<number>(n).fill(0);
  const agents: { name: string; state: string; model: string; tests: number | null; cost: number; took: number }[] = [];
  const models = new Map<string, number[]>();

  const all = allRuns().map((x) => x.run as Run);
  const landed: Run[] = [];
  for (const r of all) {
    const t0 = Date.parse(r.started), t1 = Date.parse(r.ended ?? "");
    if (!(t0 >= since.getTime()) || t0 > now.getTime() || !(t1 >= t0) || t1 - t0 > MAX_RUN) continue;
    const secs = (t1 - t0) / 1000, i = Math.min(n - 1, Math.max(0, slot(t0)));
    const kind = r.kind === "recheck" ? "agent" : r.kind;
    if (kind in times) times[kind].push(secs);
    for (const c of r.checks ?? []) {
      if (!checks.has(c.name)) checks.set(c.name, []);
      checks.get(c.name)!.push(c.seconds);
      if (kind === "agent" && isTests(c.name)) testsIn[i].push(c.seconds);
    }
    if (kind === "land" && r.state === "landed") { lands[i]++; landed.push(r); }
    if (kind !== "agent") continue;
    agentIn[i].push(secs);
    const end = endOf(r.state);
    if (end) { const e = ends[end]; e.hours += secs / 3600; e.cost += r.cost ?? 0; e.count++; }
    const model = r.model || "unset";
    if (!models.has(model)) models.set(model, []);
    models.get(model)!.push(secs);
    agents.push({ name: r.name, state: r.state, model, tests: (r.checks ?? []).find((c) => isTests(c.name))?.seconds ?? null, cost: round(r.cost ?? 0, 2), took: round(secs) });
  }
  const total = END_STATES.reduce((a, s) => a + ends[s].hours, 0);
  const wasted = total ? (ends.dropped.hours + ends.stuck.hours) / total : 0;
  for (const s of END_STATES) { ends[s].hours = round(ends[s].hours, 2); ends[s].cost = round(ends[s].cost, 2); }
  // A fix round is a worker run of the goal that a failed check or the reviewer sent back (`failed` set).
  const rounds = new Map<string, number>();
  for (const r of all) {
    if (r.kind !== "agent" && r.kind !== "recheck") continue;
    if (r.failed) rounds.set(r.job, (rounds.get(r.job) ?? 0) + 1);
  }
  const fixes = landed.map((r) => rounds.get(r.job) ?? 0);
  const goals: Speed["goals"] = {
    landed: landed.length,
    firstPass: landed.length ? round(fixes.filter((f) => f === 0).length / landed.length, 4) : null,
    fixRounds: landed.length ? pct(fixes, 0.5) : null,
    week: null,
  };
  if (fit) {
    const weekOf = new Map<string, number>();
    for (const r of all) if (isAgent(r) && r.todo !== undefined) weekOf.set(`${r.repo}-${r.todo}`, (weekOf.get(`${r.repo}-${r.todo}`) ?? 0) + (share(fit, r.cost, r.model)?.pct ?? 0));
    const per = [...new Set(landed.filter((r) => r.todo !== undefined).map((r) => `${r.repo}-${r.todo}`))].map((g) => weekOf.get(g) ?? 0);
    goals.week = per.length ? round(pct(per, 0.5), 2) : null;
  }
  const lists = reader({ fetch: false });
  const statusOf = (goal: string): string | undefined => {
    const m = goal.lastIndexOf("-");
    const item = m < 0 ? undefined : lists.item(goal.slice(0, m), Number(goal.slice(m + 1)));
    return item ? status(item) : undefined;
  };
  const cls = classify(all, statusOf, since.getTime(), now.getTime(), fit);
  const med = (xs: number[]) => (xs.length ? round(pct(xs, 0.5)) : null);
  return {
    window,
    done: lands.reduce((a, b) => a + b, 0),
    kinds: Object.fromEntries(KINDS.map((k) => [k, stat(times[k])])) as Speed["kinds"],
    checks: [...checks].map(([name, xs]) => ({ name, ...stat(xs) })).sort((a, b) => a.name.localeCompare(b.name)),
    ends,
    wasted: round(wasted, 4),
    buckets: Array.from({ length: n }, (_, i) => {
      const d = startOf(i);
      return { label: daily ? `${pad(d.getMonth() + 1)}-${pad(d.getDate())}` : `${pad(d.getHours())}:${pad(d.getMinutes())}`, at: d.toISOString(), agent: med(agentIn[i]), tests: med(testsIn[i]), lands: lands[i] };
    }),
    slowest: agents.sort((a, b) => b.took - a.took).slice(0, 6),
    models: [...models].map(([model, xs]) => ({ model, count: xs.length, p50: round(pct(xs, 0.5)) })).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model)),
    goals,
    classes: cls.classes,
    notCounted: cls.notCounted,
    lost: cls.lost,
    hasWeek: fit !== null,
    flaky: flakes().filter((f) => Date.parse(f.at) >= since.getTime()).length,
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
