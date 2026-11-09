// The chart panel: `<aleph-chart key="view/chart">` draws a frame as a card that fills its box. The title, the
// colours, the units, the aria label, the empty line and the forms on offer come from the frame. The form and the
// hidden series stay per panel through keep(). A row with an `href` links to its issue: the option carries the link
// of every point, a category frame lists its linked rows under the chart, and a click on a bar or a label opens it.
//
// A frame:
//   measure: { name, unit: "count" | "usd" | "seconds", agg: "sum" | "max" }
//     agg is how one key's values add up: a flow ("Cost") sums, a level ("Agents Live") peaks.
//   over: { kind: "time", window } | { kind: "category", name }
//   by: { name, keys: [{ key, name, color? }] }   color is a token name; a key keeps its colour in every window.
//   rows: time [{ at, [key]: n }], category [{ name, [key]: n }]; a row may carry `name` and `href`.
//   form: the form the panel opens in, where its group offers it. note: a line under the title.
//   empty: the line the panel shows instead of the chart when no key has a value.
// The kind of `over` is the group, and the group gives the forms.
import { card, chart, count, dur, empty, esc, idLink, keep, kept, legend, money, pct, readTokens, seg } from "./lib.js";
import { xLabel } from "./views/speed.js";

/** The forms of each group. The default is the first, except that a time frame of a flow (agg "sum") opens as columns. */
export const FORMS = {
  time: [{ key: "area", label: "Area", icon: "chart-area" }, { key: "columns", label: "Columns", icon: "chart-column" }, { key: "lines", label: "Lines", icon: "chart-line" }, { key: "points", label: "Points", icon: "circle" }, { key: "share", label: "Share", icon: "percent" }],
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

/** The form the panel opens in: the kept one, else the frame's own, else the group's default. */
export function formOf(f, form) {
  const offers = (x) => FORMS[f.over.kind].some((y) => y.key === x);
  if (offers(form)) return form;
  if (offers(f.form)) return f.form;
  return f.over.kind === "time" && f.measure.agg === "sum" ? "columns" : FORMS[f.over.kind][0].key;
}

/** The ECharts option for frame `f` in `form`. `t` is the page tokens; `hidden` the series names the legend hides. */
export function option(f, form, t, hidden = []) {
  const ks = shown(f), share = form === "share", fmt = share ? pct : fmtOf(f);
  const sums = f.rows.map((r) => ks.reduce((n, k) => n + (r[k.key] ?? 0), 0));
  // A row with an issue link keeps it on its point, so a click on the point opens the issue.
  const item = (r, v) => (r.href && v != null ? { value: v, href: r.href } : v);
  // A points form draws a dot only where the row has the key, so a row is one dot, not one dot per key.
  const none = f.over.kind === "time" && form === "points" ? null : 0;
  // A share point with nothing to divide is a gap, not 0%.
  const data = (k) => f.rows.map((r, i) => item(r, share ? (sums[i] ? ((r[k.key] ?? 0) / sums[i]) * 100 : null) : (r[k.key] ?? none)));
  const value = { type: "value", min: 0, ...(share ? { max: 100 } : {}), minInterval: f.measure.unit === "count" && !share ? 1 : 0, splitLine: { lineStyle: { opacity: 0.5 } }, axisTick: { show: false }, axisLabel: { formatter: fmt } };
  const base = (k) => ({ name: k.name, data: data(k), ...(k.color ? { color: t[k.color] } : {}) });
  const o = { animation: false, legend: { ...legend, selected: Object.fromEntries(hidden.map((n) => [n, false])) }, tooltip: { trigger: "axis", confine: true, valueFormatter: fmt } };
  if (f.over.kind === "time") {
    const bars = form === "columns", points = form === "points", stack = !bars && !points && form !== "lines";
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
        : points
          ? { ...base(k), type: "line", symbol: "circle", symbolSize: 9, lineStyle: { width: 0 } }
          : { ...base(k), type: "line", symbol: "none", ...(stack ? { stack: "all", lineStyle: { width: 1 }, areaStyle: { opacity: 0.6 } } : { lineStyle: { width: 2 } }) }),
    };
  }
  const stack = form !== "grouped", linked = f.rows.some((r) => r.href);
  return {
    ...o,
    tooltip: { ...o.tooltip, axisPointer: { type: "shadow" } },
    grid: { left: 64, right: 16, top: 28, bottom: 20 },
    xAxis: { ...value, splitLine: { show: true, lineStyle: { opacity: 0.5 } } },
    // A linked row is named on the axis and is its own link, so every label shows and a click on one is an event.
    yAxis: { type: "category", inverse: true, data: f.rows.map((r) => r.name), axisTick: { show: false }, ...(linked ? { triggerEvent: true, axisLabel: { interval: 0 } } : {}) },
    series: ks.map((k) => ({ ...base(k), type: "bar", barMaxWidth: stack ? 32 : 12, ...(stack ? { stack: "all" } : {}) })),
  };
}

/** The panel's markup for frame `f` in `form`: the card, its form control, the chart box and the links of its rows, or the empty line. */
export function panel(f, form) {
  if (!shown(f).length) return card(title(f), empty(f.empty ?? "Nothing to plot in this window."));
  const forms = seg("Chart form", FORMS[f.over.kind].map((x) => ({ label: x.label, icon: x.icon, on: x.key === form, attrs: ` data-form="${esc(x.key)}"` })));
  // A category frame names each row on its axis, so each row with an issue link gets one here too, for a reader
  // who cannot click a bar.
  const links = f.over.kind === "category" ? f.rows.filter((r) => r.href) : [];
  const list = links.length ? `<p class="quiet">${links.map((r) => idLink(r.name, r.href)).join(" · ")}</p>` : "";
  return card(title(f), (f.note ? `<p>${esc(f.note)}</p>` : "") + `<div class="chartbox" role="img" aria-label="${esc(label(f))}"></div>${list}`, { aside: forms });
}

/** A chart panel with its first markup, so the page reads the same before the element draws. `cls` is the panel's grid class. */
export const panelOf = (key, f, cls = "") => `<aleph-chart key="${esc(key)}"${cls ? ` class="${esc(cls)}"` : ""}>${panel(f, formOf(f, kept(key, {}).form))}</aleph-chart>`;

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
      this.#chart.on("click", (p) => {
        // The link of the point, or of the row whose name the clicked axis label gives.
        const h = p.data?.href ?? (p.componentType === "yAxis" ? f.rows.find((r) => r.name === p.value)?.href : null);
        if (h) location.hash = h;
      });
      this.onclick = (e) => {
        const b = e.target.closest?.("button[data-form]");
        if (!b) return;
        keep(this.key, { ...kept(this.key, {}), form: b.dataset.form });
        this.#render();
      };
    }

    disconnectedCallback() {
      this.#chart?.dispose();
      this.#chart = null;
    }
  });
}
