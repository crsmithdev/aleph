import { expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { histOption, renderFactoryJobs } from "./views/factory-jobs.js";

const P = (count: number, p50: number, p90: number, hist: number[] = [0, 1, 0, 0, 0, 0, count ? 2 : 0], worst = 9000) => ({ count, p50, p90, hist, worst });
const D: any = {
  window: "week",
  phases: { lead: P(3, 1570, 16560), intake: P(3, 59, 1467), queue: P(3, 304, 6120, [1, 1, 1, 0, 0, 0, 0], 800), implement: P(3, 475, 1698), land: P(3, 74, 650) },
  buckets: [{ at: new Date(2026, 9, 27).toISOString(), lead: 1000, queue: 200 }, { at: new Date(2026, 9, 28).toISOString(), lead: null, queue: 100 }],
  checks: [{ name: "tests", count: 5, p50: 51, p90: 171 }],
  models: [{ model: "unset", count: 2, p50: 480 }, { model: "opus", count: 1, p50: 700 }],
};

test("five stage tiles come from the data, with the last 24h", () => {
  const h = renderFactoryJobs(D, { phases: { ...D.phases, lead: P(1, 1484, 1484) } }, "lead");
  expect([...h.matchAll(/data-tile="(\w+)"/g)].map((m) => m[1])).toEqual(["lead", "intake", "queue", "implement", "land"]);
  expect(h).toContain("<b>26m</b><small>p90 4h 36m</small><small>24m 44s in the last 24h</small>");
  expect(h).toContain('data-tile="lead" aria-pressed="true"');
});

test("picking a stage changes the histogram and the day rows", () => {
  const lead = renderFactoryJobs(D, null, "lead"), queue = renderFactoryJobs(D, null, "queue");
  expect(lead).toContain("Lead time times: 0, 1, 0, 0, 0, 0, 2 issues");
  expect(queue).toContain("Queue times: 1, 1, 1, 0, 0, 0, 0 issues");
  expect(lead).toContain('<span class="bv">16m 40s</span>');
  expect(queue).toContain('<span class="bv">3m 20s</span>');
  expect(queue).toContain("Longest: 13m 20s.");
  expect(lead).toContain("2 of 3 took over 4h in the last 7 days.");
});

test("the 1–4h and over-4h bins take the slow colour, the others do not", () => {
  const color = histOption(D.phases.lead, "Lead time", { hot: "H", run: "R" }).series[0].itemStyle.color;
  expect([0, 1, 2, 3, 4, 5, 6].map((dataIndex) => color({ dataIndex }))).toEqual(["R", "R", "R", "R", "R", "H", "H"]);
});

test("empty phases show dashes and no error", () => {
  const none = P(0, 0, 0, [0, 0, 0, 0, 0, 0, 0], 0);
  const d = { ...D, phases: { lead: none, intake: none, queue: none, implement: none, land: none }, buckets: [{ at: D.buckets[0].at, lead: null }], checks: [], models: [] };
  const h = renderFactoryJobs(d, null, "lead");
  expect(h).toContain("<b>–</b><small>p90 –</small><small>none in the last 24h</small>");
  expect(h).not.toMatch(/NaN|undefined|Infinity/);
});

test("the title is the sidebar name; models with no name say not recorded", () => {
  expect(renderFactoryJobs(D, null, "lead")).toContain('<header class="ph"><h1>Jobs</h1><span class="count">last 7 days</span><div class="aside"><a href="#/jobs?window=week">All jobs</a> <div class="fbar">');
  expect(renderFactoryJobs(D, null, "lead")).toContain("not recorded");
});
