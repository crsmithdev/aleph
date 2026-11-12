import { expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { chartKey, FRAMES, redirect, renderFactoryJobs, slowestFrame, stripFrame, trendFrame } from "./views/factory-jobs.js";
// @ts-ignore plain JS shared with the page
import { option, title } from "./chart.js";
// @ts-ignore plain JS shared with the page
import { wireJobs } from "./views/jobs.js";

const P = (count: number, p50: number, p90: number, hist: number[] = [0, 1, 0, 0, 0, 0, count ? 2 : 0], worst = 9000) => ({ count, p50, p90, hist, worst });
const F1 = new Date(2026, 9, 27, 9).getTime(), F2 = new Date(2026, 9, 28, 14).getTime();
const D: any = {
  window: "week",
  phases: { lead: P(3, 1570, 16560), intake: P(3, 59, 1467), queue: P(3, 304, 6120, [1, 1, 1, 0, 0, 0, 0], 800), implement: P(3, 475, 1698), land: P(3, 74, 650) },
  buckets: [{ at: new Date(2026, 9, 27).toISOString(), lead: 1000, queue: 200, p90: { lead: 3000, queue: 900 } }, { at: new Date(2026, 9, 28).toISOString(), lead: null, queue: 100, p90: { lead: null, queue: 400 } }],
  times: [
    { id: "fx-1", href: "#/issues/fx/1", outcome: "landed", filed: new Date(F1).toISOString(), intake: 60, queue: 600, implement: 240, land: 200, lead: 1100 },
    { id: "fx-2", href: "#/issues/fx/2", outcome: "unlanded", filed: new Date(F2).toISOString(), intake: 100, queue: 300, implement: 100, land: null, lead: null },
    { id: "fx-3", href: "#/issues/fx/3", outcome: "landed", filed: null, intake: 10, queue: 20, implement: 4000, land: 30, lead: 5000 },
  ],
  checks: [{ name: "tests", count: 5, p50: 51, p90: 171 }],
  models: [{ model: "unset", count: 2, p50: 480 }, { model: "opus", count: 1, p50: 700 }],
};

const T = { hot: "H", run: "R", done: "D", need: "N", muted: "M" };

test("with no time for the stage the trend, strip and slowest panels give way to the empty line", () => {
  const none = renderFactoryJobs({ ...D, buckets: D.buckets.map((b: any) => ({ ...b, queue: null, p90: {} })), times: D.times.map((i: any) => ({ ...i, queue: null })) }, null, "queue");
  expect(none).toContain("No time to plot in this window.");
  expect(none).not.toContain("chartbox");
  expect(none).toContain("<h2>Slowest 10</h2>");
  for (const k of ["trend", "strip", "slowest"]) expect(none).toContain(`<aleph-chart key="factory/jobs/${k}"`);
  const shown = renderFactoryJobs(D, null, "queue");
  for (const k of ["trend", "strip", "slowest"]) expect(shown).toContain(`<aleph-chart key="factory/jobs/${k}"`);
  expect(shown.match(/class="chartbox"/g)).toHaveLength(3);
  expect(shown).not.toContain("data-chart=");
});

test("five stage tiles come from the data, with the last 24h", () => {
  const h = renderFactoryJobs(D, { phases: { ...D.phases, lead: P(1, 1484, 1484) } }, "lead");
  expect([...h.matchAll(/data-tile="(\w+)"/g)].map((m) => m[1])).toEqual(["lead", "intake", "queue", "implement", "land"]);
  expect(h).toContain('<span class="tr good" title="24m 44s in the last 24h, against 26m 10s over the window">▼ 5%</span></span><b>26m 10s<em> / 4h 36m</em></b>');
  expect(h).toContain('data-tile="lead" aria-pressed="true"');
});

test("three chart panels in one row replace the old cards, each says its data for the stage, and the slowest panel links each row to its issue", () => {
  const lead = renderFactoryJobs(D, null, "lead"), queue = renderFactoryJobs(D, null, "queue");
  expect(lead).not.toContain("how long it took");
  expect(lead).not.toContain("Median by");
  const row = lead.match(/<div class="trio">(.*?)<div class="pair">/s)![1];
  expect([...row.matchAll(/<aleph-chart key="([^"]*)"/g)].map((m) => m[1])).toEqual(["factory/jobs/trend", "factory/jobs/strip", "factory/jobs/slowest"]);
  expect([...row.matchAll(/class="chartbox"[^>]*aria-label="([^"]*)"/g)].map((m) => m[1])).toEqual([
    "Lead Time by Day: p90 peak 50m 00s, p50 peak 16m 40s",
    "Lead Time: Time per Issue: landed peak 18m 20s",
    "Slowest 10: Intake peak 1m 40s, Queue peak 10m 00s, Build peak 1h 06m, Land peak 3m 20s",
  ]);
  // The stage's own line sits under the trend's title; each panel keeps its own empty line.
  expect(row).toContain('<p class="notice" role="status">From filing to the last land.</p>');
  expect(queue).toContain('<p class="notice" role="status">From intake to the first agent job. This includes waits for a slot or for another issue.</p>');
  expect(lead).not.toContain('<a class="idl" href="#/issues/fx/3">fx-3 Build</a>');
  expect(queue).toContain("Queue peak 10m 00s");
  expect([...lead.matchAll(/<h2>([^<]*)<\/h2>/g)].map((m) => m[1])).toEqual(["Lead Time by Day", "Lead Time: Time per Issue", "Slowest 10", "Checks", "Build Time by Model", "Jobs"]);
  expect([...lead.matchAll(/<section class="card[^"]*" aria-label="([^"]*)"/g)].map((m) => m[1])).toEqual(["Lead Time by Day", "Lead Time: Time per Issue", "Slowest 10", "Checks", "Build time by model", "Jobs"]);
});

test("each Jobs frame carries the stage's data, its colours and the issue link of its rows", () => {
  const t = trendFrame(D, "queue", "Queue", "From intake to the first agent job.");
  expect(t.rows.map((r: any) => [r.at, r.p50, r.p90])).toEqual([[D.buckets[0].at, 200, 900], [D.buckets[1].at, 100, 400]]);
  expect(t.by.keys.map((k: any) => [k.key, k.color])).toEqual([["p90", "hot"], ["p50", "run"]]);
  // The measure is the stage alone, so the title takes the `<measure> by <dimension>` form and the legend names the perciles.
  expect([title(t), t.by.keys.map((k: any) => k.name)]).toEqual(["Queue by Day", ["p90", "p50"]]);
  // The p50 is not a part of the p90, so the frame opens as two lines rather than stacked areas.
  expect([t.form, option(t, t.form, T).series.map((s: any) => s.stack ?? null)]).toEqual(["lines", [null, null]]);
  // A bucket with no time is null, so the line shows a gap.
  expect(trendFrame(D, "lead", "Lead Time", "x").rows.map((r: any) => r.p50)).toEqual([1000, null]);
  const s = stripFrame(D, "lead", "Lead Time");
  // fx-2 has no lead time and fx-3 has no filing time, so neither has a point.
  expect(s.rows.map((r: any) => [r.at, r.name, r.href, r.landed])).toEqual([[F1, "fx-1", "#/issues/fx/1", 1100]]);
  expect(s.by.keys.map((k: any) => [k.key, k.color])).toEqual([["landed", "done"], ["unlanded", "need"]]);
  const q = slowestFrame(D, "queue");
  expect(q.rows.map((r: any) => [r.name, r.href, r.queue])).toEqual([["fx-1", "#/issues/fx/1", 600], ["fx-2", "#/issues/fx/2", 300], ["fx-3", "#/issues/fx/3", 20]]);
  expect(Object.keys(FRAMES)).toEqual(["trend", "strip", "slowest"]);
  expect(chartKey("trend")).toBe("factory/jobs/trend");
});

test("the strip panel draws one point per issue, in filing order", () => {
  const d = { ...D, times: [{ ...D.times[1], lead: 700 }, D.times[0]] };
  const s = stripFrame(d, "lead", "Lead Time");
  expect(s.rows.map((r: any) => r.name)).toEqual(["fx-1", "fx-2"]);
  const o = option(s, s.form, T);
  expect(o.series.map((x: any) => x.data.map((p: any) => p?.value ?? p))).toEqual([[1100, null], [null, 700]]);
});

test("Slowest 10 holds the 10 slowest stages, by stage then by issue; for Lead Time an issue has a row per slow stage", () => {
  const many = { ...D, times: Array.from({ length: 12 }, (_, i) => ({ id: `fx-${i}`, href: `#/issues/fx/${i}`, outcome: "landed", intake: 1, queue: i === 3 ? 500 : 2, implement: 100 + i, land: 3, lead: 106 + i })) };
  const f = slowestFrame(many, "lead"), o = option(f, "stacked", T);
  expect(f.rows.map((r: any) => r.name)).toEqual(["fx-3 Queue", "fx-3 Build", "fx-4 Build", "fx-5 Build", "fx-6 Build", "fx-7 Build", "fx-8 Build", "fx-9 Build", "fx-10 Build", "fx-11 Build"]);
  expect(o.yAxis.data).toEqual(["fx-3 Queue", "fx-3 Build", "fx-4 Build", "fx-5 Build", "fx-6 Build", "fx-7 Build", "fx-8 Build", "fx-9 Build", "fx-10 Build", "fx-11 Build"]);
  // A linked row is named on the axis and its label is its own link, so every label shows.
  expect([o.yAxis.triggerEvent, o.yAxis.axisLabel.interval]).toEqual([true, 0]);
  expect(o.series.map((s: any) => [s.name, s.stack])).toEqual([["Queue", "all"], ["Build", "all"]]);
  expect(o.series[0].data[0]).toEqual({ value: 500, href: "#/issues/fx/3" });
  expect(o.series[1].data[0]).toEqual({ value: 0, href: "#/issues/fx/3" });
  expect(o.series[1].data[1]).toEqual({ value: 103, href: "#/issues/fx/3" });
  const q = slowestFrame(D, "queue");
  expect(q.rows.map((r: any) => r.name)).toEqual(["fx-1", "fx-2", "fx-3"]);
  expect(q.by.keys.map((k: any) => k.name)).toEqual(["Queue"]);
  expect(option(q, "stacked", T).series[0].data.map((x: any) => x.value)).toEqual([600, 300, 20]);
});

test("empty phases show dashes and no error", () => {
  const none = P(0, 0, 0, [0, 0, 0, 0, 0, 0, 0], 0);
  const d = { ...D, phases: { lead: none, intake: none, queue: none, implement: none, land: none }, buckets: [{ at: D.buckets[0].at, lead: null }], checks: [], models: [] };
  const h = renderFactoryJobs(d, null, "lead");
  expect(h).toContain("<b>–<em> / –</em></b>");
  expect(h).not.toMatch(/NaN|undefined|Infinity/);
});

test("the title is the sidebar name", () => {
  expect(renderFactoryJobs(D, null, "lead")).toContain('<header class="ph"><h1>Jobs</h1><div class="aside"><div class="fbar">');
});

test("the Checks table groups a job count and the Models table names a model by shortModel()", () => {
  const h = renderFactoryJobs({ ...D, checks: [{ name: "tests", count: 1234, p50: 51, p90: 171 }], models: [{ model: "claude-opus-5-5", count: 3, p50: 700 }, { model: "unset", count: 2, p50: 480 }] }, null, "lead");
  expect(h).toContain('<td class="num">1,234</td>');
  expect(h).toContain('<td class="wide" title="tests">tests</td>');
  expect(h).toContain('<td class="wide" title="opus">opus</td>');
  expect(h).toContain('<td class="wide" title="unset">unset</td>');
  expect(h).not.toContain("not recorded");
});

test("each slowest stage has a colour that it keeps whatever other stages the data holds", () => {
  const all = slowestFrame(D, "lead").by.keys, one = slowestFrame(D, "queue").by.keys;
  expect(all.map((k: any) => k.key)).toEqual(["intake", "queue", "implement", "land"]);
  for (const k of all) expect(k.color).toBeTruthy();
  expect(new Set(all.map((k: any) => k.color)).size).toBe(4);
  expect(one[0].color).toBe(all.find((k: any) => k.key === "queue").color);
});

test("each Jobs chart frame with no data shows its empty line and its hint in the empty block", () => {
  const none = renderFactoryJobs({ ...D, buckets: [], times: [] }, null, "lead");
  const blocks = [...none.matchAll(/<div class="empty"><p>No time to plot in this window\.<\/p><p class="hint">Pick a longer window or another stage\.<\/p><\/div>/g)];
  expect(blocks).toHaveLength(3);
});

const J: any = { id: "fac-9#2", subject: "fac-9", name: "fac-9", repo: "fac", kind: "build", actor: "worker", state: "landed", title: "Fix it", issue: "fac-9", started: "2026-11-01T08:00:00Z", ended: null, seconds: null, cost: 0.75, model: null };

test("the page lists the jobs with the search, the State filter and the Project filter, and links no list", () => {
  const h = renderFactoryJobs(D, null, "lead", [J], { state: "landed" });
  expect(h).toContain('href="#/jobs/fac-9%232"');
  expect(h).toContain('data-ui="jobs-search"');
  expect(h).toContain('data-name="state"');
  expect(h).toContain('data-value="landed" aria-pressed="true"');
  expect(h).toContain('<select name="project"');
  expect(h).not.toContain('href="#/jobs?');
  expect(h.match(/<tr class="rowlink"/g)).toHaveLength(1);
  expect(h).toContain('<table class="tbl">');
  expect(h.slice(h.indexOf('id="jobs-table"')).match(/<th[ >]/g)).toHaveLength(8);
  expect(h).not.toContain("<style>");
  expect(h).not.toContain("data-page");
  const many = renderFactoryJobs(D, null, "lead", Array.from({ length: 51 }, (_, i) => ({ ...J, id: `fac-${i}#1` })), {});
  expect(many.match(/<tr class="rowlink"/g)).toHaveLength(50);
  expect(many).toContain('data-page="2">Next 1<');
  expect(many).toContain("50 of 51");
  expect(renderFactoryJobs(D, null, "lead", [], {})).toContain("No job matches.");
  expect(renderFactoryJobs(D, null, "lead", null, {})).toContain("Loading jobs");
});

test("the Checks and Models tables head their count Jobs, and the stage line names jobs too", () => {
  const h = renderFactoryJobs(D, null, "queue");
  const heads = [...h.matchAll(/<th[^>]*>([^<]+)<\/th>/g)].map((m) => m[1].trim());
  expect(heads.filter((t) => t === "Jobs")).toHaveLength(2);
  expect(heads.filter((t) => /runs|goal|part/i.test(t))).toEqual([]);
  expect(h).toContain("From intake to the first agent job.");
  expect(h).not.toContain("agent run");
});

test("#/jobs redirects to the merged page with its query; a Job page does not", () => {
  expect(redirect("#/jobs?window=day")).toBe("#/factory/jobs?window=day");
  expect(redirect("#/jobs?repo=fac")).toBe("#/factory/jobs?repo=fac");
  expect(redirect("#/jobs")).toBe("#/factory/jobs");
  expect(redirect("#/jobs/aleph-1")).toBeNull();
});

test("the Checks and Models tables show empty() with no rows and page at 50", () => {
  expect(renderFactoryJobs({ ...D, checks: [], models: [] }, null, "lead").match(/class="empty"/g)!.length).toBe(2);
  const checks = Array.from({ length: 51 }, (_, i) => ({ name: `c${i}`, count: 1, p50: 1, p90: 2 }));
  expect(renderFactoryJobs({ ...D, checks }, null, "lead")).toContain("50 of 51");
});

test("Next under the Checks table turns the page in place and leaves the Jobs table's page alone", () => {
  const was = { location: globalThis.location, history: globalThis.history };
  const set: string[] = [];
  Object.assign(globalThis, { location: { hash: "#/factory/jobs" }, history: { replaceState: (_s: unknown, _t: string, url: string) => set.push(url) } });
  try {
    const root: any = {};
    wireJobs(root, () => null);
    const click = (paged: boolean) => root.onclick({ target: { closest: (s: string) => (s === "button[data-page]" ? { dataset: { page: "2" } } : s === ".paged" && paged ? {} : null) } });
    click(true);
    expect(set).toEqual([]);
    click(false);
    expect(set).toEqual(["#/factory/jobs?page=2"]);
  } finally { Object.assign(globalThis, was); }
});
