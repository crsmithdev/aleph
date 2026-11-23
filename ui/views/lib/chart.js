// The chart panel: `<aleph-chart key="view/chart">` draws a frame as a card that fills its box. The title, the
// colours, the units, the aria label, the empty line and the forms on offer come from the frame. The form and the
// hidden series stay per panel through keep(). One menu picks the form. A row with an `href` links to its issue: the option carries the link
// of every point, and a click on a bar or a label opens it.
//
// A frame:
//   measure: { name, unit: "count" | "usd" | "seconds", agg: "sum" | "max" }
//     agg is how one key's values add up: a flow ("Cost") sums, a level ("Agents Live") peaks.
//   over: { kind: "time", window } | { kind: "category", name }
//   by: { name, keys: [{ key, name, color? }] }   color is a token name; a key keeps its colour in every window.
//   rows: time [{ at, [key]: n }], category [{ name, [key]: n }]; a row may carry `name` and `href`. A time row with a
//     `name` and no `at` is a step that is not a time (a request): `name` is its axis label. A row may also carry
//     `on` (its point is drawn in --ink: the selected one), `dashed` (a dashed outline: a point that follows a break)
//     and `pick` (a click on its point makes the panel send a bubbling `chartpick` event whose detail is `pick`).
//   form: the form the panel opens in, where its group offers it.
//   legend: false hides the legend, for a frame of one key that the title already names.
//   cap: a top for the value axis of a columns form, in the measure's unit. A column over it is cut there and labelled
//     with its total, so one outlier does not flatten the others.
//   error, since: the mark of data that failed to rebuild; the panel says how old it is and why.
// The kind of `over` is the group, and the group gives the forms.
import { keep, kept } from "./address.js";
import { chart, legend, readTokens } from "./chart-theme.js";
import { count, day, dur, markLine, money, pct, xLabel } from "./format.js";
import { card, empty, esc, notice, selectBox } from "./html.js";

/** The forms of each group. The default is the first, except that a time frame of a flow (agg "sum") opens as columns. */
export const FORMS = {
  time: [{ key: "area", label: "Area" }, { key: "columns", label: "Columns" }, { key: "lines", label: "Lines" }, { key: "points", label: "Points" }, { key: "share", label: "Share" }],
  category: [{ key: "stacked", label: "Stacked" }, { key: "grouped", label: "Grouped" }, { key: "share", label: "Share" }],
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

/** The frame with its keys cut to seven: the first seven with a value, then one `Other` that sums the rest in each row. */
const MAX_KEYS = 7;
const fold = (f) => {
  const ks = shown(f);
  if (ks.length <= MAX_KEYS) return f;
  const rest = ks.slice(MAX_KEYS);
  return { ...f, by: { ...f.by, keys: [...ks.slice(0, MAX_KEYS), { key: "~other", name: "Other", color: "muted" }] }, rows: f.rows.map((r) => ({ ...r, "~other": rest.reduce((n, k) => n + (r[k.key] ?? 0), 0) })) };
};

const total = (f, k) => {
  const vs = f.rows.map((r) => r[k.key] ?? 0);
  return f.measure.agg === "max" ? Math.max(...vs) : vs.reduce((a, b) => a + b, 0);
};

/** The aria label: the title, then each key with its total, or its peak for a level. */
export const label = (f) => { const g = fold(f); return `${title(g)}: ${shown(g).map((k) => `${k.name} ${g.measure.agg === "max" ? "peak " : ""}${fmtOf(g)(total(g, k))}`).join(", ") || "none"}`; };

/** The form the panel opens in: the kept one, else the frame's own, else the group's default. */
export function formOf(f, form) {
  const offers = (x) => FORMS[f.over.kind].some((y) => y.key === x);
  if (offers(form)) return form;
  if (offers(f.form)) return f.form;
  return f.over.kind === "time" && f.measure.agg === "sum" ? "columns" : FORMS[f.over.kind][0].key;
}

/** The ECharts option for frame `f` in `form`. `t` is the page tokens; `hidden` the series names the legend hides. */
export function option(frame, form, t, hidden = []) {
  const f = fold(frame);
  const ks = shown(f), share = form === "share", fmt = share ? pct : fmtOf(f);
  const sums = f.rows.map((r) => ks.reduce((n, k) => n + (r[k.key] ?? 0), 0));
  // A row with an issue link keeps it on its point, so a click on the point opens the issue.
  const item = (r, v) => {
    if (v == null || !(r.href || r.on || r.dashed)) return v;
    const style = { ...(r.on ? { color: t.ink } : {}), ...(r.dashed ? { borderColor: t.ink, borderType: "dashed", borderWidth: 1 } : {}) };
    return { value: v, ...(r.href ? { href: r.href } : {}), ...(r.on || r.dashed ? { itemStyle: style } : {}) };
  };
  // A points form draws a dot only where the row has the key, so a row is one dot, not one dot per key.
  const none = f.over.kind === "time" && form === "points" ? null : 0;
  // A share point with nothing to divide is a gap, not 0%. A row whose key is null has no value there: a gap, not 0.
  const data = (k) => f.rows.map((r, i) => item(r, share ? (sums[i] ? ((r[k.key] ?? 0) / sums[i]) * 100 : null) : r[k.key] === undefined ? none : r[k.key]));
  // A cap applies only to stacked columns over time, and only when a column passes it.
  const cut = f.cap && form === "columns" && f.over.kind === "time" && Math.max(...sums) > f.cap;
  const value = { type: "value", min: 0, ...(share ? { max: 100 } : cut ? { max: f.cap } : {}), minInterval: f.measure.unit === "count" && !share ? 1 : 0, splitLine: { lineStyle: { opacity: 0.5 } }, axisTick: { show: false }, axisLabel: { formatter: fmt, hideOverlap: true } };
  const base = (k) => ({ name: k.name, data: data(k), ...(k.color ? { color: t[k.color] } : {}) });
  // A hidden legend frees the top band it takes; 8 px keeps the top y label inside the box.
  const top = f.legend === false ? 8 : 28;
  const o = { animation: false, legend: { ...legend, ...(f.legend === false ? { show: false } : {}), selected: Object.fromEntries(hidden.map((n) => [n, false])) }, tooltip: { trigger: "axis", confine: true, valueFormatter: fmt } };
  if (f.over.kind === "time") {
    const bars = form === "columns", points = form === "points", stack = !bars && !points && form !== "lines";
    // A day axis keeps one label per day: the label of a bucket is its day, so a point whose label is the label
    // of the point before it is blank. A frame of one row per day labels every point.
    // The axis data is the date and the label, so the tooltip shows both; the axis shows the label.
    const labels = f.rows.map((r) => r.name ?? xLabel(r.at, f.over.window)), perDay = (_, i) => (i && labels[i] === labels[i - 1] ? "" : labels[i]);
    const dated = f.rows.map((r, i) => (r.name !== undefined || f.over.window === "week" || f.over.window === "month" ? labels[i] : `${day(new Date(r.at))} ${labels[i]}`));
    return {
      ...o,
      tooltip: { ...o.tooltip, ...(bars ? { axisPointer: { type: "shadow" } } : {}) },
      grid: { left: 40, right: 16, top, bottom: 20 },
      xAxis: { type: "category", boundaryGap: bars, data: dated, axisTick: { show: false }, axisLabel: { hideOverlap: true, formatter: perDay } },
      yAxis: value,
      series: ks.map((k, j) => bars
        ? { ...base(k), type: "bar", stack: "all", barMaxWidth: 64, ...(cut && !j ? { markPoint: capMarks(f, sums, fmt, t) } : {}) }
        : points
          ? { ...base(k), type: "line", symbol: "circle", symbolSize: 9, lineStyle: { width: 0 } }
          : { ...base(k), type: "line", symbol: "none", ...(stack ? { stack: "all", lineStyle: { width: 1 }, areaStyle: { opacity: 0.6 } } : { lineStyle: { width: 2 }, connectNulls: true }) }),
    };
  }
  const stack = form !== "grouped", linked = f.rows.some((r) => r.href);
  return {
    ...o,
    tooltip: { ...o.tooltip, axisPointer: { type: "shadow" } },
    grid: { left: 64, right: 16, top, bottom: 20 },
    xAxis: { ...value, splitLine: { show: true, lineStyle: { opacity: 0.5 } } },
    // A linked row is named on the axis and is its own link, so every label shows and a click on one is an event.
    yAxis: { type: "category", inverse: true, data: f.rows.map((r) => r.name), axisTick: { show: false }, ...(linked ? { triggerEvent: true, axisLabel: { interval: 0 } } : {}) },
    series: ks.map((k) => ({ ...base(k), type: "bar", barMaxWidth: stack ? 32 : 12, ...(stack ? { stack: "all" } : {}) })),
  };
}

/** The labels of the columns over the cap: each column's total, at the cap, inside its top. The bar is clipped there, so the label sits on the first series as a mark. */
const capMarks = (f, sums, fmt, t) => ({
  symbol: "rect", symbolSize: 0, silent: true,
  label: { show: true, position: "bottom", color: t.need, fontWeight: 600, backgroundColor: t.surface, padding: [1, 2] },
  data: sums.flatMap((v, i) => (v > f.cap ? [{ coord: [i, f.cap], value: v, label: { formatter: fmt(v) } }] : [])),
});

/** The panel's markup for frame `f` in `form`: the card, its form control and the chart box, or the empty line. */
export function panel(f, form, bare = false) {
  const mark = f.error && f.since ? notice(markLine(title(f), f), true) : "";
  if (!shown(f).length) return bare ? mark + empty() : card(title(f), mark + empty());
  const forms = selectBox("Chart form", "form", FORMS[f.over.kind].map((x) => ({ value: x.key, label: x.label })), form, { attrs: " data-form" });
  // The canvas has no keyboard path, so a linked row is also a link in a list that shows on focus.
  const links = f.rows.filter((r) => r.href).map((r) => `<li><a href="${esc(r.href)}">${esc(r.name ?? (f.over.kind === "time" ? `${day(new Date(r.at))} ${xLabel(r.at, f.over.window)}` : ""))}</a></li>`).join("");
  const body = mark + `<div class="chartbox" role="img" aria-label="${esc(label(f))}"></div>` + (links ? `<ul class="chartlinks sr">${links}</ul>` : "");
  return bare ? body : card(title(f), body, { aside: forms });
}

/** A chart panel with its first markup, so the page reads the same before the element draws. `cls` is the panel's grid class. `bare` draws the chart alone, in its frame's form, for a part of a card. */
export const panelOf = (key, f, cls = "", { bare = false } = {}) => `<aleph-chart key="${esc(key)}"${cls ? ` class="${esc(cls)}"` : ""}${bare ? " bare" : ""}>${panel(f, bare ? formOf(f) : formOf(f, kept(key, {}).form), bare)}</aleph-chart>`;

if (globalThis.customElements && !customElements.get("aleph-chart")) {
  customElements.define("aleph-chart", class extends HTMLElement {
    #frame = null;
    #chart = null;

    get frame() { return this.#frame; }
    /** Draw a new frame. */
    set frame(f) {
      this.#frame = f;
      this.#render();
    }

    /** The panel's key: the frame and the kept state are its own. */
    get key() { return this.getAttribute("key"); }
    get #bare() { return this.hasAttribute("bare"); }
    get #state() {
      const s = kept(this.key, {});
      return { form: this.#bare ? formOf(this.#frame) : formOf(this.#frame, s.form), hidden: s.hidden ?? [] };
    }

    #render() {
      this.#chart?.dispose();
      this.#chart = null;
      const f = this.#frame, s = this.#state;
      this.innerHTML = panel(f, s.form, this.#bare);
      const box = this.querySelector(".chartbox");
      if (!box || !globalThis.echarts) return;
      this.#chart = chart(box, option(f, s.form, readTokens(), s.hidden));
      this.#chart.on("legendselectchanged", (e) => keep(this.key, { ...kept(this.key, {}), hidden: Object.keys(e.selected).filter((n) => !e.selected[n]) }));
      this.#chart.on("click", (p) => {
        // The link of the point, or of the row whose name the clicked axis label gives.
        const h = p.data?.href ?? (p.componentType === "yAxis" ? f.rows.find((r) => r.name === p.value)?.href : null);
        if (h) location.hash = h;
        const pick = f.rows[p.dataIndex]?.pick;
        if (pick !== undefined) this.dispatchEvent(new CustomEvent("chartpick", { detail: pick, bubbles: true }));
      });
      this.onchange = (e) => {
        const m = e.target.closest?.("select[data-form]");
        if (!m) return;
        keep(this.key, { ...kept(this.key, {}), form: m.value });
        this.#render();
      };
    }

    disconnectedCallback() {
      this.#chart?.dispose();
      this.#chart = null;
    }
  });
}
