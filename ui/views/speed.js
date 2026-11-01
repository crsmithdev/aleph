// What the Status pages share: formats, the /api/speed cache, the merged causes, tiles and the usage pace.
import { esc, when } from "../lib.js";

/** Seconds as "43s", "4m 05s" or "1h 02m"; "–" for none. */
export function dur(s) {
  if (s === null || s === undefined || Number.isNaN(s)) return "–";
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
/** Seconds for a big number: "59s", "26m" or "4h 36m". */
export const durShort = (s) => (s >= 60 && s < 3600 ? `${Math.floor(s / 60)}m` : dur(s));
export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export const hours = (h) => `${h.toFixed(h < 10 ? 1 : 0)} h`;
export const pctText = (w) => `${Math.round((w || 0) * 100)}%`;
/** A percent of the weekly limit: one decimal, but a small nonzero value shows "<0.1%" rather than "0.0%". */
export const weekText = (v) => (v > 0 && v < 0.05 ? "<0.1%" : `${v.toFixed(1)}%`);

/** A bucket's x-axis label: "4a" or "1:36p" in the hour and day windows, "10/25" in week and month. */
export function xLabel(at, window) {
  const d = new Date(at);
  if (window === "week" || window === "month") return `${d.getMonth() + 1}/${d.getDate()}`;
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
  `<div class="cause${top ? " top" : ""}">${name}<i style="width:${max > 0 ? (x.hours / max) * 100 : 0}%"></i><span>${esc(hours(x.hours))} · ${esc(plural(x.runs, "run"))}</span></div>`;

/** A scorecard tile: a link with `href`, else a plain block. `body` is HTML. */
export const tile = (k, v, body, href = "") => {
  const inner = `<span class="k">${esc(k)}</span><b>${esc(v)}</b>${body}`;
  return href ? `<a class="tile" href="${esc(href)}">${inner}</a>` : `<div class="tile">${inner}</div>`;
};
export const small = (t) => `<small>${esc(t)}</small>`;

/** The last 24 h against the 7 days: the arrow gives the direction, the colour whether that is good. */
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
/** The Weekly usage tile: the used share, the bar with the mark for the week gone, the reset time. */
export function usageTile(s, href = "") {
  const cur = s.usage?.now;
  if (!cur) return tile("Weekly usage", "–", small("usage unknown"), href);
  const p = pace(s);
  const label = p ? `${Math.round(p.used)}% used, ${p.gone.toFixed(1)}% of the week gone` : `${Math.round(cur.seven_day)}% used`;
  const bar = `<div class="usebar" role="img" aria-label="${esc(label)}"><div style="width:${Math.min(100, cur.seven_day)}%"></div>${p ? `<i style="left:${p.gone}%"></i>` : ""}</div>`;
  const notes = (p ? small(`${p.word} pace: ${p.gone.toFixed(1)}% of the week gone`) : "") + (cur.seven_day_resets_at ? small(`resets ${when(cur.seven_day_resets_at, new Date(s.now))}`) : "");
  return tile("Weekly usage", `${Math.round(cur.seven_day)}%`, bar + notes, href);
}

/** The head of a detail page. */
export const head = (title) => `<header class="head"><span>Last 7 days</span><h1>${esc(title)}</h1></header>`;
/** The Lost time tile, on Status and on Efficiency. */
export function lostTile(d, day, href = "") {
  if (!d) return tile("Lost time", "–", small("agent time that did not reach main"), href);
  const total = (d.classes ?? []).reduce((a, c) => a + c.hours, 0);
  return tile("Lost time", pctText(d.lost.share), small(`${hours(d.lost.hours)} of ${hours(total)} agent time, 7 days`) + trend(d.lost.share, day ? day.lost.share : null, pctText), href);
}
/** The First pass tile, on Status and on Efficiency. */
export function firstPassTile(d, day, href = "") {
  const v = d?.issues?.firstPass ?? null;
  return tile("First pass", v === null ? "–" : pctText(v), small(d && v === null ? "no issue landed" : "lands with no fix round") + (v === null ? "" : trend(v, day?.issues?.firstPass ?? null, pctText, false)), href);
}
