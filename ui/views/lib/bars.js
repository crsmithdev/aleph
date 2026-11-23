// The bars a list row carries as its evidence (design/components/row-bars.md): one bar of shares, a rate against its baseline, a
// strip of runs, and a meter on a log scale. Each fills a cell; the figures go in its tooltip, not beside it.
import { esc, meter } from "./html.js";
import { cardPct } from "./format.js";

/**
 * One bar in a row cell: `parts` is `meter`'s (one share in percent, or segments `{ pct, cls }`), `label` its text alternative.
 * @design row-bars
 */
export const rowBar = (parts, label, o) => `<span class="rowbar">${meter(parts, label, o)}</span>`;

/**
 * A rate (0 to 1) against its `baseline`: the bar with the baseline as its mark, in the need tone below it, then the rate. A null baseline draws no mark.
 * @design row-bars
 */
export function rateBar(rate, baseline) {
  const below = baseline != null && rate < baseline, title = baseline == null ? "no baseline" : `baseline ${cardPct(baseline)}`;
  return `<span class="ratebar">${meter([{ pct: rate * 100, cls: below ? "below" : "" }], title, { mark: baseline == null ? null : Math.round(Math.min(baseline, 1) * 100) })}<span>${esc(cardPct(rate))}</span></span>`;
}

/**
 * The runs as one strip: a segment per run `{ secs, cls, tip }`, its width its share of `most` seconds, its colour its tone (`cls`, from `tone()`).
 * `full` fills its box; else it is a cell wide.
 * @design row-bars
 */
export function runStrip(runs, most, { full = false, label = "" } = {}) {
  const segs = runs.map((r) => `<i class="${esc(r.cls)}" style="width:${((r.secs / most) * 100).toFixed(2)}%" title="${esc(r.tip)}"></i>`).join("");
  return `<span class="runstrip${full ? " full" : ""}"${label ? ` role="img" aria-label="${esc(label)}"` : ""}>${segs}</span>`;
}

/**
 * A p50 fill with its p90 mark on a log scale from `lo` to `hi` seconds, for spans that run from seconds to days: a linear bar
 * would show only the longest. `label` is the text alternative.
 * @design row-bars
 */
export function logMeter(p50, p90, { lo = 1, hi, label }) {
  const a = Math.log(lo), at = (s) => Math.max(1, ((Math.log(Math.max(lo, s)) - a) / (Math.log(hi) - a)) * 100);
  return `<span class="logmeter">${meter(at(p50), label, { mark: Math.round(at(p90)) })}</span>`;
}
