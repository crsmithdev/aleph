// What the Status pages share: formats, the /api/speed cache, the merged causes, tiles and the usage pace.
import { barRow, day, dur, esc, small, tile, when } from "../lib.js";

/** Seconds for a big number: "59s", "26m" or "4h 36m". */
export const durShort = (s) => (s >= 60 && s < 3600 ? `${Math.floor(s / 60)}m` : dur(s));
export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const hours = (h) => `${h.toFixed(h < 10 ? 1 : 0)} h`;
export const pctText = (w) => `${Math.round((w || 0) * 100)}%`;
/** A percent of the weekly limit: one decimal, but a small nonzero value shows "<0.1%" rather than "0.0%". */
export const weekText = (v) => (v > 0 && v < 0.05 ? "<0.1%" : `${v.toFixed(1)}%`);

/** The period an answer covers, in words. */
export const period = (d) => PERIODS[d?.window] ?? PERIODS.week;
const PERIODS = { hour: "hour", day: "24 hours", week: "7 days", month: "30 days" };
/** The bucket of a window: a minute, an hour or a day. */
export const bucketOf = (d) => ({ hour: "minute", day: "hour" })[d?.window] ?? "day";
/** The last 24 hours are a different span from the window only in week and month. */
export const trendOn = (d) => d?.window === "week" || d?.window === "month" || !d?.window;
/** "last 7 days": the span as the page says it. */
export const lastPeriod = (d) => `last ${period(d)}`;

/** A bucket's x-axis label: "4a" or "1:36p" in the hour and day windows, "Oct 25" in week and month. */
export function xLabel(at, window) {
  const d = new Date(at);
  if (window === "week" || window === "month") return day(d);
  const m = d.getMinutes();
  return `${d.getHours() % 12 || 12}${m ? `:${String(m).padStart(2, "0")}` : ""}${d.getHours() < 12 ? "a" : "p"}`;
}

const got = new Map();
/** The last answer for a window, or null; a failed load is `{ error }`. */
export const speedOf = (window) => got.get(window) ?? null;
export const resetSpeed = () => got.clear();
/** A usable answer for a window, or null. */
export const usable = (window) => { const d = speedOf(window); return d && !d.error ? d : null; };
/** Fetch a window into the cache. A failed reload keeps the last good answer. */
export async function loadSpeed(window, fetcher = fetch) {
  try {
    const res = await fetcher(`/api/speed?window=${window}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load speed (${res.status}).`);
    got.set(window, await res.json());
  } catch (e) { if (!usable(window)) got.set(window, { error: e.message }); }
  return got.get(window);
}

/** The classes whose work did not reach main. */
export const lostClasses = (d) => (d.classes ?? []).slice(2);
/** The causes of all lost time: one row per name, largest first. */
export function mergeCauses(d) {
  const by = new Map();
  for (const c of lostClasses(d)) for (const x of c.causes ?? []) {
    const m = by.get(x.name) ?? { name: x.name, hours: 0, runs: 0 };
    m.hours += x.hours; m.runs += x.runs;
    by.set(x.name, m);
  }
  return [...by.values()].sort((a, b) => b.hours - a.hours);
}

/** One ranked cause row with its bar; the first is the hot one. `name` is HTML. */
export const causeRow = (name, x, max, top) =>
  barRow(name, max > 0 ? (x.hours / max) * 100 : 0, `${esc(hours(x.hours))} · ${esc(plural(x.runs, "run"))}`, { top });

/** The last 24 h against the window: the arrow gives the direction, the colour whether that is good. */
export function trend(week, day, format, lowerIsGood = true) {
  if (day === null || day === undefined) return small("none in the last 24 h");
  if (week === null || week === undefined || day === week) return small(`${format(day)} in the last 24 h`);
  const down = day < week;
  return `<span class="${down === lowerIsGood ? "good" : "warn"}">${down ? "▼" : "▲"} ${esc(format(day))} in the last 24 h</span>`;
}

const WEEK_MS = 7 * 24 * 3600 * 1000;
/** The share of the usage week that is gone, 0 to 100; null with no reset time. */
export function weekGone(resetsAt, now) {
  const left = Date.parse(resetsAt ?? "") - Date.parse(now);
  return Number.isNaN(left) ? null : Math.min(100, Math.max(0, 100 - (left / WEEK_MS) * 100));
}
/** The pace sentence, or null when the usage or the reset time is unknown. */
export function pace(s) {
  const cur = s.usage?.now, gone = cur && weekGone(cur.seven_day_resets_at, s.now);
  if (gone === null || gone === undefined) return null;
  return { used: cur.seven_day, gone, word: cur.seven_day > gone ? "over" : "under" };
}
/** "as of 40m ago" for a stale snapshot, else "". */
export function usageAge(s) {
  const cur = s.usage?.now;
  if (!cur || !s.usage.stale) return "";
  const sec = Math.max(0, (Date.parse(s.now) - Date.parse(cur.at)) / 1000);
  return Number.isNaN(sec) ? "" : `as of ${durShort(sec)} ago`;
}
/** The Weekly usage tile: the used share, the bar with the mark for the week gone, the reset time. `link` is `{key, on}` or `{href}`. */
export function usageTile(s, link = {}, extra = "") {
  const cur = s.usage?.now;
  if (!cur) return tile({ k: "Weekly usage", v: "–", body: small("usage unknown") + extra, ...link });
  const p = pace(s);
  const label = p ? `${Math.round(p.used)}% used, ${p.gone.toFixed(1)}% of the week gone` : `${Math.round(cur.seven_day)}% used`;
  const bar = `<div class="usebar" role="img" aria-label="${esc(label)}"><div style="width:${Math.min(100, cur.seven_day)}%"></div>${p ? `<i style="left:${p.gone}%"></i>` : ""}</div>`;
  const notes = (p ? small(`${p.word} pace: ${p.gone.toFixed(1)}% of the week gone`) : "") + (cur.seven_day_resets_at ? small(`resets ${when(cur.seven_day_resets_at, new Date(s.now))}`) : "") + (usageAge(s) ? small(usageAge(s)) : "");
  return tile({ k: "Weekly usage", v: `${Math.round(cur.seven_day)}%`, body: bar + notes + extra, ...link });
}

/** The Lost time tile, on Status and on Efficiency. */
export function lostTile(d, last, link = {}) {
  if (!d) return tile({ k: "Lost time", v: "–", body: small("agent time that did not reach main"), ...link });
  const total = (d.classes ?? []).reduce((a, c) => a + c.hours, 0);
  return tile({ k: "Lost time", v: pctText(d.lost.share), body: small(`${hours(d.lost.hours)} of ${hours(total)} agent time, ${period(d)}`) + (trendOn(d) ? trend(d.lost.share, last ? last.lost.share : null, pctText) : ""), ...link });
}
/** The First pass tile, on Status and on Efficiency. */
export function firstPassTile(d, last, link = {}) {
  const v = d?.issues?.firstPass ?? null;
  return tile({ k: "First pass", v: v === null ? "–" : pctText(v), body: small(d && v === null ? "no issue landed" : "lands with no fix round") + (v === null || !trendOn(d) ? "" : trend(v, last?.issues?.firstPass ?? null, pctText, false)), ...link });
}
