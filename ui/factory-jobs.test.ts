import { expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { redirect, renderFactoryJobs, slowestOption, stripOption, trendOption } from "./views/factory-jobs.js";

const P = (count: number, p50: number, p90: number, hist: number[] = [0, 1, 0, 0, 0, 0, count ? 2 : 0], worst = 9000) => ({ count, p50, p90, hist, worst });
const D: any = {
  window: "week",
  phases: { lead: P(3, 1570, 16560), intake: P(3, 59, 1467), queue: P(3, 304, 6120, [1, 1, 1, 0, 0, 0, 0], 800), implement: P(3, 475, 1698), land: P(3, 74, 650) },
  buckets: [{ at: new Date(2026, 9, 27).toISOString(), lead: 1000, queue: 200, p90: { lead: 3000, queue: 900 } }, { at: new Date(2026, 9, 28).toISOString(), lead: null, queue: 100, p90: { lead: null, queue: 400 } }],
  times: [
    { id: "fx-1", href: "#/issues/fx/1", outcome: "landed", intake: 60, queue: 600, implement: 240, land: 200, lead: 1100 },
    { id: "fx-2", href: "#/issues/fx/2", outcome: "unlanded", intake: 100, queue: 300, implement: 100, land: null, lead: null },
    { id: "fx-3", href: "#/issues/fx/3", outcome: "landed", intake: 10, queue: 20, implement: 4000, land: 30, lead: 5000 },
  ],
  checks: [{ name: "tests", count: 5, p50: 51, p90: 171 }],
  models: [{ model: "unset", count: 2, p50: 480 }, { model: "opus", count: 1, p50: 700 }],
};

test("five stage tiles come from the data, with the last 24h", () => {
  const h = renderFactoryJobs(D, { phases: { ...D.phases, lead: P(1, 1484, 1484) } }, "lead");
  expect([...h.matchAll(/data-tile="(\w+)"/g)].map((m) => m[1])).toEqual(["lead", "intake", "queue", "implement", "land"]);
  expect(h).toContain('<span class="tr good" title="24m 44s in the last 24h, against 26m 10s over the window">▼ 5%</span></span><b>26m<em> / 4h 36m</em></b>');
  expect(h).toContain('data-tile="lead" aria-pressed="true"');
});

test("three chart boxes in one row replace the old cards, each says its data for the stage, and the strip holds one point per issue on a log axis with its issue link", () => {
  const lead = renderFactoryJobs(D, null, "lead"), queue = renderFactoryJobs(D, null, "queue");
  expect(lead).not.toContain("how long it took");
  expect(lead).not.toContain("Median by");
  const row = lead.match(/<div class="trio">(.*?)<div class="pair">/s)![1];
  expect([...row.matchAll(/class="chartbox"[^>]*role="img" aria-label="([^"]*)"/g)].map((m) => m[1])).toEqual([
    "Lead time p50 and p90 trend: 2 issues in the last 7 days, from 18m 20s to 1h 23m",
    "Lead time time per issue: 2 issues in the last 7 days, from 18m 20s to 1h 23m",
    "Lead time slowest 10: 2 issues in the last 7 days, from 18m 20s to 1h 23m",
  ]);
  expect(queue).toContain("Queue slowest 10: 3 issues");
  expect([...lead.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1])).toEqual(["Lead Time: p50 and p90 by Day", "Lead Time: Time per Issue", "Slowest 10", "Checks", "Build Time by Model", "Jobs"]);
  expect([...lead.matchAll(/<section class="card[^"]*" aria-label="([^"]*)"/g)].map((m) => m[1])).toEqual(["Lead time: p50 and p90 by day", "Lead time: time per issue", "Slowest 10", "Checks", "Build time by model", "Jobs"]);
  const o = stripOption(D, "queue", { done: "D", need: "N" });
  expect([o.xAxis.type, o.xAxis.logBase, o.xAxis.min({ min: 20 }), o.xAxis.min({ min: 60 })]).toEqual(["log", 60, 1, 60]);
  const pts = o.series.flatMap((s: any) => s.data);
  expect(pts.map((p: any) => [p.id, p.href, p.value[0]]).sort()).toEqual([["fx-1", "#/issues/fx/1", 600], ["fx-2", "#/issues/fx/2", 300], ["fx-3", "#/issues/fx/3", 20]]);
  expect(o.series.map((s: any) => s.color)).toEqual(["D", "N"]);
  expect(trendOption(D, "queue", { run: "R", hot: "H" }).series.map((s: any) => [s.name, s.data, !!s.areaStyle])).toEqual([["p90", [900, 400], true], ["p50", [200, 100], true]]);
  expect(trendOption(D, "lead", { run: "R", hot: "H" }).series.map((s: any) => s.data)).toEqual([[3000, 0], [1000, 0]]);
});

test("Slowest 10 holds the 10 slowest stages, by stage then by issue; for Lead Time an issue has a row per slow stage", () => {
  const many = { ...D, times: Array.from({ length: 12 }, (_, i) => ({ id: `fx-${i}`, href: `#/issues/fx/${i}`, outcome: "landed", intake: 1, queue: i === 3 ? 500 : 2, implement: 100 + i, land: 3, lead: 106 + i })) };
  const o = slowestOption(many, "lead");
  expect(o.yAxis.data).toEqual(["fx-3 Queue", "fx-3 Build", "fx-4 Build", "fx-5 Build", "fx-6 Build", "fx-7 Build", "fx-8 Build", "fx-9 Build", "fx-10 Build", "fx-11 Build"]);
  expect(o.yAxis.axisLabel.interval).toBe(0);
  expect(o.series.map((s: any) => [s.name, s.stack])).toEqual([["Queue", "one"], ["Build", "one"]]);
  expect(o.series[0].data[0]).toEqual({ value: 500, href: "#/issues/fx/3" });
  expect(o.series[1].data[0]).toBeNull();
  expect(o.series[1].data[1]).toEqual({ value: 103, href: "#/issues/fx/3" });
  const q = slowestOption(D, "queue");
  expect(q.yAxis.data).toEqual(["fx-1", "fx-2", "fx-3"]);
  expect(q.series.map((s: any) => s.name)).toEqual(["Queue"]);
  expect(q.series[0].data.map((x: any) => x.value)).toEqual([600, 300, 20]);
});

test("empty phases show dashes and no error", () => {
  const none = P(0, 0, 0, [0, 0, 0, 0, 0, 0, 0], 0);
  const d = { ...D, phases: { lead: none, intake: none, queue: none, implement: none, land: none }, buckets: [{ at: D.buckets[0].at, lead: null }], checks: [], models: [] };
  const h = renderFactoryJobs(d, null, "lead");
  expect(h).toContain("<b>–<em> / –</em></b>");
  expect(h).not.toMatch(/NaN|undefined|Infinity/);
});

test("the title is the sidebar name; models with no name say not recorded", () => {
  expect(renderFactoryJobs(D, null, "lead")).toContain('<header class="ph"><h1>Jobs</h1><span class="count">last 7 days</span><div class="aside"><div class="fbar">');
  expect(renderFactoryJobs(D, null, "lead")).toContain("not recorded");
});

const J: any = { name: "fac-9", repo: "fac", item: { id: 9, title: "Fix it" }, condition: "landed", started: "2026-11-01T08:00:00Z", cost: 0.75 };

test("the page lists the jobs with the search, the State filter and the Project filter, and links no list", () => {
  const h = renderFactoryJobs(D, null, "lead", [J], { repo: "fac", condition: "landed" });
  expect(h).toContain('href="#/jobs/fac-9"');
  expect(h).toContain('data-ui="jobs-search"');
  expect(h).toContain('data-name="condition"');
  expect(h).toContain('data-value="landed" aria-pressed="true"');
  expect(h).toContain('<select name="project"');
  expect(h).not.toContain('href="#/jobs?');
  expect(h.match(/<tr class="rowlink"/g)).toHaveLength(1);
  expect(h).toContain('<table class="tbl">');
  expect(h.slice(h.indexOf('id="jobs-table"')).match(/<th[ >]/g)).toHaveLength(8);
  expect(h).not.toContain("<style>");
  expect(h).not.toContain("data-more");
  const many = renderFactoryJobs(D, null, "lead", Array.from({ length: 51 }, (_, i) => ({ ...J, name: `fac-${i}` })), {});
  expect(many.match(/<tr class="rowlink"/g)).toHaveLength(50);
  expect(many).toContain('data-more="1"');
  expect(many).toContain("50 of 51");
  expect(renderFactoryJobs(D, null, "lead", [], {})).toContain("No job matches.");
  expect(renderFactoryJobs(D, null, "lead", null, {})).toContain("Loading jobs");
});

test("#/jobs redirects to the merged page with its query; a Job page does not", () => {
  expect(redirect("#/jobs?window=day")).toBe("#/factory/jobs?window=day");
  expect(redirect("#/jobs?repo=fac")).toBe("#/factory/jobs?repo=fac");
  expect(redirect("#/jobs")).toBe("#/factory/jobs");
  expect(redirect("#/jobs/aleph-1")).toBeNull();
});
