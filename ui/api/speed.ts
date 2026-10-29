/**
 * `GET /api/speed?days=1|7|30`: how fast the factory's runs are, read from the run folders'
 * state.json (no Langfuse). Runs with a `started` and an `ended` count; one longer than 4 hours
 * is a broken clock and is skipped. Days are local: `days=1` is since midnight today, 7 the last
 * seven days with today. A percentile is the nearest rank.
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
  days: number;
  kinds: Record<(typeof KINDS)[number], Pct>;
  checks: { name: string; count: number; p50: number; p90: number }[];
  ends: Record<End, { hours: number; cost: number; count: number }>;
  /** Dropped and stuck agent hours over all agent hours, 0 to 1; 0 with no agent hours. */
  wasted: number;
  /** One bucket per hour (days=1) or per local day (7, 30); `at` is its local start as an ISO string. */
  buckets: { label: string; at: string; agent: number | null; tests: number | null; lands: number }[];
  slowest: { name: string; state: string; model: string; tests: number | null; cost: number; took: number }[];
  models: { model: string; count: number; p50: number }[];
  flaky: number;
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

export function speed(days: number, now = new Date()): Speed {
  const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const since = new Date(midnight.getFullYear(), midnight.getMonth(), midnight.getDate() - (days - 1));
  const hourly = days === 1;
  const n = hourly ? 24 : days;
  const slot = (t: number): number => (hourly ? new Date(t).getHours() : Math.round((new Date(t).setHours(0, 0, 0, 0) - since.getTime()) / DAY));
  const times: Record<string, number[]> = { agent: [], land: [], triage: [], plan: [] };
  const checks = new Map<string, number[]>();
  const ends = Object.fromEntries(END_STATES.map((s) => [s, { hours: 0, cost: 0, count: 0 }])) as Speed["ends"];
  const agentIn: number[][] = Array.from({ length: n }, () => []);
  const testsIn: number[][] = Array.from({ length: n }, () => []);
  const lands = new Array<number>(n).fill(0);
  const agents: { name: string; state: string; model: string; tests: number | null; cost: number; took: number }[] = [];
  const models = new Map<string, number[]>();

  for (const { run } of allRuns()) {
    const r = run as Run;
    const t0 = Date.parse(r.started), t1 = Date.parse(r.ended ?? "");
    if (!(t0 >= since.getTime()) || t0 > now.getTime() || !(t1 >= t0) || t1 - t0 > MAX_RUN) continue;
    const secs = (t1 - t0) / 1000, i = slot(t0);
    const kind = r.kind === "recheck" ? "agent" : r.kind;
    if (kind in times) times[kind].push(secs);
    for (const c of r.checks ?? []) {
      if (!checks.has(c.name)) checks.set(c.name, []);
      checks.get(c.name)!.push(c.seconds);
      if (kind === "agent" && isTests(c.name)) testsIn[i].push(c.seconds);
    }
    if (kind === "land" && r.state === "landed") lands[i]++;
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
  const med = (xs: number[]) => (xs.length ? round(pct(xs, 0.5)) : null);
  const weekAgo = now.getTime() - 7 * DAY;
  return {
    days,
    kinds: Object.fromEntries(KINDS.map((k) => [k, stat(times[k])])) as Speed["kinds"],
    checks: [...checks].map(([name, xs]) => ({ name, ...stat(xs) })).sort((a, b) => a.name.localeCompare(b.name)),
    ends,
    wasted: round(wasted, 4),
    buckets: Array.from({ length: n }, (_, i) => {
      const d = hourly ? new Date(since.getFullYear(), since.getMonth(), since.getDate(), i) : new Date(since.getFullYear(), since.getMonth(), since.getDate() + i);
      return { label: hourly ? `${pad(i)}:00` : `${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, at: d.toISOString(), agent: med(agentIn[i]), tests: med(testsIn[i]), lands: lands[i] };
    }),
    slowest: agents.sort((a, b) => b.took - a.took).slice(0, 6),
    models: [...models].map(([model, xs]) => ({ model, count: xs.length, p50: round(pct(xs, 0.5)) })).sort((a, b) => b.count - a.count || a.model.localeCompare(b.model)),
    flaky: flakes().filter((f) => Date.parse(f.at) >= weekAgo).length,
  };
}

const cache = staleSync<Speed>();
export const clearCache = () => cache.clear();
/** `speed`, kept `ALEPH_UI_FETCH_TTL` seconds like the other fetches; the key holds the local date, so a new day starts fresh. */
export const cachedSpeed = (days: number): Speed => {
  const d = new Date();
  return cache.get(`${d.getFullYear()}-${d.getMonth()}-${d.getDate()}|${days}`, uiFetchTtl() * 1000, () => speed(days));
};

export const routes: Routes = {
  "GET /api/speed": (_req, _params, url) => {
    const days = Number(url.searchParams.get("days") ?? 7);
    if (![1, 7, 30].includes(days)) return Response.json({ error: "days must be 1, 7 or 30" }, { status: 400 });
    return Response.json(cachedSpeed(days));
  },
};
