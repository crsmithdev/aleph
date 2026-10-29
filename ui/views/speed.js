// The speed parts of the Status page: how fast runs are. `d` is /api/speed. The render functions
// return HTML strings; `mountSpeed` fetches the data, draws the three ECharts and wires the control.
import { badge, chart, esc, filterBar, money, readTokens, shortModel } from "../lib.js";

export const RANGES = [{ value: "1", label: "Today" }, { value: "7", label: "7 days" }, { value: "30", label: "30 days" }];
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

/** The "Median run" metric card: the agent p50, then "land 43s · tests 36s · 42% wasted". `d` is the 7-day speed, or none. */
export function renderMedianCard(d) {
  if (!d || !d.kinds?.agent?.count) return `<a class="metric speed" href="#speed"><span class="k">Median run</span><span class="v">–</span><span class="quiet">no runs yet</span></a>`;
  return `<a class="metric speed" href="#speed"><span class="k">Median run</span><span class="v">${esc(dur(d.kinds.agent.p50))}</span>` +
    `<span class="quiet">land ${esc(dur(d.kinds.land.p50))} · tests ${esc(dur(checkP50(d, "test")))} · ${esc(pctText(d.wasted))} wasted</span></a>`;
}

const med = (k, v, sub = "") => `<div class="med"><span class="k">${esc(k)}</span><span class="v">${v}</span>${sub ? `<span class="quiet">${sub}</span>` : ""}</div>`;

/** The medians row: agent, land, triage, plan, tests check, flaky reruns. */
export function renderMedians(d) {
  const k = (name) => d.kinds[name];
  const sub = (name) => `${k(name).count} runs · p90 ${esc(dur(k(name).p90))}`;
  const tests = d.checks.find((c) => c.name === "tests" || c.name === "test");
  return `<div class="meds">` +
    ["agent", "land", "triage", "plan"].map((n) => med(n.charAt(0).toUpperCase() + n.slice(1), esc(dur(k(n).p50)), sub(n))).join("") +
    med("Tests check", esc(dur(tests?.p50 ?? null)), `${tests ? `p90 ${esc(dur(tests.p90))} · ` : ""}24–27 s alone`) +
    med("Flaky reruns", String(d.flaky), "passed on rerun, 7 days") + `</div>`;
}

/** "Where the agent hours went": one stacked bar by end state, a legend with hours, cost and count, and the wasted sentence. */
export function renderHours(d) {
  const total = Object.values(d.ends).reduce((a, e) => a + e.hours, 0);
  if (!total) return `<div class="empty"><p class="hint">No agent run ended in this period.</p></div>`;
  const segs = Object.entries(d.ends).filter(([, e]) => e.hours > 0)
    .map(([s, e]) => `<span class="seg-${END_TONE[s]}" style="flex:${e.hours}" title="${esc(`${END_LABEL[s]}: ${hours(e.hours)}, ${money(e.cost)}, ${e.count} runs`)}"></span>`).join("");
  const legend = Object.entries(d.ends)
    .map(([s, e]) => `<li>${badge(s)} <b>${esc(hours(e.hours))}</b> <span class="quiet">${esc(money(e.cost))} · ${e.count} ${e.count === 1 ? "run" : "runs"}</span></li>`).join("");
  const waste = d.ends.dropped.hours + d.ends.stuck.hours;
  return `<div class="hbar" role="img" aria-label="Agent hours by end state">${segs}</div><ul class="hlegend">${legend}</ul>` +
    `<p class="wasted"><b>${esc(pctText(d.wasted))}</b> of the agent hours were wasted: ${esc(hours(waste))} of ${esc(hours(total))} went to runs that were dropped or stuck.</p>`;
}

const chartBox = (key, title, label) => `<figure class="chartbox"><figcaption>${esc(title)}</figcaption><div class="speedchart" data-chart="${key}" role="img" aria-label="${esc(label)}"></div></figure>`;

/** The three chart boxes; `mountSpeed` fills them. */
export const renderCharts = (d) => `<div class="charts3">` +
  chartBox("agent", d.days === 1 ? "Agent run time by hour (median)" : "Agent run time by day (median)", "Median agent run time per bucket") +
  chartBox("tests", d.days === 1 ? "Tests check time by hour (median)" : "Tests check time by day (median)", "Median tests check time per bucket") +
  chartBox("lands", d.days === 1 ? "Lands by hour" : "Lands by day", "Lands per bucket") + `</div>`;

export const renderModels = (d) => {
  const rows = d.models.map((m) => `<tr><td>${esc(m.model === "unset" ? "unset" : shortModel(m.model) || m.model)}</td><td class="num">${m.count}</td><td class="num">${esc(dur(m.p50))}</td></tr>`).join("");
  return `<div class="half"><div class="sh"><h3>Agent runs by model</h3></div>` + (rows
    ? `<div class="tscroll"><table class="tbl fit" data-table="models"><thead><tr><th>Model</th><th class="num">Runs</th><th class="num">Median</th></tr></thead><tbody>${rows}</tbody></table></div>`
    : `<div class="empty"><p class="hint">No agent run in this period.</p></div>`) + `</div>`;
};

/** The top block under the metric cards: the range control, the medians, the hours and the charts. `d` is null while loading, `{error}` on a failed load. */
export function renderSpeedTop(d, days) {
  const bar = filterBar([{ label: "", name: "days", value: String(days), options: RANGES }]);
  if (!d) return bar + `<p class="quiet loading" role="status">Loading speed…</p>`;
  if (d.error) return bar + `<div class="empty"><p class="hint">${esc(d.error)}</p></div>`;
  return bar + renderMedians(d) + `<div class="sh sub"><h3>Where the agent hours went</h3></div>` + renderHours(d) + renderCharts(d);
}

/** The Speed section further down: the model table. */
export function renderSpeedBody(d) {
  if (!d) return `<p class="quiet loading" role="status">Loading speed…</p>`;
  if (d.error) return `<div class="empty"><p class="hint">${esc(d.error)}</p></div>`;
  return renderModels(d);
}

export const renderSpeed = (d) =>
  `<div class="sh"><h2 id="h-speed">Speed</h2></div><div class="speed-body">${renderSpeedBody(d)}</div>`;

/** The bar option of one chart: `values` per bucket (null draws nothing), `unit` for the tooltip. */
export function barOption(buckets, key, { unit, color, fmt = String }) {
  return {
    color: [color],
    grid: { left: 40, right: 8, top: 8, bottom: 22 },
    tooltip: { trigger: "axis", axisPointer: { type: "shadow" }, confine: true, formatter: (p) => { const q = [].concat(p)[0]; return `${esc(q.name)}<br>${q.value == null ? "none" : esc(fmt(q.value)) + (unit ? " " + unit : "")}`; } },
    xAxis: { type: "category", data: buckets.map((b) => b.label), axisLabel: { interval: "auto", hideOverlap: true } },
    yAxis: { type: "value", min: 0, minInterval: unit === "lands" ? 1 : undefined, axisLabel: { formatter: (v) => (unit === "lands" ? String(v) : dur(v)) } },
    series: [{ type: "bar", data: buckets.map((b) => b[key]), barCategoryGap: "25%" }],
  };
}

// What the reader chose and what came back, so a refresh of the page re-renders at once.
let days = 7;
const got = new Map();
let drawn = [];
const clear = () => { for (const c of drawn) c.dispose(); drawn = []; };

/** The section for the current choice; from the last answer when there is one. */
export const speedSection = () => renderSpeed(got.get(days) ?? null);
export const speedTop = () => renderSpeedTop(got.get(days) ?? null, days);
export const speedDays = () => days;
export const resetSpeed = () => { days = 7; got.clear(); };

function draw(box, d) {
  clear();
  if (!globalThis.echarts) return;
  const t = readTokens();
  const specs = { agent: ["agent", { color: t.run, fmt: dur }], tests: ["tests", { color: t.need, fmt: dur }], lands: ["lands", { unit: "lands", color: t.done }] };
  for (const el of box.querySelectorAll(".speedchart[data-chart]")) {
    const [key, o] = specs[el.dataset.chart];
    try { drawn.push(chart(el, barOption(d.buckets, key, o))); } catch (e) { console.error("speed chart failed", e); }
  }
}

/** Fetch the data for `days`, put it in the section and draw the charts; the control reloads it. */
export async function mountSpeed(root, fetcher = fetch) {
  const sec = root.querySelector?.("#speed");
  const top = root.querySelector?.("#speedtop");
  if (!sec || !top) return;
  const show = (d) => {
    top.innerHTML = renderSpeedTop(d, days);
    sec.innerHTML = renderSpeed(d);
    if (d && !d.error) draw(top, d); else clear();
  };
  const load = async () => {
    const want = days;
    try {
      const res = await fetcher(`/api/speed?days=${want}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`Could not load speed (${res.status}).`);
      got.set(want, await res.json());
    } catch (e) { if (!got.has(want)) got.set(want, { error: e.message }); }
    if (want === days && sec.isConnected !== false) show(got.get(want));
  };
  top.addEventListener("click", (ev) => {
    const b = ev.target?.closest?.(".seg button");
    if (!b) return;
    days = Number(b.dataset.value);
    show(got.get(days) ?? null);
    load();
  });
  if (got.has(days) && !got.get(days).error) draw(top, got.get(days));
  await load();
}
