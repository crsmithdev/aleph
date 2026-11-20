// What the Status pages share: formats, the /api/flow load, tiles and the usage pace.
import { get } from "./router.js";
import { scope } from "./address.js";
import { cardPct, count, xLabel, day, dur, hourLabel, hours, pct, plural, when } from "./format.js";
import { cardTrend, empty, meter, esc, statCard } from "./html.js";
import { BUCKETS } from "../../../lib/windows.ts";

/** The period an answer covers, in words. */
export const period = (d) => (d?.window === "hour" ? "hour" : plural(BUCKETS[d?.window]?.n ?? 7, bucketOf(d)));
/** The bucket of a window: a minute, an hour or a day. */
export const bucketOf = (d) => BUCKETS[d?.window]?.name ?? "day";
/** The last 24 hours are a different span from the window only in week and month. */
export const trendOn = (d) => d?.window === "week" || d?.window === "month" || !d?.window;
/** "last 7 days": the span as the page says it. */
export const lastPeriod = (d) => `last ${period(d)}`;

/** The URL of /api/flow for `window` in the project of the query `q`, with the window's trend baseline when `baseline`. */
export const flowUrl = (window, q, baseline = false) => scope(q).url(`/api/flow?window=${window}${baseline ? "&baseline=1" : ""}`);
/** /api/flow for `window` in the project of the query `q`, with the window's trend baseline (`d.baseline`) when
 * `baseline`; `{ error }` when the load fails. */
export async function flowOf(window, q, baseline = false) {
  try {
    const res = await get(flowUrl(window, q, baseline));
    if (!res.ok) throw new Error(`Could not load Flow (${res.status}).`);
    return await res.json();
  } catch (e) { return { error: e.message }; }
}
/** A usable /api/flow answer, or null. */
export const usable = (d) => (d && !d.error ? d : null);

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
export const cardHours = (h) => (h === null || h === undefined ? "–" : hours(h));

/** The trend of one figure of `d` against the baseline of its own /api/flow answer; empty with no baseline. */
export function windowTrend(d, figure, value, o) {
  const base = d?.baseline?.base;
  if (!base) return "";
  return cardTrend(value, base[figure], d.baseline.prev?.[figure], { basis: d.baseline.basis ?? "", ...o });
}

/** The props of the five cards of the Status scorecard: the page draws each as a `statCard`, herdr as a line. `d` is /api/flow for the window with `baseline`, or null while it loads. */
export function cardList(s, d, { performance }) {
  const base = d?.baseline?.base, prev = d?.baseline?.prev, basis = d?.baseline?.basis ?? "";
  const f = d && !d.error ? d.figures : null, loading = !d, failed = d?.error ?? "";
  const t = (key, o) => (f && base ? cardTrend(f[key], base[key], prev?.[key], { basis, ...o }) : "");
  return [
    { k: "Lost time", loading, failed, ...(f ? { v: cardPct(f.lost) } : {}), ...(f?.lost == null ? {} : { v2: cardHours(f.hours), q: ["lost", "hours"] }), trend: t("lost", { kind: "points", lowerIsGood: true, format: cardPct }) },
    { k: "Completion", loading, failed, ...(f ? { v: dur(f.leadP50), v2: dur(f.leadP90) } : {}), q: ["p50", "p90"], trend: t("leadP50", { kind: "relative", lowerIsGood: true, format: dur }), href: performance },
    { k: "Landed", loading, failed, ...(f ? { v: cardPct(f.firstPass) } : {}), ...(f?.firstPass == null || f.landed == null ? {} : { v2: count(f.landed) }), q: ["clean", "landed"], trend: t("firstPass", { kind: "points", lowerIsGood: false, format: cardPct }) },
    { k: "Jobs", v: count(s.factory.liveRuns), v2: count(s.queued.length), q: ["running", "queued"], href: "#/factory/jobs" },
    usageProps(s),
  ];
}
/** The Status scorecard's five cards as HTML. */
export const statusCards = (s, d, links) => cardList(s, d, links).map((c) => statCard(c)).join("");

/** The props of the Usage card: the 7-day value, the bar with the mark for the week gone, and a one- or two-word note. `link` is `{href}` or `{key, on}`. */
function usageProps(s, link = { href: "#/factory/agents" }) {
  const cur = s.usage?.now, p = pace(s), off = s.usage?.off;
  if (!cur) return { k: "Usage", v: "–", ...link };
  const note = s.usage.stale ? "stale" : p ? `${p.word} pace` : "live";
  const gone = weekGone(cur.seven_day_resets_at, s.now);
  const tip = [`${pct(cur.seven_day)} used`, gone !== null && `${pct(gone)} of the week gone`, off != null && `${pct(off)} off this machine`].filter(Boolean).join(", ");
  const bar = meter([{ pct: Math.min(100, cur.seven_day) }], tip, { mark: gone });
  return { k: "Usage", v: pct(cur.seven_day), extra: bar, note, ...link };
}
export const usageCard = (s, link) => statCard(usageProps(s, link));

/** The kept share of agent time, for the Status card: the share that reached main as the figure, a thin bar, and a legend of two columns, kept then lost, each line an Inspector target. `d` is /api/flow for the window. */
export function share(d) {
  const { kept, hours: lostH } = d.figures;
  if (lostH === null) return empty();
  const total = kept + lostH, cs = d.classes.filter((c) => c.hours > 0), good = cs.filter((c) => !c.lost), lost = cs.filter((c) => c.lost);
  const seg = (c) => `<i class="seg-${esc(c.key)}" style="flex:${c.hours / total}" title="${esc(`${c.key} ${hours(c.hours)}${c.text ? `: ${c.text}` : ""}`)}"></i>`;
  const gap = good.length && lost.length ? `<i class="ogap" title="Left of the gap reached main; right of it did not"></i>` : "";
  // The button covers the line's grid row, `n` from 1: a line is three cells of its column's grid.
  const line = (c, n) => `<span><i class="seg-${esc(c.key)}"></i>${esc(c.key)}</span><span>${esc(hours(c.hours))}</span><span class="m">${esc(cardPct(c.hours / total))}</span><button type="button" class="oline" data-inspect="class" data-target="${esc(c.key)}" aria-label="${esc(c.key)}" style="grid-row:${n} / span 1"></button>`;
  const col = (xs) => `<div>${xs.map((c, i) => line(c, i + 1)).join("")}</div>`;
  return `<div class="ohead"><b class="num">${esc(cardPct(kept / total))}</b><span>reached main</span></div>` +
    `<div class="obar thin" role="img" aria-label="${esc(cs.map((c) => `${c.key} ${hours(c.hours)}`).join(", "))}">${good.map(seg).join("")}${gap}${lost.map(seg).join("")}</div>` +
    `<div class="oledger num">${col(good)}${col(lost)}</div>`;
}
