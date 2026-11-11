/**
 * The account's weekly plan usage. The UI server polls Anthropic's OAuth usage
 * endpoint (the one Claude Code's `/usage` reads; undocumented, so it can
 * change) every 10 minutes and appends a row to ~/.aleph/usage.jsonl. From the
 * rows and the hourly Claude dollars in Langfuse it estimates each job's and
 * session's share of the week. The token is read per call and never logged or
 * returned. The same poll records what OpenRouter bills per list dollar.
 */
import { readJsonOr } from "../lib/json.ts";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { need, type Hourly } from "../lib/langfuse.ts";
import { jevFile } from "../lib/jev.ts";
import { openRouterFile, openRouterSpend, viaOf } from "../jobs/lib/routing/models.ts";
import { once, touch } from "../lib/sources.ts";
import { credentialsFile, usageFile, usageFileSet, usageUrl as usageUrlSetting } from "../jobs/lib/infra/settings.ts";

export interface Snapshot { at: string; five_hour: number | null; seven_day: number; seven_day_resets_at: string | null }
/** A job's or session's estimated share of the week: percent of the weekly limit, and whether the pooled rate priced it. */
export interface Wk { pct: number; pooled: boolean }
/** Percent of the week per Claude dollar, on Fable and on the other models; `pooled`: one rate for both. `hours`: the rows of the fit. */
export interface Fit { fable: number; rest: number; pooled: boolean; hours: number }

const POLL_MS = 10 * 60_000;
const MIN_HOURS = 6;
/** Below this many Fable dollars in the window its rate is noise. */
const MIN_FABLE = 20;
/** Below this many list dollars on OpenRouter the bill's rounding swamps the rate. */
const MIN_LIST = 0.25;
const HOUR = 3600_000;
const WEEK = 7 * 24 * HOUR;
const WINDOW = 4 * WEEK;
const NEAR_HOUR = 15 * 60_000;
const STALE_MS = 25 * 60_000;

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
    token = readJsonOr<any>(credentialsFile(), null)?.claudeAiOauth?.accessToken;
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
  const poll = () => { void pollOnce().then((s) => { if (s) polled(); }); void pollOpenRouter().catch(() => {}); };
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

/** The snapshot nearest each hour boundary, within NEAR_HOUR of it. */
function byHour(snaps: Snapshot[]): Map<number, Snapshot> {
  const out = new Map<number, Snapshot>();
  for (const s of snaps) {
    const t = Date.parse(s.at), h = Math.round(t / HOUR) * HOUR, b = out.get(h);
    if (Math.abs(t - h) <= NEAR_HOUR && (!b || Math.abs(t - h) < Math.abs(Date.parse(b.at) - h))) out.set(h, s);
  }
  return out;
}

const isFable = (model: string) => model.includes("fable");

/**
 * Percent of the week per dollar of Claude spend. Each hour with a snapshot at both ends, in one reset window, is a
 * row: the rise of the weekly percent against that hour's Fable and other Claude dollars. Two rates come from least
 * squares with no intercept: Fable draws about twice the rest per dollar (fit of 2026-10-28..11-11). With under
 * MIN_FABLE Fable dollars, or a rate that is not positive, one pooled rate prices all. Null under MIN_HOURS rows or no dollars.
 * The account is used off this machine too, so a week's estimate missed by about ±25% in holdout.
 */
export function fit(snaps: Snapshot[], spend: Hourly[]): Fit | null {
  const cost = new Map<number, [number, number]>();
  for (const x of spend) {
    if (viaOf(x.model) !== "claude" || !x.model.startsWith("claude-")) continue;
    const c = cost.get(x.at) ?? [0, 0];
    c[isFable(x.model) ? 0 : 1] += x.cost;
    cost.set(x.at, c);
  }
  const near = byHour(snaps);
  let ff = 0, fr = 0, rr = 0, fy = 0, ry = 0, n = 0, fable = 0;
  for (const [h, a] of near) {
    const b = near.get(h + HOUR);
    if (!b || sinceReset([a, b]).length < 2) continue;
    const [f, r] = cost.get(h) ?? [0, 0], y = b.seven_day - a.seven_day;
    ff += f * f; fr += f * r; rr += r * r; fy += f * y; ry += r * y; n++; fable += f;
  }
  const xx = ff + 2 * fr + rr;
  if (n < MIN_HOURS || !(xx > 0)) return null;
  const det = ff * rr - fr * fr;
  const f = (fy * rr - ry * fr) / det, r = (ry * ff - fy * fr) / det;
  if (fable >= MIN_FABLE && f > 0 && r > 0 && Number.isFinite(f) && Number.isFinite(r)) return { fable: f, rest: r, pooled: false, hours: n };
  const p = Math.max(0, (fy + ry) / xx);
  return { fable: p, rest: p, pooled: true, hours: n };
}

/** The share of `cost` on `model`: a model off Claude's subscription uses none of it. None without a fit or a cost. */
export function share(f: Fit | null, cost: number | undefined, model?: string): Wk | undefined {
  if (!f || cost === undefined || !(cost > 0)) return undefined;
  const rate = viaOf(model) !== "claude" ? 0 : model && isFable(model) ? f.fable : f.rest;
  return { pct: cost * rate, pooled: f.pooled };
}

/** A run's share: its own cost on its model and its reviewer's cost on the review's model. */
export function runShare(f: Fit | null, run: { cost?: number; model?: string; review?: { cost?: number; model?: string } }): Wk | undefined {
  const rv = run.review?.cost ?? 0;
  const own = share(f, (run.cost ?? 0) - rv, run.model), review = share(f, rv, run.review?.model);
  return own || review ? { pct: (own?.pct ?? 0) + (review?.pct ?? 0), pooled: f!.pooled } : undefined;
}

/** The current fit over the last WINDOW, read once per pass of the UI's builds (sources.ts); null when Langfuse does not answer. */
export function currentFit(): Promise<Fit | null> {
  return once("fit", ["usage"], async () => {
    const to = Date.now(), from = to - WINDOW;
    const snaps = readSnapshots(to).filter((s) => Date.parse(s.at) >= from);
    try { return fit(snaps, await need().hourly({ from: new Date(from), to: new Date(to) }, "usage")); }
    catch { return null; }
  });
}

/**
 * Appends the OpenRouter key's lifetime USD and, with MIN_LIST of list-price spend since the key's first line in the
 * last week, what it bills per list dollar: the rise of the bill less Jev's calls (no transcript has them), over the
 * list price of the OpenRouter calls Langfuse saw. A fall of the lifetime USD is a new key and starts over.
 */
export async function pollOpenRouter(now = Date.now()): Promise<void> {
  if (process.env.NODE_ENV === "test" && !process.env.ALEPH_OPENROUTER_FILE) return;
  const spent = await openRouterSpend();
  if (!spent || typeof spent.total !== "number") return;
  const key: { at: string; usage: number }[] = [];
  for (const r of lines(openRouterFile())) {
    if (typeof r?.usage !== "number") continue;
    if (key.length && r.usage < key.at(-1)!.usage) key.length = 0;
    key.push(r);
  }
  if (key.length && spent.total < key.at(-1)!.usage) key.length = 0;
  const base = key.find((r) => Date.parse(r.at) >= now - WEEK);
  const row: { at: string; usage: number; factor?: number } = { at: new Date(now).toISOString(), usage: spent.total };
  if (base) {
    const from = Date.parse(base.at);
    const list = (await need().hourly({ from: new Date(from), to: new Date(now) }, "usage").catch(() => []))
      .filter((h) => viaOf(h.model) === "openrouter").reduce((a, h) => a + h.cost, 0);
    const jev = lines(jevFile()).filter((j) => Date.parse(j?.at) > from && Date.parse(j.at) <= now).reduce((a, j) => a + (j.cost ?? 0), 0);
    const factor = (spent.total - base.usage - jev) / list;
    if (list >= MIN_LIST && factor > 0) row.factor = factor;
  }
  try {
    mkdirSync(dirname(openRouterFile()), { recursive: true });
    appendFileSync(openRouterFile(), JSON.stringify(row) + "\n");
  } catch (e) {
    console.error(`ui/usage: cannot write ${openRouterFile()}: ${e instanceof Error ? e.message : "error"}`);
  }
}

/** The JSON lines of a file; a torn line is skipped. */
const lines = (file: string): any[] => existsSync(file)
  ? readFileSync(file, "utf8").split("\n").flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } })
  : [];

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
  /** Percent of the week spent off this machine, set by `/api/factory`; see `off`. */
  off?: number | null;
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

/** The hour the week of `u` began, where Langfuse's hourly rows start: its reset less a week, to the nearest hour; with no reset time, the first snapshot's hour. */
function weekStart(u: UsageSummary): number {
  const r = Date.parse(u.now?.seven_day_resets_at ?? "") - WEEK;
  return Number.isNaN(r) ? Math.floor(Date.parse(u.series[0].at) / HOUR) * HOUR : Math.round(r / HOUR) * HOUR;
}

/** The weekly percent spent off this machine: the latest 7-day percent less the fit's share of this machine's Claude dollars since the reset, at least 0. Null with no fit or no current snapshot. */
export function off(f: Fit | null, u: UsageSummary, spend: Hourly[]): number | null {
  if (!f || !u.now) return null;
  const from = weekStart(u);
  const mine = spend.filter((x) => x.at >= from && x.model.startsWith("claude-")).reduce((a, x) => a + (share(f, x.cost, x.model)?.pct ?? 0), 0);
  return Math.max(0, u.now.seven_day - mine);
}

/** `summary()` with `off` set: the spend since the reset comes from Langfuse; `off` is null when it does not answer. */
export async function summaryOff(f: Fit | null): Promise<UsageSummary> {
  const u = summary();
  if (!f || !u.now) return { ...u, off: null };
  const from = new Date(weekStart(u));
  try { return { ...u, off: off(f, u, await need().hourly({ from, to: new Date() }, "usage")) }; }
  catch { return { ...u, off: null }; }
}
