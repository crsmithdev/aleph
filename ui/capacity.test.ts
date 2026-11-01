import { expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { liveOption, renderCapacity, roleRows, totals } from "./views/capacity.js";
// @ts-ignore plain JS shared with the page
import { pace, weekGone } from "./views/speed.js";

const S: any = { now: "2026-11-01T08:00:00Z", usage: { now: { seven_day: 7, seven_day_resets_at: "2026-11-07T08:00:00Z" } }, factory: { runsToday: 198, costToday: 71.94, dayCap: 999, liveRuns: 1, liveCap: 5 } };
const agents = {
  live: 1, workers: 1, cap: 5, mean: 1.5, peak: 4,
  roles: [
    { key: "worker", name: "Worker", runs: 10, hours: 9, p50: 400, models: ["sonnet"], live: 1 },
    { key: "triage", name: "Triage", runs: 5, hours: 1, p50: 38, models: ["opus"], live: 0 },
    { key: "reviewer", name: "Reviewer", runs: 3, hours: null, p50: null, models: [], live: null },
  ],
  points: [{ at: new Date(2026, 9, 27).toISOString(), worker: 1, triage: 0.5 }, { at: new Date(2026, 9, 28).toISOString() }],
};
const D = { window: "week", agents };

test("the share of the week gone comes from seven_day_resets_at", () => {
  expect(weekGone("2026-11-07T08:00:00Z", "2026-11-01T08:00:00Z")).toBeCloseTo(14.29, 1);
  expect(weekGone("2026-11-08T08:00:00Z", "2026-11-01T08:00:00Z")).toBe(0);
  expect(weekGone(undefined, S.now)).toBeNull();
  expect(pace(S).word).toBe("under");
  expect(pace({ ...S, usage: { now: { ...S.usage.now, seven_day: 50 } } }).word).toBe("over");
});

test("role shares sum to 100% over the timed roles, and the reviewer row says not timed", () => {
  const rows = roleRows(agents);
  expect(rows.filter((r: any) => r.share !== null).reduce((a: number, r: any) => a + r.share, 0)).toBeCloseTo(100);
  expect(rows.at(-1).share).toBeNull();
  expect(renderCapacity(S, D)).toMatch(/<th scope="row">Reviewer<\/th><td>3<\/td><td>not timed<\/td><td>–<\/td><td>–<\/td><td>–<\/td>/);
});

test("the tiles come from the state and the agents", () => {
  const h = renderCapacity(S, D);
  expect([...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1])).toEqual(["Weekly usage", "Runs today", "Worker slots", "Agents live"]);
  for (const t of ["$71.94 recorded cost", "day cap 999", "1 <em>of 5</em>", "mean, all roles, peak 4", "1 of 2 steps had no agent live"]) expect(h).toContain(t);
});

test("no usage data says usage unknown; while the speed data loads the page says so", () => {
  const h = renderCapacity({ ...S, usage: undefined }, null);
  expect(h).toContain("usage unknown");
  expect(h).toContain("Loading");
  expect(renderCapacity(S, { error: "no data" })).toContain("no data");
});

test("the chart has one area of the total agents live", () => {
  expect(totals(agents)).toEqual([1.5, 0]);
  const o = liveOption(D, "#123");
  expect(o.series.length).toBe(1);
  expect(o.series[0].data).toEqual([1.5, 0]);
});

test("a stale usage shows the figure and its age; a fresh one shows no age", () => {
  const at = "2026-11-01T07:20:00Z";
  const stale = { ...S, usage: { stale: true, now: { ...S.usage.now, at } } };
  expect(renderCapacity(stale, null)).toContain("as of 40m ago");
  const fresh = { ...S, usage: { stale: false, now: { ...S.usage.now, at } } };
  expect(renderCapacity(fresh, null)).not.toContain("as of");
});

test("the title is the sidebar name, whatever the data", () => {
  expect(renderCapacity(S, D)).toContain('<header class="ph"><h1>Capacity</h1></header>');
  expect(renderCapacity({ ...S, usage: undefined }, null)).toContain('<header class="ph"><h1>Capacity</h1></header>');
});
