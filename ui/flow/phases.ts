import { isAgentRun, onOf, type Run } from "../../jobs/lib/records/ledger.ts";
import { issueHref, issueId, parseId, tail } from "../../lib/naming.ts";
import { quantile, type buckets } from "../../lib/windows.ts";
import type { Filed } from "../../lib/store.ts";
import type { Speed } from "../api/flow.ts";

/** The issue a run works on, as the issue store names it (`<repo>-<n>`), or undefined for a run on no issue. */
export const issueOf = (r: Pick<Run, "repo" | "target">): string | undefined => { const n = onOf(r); return n === undefined || !r.repo ? undefined : issueId(r.repo, n); };

export const HOUR = 3600_000;

/** The repo and the ref inside it of a whole issue key: `aleph-1359.1` is `aleph` and `1359.1`; "" and "" for any other text. */
export const splitId = (s: string): [string, string] => {
  const p = parseId(s);
  return p ? [p.repo, tail(p)] : ["", ""];
};

export const MAX_RUN = 4 * HOUR;

export interface Pct { count: number; p50: number; p90: number }
/** A phase's `hist` counts times in 7 bins: under 1m, 1-5m, 5-15m, 15-30m, 30m-1h, 1-4h, over 4h (an edge falls in the upper bin). `worst` is the longest time in seconds. */
export interface PhaseStat extends Pct { hist: number[]; worst: number }
export type Phase = "intake" | "queue" | "implement" | "land" | "lead";
export const PHASE_KEYS: Phase[] = ["intake", "queue", "implement", "land", "lead"];
/** One issue's seconds per phase (null when the phase did not end in the window). `outcome` is "landed" once a land run landed it, else "unlanded". `filed` is its filing time, ISO, or null when the store has none. */
export type IssueTimes = { id: string; href: string; outcome: "landed" | "unlanded"; filed: string | null } & Record<Phase, number | null>;

export const round = (n: number, d = 0) => { const k = 10 ** d; return Math.round(n * k) / k; };
export const stat = (xs: number[]): Pct => ({ count: xs.length, p50: round(quantile(xs, 0.5) ?? 0), p90: round(quantile(xs, 0.9) ?? 0) });
const HIST_EDGES = [60, 300, 900, 1800, 3600, 14400];
const histOf = (xs: number[]): number[] => {
  const h = new Array(HIST_EDGES.length + 1).fill(0);
  for (const x of xs) h[HIST_EDGES.filter((e) => x >= e).length]++;
  return h;
};
export const phaseStat = (xs: number[]): PhaseStat => ({ ...stat(xs), hist: histOf(xs), worst: xs.length ? round(Math.max(...xs)) : 0 });

export const passedState = (st: string) => st === "passed" || st === "landed" || st === "done";

/** The phases of the work over `runs` and the store's history, for what ended in `since`..`now`: each one's end time and seconds. */
export function phaseTimes(runs: Run[], { issue }: Filed, since: number, now: number): Record<Phase, { at: number; secs: number }[]> & { issues: IssueTimes[] } {
  const per = new Map<string, IssueTimes>();
  const note = (key: string | undefined, k: Phase, secs: number) => {
    if (!key) return;
    const [repo, n] = splitId(key);
    if (!per.has(key)) per.set(key, { id: key, href: issueHref(issueId(repo, n)), outcome: "unlanded", filed: issue.get(key) ? new Date(issue.get(key)!).toISOString() : null, intake: null, queue: null, implement: null, land: null, lead: null });
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
    const key = rs.map((r) => issueOf(r)).find((k) => k !== undefined);
    const finished = Math.max(...ends), started = Math.min(...agents.map((r) => Date.parse(r.started)));
    if (inWindow(finished)) { implement.push({ at: finished, secs: (finished - started) / 1000 }); note(key, "implement", (finished - started) / 1000); }
    if (inWindow(landed)) { land.push({ at: landed, secs: (landed - finished) / 1000 }); note(key, "land", (landed - finished) / 1000); }
  }
  // Queue and Lead are per issue. A run older than its filing (a file added again) has no such span.
  const firstStart = new Map<string, number>(), lastLand = new Map<string, number>(), triaged = new Map<string, number>();
  for (const r of runs) {
    const key = issueOf(r);
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
    const key = issueOf(r);
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
