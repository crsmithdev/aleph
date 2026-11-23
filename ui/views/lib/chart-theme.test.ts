import { expect, test } from "bun:test";
// @ts-ignore the module is plain JS, shared with the page
import { chart, fitGrid, chartTheme } from "./chart-theme.js";
// @ts-ignore the module is plain JS, shared with the page
import { shortModel } from "./format.js";

test("chart on() attaches a handler that survives a re-theme", () => {
  const g = globalThis as any;
  const made: any[] = [];
  let retheme = () => {};
  const keep = { echarts: g.echarts, matchMedia: g.matchMedia, ResizeObserver: g.ResizeObserver, getComputedStyle: g.getComputedStyle, document: g.document };
  g.echarts = {
    registerTheme() {},
    init() {
      const c: any = { ons: [], getOption: () => ({ legend: [{ show: false }] }), setOption() {}, dispose() {}, resize() {} };
      c.on = (ev: string, fn: unknown) => c.ons.push([ev, fn]);
      made.push(c);
      return c;
    },
  };
  g.matchMedia = () => ({ addEventListener: (_: string, fn: () => void) => { retheme = fn; }, removeEventListener() {} });
  g.ResizeObserver = class { observe() {} disconnect() {} };
  g.getComputedStyle = () => ({ getPropertyValue: () => "" });
  g.document = { documentElement: {} };
  try {
    const fn = () => {};
    const c = chart({}, {});
    c.on("click", fn);
    expect(made[0].ons).toEqual([["click", fn]]);
    retheme();
    expect(made[1].ons).toEqual([["click", fn]]);
  } finally {
    Object.assign(g, keep);
  }
});

test("the legend of the Sources and the Live chart ends above the grid at 390 and 1440px", async () => {
  // @ts-ignore the vendored ECharts bundle has no types
  const echarts = (await import("../../vendor/echarts.min.js")).default;
  // @ts-ignore issues.js is plain JS, shared with the page
  const { sourceFrame } = await import("../issues.js");
  // @ts-ignore chart.js is plain JS, shared with the page
  const { option } = await import("./chart.js");
  const filed = { ats: [Date.parse("2026-11-04T10:00:00Z")], counts: Object.fromEntries(["user", "worker", "deps", "memory", "agent"].map((k) => [k, [1]])) };
  const roles = ["Worker", "Judge", "Planner", "Reviewer", "Intake"];
  const live = {
    measure: { name: "Agents Live", unit: "count", agg: "max" }, over: { kind: "time", window: "week" }, by: { name: "Role", keys: roles.map((n) => ({ key: n, name: n })) },
    rows: [{ at: Date.parse("2026-11-04T10:00:00Z"), ...Object.fromEntries(roles.map((n, i) => [n, i + 1])) }, { at: Date.parse("2026-11-04T11:00:00Z"), ...Object.fromEntries(roles.map((n, i) => [n, i + 2])) }],
  };
  const models = ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5", "gpt-5-codex", "gpt-5-mini", "gemini-2.5-pro", "Other"].map((m): string => shortModel(m));
  const cost = {
    measure: { name: "Cost", unit: "usd", agg: "sum" }, over: { kind: "time", window: "week" }, by: { name: "Model", keys: models.map((n) => ({ key: n, name: n })) },
    rows: [{ at: Date.parse("2026-11-04T10:00:00Z"), ...Object.fromEntries(models.map((n, i) => [n, i + 1])) }],
  };
  const charts = { sources: option(sourceFrame(filed, "week"), "columns", {}), live: option(live, "area", {}), cost: option(cost, "columns", {}) };
  for (const [name, chartOption] of Object.entries(charts)) for (const width of [390, 1440]) {
    const ec = echarts.init(null, chartTheme({ ink: "#000", rule: "#ccc", sans: "sans" }), { renderer: "svg", ssr: true, width, height: 240 });
    ec.setOption(chartOption);
    fitGrid(ec);
    const model = ec.getModel(), group = ec.getViewOfComponentModel(model.getComponent("legend")).group;
    const box = group.getBoundingRect().clone();
    box.applyTransform(group.getLocalTransform());
    const grid = model.getComponent("grid").coordinateSystem.getRect();
    const drawn: string[] = [];
    group.traverse((g: any) => { if (models.includes(g.style?.text)) drawn.push(g.style.text); });
    ec.dispose();
    if (name === "cost") { expect(chartOption.legend.type).not.toBe("scroll"); expect(drawn, `${width}px`).toEqual(models); }
    expect(box.y + box.height, `${name} at ${width}px`).toBeLessThanOrEqual(grid.y);
  }
});
