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
const th = (html: string) => [...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map((m) => m[1]);

test("the left panel is the Stages table and the middle panel the Holds table, from monitor.stages and monitor.holds", () => {
  const html = render(monitor);
  const stages = html.slice(html.indexOf('id="stages"'), html.indexOf('id="holds"'));
  const holds = html.slice(html.indexOf('id="holds"'), html.indexOf('id="monitor"'));
  expect(th(stages)).toEqual(["stage", "cost per item", "runs per item", "no usable result"]);
  expect(stages).toContain("<td>build</td>");
  expect(stages).toContain("$1.50 <small>($2.00)</small>");
  expect(stages).toContain("25% <small>(-)</small>");
  expect(th(holds)).toEqual(["hold record kind", "goals", "hours in the state"]);
  expect(holds).toContain("<td>stops</td>");
  expect(holds).toContain("2 <small>(1.5)</small>");
});

test("each table shows at most 10 rows", () => {
  const rows = Array.from({ length: 12 }, (_, i) => ({ stage: `s${i}`, costPerItem: P(1, 1), runsPerItem: P(1, 1), unusable: P(0, 0) }));
  const hs = Array.from({ length: 12 }, (_, i) => ({ kind: `k${i}`, goals: P(1, 1), hours: P(1, 1) }));
  expect(view.renderStages({ factory: { monitor: { ...monitor, stages: rows } } }).match(/<tr><td>/g)).toHaveLength(10);
  expect(view.renderHolds({ factory: { monitor: { ...monitor, holds: hs } } }).match(/<tr><td>/g)).toHaveLength(10);
});

test("the Monitor panel shows the findings with numbers and **text** in bold, other HTML escaped, and no table", () => {
  const html = render(monitor);
  expect(html).toContain("Monitor, 2026-10-20");
  expect(html).toContain("<li>Build runs &lt;b&gt;rose&lt;/b&gt; to <b>38%</b> from <b>20%</b>, <b>no usable result</b> is <b>3</b>.</li>");
  expect(html).toContain("<li>Plans rose.</li>");
  expect(html).not.toContain("<summary>Table</summary>");
  expect(html).not.toContain("monitor-table");
});

test("a report with no reading says why; one with no findings says nothing looks off; no report shows no panel", () => {
  expect(view.renderMonitor({ factory: { monitor: { ...monitor, findings: [], error: "the monitor reader timed out" } } })).toContain("No reading: the monitor reader timed out");
  expect(view.renderMonitor({ factory: { monitor: { ...monitor, findings: [] } } })).toContain("Nothing looks off.");
  expect(view.renderMonitor({ factory: { monitor: null } })).toBe("");
  expect(render(null)).not.toContain('id="monitor"');
});
