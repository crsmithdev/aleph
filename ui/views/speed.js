// What the Status pages share: formats, the /api/speed cache, the merged causes, tiles and the usage pace.
import { barRow, day, dur, hourLabel, esc, hours, mean, pct, small, tile, when } from "../lib.js";

/** Seconds for a big number: "59s", "26m" or "4h 36m". */
export const durShort = (s) => (s >= 60 && s < 3600 ? `${Math.floor(s / 60)}m` : dur(s));
export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export { hours };
export const pctText = (w) => pct((w || 0) * 100);
/** A percent of the weekly limit: one decimal, but a small nonzero value shows "<0.1%" rather than "0.0%". */
export const weekText = (v) => pct(v);

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
  return hourLabel(d);
}

const got = new Map();
/** The last answer for a window, or null; a failed load is `{ error }`. */
export const speedOf = (window) => got.get(window) ?? null;
export const resetSpeed = () => got.clear();
/** A usable answer for a window, or null. */
export const usable = (window) => { const d = speedOf(window); return d && !d.error ? d : null; };
/** Fetch a window into the cache. A failed reload keeps the last good answer. */
export async function loadSpeed(window, fetcher = fetch, baseline = false) {
  try {
    const res = await fetcher(`/api/speed?window=${window}${baseline ? "&baseline=1" : ""}`, { cache: "no-store" });
    if (!res.ok) throw new Error(`Could not load speed (${res.status}).`);
    // With `baseline=1` the answer carries the window's trend baseline (`d.baseline`): one request per window.
    const { others, ...d } = await res.json();
    got.set(window, d);
    // The day and month answers come in the same answer (the Efficiency page reads them): one request fills all three.
    for (const [k, v] of Object.entries(others ?? {})) if (k !== window) got.set(k, v);
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

/** The last 24h against the window: the arrow gives the direction, the colour whether that is good. */
export function trend(week, day, format, lowerIsGood = true) {
  if (day === null || day === undefined) return small("none in the last 24h");
  if (week === null || week === undefined || day === week) return small(`${format(day)} in the last 24h`);
  const down = day < week;
  return `<span class="${down === lowerIsGood ? "good" : "warn"}">${down ? "▼" : "▲"} ${esc(format(day))} in the last 24h</span>`;
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
  const label = p ? `${pct(p.used)} used, ${pct(p.gone)} of the week gone` : `${pct(cur.seven_day)} used`;
  const bar = `<div class="usebar" role="img" aria-label="${esc(label)}"><div style="width:${Math.min(100, cur.seven_day)}%"></div>${p ? `<i style="left:${p.gone}%"></i>` : ""}</div>`;
  const notes = (p ? small(`${p.word} pace: ${pct(p.gone)} of the week gone`) : "") + (cur.seven_day_resets_at ? small(`resets ${when(cur.seven_day_resets_at, new Date(s.now))}`) : "") + (usageAge(s) ? small(usageAge(s)) : "");
  return tile({ k: "Weekly usage", v: pct(cur.seven_day), body: bar + notes + extra, ...link });
}

/** A time on a Status card: "45s", "20m", "1h35m". */
export const cardDur = (s) => (s != null && Math.round(s) >= 60 && Math.round(s) < 3600 ? `${Math.floor(Math.round(s) / 60)}m` : dur(s));
export const cardPct = (v) => (v == null ? "–" : pct(v * 100));
export const cardHours = (h) => (h === null || h === undefined ? "–" : `${mean(h)}h`);

/**
 * The trend of a card: an arrow and a percent, green when good and amber when bad, with the previous value and the baseline in the tooltip.
 * `kind` "points" compares shares (0 to 1) in percentage points; "relative" compares times and counts by relative change.
 * Empty with no value or no baseline.
 */
export function cardTrend(value, base, prev, { kind, lowerIsGood, format, basis }) {
  if (value === null || value === undefined || base === null || base === undefined) return "";
  const change = kind === "points" ? (value - base) * 100 : base === 0 ? (value === 0 ? 0 : NaN) : ((value - base) / base) * 100;
  if (Number.isNaN(change)) return "";
  const down = change < 0;
  const tip = `${prev === null || prev === undefined ? "No previous value" : `Previous ${format(prev)}`}; baseline ${format(base)}, ${basis}${kind === "points" ? " (change in percentage points)" : ""}`;
  if (change === 0) return `<span class="tr" title="${esc(tip)}">▬ 0%</span>`;
  return `<span class="tr ${down === lowerIsGood ? "good" : "warn"}" title="${esc(tip)}">${down ? "▼" : "▲"} ${pct(Math.abs(change))}</span>`;
}

/**
 * A Status card: row 1 the label and the trend, row 2 the value and the second value, row 3 an optional qualifier ("p50 / p90").
 * `v` and `v2` are text; `q` is `[first, second]`; `trend` is HTML; `extra` is HTML after the value.
 */
export function statCard({ k, v, v2, q, note, trend: tr = "", extra = "", href, key, on = false }) {
  const second = v2 === undefined ? "" : `<em> / ${esc(v2)}</em>`;
  const qual = q ? `<span class="q"><span>${esc(q[0])}</span><span class="m"> / ${esc(q[1])}</span></span>` : note ? `<span class="q m">${esc(note)}</span>` : "";
  return tile({ cls: "sc", html: `<span class="r1"><span class="k">${esc(k)}</span>${tr}</span><b>${esc(v)}${second}</b>${extra}${qual}`, key, on, href });
}

/** The trend of one figure of `d` against the baseline of its own /api/speed answer; empty with no baseline. */
export function windowTrend(d, figure, value, o) {
  const base = d?.baseline?.base;
  if (!base) return "";
  return cardTrend(value, base[figure], d.baseline.prev?.[figure], { basis: d.baseline.basis ?? "", ...o });
}

/** The five cards of the Status scorecard. `d` is /api/speed for the window with `baseline`, or null while it loads. */
export function statusCards(s, d, { efficiency, performance }) {
  const base = d?.baseline?.base, prev = d?.baseline?.prev, basis = d?.baseline?.basis ?? "";
  const f = d && !d.error ? figuresOf(d) : null;
  const t = (key, o) => (f && base ? cardTrend(f[key], base[key], prev?.[key], { basis, ...o }) : "");
  const lost = statCard({ k: "Lost time", v: f ? cardPct(f.lost) : "–", ...(f?.lost == null ? {} : { v2: cardHours(f.hours) }), trend: t("lost", { kind: "points", lowerIsGood: true, format: cardPct }), href: efficiency });
  const lead = statCard({ k: "Completion", v: cardDur(f?.leadP50), v2: cardDur(f?.leadP90), q: ["p50", "p90"], trend: t("leadP50", { kind: "relative", lowerIsGood: true, format: cardDur }), href: performance });
  const landed = statCard({ k: "Landed", v: f?.landed == null ? "–" : String(f.landed), v2: cardPct(f?.firstPass), q: ["issues", "clean"], trend: t("landed", { kind: "relative", lowerIsGood: false, format: String }), href: efficiency });
  const queue = statCard({ k: "Queue wait", v: cardDur(f?.queueP50), v2: cardDur(f?.queueP90), q: ["p50", "p90"], trend: t("queueP50", { kind: "relative", lowerIsGood: true, format: cardDur }), href: performance });
  return lost + lead + landed + queue + usageCard(s);
}

/** The figures of an answer, as the server's baseline gives them. */
export function figuresOf(d) {
  const total = (d.classes ?? []).reduce((a, c) => a + c.hours, 0), lead = d.phases?.lead, queue = d.phases?.queue;
  return {
    lost: total > 0 ? d.lost.share : null, hours: total > 0 ? d.lost.hours : null,
    leadP50: lead?.count ? lead.p50 : null, leadP90: lead?.count ? lead.p90 : null,
    queueP50: queue?.count ? queue.p50 : null, queueP90: queue?.count ? queue.p90 : null,
    landed: total > 0 || d.done > 0 ? d.done : null, firstPass: d.issues?.firstPass ?? null,
  };
}

/** The Usage card: the 7-day value, the bar and the mark for the week gone; nothing else. */
export function usageCard(s) {
  const cur = s.usage?.now;
  if (!cur) return statCard({ k: "Usage", v: "–", href: "#/factory/agents" });
  const gone = weekGone(cur.seven_day_resets_at, s.now);
  const tip = gone === null ? "" : `${pct(gone)} of the week gone`;
  const bar = `<div class="usebar"${tip ? ` title="${esc(tip)}" role="img" aria-label="${esc(tip)}"` : ""}><div style="width:${Math.min(100, cur.seven_day)}%"></div>${gone === null ? "" : `<i style="left:${gone}%"></i>`}</div>`;
  return statCard({ k: "Usage", v: pct(cur.seven_day), extra: bar, href: "#/factory/agents" });
}
