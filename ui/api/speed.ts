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
import { uiFetchTtl } from "../../todo/lib/store.ts";

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
    /** Mean cost of the worker runs of a landed goal, dollars; null with none landed. */
    cost: number | null;
  };
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

export function speed(window: Window, now = new Date()): Speed {
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
  const rounds = new Map<string, number>(), spent = new Map<string, number>();
  for (const r of all) {
    if (r.kind !== "agent" && r.kind !== "recheck") continue;
    if (r.failed) rounds.set(r.job, (rounds.get(r.job) ?? 0) + 1);
    spent.set(r.job, (spent.get(r.job) ?? 0) + (r.cost ?? 0));
  }
  const fixes = landed.map((r) => rounds.get(r.job) ?? 0);
  const goals: Speed["goals"] = {
    landed: landed.length,
    firstPass: landed.length ? round(fixes.filter((f) => f === 0).length / landed.length, 4) : null,
    fixRounds: landed.length ? pct(fixes, 0.5) : null,
    cost: landed.length ? round(landed.reduce((a, r) => a + (spent.get(r.job) ?? 0), 0) / landed.length, 2) : null,
  };
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
    flaky: flakes().filter((f) => Date.parse(f.at) >= since.getTime()).length,
  };
}

const cache = staleSync<Speed>();
export const clearCache = () => cache.clear();
/** `speed`, kept `ALEPH_UI_FETCH_TTL` seconds like the other fetches. */
export const cachedSpeed = (window: Window): Speed => cache.get(window, uiFetchTtl() * 1000, () => speed(window));

export const routes: Routes = {
  "GET /api/speed": (_req, _params, url) => {
    const w = url.searchParams.get("window") ?? "week";
    if (!(WINDOWS as readonly string[]).includes(w)) return Response.json({ error: "window must be hour, day, week or month" }, { status: 400 });
    return Response.json(cachedSpeed(w as Window));
  },
};
