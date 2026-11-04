import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { withFactory } from "./test-now.ts";

const calm = { ...withFactory({}), asks: [], stuck: [] };
const monitor = { day: "2026-10-20", headline: "Acceptance failures that led to a real fix: 1 of 6 in the 8 days to 2026-10-20 (17%); 1 of 6 in all (17%).", findings: ["Build runs <b>rose</b>.", "Plans rose."], table: "# Factory monitor 2026-10-20\n| a | b |" };

test("the Monitor panel shows the day, the first metric, the findings in rank order and the table behind a fold", () => {
  const html = view.view.render({ ...calm, factory: { ...calm.factory, monitor } });
  expect(html).toContain('<section id="monitor"');
  expect(html).toContain("Monitor, 2026-10-20");
  expect(html).toContain(monitor.headline);
  expect(html).toContain('<ol class="findings"><li>Build runs &lt;b&gt;rose&lt;/b&gt;.</li><li>Plans rose.</li></ol>');
  expect(html).toContain("<summary>Table</summary>");
});

test("a report with no reading says why; one with no findings says nothing looks off; no report shows no panel", () => {
  expect(view.renderMonitor({ factory: { monitor: { ...monitor, findings: [], error: "the monitor reader timed out" } } })).toContain("No reading: the monitor reader timed out");
  expect(view.renderMonitor({ factory: { monitor: { ...monitor, findings: [] } } })).toContain("Nothing looks off.");
  expect(view.renderMonitor({ factory: { monitor: null } })).toBe("");
  expect(view.view.render({ ...calm, factory: { ...calm.factory, monitor: null } })).not.toContain('id="monitor"');
});
