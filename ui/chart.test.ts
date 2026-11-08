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

test("the panel has a form control for its group, or the empty line under its title", () => {
  const h = panel(time, "lines");
  expect(h.match(/data-form="(\w+)"/g)).toEqual(FORMS.time.map((x: any) => `data-form="${x.key}"`));
  expect(h).toContain('data-form="lines" aria-label="Lines" title="Lines" aria-pressed="true"');
  const none = panel({ ...time, rows: [] }, "area");
  expect(none).toContain("<h2>Agents Live by Role</h2>");
  expect(none).toContain("Nothing to plot in this window.");
  expect(none).not.toContain("chartbox");
});
