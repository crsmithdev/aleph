/**
 * The account's weekly plan usage. The UI server polls Anthropic's OAuth usage
 * endpoint (the one Claude Code's `/usage` reads; undocumented, so it can
 * change) every 10 minutes and appends a row to ~/.aleph/usage.jsonl. From the
 * rows and the dollars aleph saw spent it estimates each job's and session's
 * share of the week. The token is read per call and never logged or returned.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { allRuns, expand } from "../jobs/lib/records/ledger.ts";
import { config, traces } from "./langfuse.ts";
import { once, touch } from "../jobs/lib/infra/sources.ts";
import { credentialsFileSetting, usageFileSet, usageFileSetting, usageUrl as usageUrlSetting } from "../jobs/lib/infra/settings.ts";

export interface Snapshot { at: string; five_hour: number | null; seven_day: number; seven_day_resets_at: string | null }
export interface Spend { at: number; model: string; cost: number }
/** A job's or session's estimated share of the week: percent of the weekly limit, and whether the pooled rate priced it. */
export interface Wk { pct: number; pooled: boolean }
export interface Fit { pooled: number; byModel: Record<string, number>; hours: number }

const POLL_MS = 10 * 60_000;
const MIN_HOURS = 6;
const MIN_DOLLARS = 5;
const HOUR = 3600_000;
const STALE_MS = 25 * 60_000;

const usageFile = () => expand(usageFileSetting());
const credentialsFile = () => expand(credentialsFileSetting());
const usageUrl = usageUrlSetting;

/** Whether the last poll failed; the pages say "usage unknown" while it did. */
let lastFailed = false;

/** Logs why a poll failed, on one stderr line. Never the token, the credentials file or the response body. */
function failed(reason: string): null {
  console.error(`ui/usage: poll failed: ${reason}`);
  return null;
}

const errName = (e: unknown) => (e instanceof Error ? e.name : "error");

/**
 * One call to the endpoint: a snapshot, or null on any error, with the reason on stderr. The token stays inside this function.
 * A failed read or parse of the credentials file logs fixed text, because a JSON parse error can quote the file.
 */
async function fetchUsage(now = new Date()): Promise<Snapshot | null> {
  let token: unknown;
  try {
    token = JSON.parse(readFileSync(credentialsFile(), "utf8"))?.claudeAiOauth?.accessToken;
  } catch {
    return failed("credentials file cannot be read or parsed");
  }
  if (typeof token !== "string" || !token) return failed("no token in credentials file");
  let res: Response;
  try {
    res = await fetch(usageUrl(), {
      headers: { authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" }, signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    return failed(`network failure or timeout (${errName(e)})`);
  }
  if (!res.ok) {
    const retry = res.headers.get("retry-after");
    return failed(`HTTP ${res.status}${retry !== null ? `, Retry-After: ${retry}` : ""}`);
  }
  let b: any;
  try {
    b = await res.json();
  } catch (e) {
    return failed(e instanceof SyntaxError ? "response body is not valid JSON" : `network failure or timeout (${errName(e)})`);
  }
  const five = b?.five_hour?.utilization, seven = b?.seven_day?.utilization;
  if (typeof seven !== "number") return failed("response body has no usage numbers");
  const resets = b.seven_day.resets_at;
  return { at: now.toISOString(), five_hour: typeof five === "number" ? five : null, seven_day: seven, seven_day_resets_at: typeof resets === "string" ? resets : null };
}

/** Polls once: appends the snapshot to the file; on any error records nothing. */
export async function pollOnce(): Promise<Snapshot | null> {
  const snap = await fetchUsage();
  lastFailed = snap === null;
  if (!snap) return null;
  // Under `bun test` (NODE_ENV=test) the real ~/.aleph/usage.jsonl is never written: a test that sets a fixed clock and polls would leave a bad row there.
  if (process.env.NODE_ENV === "test" && !usageFileSet()) return snap;
  try {
    const file = usageFile();
    mkdirSync(dirname(file), { recursive: true });
    appendFileSync(file, JSON.stringify(snap) + "\n");
  } catch (e) {
    console.error(`ui/usage: cannot write ${usageFile()}: ${e instanceof Error ? e.message : "error"}`);
  }
  return snap;
}

/** Polls now and every `ms`, and calls `polled` after each snapshot it keeps. Returns a stop function. */
export function startPoller(ms = POLL_MS, polled = () => {}): () => void {
  const poll = () => void pollOnce().then((s) => { if (s) polled(); });
  poll();
  const timer = setInterval(poll, ms);
  timer.unref?.();
  return () => clearInterval(timer);
}

/** The snapshots dated at or before `clock`; a row dated after it cannot be a poll that has happened. */
export function readSnapshots(clock = Date.now()): Snapshot[] {
  touch("usage");
  const file = usageFile();
  if (!existsSync(file)) return [];
  const out: Snapshot[] = [];
  for (const l of readFileSync(file, "utf8").split("\n")) {
    try {
      const s = JSON.parse(l);
      if (typeof s?.at === "string" && Number.isFinite(Date.parse(s.at)) && typeof s.seven_day === "number") out.push({ at: s.at, five_hour: typeof s.five_hour === "number" && Number.isFinite(s.five_hour) ? s.five_hour : null, seven_day: s.seven_day, seven_day_resets_at: s.seven_day_resets_at ?? null });
    } catch { /* a torn line */ }
  }
  return out.filter((s) => Date.parse(s.at) <= clock).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
}

/** The snapshots since the last reset: a new reset time or a fall of the 7-day percent starts the window. */
export function sinceReset(snaps: Snapshot[]): Snapshot[] {
  let i = snaps.length - 1;
  while (i > 0) {
    const a = snaps[i - 1], b = snaps[i];
    const ra = Date.parse(a.seven_day_resets_at ?? ""), rb = Date.parse(b.seven_day_resets_at ?? "");
    if (b.seven_day < a.seven_day || (!Number.isNaN(ra) && !Number.isNaN(rb) && Math.abs(ra - rb) > HOUR)) break;
    i--;
  }
  return snaps.slice(i);
}

/** Solves A x = b by Gauss elimination; null when singular. */
function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[p][c])) p = r;
    if (Math.abs(M[p][c]) < 1e-12) return null;
    [M[c], M[p]] = [M[p], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

/**
 * Percent of the week per dollar. Over the intervals between snapshots since the last reset, the rise
 * in weekly percent is regressed on each model's dollars (least squares, no intercept). A model with
 * under MIN_DOLLARS in the window gets the pooled rate (all rises over all dollars). Null with under
 * MIN_HOURS of snapshots, or with no dollars.
 */
export function fit(snaps: Snapshot[], spends: Spend[]): Fit | null {
  const w = sinceReset(snaps);
  if (w.length < 2) return null;
  const t = w.map((s) => Date.parse(s.at));
  const hours = (t.at(-1)! - t[0]) / HOUR;
  if (hours < MIN_HOURS) return null;
  const rows: { dy: number; x: Map<string, number> }[] = [];
  const total = new Map<string, number>();
  for (let i = 0; i + 1 < w.length; i++) {
    const x = new Map<string, number>();
    for (const s of spends) if (s.at > t[i] && s.at <= t[i + 1] && s.cost > 0) {
      x.set(s.model, (x.get(s.model) ?? 0) + s.cost);
      total.set(s.model, (total.get(s.model) ?? 0) + s.cost);
    }
    rows.push({ dy: w[i + 1].seven_day - w[i].seven_day, x });
  }
  const dollars = [...total.values()].reduce((a, b) => a + b, 0);
  if (dollars <= 0) return null;
  const pooled = rows.reduce((a, r) => a + r.dy, 0) / dollars;
  const byModel: Record<string, number> = {};
  const big = [...total].filter(([, d]) => d >= MIN_DOLLARS).map(([m]) => m);
  if (big.length) {
    const A = big.map(() => big.map(() => 0)), b = big.map(() => 0);
    for (const r of rows) {
      const rest = [...r.x].filter(([m]) => !big.includes(m)).reduce((a, [, d]) => a + d, 0);
      const y = r.dy - pooled * rest;
      big.forEach((m, i) => {
        const xi = r.x.get(m) ?? 0;
        b[i] += xi * y;
        big.forEach((n, j) => { A[i][j] += xi * (r.x.get(n) ?? 0); });
      });
    }
    const sol = solve(A, b);
    big.forEach((m, i) => { const v = sol?.[i]; if (v !== undefined && Number.isFinite(v) && v > 0) byModel[m] = v; });
  }
  return { pooled: Math.max(0, pooled), byModel, hours };
}

/** The share of `cost` on `model`; none without a fit or a cost. */
export function share(f: Fit | null, cost: number | undefined, model?: string): Wk | undefined {
  if (!f || cost === undefined || !(cost > 0) || !(f.pooled > 0 || Object.keys(f.byModel).length)) return undefined;
  const own = model ? f.byModel[model] : undefined;
  return { pct: cost * (own ?? f.pooled), pooled: own === undefined };
}

/** The dollars aleph saw spent since `from`: the ledger's runs, and Langfuse sessions the ledger does not price. */
export async function spends(from: number): Promise<Spend[]> {
  const out: Spend[] = [];
  const jobIds = new Set<string>();
  for (const { run } of allRuns()) {
    if (run.job) jobIds.add(run.job);
    const at = Date.parse(run.ended ?? run.started);
    if (run.cost && at >= from) out.push({ at, model: run.model ?? "unknown", cost: run.cost });
  }
  try {
    const floor = Math.floor(from / HOUR) * HOUR;
    for (const t of await traces(config(), { fromTimestamp: new Date(floor).toISOString() }, "usage")) {
      if (!t.sessionId || jobIds.has(t.sessionId) || !(t.totalCost > 0)) continue;
      const at = Date.parse(t.timestamp);
      if (at >= from) out.push({ at, model: typeof t.metadata?.model === "string" ? t.metadata.model : "unknown", cost: t.totalCost });
    }
  } catch { /* Langfuse is optional here */ }
  return out;
}

/** The current fit, read once per pass of the UI's builds (sources.ts). */
export function currentFit(): Promise<Fit | null> {
  return once("fit", ["usage", "records"], async () => {
    const w = sinceReset(readSnapshots());
    if (w.length < 2) return null;
    return fit(w, await spends(Date.parse(w[0].at)));
  });
}

interface UsageSummary {
  /** The last snapshot of the reset window, or null with none or when its week has ended. */
  now: Snapshot | null;
  /** True when the last poll failed or the snapshot is older than STALE_MS. */
  stale: boolean;
  /** The 7-day percent since the last reset. */
  series: { at: string; seven_day: number }[];
  /** Hours of snapshots since the last reset. */
  hours: number;
  /** Weekly percent points used in the last 5 hours (`gainSince`); null with no snapshot near 5 hours ago in the reset window. */
  last5h: number | null;
}

/** How far from the target time a snapshot may lie to count as "nearest": a bit over the 10-minute poll, times 3. */
const NEAR_MS = 30 * 60_000;

/**
 * The latest seven_day minus the seven_day of the snapshot nearest to `ms` before the latest one, among
 * the snapshots of one reset window (`w`). Null when there is no snapshot within NEAR_MS of that time.
 */
export function gainSince(w: Snapshot[], ms: number): number | null {
  const last = w.at(-1);
  if (!last) return null;
  const target = Date.parse(last.at) - ms;
  let best: Snapshot | null = null;
  for (const s of w.slice(0, -1)) {
    const d = Math.abs(Date.parse(s.at) - target);
    if (d <= NEAR_MS && (!best || d < Math.abs(Date.parse(best.at) - target))) best = s;
  }
  return best ? Math.max(0, last.seven_day - best.seven_day) : null;
}

/** What the Status page shows; `now` is null with no snapshot or after the snapshot's week ended; `stale` marks an old or failed one. */
export function summary(clock = Date.now()): UsageSummary {
  const w = sinceReset(readSnapshots(clock));
  const last = w.at(-1);
  const resets = last ? Date.parse(last.seven_day_resets_at ?? "") : NaN;
  const known = last && !(resets <= clock);
  return {
    now: known ? last : null,
    stale: !!known && (lastFailed || clock - Date.parse(last.at) > STALE_MS),
    series: w.map((s) => ({ at: s.at, seven_day: s.seven_day })),
    hours: w.length > 1 ? (Date.parse(w.at(-1)!.at) - Date.parse(w[0].at)) / HOUR : 0,
    last5h: gainSince(w, 5 * HOUR),
  };
}

/** Sets `wk` on each job that has a cost and a fit. */
export function annotate<T extends { cost?: number; model?: string; wk?: Wk }>(jobs: T[], f: Fit | null): void {
  for (const j of jobs) { const w = share(f, j.cost, j.model); if (w) j.wk = w; }
}
