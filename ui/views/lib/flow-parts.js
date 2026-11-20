// What the Status pages share: formats, the /api/flow load, tiles and the Usage card.
import { get } from "./router.js";
import { scope } from "./address.js";
import { cardPct, count, xLabel, day, dur, hourLabel, pct, plural, when } from "./format.js";
import { cardTrend, statCard } from "./html.js";
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
/** A card's duration from seconds: as `dur` under 10m, then whole minutes rounded, then whole hours rounded. */
export function cardDur(s) {
  if (!(s >= 600)) return dur(s);
  const m = Math.round(s / 60);
  return m < 60 ? `${m}m` : `${Math.round(s / 3600)}h`;
}

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
  const issues = new Set(s.errored.filter((j) => j.item).map((j) => `${j.repo}/${j.item.id}`)); // the issues with an errored job
  const t = (key, o) => (f && base ? cardTrend(f[key], base[key], prev?.[key], { basis, ...o }) : "");
  const eff = (lost) => (lost == null ? null : 1 - lost), ended = f ? (f.landed ?? 0) + f.dropped : 0; // ended: the issues landed or dropped
  return [
    { k: "Efficiency", loading, failed, ...(f ? { v: cardPct(eff(f.lost)), v2: cardPct(ended ? (f.landed ?? 0) / ended : null) } : {}), q: ["efficient", "landed"], trend: f && base ? cardTrend(eff(f.lost), eff(base.lost), eff(prev?.lost), { basis, kind: "points", lowerIsGood: false, format: cardPct }) : "" },
    { k: "Completion", loading, failed, ...(f ? { v: cardDur(f.leadP50), v2: cardDur(f.leadP90) } : {}), q: ["p50", "p90"], trend: t("leadP50", { kind: "relative", lowerIsGood: true, format: cardDur }), href: performance },
    { k: "Issues", loading, failed, ...(f ? { v: count(d.open?.open), v2: [count(f.landed), count(issues.size)] } : {}), q: ["active", "landed", "errored"] },
    { k: "Jobs", v: count(s.factory.liveRuns), v2: [count(s.queued.length), count(s.errored.length)], q: ["running", "queued", "error"], href: "#/factory/jobs" },
    usageProps(s),
  ];
}
/** The Status scorecard's five cards as HTML. */
export const statusCards = (s, d, links) => cardList(s, d, links).map((c) => statCard(c)).join("");

/** The props of the Usage card: the 7-day value over the week gone as its pace, or a note with no reset time. `link` is `{href}` or `{key, on}`. */
function usageProps(s, link = { href: "#/factory/agents" }) {
  const cur = s.usage?.now, off = s.usage?.off, stale = s.usage?.stale;
  if (!cur) return { k: "Usage", v: "–", ...link };
  const gone = weekGone(cur.seven_day_resets_at, s.now);
  const title = [`${pct(cur.seven_day)} used`, gone !== null && `${pct(gone)} of the week gone`, off != null && `${pct(off)} off this machine`, stale && "stale"].filter(Boolean).join(", ");
  const shown = gone === null ? { note: stale ? "stale" : "live" } : { v2: pct(gone), q: ["used", "pace"] };
  return { k: "Usage", v: pct(cur.seven_day), ...shown, title, ...link };
}
export const usageCard = (s, link) => statCard(usageProps(s, link));

