import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { withFactory } from "./test-now.ts";

const calm = { ...withFactory({}), asks: [], stuck: [] };
const P = (day: number | null, trailing: number | null) => ({ day, trailing });
const monitor = {
  day: "2026-10-20",
  findings: ["Build runs <b>rose</b> to 38% from 20%, **no usable result** is 3.", "Plans rose."],
  stages: [{ stage: "build", costPerItem: P(1.5, 2), runsPerItem: P(2, 1.4), unusable: P(0.25, null) }],
  holds: [{ kind: "stops", goals: P(2, 1.5), hours: P(5, 2) }],
};
const render = (m: any) => view.view.render({ ...calm, factory: { ...calm.factory, monitor: m } });

test("the left panel is the Stages table and the middle panel the Holds table, from monitor.stages and monitor.holds", () => {
  const html = render(monitor);
  const stages = html.slice(html.indexOf('id="stages"'), html.indexOf('id="holds"'));
  const holds = html.slice(html.indexOf('id="holds"'), html.indexOf('id="monitor"'));
  expect(stages).toContain("<td>build</td>");
  expect(stages).toContain('title="Trailing 7 days: 1.4"');
  expect(stages).toContain('title="Trailing 7 days: -"');
  expect(holds).toContain("<td>stops</td>");
  expect(holds).toContain('title="Mean per day over the trailing 7 days: 1.5"');
  expect(html).not.toContain("<small>(");
});

const labels = (html: string) => [...html.matchAll(/<th[^>]*><button type="button" data-sort="([^"]+)">([^<]*)</g)].map((m) => [m[1], m[2]]);
const firsts = (html: string) => [...html.matchAll(/<tr><td>([^<]*)<\/td>/g)].map((m) => m[1]);
const widths = (html: string) => [...html.matchAll(/class="meter"[^>]*><i style="width:([\d.]+)%/g)].map((m) => Number(m[1]));
const many = {
  stages: ([["a", 1], ["b", 3], ["c", 2]] as [string, number][]).map(([stage, n]) => ({ stage, costPerItem: P(9, 9), runsPerItem: P(n, n), unusable: P(0, 0) })),
  holds: ([["x", 1], ["y", 4], ["z", 2]] as [string, number][]).map(([kind, n]) => ({ kind, goals: P(n, n), hours: P(5 - n, 1) })),
};
const only = (m: any) => ({ factory: { monitor: { ...monitor, ...m } } });

test("Stages and Holds heads are Title Case sortHead buttons, with no cost per item", () => {
  const s = view.renderStages(only(many));
  expect(labels(s)).toEqual([["stage", "Stage"], ["runs", "Runs per Item"], ["unusable", "No Usable Result"]]);
  expect(s).not.toContain("Cost Per Item");
  expect(labels(view.renderHolds(only(many)))).toEqual([["kind", "Kind"], ["goals", "Affected Issues"], ["hours", "Hours"]]);
});

test("rows sort by runs per item and goals, descending, by default; another key or direction reorders them", () => {
  expect(firsts(view.renderStages(only(many)))).toEqual(["b", "c", "a"]);
  expect(firsts(view.renderHolds(only(many)))).toEqual(["y", "z", "x"]);
  expect(firsts(view.renderStages(only(many), { key: "runs", dir: 1 }))).toEqual(["a", "c", "b"]);
  expect(firsts(view.renderStages(only(many), { key: "stage", dir: -1 }))).toEqual(["c", "b", "a"]);
  expect(firsts(view.renderHolds(only(many), { key: "hours", dir: -1 }))).toEqual(["x", "z", "y"]);
});

test("the runs per item and goals cells hold a bar that scales with the value", () => {
  expect(widths(view.renderStages(only(many)))).toEqual([100, expect.closeTo(66.7, 1), expect.closeTo(33.3, 1)]);
  expect(widths(view.renderHolds(only(many)))).toEqual([100, 50, 25]);
});

test("each table shows at most 10 rows", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ stage: `s${i}`, costPerItem: P(1, 1), runsPerItem: P(1, 1), unusable: P(0, 0) }));
  const hs = Array.from({ length: 12 }, (_, i) => ({ kind: `k${i}`, goals: P(1, 1), hours: P(1, 1) }));
  expect(view.renderStages({ factory: { monitor: { ...monitor, stages: rows } } }).match(/<tr><td>/g)).toHaveLength(10);
  expect(view.renderHolds({ factory: { monitor: { ...monitor, holds: hs } } }).match(/<tr><td>/g)).toHaveLength(10);
});

test("the Monitor panel shows the findings with numbers and **text** in bold, other HTML escaped, and no table", () => {
  const html = render(monitor);
  expect(html).toContain('<h2>Monitor <span class="asof">2026-10-20</span></h2>');
  expect(html).not.toContain("Monitor,");
  expect(html).toContain("<li>Build runs &lt;b&gt;rose&lt;/b&gt; to <b>38%</b> from <b>20%</b>, <b>no usable result</b> is <b>3</b>.</li>");
  expect(html).toContain("<li>Plans rose.</li>");
  expect(html).not.toContain("<summary>Table</summary>");
  expect(html).not.toContain("monitor-table");
});

test("a report with no reading says why; one with no findings says nothing looks off; no report shows no panel", () => {
  expect(view.renderMonitor({ factory: { monitor: { ...monitor, findings: [], error: "the monitor reader timed out" } } })).toMatch(/<div class="error" role="alert"><p>No reading: the monitor reader timed out<\/p>/);
  expect(view.renderMonitor({ factory: { monitor: { ...monitor, findings: [] } } })).toContain('<div class="empty"><p>Nothing looks off.</p>');
  expect(view.renderMonitor({ factory: { monitor: null } })).toBe("");
  expect(render(null)).not.toContain('id="monitor"');
});
