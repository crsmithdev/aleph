// The ECharts theme, the page tokens it reads, and the chart mount.

/**
 * The ECharts theme for a token map ({bg, surface, ink, rule, run, done, need, stuck, sans}).
 * Series colours `series-1` to `series-5`, then `chart-6` and `chart-7`; a series that is a state sets its tone as `color`.
 */
export function chartTheme(t) {
  const axis = { axisLine: { lineStyle: { color: t.rule } }, axisTick: { lineStyle: { color: t.rule } }, axisLabel: { color: t.ink, fontSize: 12 * (Number(t["chart-scale"]) || 1), fontWeight: Number(t["chart-weight"]) || 400 }, splitLine: { lineStyle: { color: t.rule } }, nameTextStyle: { color: t.ink } };
  return {
    color: [t["series-1"], t["series-2"], t["series-3"], t["series-4"], t["series-5"], t["chart-6"], t["chart-7"]],
    backgroundColor: "transparent",
    textStyle: { color: t.ink, fontFamily: t.chart || t.sans },
    title: { textStyle: { color: t.ink }, subtextStyle: { color: t.ink } },
    legend: { textStyle: { color: t.ink } }, bar: { label: { color: t.ink } },
    categoryAxis: axis, valueAxis: axis, timeAxis: axis, logAxis: axis,
    tooltip: { backgroundColor: t.surface, borderColor: t.rule, textStyle: { color: t.ink }, axisPointer: { lineStyle: { color: t.rule }, crossStyle: { color: t.rule } } },
  };
}
const TOKENS = ["bg", "surface", "ink", "rule", "run", "done", "need", "error", "hot", "muted", "focus", "sans", "mono", "chart", "chart-scale", "chart-weight", "series-1", "series-2", "series-3", "series-4", "series-5", "chart-6", "chart-7"];
/** Read the page tokens off :root into a token map. */
export const readTokens = (el = document.documentElement) => {
  const cs = getComputedStyle(el);
  return Object.fromEntries(TOKENS.map((k) => [k, cs.getPropertyValue(`--${k}`).trim()]));
};
let seq = 0;
/** Start the grid of ECharts instance `c` below the last legend line, so a legend that wraps never covers the plot. */
export function fitGrid(c) {
  if (c.getOption().legend?.[0]?.show === false) return;
  const group = c.getViewOfComponentModel(c.getModel().getComponent("legend")).group;
  const box = group.getBoundingRect().clone();
  box.applyTransform(group.getLocalTransform());
  c.setOption({ grid: { top: Math.ceil(box.y + box.height) + 14 } });
}
/**
 * Init an ECharts chart on `el` with `option`, themed from the page tokens. It re-themes when
 * prefers-color-scheme changes and resizes with the element. Returns a wrapper over the instance.
 */
export function chart(el, option) {
  const echarts = globalThis.echarts;
  if (!echarts) throw new Error("ECharts is not loaded");
  const name = `aleph-${++seq}`;
  const build = () => { echarts.registerTheme(name, chartTheme(readTokens())); return echarts.init(el, name); };
  const handlers = [];
  let c = build();
  c.setOption(option);
  fitGrid(c);
  const mq = matchMedia("(prefers-color-scheme: dark)");
  const retheme = () => {
    const opt = c.getOption();
    c.dispose();
    c = build();
    c.setOption(opt);
    fitGrid(c);
    for (const [ev, fn] of handlers) c.on(ev, fn);
  };
  mq.addEventListener("change", retheme);
  const ro = new ResizeObserver(() => { c.resize(); fitGrid(c); });
  ro.observe(el);
  return {
    get instance() { return c; },
    setOption: (o, ...rest) => c.setOption(o, ...rest),
    // Handlers are kept so a re-theme, which builds a new instance, attaches them again.
    on(ev, fn) { handlers.push([ev, fn]); c.on(ev, fn); },
    dispose() { mq.removeEventListener("change", retheme); ro.disconnect(); c.dispose(); },
  };
}
/** The legend of every chart: at the top, wrapping onto more lines when its items do not fit on one; `fitGrid` moves the grid below it. */
export const legend = { top: 0, right: 0, itemWidth: 10, itemHeight: 10 };
