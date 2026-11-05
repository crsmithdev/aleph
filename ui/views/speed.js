// What the Status pages share: formats, the /api/speed cache, the merged causes, tiles and the usage pace.
import { cardTrend, meter, day, dur, hourLabel, esc, hours, mean, pct, projectNow, statCard, when } from "../lib.js";

/** Seconds for a big number: "59s", "26m" or "4h 36m". */
export const durShort = (s) => (s >= 60 && s < 3600 ? `${Math.floor(s / 60)}m` : dur(s));
export const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
export { hours };
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
let loadedFor = ""; // the project of the cached answers
/** The last answer for a window, or null; a failed load is `{ error }`. */
export const speedOf = (window) => got.get(window) ?? null;
export const resetSpeed = () => got.clear();
/** A usable answer for a window, or null. */
export const usable = (window) => { const d = speedOf(window); return d && !d.error ? d : null; };
/** Fetch a window of a project (the address's, by default) into the cache. A failed reload keeps the last good answer. */
export async function loadSpeed(window, fetcher = fetch, baseline = false, project = projectNow()) {
  if (project !== loadedFor) { got.clear(); loadedFor = project; }
  try {
    const res = await fetcher(`/api/speed?window=${window}${baseline ? "&baseline=1" : ""}${project ? `&project=${encodeURIComponent(project)}` : ""}`, { cache: "no-store" });
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
/** A time on a Status card: "45s", "20m", "1h35m". */
export const cardDur = (s) => (s != null && Math.round(s) >= 60 && Math.round(s) < 3600 ? `${Math.floor(Math.round(s) / 60)}m` : dur(s));
export const cardPct = (v) => (v == null ? "–" : pct(v * 100));
export const cardHours = (h) => (h === null || h === undefined ? "–" : `${mean(h)}h`);

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
  const landed = statCard({ k: "Landed", v: cardPct(f?.firstPass), ...(f?.firstPass == null || f.landed == null ? {} : { v2: String(f.landed) }), q: ["clean", "landed"], trend: t("firstPass", { kind: "points", lowerIsGood: false, format: cardPct }), href: efficiency });
  const asks = statCard({ k: "Asks", v: f?.asks == null ? "–" : String(f.asks), ...(f ? { v2: String(d.asks?.manual ?? 0) } : {}), q: ["All", "Manual"], trend: t("asks", { kind: "relative", lowerIsGood: true, format: String }), href: performance });
  return lost + lead + landed + asks + usageCard(s);
}

/** The figures of an answer, as the server's baseline gives them. */
export function figuresOf(d) {
  const total = (d.classes ?? []).reduce((a, c) => a + c.hours, 0), lead = d.phases?.lead, asks = d.asks;
  return {
    lost: total > 0 ? d.lost.share : null, hours: total > 0 ? d.lost.hours : null,
    leadP50: lead?.count ? lead.p50 : null, leadP90: lead?.count ? lead.p90 : null,
    asks: asks?.count ?? null,
    landed: total > 0 || d.done > 0 ? d.done : null, firstPass: d.issues?.firstPass ?? null,
  };
}

/** The Usage card: the 7-day value, the bar with the mark for the week gone, and an optional note. `link` is `{href}` or `{key, on}`. */
export function usageCard(s, link = { href: "#/factory/agents" }, note) {
  const cur = s.usage?.now;
  if (!cur) return statCard({ k: "Usage", v: "–", note: note && "usage unknown", ...link });
  const gone = weekGone(cur.seven_day_resets_at, s.now);
  const tip = gone === null ? "" : `${pct(gone)} of the week gone`;
  const bar = meter([{ pct: Math.min(100, cur.seven_day), cls: "c-use" }], `${pct(cur.seven_day)} used${tip && `, ${tip}`}`, { mark: gone });
  return statCard({ k: "Usage", v: pct(cur.seven_day), extra: bar, note, ...link });
}

const LANDED = ["landed", "fixed"];
/** The outcome bar: one segment per class with hours, `key` the pressed one. `d` is /api/speed for the window. */
export function bar(d, key) {
  const cs = (d.classes ?? []).filter((c) => c.hours > 0), total = cs.reduce((a, c) => a + c.hours, 0);
  if (!(total > 0)) return `<p>No agent run of an issue ended in the ${lastPeriod(d)}.</p>`;
  const seg = (c) => `<button type="button" class="seg-${esc(c.key)}" data-tile="${esc(c.key)}" style="flex:${c.hours}" aria-pressed="${c.key === key}" title="${esc(c.text)}"><b>${esc(c.name)}</b><span>${esc(hours(c.hours))} · ${esc(pct((c.hours / total) * 100))}</span></button>`;
  const group = (xs, t) => (xs.length ? `<div class="ogrp" style="flex:${xs.reduce((a, c) => a + c.hours, 0)}"><span class="obk">${t}</span><div class="osegs">${xs.map(seg).join("")}</div></div>` : "");
  const good = cs.filter((c) => LANDED.includes(c.key)), lost = cs.filter((c) => !LANDED.includes(c.key));
  const sep = good.length && lost.length ? `<i class="osep" role="separator" title="Left of the line reached main; right of it did not"></i>` : "";
  return `<div class="obar" role="group" aria-label="Agent time">${group(good, "Reached main")}${sep}${group(lost, "Did not reach main")}</div>`;
}
