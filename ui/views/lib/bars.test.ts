import { expect, test } from "bun:test";
// @ts-ignore the module is plain JS, shared with the page
import { logMeter, rateBar, rowBar, runStrip } from "./bars.js";
// @ts-ignore the module is plain JS, shared with the page
import { weekday } from "./format.js";

test("a rate under its baseline takes the below class, with the baseline as its mark", () => {
  expect(rateBar(0.62, 0.8)).toContain('<i class="below" style="width:62.0%"></i><b style="left:80%"></b>');
  expect(rateBar(0.93, 0.8)).not.toContain("below");
  expect(rateBar(0.5, null)).toContain('title="no baseline"');
  expect(rateBar(0.5, null)).not.toContain("<b ");
});

test("a run strip sizes each segment by its seconds against the longest", () => {
  const h = runStrip([{ secs: 30, cls: "done", tip: "a" }, { secs: 10, cls: "error", tip: "b" }], 40, { full: true, label: "2 runs" });
  expect(h).toContain('class="runstrip full" role="img" aria-label="2 runs"');
  expect(h).toContain('<i class="done" style="width:75.00%" title="a"></i><i class="error" style="width:25.00%" title="b"></i>');
});

test("a log-scale meter puts p50 and p90 on one scale from lo to hi", () => {
  const h = logMeter(60, 3600, { lo: 1, hi: 3600, label: "x" });
  expect(h).toContain('<i style="width:50.0%"></i><b style="left:100%"></b>'.replace("50.0", (Math.log(60) / Math.log(3600) * 100).toFixed(1)));
  expect(logMeter(1, 1, { hi: 3600, label: "x" })).toContain('style="width:1.0%"');
});

test("a row bar is one meter in a cell", () => {
  expect(rowBar([{ pct: 50, cls: "c-rule" }], "half")).toBe('<span class="rowbar"><span class="meter" role="img" aria-label="half" title="half"><i class="c-rule" style="width:50.0%"></i></span></span>');
});

test("weekday is the short weekday of a time", () => {
  expect(weekday(Date.UTC(2026, 10, 18, 12))).toBe("Wed");
});
