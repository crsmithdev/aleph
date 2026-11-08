// The chart panel: `<aleph-chart key="view/chart">` draws a frame as a card that fills its box. The title, the
// colours, the units, the aria label, the empty line and the forms on offer come from the frame. The form and the
// hidden series stay per panel through keep(). A connected panel follows `/api/live` and adds each row of its own
// key with push(), so the newest point of the chart grows with no page reload.
//
// A frame:
//   measure: { name, unit: "count" | "usd" | "seconds", agg: "sum" | "max" }
//     agg is how one key's values add up: a flow ("Cost") sums, a level ("Agents Live") peaks.
//   over: { kind: "time", window } | { kind: "category", name }
//   by: { name, keys: [{ key, name, color? }] }   color is a token name; a key keeps its colour in every window.
//   rows: time [{ at, [key]: n }], category [{ name, [key]: n }]
// The kind of `over` is the group, and the group gives the forms.
import { card, chart, count, dur, empty, esc, hashQuery, keep, kept, legend, money, pct, projectNow, readTokens, seg, windowOf } from "./lib.js";
import { xLabel } from "./views/speed.js";

/** The forms of each group. The default is the first, except that a time frame of a flow (agg "sum") opens as columns. */
export const FORMS = {
  time: [{ key: "area", label: "Area", icon: "chart-area" }, { key: "columns", label: "Columns", icon: "chart-column" }, { key: "lines", label: "Lines", icon: "chart-line" }, { key: "share", label: "Share", icon: "percent" }],
  category: [{ key: "stacked", label: "Stacked", icon: "chart-bar" }, { key: "grouped", label: "Grouped", icon: "align-left" }, { key: "share", label: "Share", icon: "percent" }],
};

const FMT = { count, usd: money, seconds: dur };
const fmtOf = (f) => FMT[f.measure.unit] ?? count;

/** The title: the measure, by the first dimension that is not time. */
export function title(f) {
  const by = f.over.kind === "category" ? f.over.name : f.by?.name;
  return by ? `${f.measure.name} by ${by}` : f.measure.name;
}

/** The keys with a value other than 0 in some row, in frame order. */
export const shown = (f) => f.by.keys.filter((k) => f.rows.some((r) => r[k.key]));

const total = (f, k) => {
  const vs = f.rows.map((r) => r[k.key] ?? 0);
  return f.measure.agg === "max" ? Math.max(...vs) : vs.reduce((a, b) => a + b, 0);
};

/** The aria label: the title, then each key with its total, or its peak for a level. */
export const label = (f) => `${title(f)}: ${shown(f).map((k) => `${k.name} ${f.measure.agg === "max" ? "peak " : ""}${fmtOf(f)(total(f, k))}`).join(", ") || "none"}`;

/** The form kept for a panel, if the group offers it, else the group's default. */
export function formOf(f, form) {
  if (FORMS[f.over.kind].some((x) => x.key === form)) return form;
  return f.over.kind === "time" && f.measure.agg === "sum" ? "columns" : FORMS[f.over.kind][0].key;
}

/** The ECharts option for frame `f` in `form`. `t` is the page tokens; `hidden` the series names the legend hides. */
export function option(f, form, t, hidden = []) {
  const ks = shown(f), share = form === "share", fmt = share ? pct : fmtOf(f);
  const sums = f.rows.map((r) => ks.reduce((n, k) => n + (r[k.key] ?? 0), 0));
  const data = (k) => f.rows.map((r, i) => (share ? (sums[i] ? ((r[k.key] ?? 0) / sums[i]) * 100 : 0) : (r[k.key] ?? 0)));
  const value = { type: "value", min: 0, ...(share ? { max: 100 } : {}), minInterval: f.measure.unit === "count" && !share ? 1 : 0, splitLine: { lineStyle: { opacity: 0.5 } }, axisTick: { show: false }, axisLabel: { formatter: fmt } };
  const base = (k) => ({ name: k.name, data: data(k), ...(k.color ? { color: t[k.color] } : {}) });
  const o = { animation: false, legend: { ...legend, selected: Object.fromEntries(hidden.map((n) => [n, false])) }, tooltip: { trigger: "axis", confine: true, valueFormatter: fmt } };
  if (f.over.kind === "time") {
    const bars = form === "columns", stack = form !== "lines";
    // A day axis keeps one label per day: the label of a bucket is its day, so a point whose label is the label
    // of the point before it is blank. A frame of one row per day labels every point.
    const labels = f.rows.map((r) => xLabel(r.at, f.over.window)), perDay = (s, i) => (i && s === labels[i - 1] ? "" : s);
    return {
      ...o,
      tooltip: { ...o.tooltip, ...(bars ? { axisPointer: { type: "shadow" } } : {}) },
      grid: { left: 40, right: 16, top: 28, bottom: 20 },
      xAxis: { type: "category", boundaryGap: bars, data: labels, axisTick: { show: false }, axisLabel: { hideOverlap: true, formatter: perDay } },
      yAxis: value,
      series: ks.map((k) => bars
        ? { ...base(k), type: "bar", stack: "all", barMaxWidth: 64 }
        : { ...base(k), type: "line", symbol: "none", ...(stack ? { stack: "all", lineStyle: { width: 1 }, areaStyle: { opacity: 0.6 } } : { lineStyle: { width: 2 } }) }),
    };
  }
  const stack = form !== "grouped";
  return {
    ...o,
    tooltip: { ...o.tooltip, axisPointer: { type: "shadow" } },
    grid: { left: 64, right: 16, top: 28, bottom: 20 },
    xAxis: { ...value, splitLine: { show: true, lineStyle: { opacity: 0.5 } } },
    yAxis: { type: "category", inverse: true, data: f.rows.map((r) => r.name), axisTick: { show: false } },
    series: ks.map((k) => ({ ...base(k), type: "bar", barMaxWidth: stack ? 32 : 12, ...(stack ? { stack: "all" } : {}) })),
  };
}

/** The panel's markup for frame `f` in `form`: the card, its form control and the chart box, or the empty line. */
export function panel(f, form) {
  if (!shown(f).length) return card(title(f), empty("Nothing to plot in this window."));
  const forms = seg("Chart form", FORMS[f.over.kind].map((x) => ({ label: x.label, icon: x.icon, on: x.key === form, attrs: ` data-form="${esc(x.key)}"` })));
  return card(title(f), `<div class="chartbox" role="img" aria-label="${esc(label(f))}"></div>`, { aside: forms });
}

// The live stream: the panels on the page, and the rows /api/live sends them.
const panels = new Set();
let stream = null;

/** Add `row` to frame `f`, or replace the row with the same `at` (or `name`); a time frame drops its oldest row to keep `size`. */
export function pushRow(f, row, size) {
  const id = (r) => r.at ?? r.name, i = f.rows.findIndex((r) => id(r) === id(row));
  if (i >= 0) f.rows[i] = row;
  else { f.rows.push(row); if (f.over.kind === "time" && f.rows.length > size) f.rows.shift(); }
}

/** Apply a `row` event of /api/live — JSON of `{ key, row }` — to each panel of `list` whose key it names. */
export function feed(data, list) {
  const { key, row } = JSON.parse(data);
  for (const p of list) if (p.key === key) p.push(row);
}

/** Open the stream while a panel is on the page, or close it with none. It carries the window and the project of the address. */
function follow() {
  if (!panels.size) { stream?.close(); stream = null; return; }
  if (stream) return;
  const project = projectNow();
  stream = new EventSource(`/api/live?window=${windowOf(hashQuery())}${project ? `&project=${encodeURIComponent(project)}` : ""}`);
  stream.addEventListener("row", (e) => feed(e.data, panels));
}

if (globalThis.customElements && !customElements.get("aleph-chart")) {
  customElements.define("aleph-chart", class extends HTMLElement {
    #frame = null;
    #chart = null;
    #size = 1;

    get frame() { return this.#frame; }
    /** Draw a new frame; its row count is the length that push() keeps. */
    set frame(f) {
      this.#frame = f;
      this.#size = Math.max(f.rows.length, 1);
      this.#render();
    }

    /** Add a row, or replace the row with the same `at` (or `name`). A time frame drops its oldest row to keep its length. */
    push(row) {
      const f = this.#frame;
      if (!f) return;
      pushRow(f, row, this.#size);
      if (!this.#chart || !shown(f).length) return this.#render();
      this.#chart.setOption(option(f, this.#state.form, readTokens(), this.#state.hidden), { notMerge: true });
      this.querySelector(".chartbox").setAttribute("aria-label", label(f));
    }

    /** The panel's key: the frame, the kept state and the streamed rows are its own. */
    get key() { return this.getAttribute("key"); }
    get #state() {
      const s = kept(this.key, {});
      return { form: formOf(this.#frame, s.form), hidden: s.hidden ?? [] };
    }

    #render() {
      this.#chart?.dispose();
      this.#chart = null;
      const f = this.#frame, s = this.#state;
      this.innerHTML = panel(f, s.form);
      const box = this.querySelector(".chartbox");
      if (!box || !globalThis.echarts) return;
      this.#chart = chart(box, option(f, s.form, readTokens(), s.hidden));
      this.#chart.on("legendselectchanged", (e) => keep(this.key, { ...kept(this.key, {}), hidden: Object.keys(e.selected).filter((n) => !e.selected[n]) }));
      this.onclick = (e) => {
        const b = e.target.closest?.("button[data-form]");
        if (!b) return;
        keep(this.key, { ...kept(this.key, {}), form: b.dataset.form });
        this.#render();
      };
    }

    connectedCallback() {
      panels.add(this);
      follow();
    }

    disconnectedCallback() {
      panels.delete(this);
      follow();
      this.#chart?.dispose();
      this.#chart = null;
    }
  });
}
