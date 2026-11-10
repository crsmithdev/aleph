// The windows that a page's `?window=` names: each name, its length and its buckets, and the one quantile the pages use. The server reads `?window=` through `scopeOf` (ui/api/scope.ts) and the page through `scope` (ui/lib.js); the page gets this module as JS from the server (ui/server.ts, SHARED).

export const DAY = 86_400_000;
/** The length of each window in ms. */
export const WINDOWS: Record<string, number> = { hour: DAY / 24, day: DAY, week: 7 * DAY, month: 30 * DAY, quarter: 90 * DAY };
/** The windows of the Factory pages. */
export const FACTORY = ["hour", "day", "week", "month"] as const;
export type Window = (typeof FACTORY)[number];
/** The windows of the Sessions page, and of the skills it reads. */
export const SESSIONS = ["week", "month", "quarter"];

/** The buckets of each Factory window: how many, the unit each one spans in ms, its name, and the finer width in ms of an agents point. */
export const BUCKETS: Record<Window, { n: number; unit: number; name: string; fine: number }> = {
  hour: { n: 60, unit: 60_000, name: "minute", fine: 60_000 },
  day: { n: 24, unit: DAY / 24, name: "hour", fine: DAY / 96 },
  week: { n: 7, unit: DAY, name: "day", fine: DAY / 24 },
  month: { n: 30, unit: DAY, name: "day", fine: DAY / 4 },
};

/**
 * The buckets of `window` up to `now` (ms): each starts on its unit (the minute, the hour, the local midnight) and the last holds `now`.
 * `since`..`until` is the span they cover; `slotOf` gives the bucket of a time, or -1 outside the span.
 */
export function buckets(window: Window, now: number): { since: number; until: number; starts: number[]; slotOf: (t: number) => number } {
  const { n, unit } = BUCKETS[window], d = new Date(now);
  // A day is a calendar day, so a DST change gives it 23 or 25 hours.
  const start = (i: number) => (unit === DAY ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - i).getTime() : Math.floor(now / unit) * unit - i * unit);
  const starts = Array.from({ length: n }, (_, i) => start(n - 1 - i)), since = starts[0], until = start(-1);
  return { since, until, starts, slotOf: (t) => (t >= since && t < until ? starts.findLastIndex((s) => s <= t) : -1) };
}

/** The nearest-rank `q` quantile (0..1) of `values`: the median of an even count is the lower middle value; null for none. */
export function quantile(values: number[], q: number): number | null {
  if (!values.length) return null;
  const s = values.toSorted((a, b) => a - b);
  return s[Math.max(0, Math.ceil(q * s.length) - 1)];
}
