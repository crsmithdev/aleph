import { expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { FORMS, formOf, label, option, panel, title } from "./chart.js";

const keys = [{ key: "a", name: "A", color: "series-1" }, { key: "b", name: "B" }, { key: "z", name: "Z" }];
const at = (d: number) => new Date(2026, 9, d).toISOString();
const time: any = { measure: { name: "Agents Live", unit: "count", agg: "max" }, over: { kind: "time", window: "week" }, by: { name: "Role", keys }, rows: [{ at: at(27), a: 1, b: 3 }, { at: at(28), a: 2, b: 0 }] };
const cat: any = { measure: { name: "Outcomes", unit: "count", agg: "sum" }, over: { kind: "category", name: "Role" }, by: { name: "Outcome", keys }, rows: [{ name: "Worker", a: 1, b: 1 }, { name: "Triage", a: 3 }] };
const T = { "series-1": "#1" };

test("the title is the measure by the breakdown over time, and by the category over categories", () => {
  expect(title(time)).toBe("Agents Live by Role");
  expect(title(cat)).toBe("Outcomes by Role");
  expect(title({ ...time, by: undefined })).toBe("Agents Live");
});

test("the label states each key with a value: the peak of a level, the total of a flow", () => {
  expect(label(time)).toBe("Agents Live by Role: A peak 2, B peak 3");
  expect(label(cat)).toBe("Outcomes by Role: A 4, B 1");
  expect(label({ ...time, rows: [] })).toBe("Agents Live by Role: none");
});

test("a kept form the group offers stays; else a level opens as an area, a flow as columns, categories as stacked bars", () => {
  expect(formOf(time, "lines")).toBe("lines");
  expect(formOf(time, "grouped")).toBe("area");
  expect(formOf({ ...time, measure: { ...time.measure, agg: "sum" } }, undefined)).toBe("columns");
  expect(formOf(cat, "area")).toBe("stacked");
});

test("each form of a group draws its series, with no series for a key that is 0 in every row", () => {
  const kinds = (f: any, form: string) => option(f, form, T).series.map((s: any) => [s.name, s.type, s.stack ?? null]);
  expect(kinds(time, "area")).toEqual([["A", "line", "all"], ["B", "line", "all"]]);
  expect(kinds(time, "columns")).toEqual([["A", "bar", "all"], ["B", "bar", "all"]]);
  expect(kinds(time, "lines")).toEqual([["A", "line", null], ["B", "line", null]]);
  expect(kinds(cat, "grouped")).toEqual([["A", "bar", null], ["B", "bar", null]]);
  expect(option(time, "area", T).series[0].color).toBe("#1");
});

test("share draws each key as a percent of its row, on an axis to 100", () => {
  const o = option(time, "share", T);
  expect(o.series.map((s: any) => s.data)).toEqual([[25, 100], [75, 0]]);
  expect(o.yAxis.max).toBe(100);
  expect(o.tooltip.valueFormatter(25)).toBe("25%");
});

test("the hidden series stay hidden in the legend", () => {
  expect(option(time, "area", T, ["B"]).legend.selected).toEqual({ B: false });
});

test("a day axis labels the first point of each day, and a frame of one row per day keeps every label", () => {
  const axis = (f: any) => { const a = option(f, "area", T).xAxis; return a.data.map((s: string, i: number) => a.axisLabel.formatter(s, i)); };
  const hour = (d: number, h: number) => new Date(2026, 9, d, h).toISOString();
  const rows = [{ at: hour(27, 22) }, { at: hour(27, 23) }, { at: hour(28, 0) }, { at: hour(28, 1) }];
  expect(axis({ ...time, rows })).toEqual(["Oct 27", "", "Oct 28", ""]);
  expect(axis(time)).toEqual(["Oct 27", "Oct 28"]);
});

test("the panel has a form control for its group, or the empty line under its title", () => {
  const h = panel(time, "lines");
  expect(h.match(/data-form="(\w+)"/g)).toEqual(FORMS.time.map((x: any) => `data-form="${x.key}"`));
  expect(h).toContain('data-form="lines" aria-label="Lines" title="Lines" aria-pressed="true"');
  const none = panel({ ...time, rows: [] }, "area");
  expect(none).toContain("<h2>Agents Live by Role</h2>");
  expect(none).toContain('<div class="empty"><p>No data</p></div>');
  expect(none).not.toContain("chartbox");
});

test("the option carries the link of a row: the point of a time frame, the bar and the label of a category frame", () => {
  const t = { ...time, rows: [{ at: at(27), a: 1, href: "#/factory/jobs/a1" }, { at: at(28), a: 2 }] };
  expect(option(t, "points", T).series[0].data).toEqual([{ value: 1, href: "#/factory/jobs/a1" }, 2]);
  const c = { ...cat, rows: [{ name: "a1", a: 1, href: "#/factory/jobs/a1" }, { name: "Worker", a: 3 }] };
  const o = option(c, "stacked", T);
  expect(o.series[0].data).toEqual([{ value: 1, href: "#/factory/jobs/a1" }, 3]);
  expect(o.yAxis.triggerEvent).toBe(true);
  expect(o.yAxis.axisLabel.interval).toBe(0);
});

test("a linked row is also a link in the markup, for the keyboard; a frame with no link has no list", () => {
  const c = { ...cat, rows: [{ name: "a1", a: 1, href: "#/factory/jobs/a1" }, { name: "Worker", a: 3 }] };
  expect(panel(c, "stacked")).toContain('<ul class="chartlinks sr"><li><a href="#/factory/jobs/a1">a1</a></li></ul>');
  expect(panel(cat, "stacked")).not.toContain("chartlinks");
});

test("a time frame's tooltip header has the date with the hour label, and the axis shows the label", () => {
  const hour = (h: number) => new Date(2026, 9, 27, h).toISOString();
  const x = option({ ...time, over: { kind: "time", window: "day" }, rows: [{ at: hour(4), a: 1 }, { at: hour(5), a: 2 }] }, "area", T).xAxis;
  expect(x.data).toEqual(["Oct 27 4a", "Oct 27 5a"]);
  expect(x.data.map((s: string, i: number) => x.axisLabel.formatter(s, i))).toEqual(["4a", "5a"]);
});

test("a frame of more than seven keys with values draws seven and one Other that sums the rest", () => {
  const ks = Array.from({ length: 9 }, (_, i) => ({ key: `k${i}`, name: `K${i}` }));
  const f = { ...time, by: { name: "Role", keys: ks }, rows: [{ at: at(27), ...Object.fromEntries(ks.map((k, i) => [k.key, i + 1])) }, { at: at(28), k8: 4 }] };
  const s = option(f, "area", { muted: "#m" }).series;
  expect(s.map((x: any) => x.name)).toEqual(["K0", "K1", "K2", "K3", "K4", "K5", "K6", "Other"]);
  expect(s.at(-1).data).toEqual([8 + 9, 4]);
  expect(label(f)).toContain("Other peak 17");
  expect(option({ ...f, by: { name: "Role", keys: ks.slice(0, 7) } }, "area", T).series).toHaveLength(7);
});

test("the time group offers points, for one dot per row, and a kept points form stays", () => {
  expect(FORMS.time.map((x: any) => x.key)).toEqual(["area", "columns", "lines", "points", "share"]);
  expect(formOf(time, "points")).toBe("points");
  const s = option(time, "points", T).series[0];
  expect([s.type, s.symbol, s.symbolSize, s.lineStyle.width]).toEqual(["line", "circle", 9, 0]);
});

test("a panel whose frame carries a mark says how old its data is and why, with or without rows", () => {
  const since = "2026-01-01T00:00:00Z";
  for (const f of [time, { ...time, rows: [] }]) {
    const h = panel({ ...f, error: "build failed", since }, "area");
    expect(h).toContain('<p class="notice bad" role="alert">');
    expect(h).toMatch(/Agents Live by Role is \d+d \d+h old: build failed/);
  }
  expect(panel(time, "area")).not.toContain('class="notice"');
});

test("a null value is a gap that a line passes over, and a missing one is 0", () => {
  const f = { ...time, rows: [{ at: at(27), a: 1, b: 3 }, { at: at(28), a: null }, { at: at(29), a: 2, b: 1 }] };
  const [a, b] = option(f, "lines", T).series;
  expect(a.data).toEqual([1, null, 2]);
  expect(b.data).toEqual([3, 0, 1]);
  expect(a.connectNulls).toBe(true);
});
