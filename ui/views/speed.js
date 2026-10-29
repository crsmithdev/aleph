// The speed parts of the Status page: how fast runs are. `d` is /api/speed. The render functions
// return HTML strings; `mountSpeed` fetches the data, draws the three ECharts and wires the control.
import { badge, chart, esc, money, readTokens } from "../lib.js";

export const WINDOWS = [{ value: "hour", label: "Hour" }, { value: "day", label: "Day" }, { value: "week", label: "Week" }, { value: "month", label: "Month" }];
export const DEFAULT_WINDOW = "week";
const WINDOW_TEXT = { hour: "the last hour", day: "the last 24 hours", week: "the last 7 days", month: "the last 30 days" };
const STEP_TEXT = { hour: "5 minutes", day: "hour", week: "day", month: "day" };
const END_LABEL = { passed: "Passed", dropped: "Dropped", stuck: "Stuck", "needs-you": "Needs you" };
const END_TONE = { passed: "done", dropped: "quiet", stuck: "stuck", "needs-you": "need" };

/** Seconds as "43s", "4m 05s" or "1h 02m"; "–" for none. */
export function dur(s) {
  if (s === null || s === undefined || Number.isNaN(s)) return "–";
  s = Math.round(s);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return m < 60 ? `${m}m ${String(s % 60).padStart(2, "0")}s` : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}
const hours = (h) => `${h.toFixed(h < 10 ? 1 : 0)} h`;
const pctText = (w) => `${Math.round((w || 0) * 100)}%`;
/** The p50 of a check by name, or null. */
export const checkP50 = (d, name) => d?.checks?.find((c) => c.name === name || c.name === `${name}s`)?.p50 ?? null;

const med = (k, c) => `<div class="med"><span class="k">${esc(k)}</span><span class="v">${esc(dur(c.p50))}</span><span class="p90">p90 ${esc(dur(c.p90))}</span><span class="runs">${c.count}</span></div>`;

/** The medians row: agent, land, triage, plan, tests. Each has the p50, the p90 and the run count. */
export function renderMedians(d) {
  const tests = d.checks.find((c) => c.name === "tests" || c.name === "test") ?? { count: 0, p50: null, p90: null };
  return `<div class="meds">` +
    ["agent", "land", "triage", "plan"].map((n) => med(n.charAt(0).toUpperCase() + n.slice(1), d.kinds[n])).join("") +
    med("Tests", tests) + `</div>`;
}

/** "Where the agent hours went": one stacked bar by end state, a legend with hours, cost and count, and the wasted sentence. */
export function renderHours(d) {
  const total = Object.values(d.ends).reduce((a, e) => a + e.hours, 0);
  if (!total) return `<div class="empty"><p class="hint">No agent run ended in this period.</p></div>`;
  const segs = Object.entries(d.ends).filter(([, e]) => e.hours > 0)
    .map(([s, e]) => `<span class="seg-${END_TONE[s]}" style="flex:${e.hours}" title="${esc(`${END_LABEL[s]}: ${hours(e.hours)}, ${money(e.cost)}, ${e.count} runs`)}"></span>`).join("");
  const legend = Object.entries(d.ends)
    .map(([s, e]) => `<li>${badge(s)} <b>${esc(hours(e.hours))}</b> <span class="quiet">${esc(money(e.cost))} · ${e.count} ${e.count === 1 ? "run" : "runs"}</span></li>`).join("");
  return `<p class="wasted"><b>${esc(pctText(d.wasted))}</b> of ${esc(hours(total).replace(' h', ''))} agent hours went to dropped or stuck runs.</p>` +
    `<div class="hbar" role="img" aria-label="Agent hours by end state">${segs}</div><ul class="hlegend">${legend}</ul>`;
}

const chartBox = (key, title, label) => `<figure class="chartbox"><figcaption>${esc(title)}</figcaption><div class="speedchart" data-chart="${key}" role="img" aria-label="${esc(label)}"></div></figure>`;

/** The three chart boxes; `mountSpeed` fills them. */
export const renderCharts = (d) => `<div class="charts3">` +
  chartBox("agent", `Agent run time by ${STEP_TEXT[d.window]} (median)`, "Median agent run time per bucket") +
  chartBox("tests", `Tests time by ${STEP_TEXT[d.window]} (median)`, "Median tests time per bucket") +
  chartBox("lands", `Lands by ${STEP_TEXT[d.window]}`, "Lands per bucket") + `</div>`;

const loading = (what, d) => (!d ? `<p class="quiet loading" role="status">Loading ${what}…</p>` : `<div class="empty"><p class="hint">${esc(d.error)}</p></div>`);

/** The Speed block: the medians and the three charts. `d` is null while loading, `{error}` on a failed load. */
export function renderSpeedTop(d) {
  const head = `<div class="sh sub"><h2 id="h-speed">Speed</h2></div>`;
  if (!d || d.error) return head + loading("speed", d);
  return head + renderMedians(d) + renderCharts(d);
}

/** The Efficiency block: reruns, the wasted share and the agent hours by end state, for the picked window. */
export function renderEfficiency(d) {
  const head = `<div class="sh sub"><h2 id="h-efficiency">Efficiency</h2></div>`;
  if (!d || d.error) return head + loading("efficiency", d);
  return head + `<div class="meds one"><div class="med"><span class="k">Reruns</span><span class="v">${d.flaky}</span><span class="quiet">passed on rerun, ${esc(WINDOW_TEXT[d.window])}</span></div></div>` + renderHours(d);
}

/** The area-chart option of one chart: `values` per bucket (null leaves a gap), `unit` for the tooltip. */
export function areaOption(buckets, key, { unit, color, fmt = String }) {
  return {
    color: [color],
    grid: { left: 40, right: 8, top: 8, bottom: 22 },
    tooltip: { trigger: "axis", confine: true, formatter: (p) => { const q = [].concat(p)[0]; return `${esc(q.name)}<br>${q.value == null ? "none" : esc(fmt(q.value)) + (unit ? " " + unit : "")}`; } },
    xAxis: { type: "category", boundaryGap: false, data: buckets.map((b) => b.label), axisLabel: { interval: "auto", hideOverlap: true } },
    yAxis: { type: "value", min: 0, minInterval: unit === "lands" ? 1 : undefined, axisLabel: { formatter: (v) => (unit === "lands" ? String(v) : dur(v)) } },
    series: [{ type: "line", smooth: false, showSymbol: buckets.length <= 12, connectNulls: true, areaStyle: { opacity: 0.25 }, data: buckets.map((b) => b[key]) }],
  };
}

// What the reader chose and what came back, so a refresh of the page re-renders at once.
let win = DEFAULT_WINDOW;
const got = new Map();
let drawn = [];
const clear = () => { for (const c of drawn) c.dispose(); drawn = []; };

/** The window in a route query (`?window=day`); week when absent or unknown. */
export const windowOf = (query) => { const w = query?.get?.("window"); return WINDOWS.some((x) => x.value === w) ? w : DEFAULT_WINDOW; };
/** Take the window from the route; the page calls it on every render. */
export const setWindow = (query) => { win = windowOf(query); return win; };
export const speedWindow = () => win;
/** The last answer for the current window, or null. */
export const speedData = () => got.get(win) ?? null;
/** The page time picker: Hour, Day, Week, Month. */
export const renderPicker = (w = win) =>
  `<span class="seg wpick" role="group" aria-label="Time window" data-name="window">${WINDOWS.map((o) => `<button type="button" data-value="${o.value}" aria-pressed="${o.value === w}">${o.label}</button>`).join("")}</span>`;
export const speedTop = () => renderSpeedTop(speedData());
export const efficiency = () => renderEfficiency(speedData());
export const resetSpeed = () => { win = DEFAULT_WINDOW; got.clear(); };

function draw(box, d) {
  clear();
  if (!globalThis.echarts) return;
  const t = readTokens();
  const specs = { agent: ["agent", { color: t.run, fmt: dur }], tests: ["tests", { color: t.need, fmt: dur }], lands: ["lands", { unit: "lands", color: t.done }] };
  for (const el of box.querySelectorAll(".speedchart[data-chart]")) {
    const [key, o] = specs[el.dataset.chart];
    try { drawn.push(chart(el, areaOption(d.buckets, key, o))); } catch (e) { console.error("speed chart failed", e); }
  }
}

/** Fetch the data for the window, fill the Speed and Efficiency sections and the Done card, draw the charts. A click on the picker puts the window in the hash, which re-renders the page. */
export async function mountSpeed(root, fetcher = fetch) {
  const top = root.querySelector?.("#speed");
  if (!top) return;
  const eff = root.querySelector("#efficiency"), doneN = root.querySelector("#done-n");
  const show = (d) => {
    top.innerHTML = renderSpeedTop(d);
    if (eff) eff.innerHTML = renderEfficiency(d);
    if (doneN && d && !d.error) doneN.textContent = String(d.done);
    if (d && !d.error) draw(top, d); else clear();
  };
  const load = async () => {
    const want = win;
    try {
      const res = await fetcher(`/api/speed?window=${want}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load speed (${res.status}).`);
      got.set(want, await res.json());
    } catch (e) { if (!got.has(want)) got.set(want, { error: e.message }); }
    if (want === win && top.isConnected !== false) show(got.get(want));
  };
  if (got.has(win) && !got.get(win).error) draw(top, got.get(win));
  await load();
}
