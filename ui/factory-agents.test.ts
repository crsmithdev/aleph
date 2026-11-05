import { expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { liveOption, renderFactoryAgents, totals } from "./views/factory-agents.js";
// @ts-ignore plain JS shared with the page
import { pace, weekGone } from "./views/speed.js";

const S: any = { now: "2026-11-01T08:00:00Z", usage: { now: { seven_day: 7, seven_day_resets_at: "2026-11-07T08:00:00Z" } }, factory: { runsToday: 198, costToday: 71.94, liveRuns: 1, liveCap: 5 } };
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

test("the Roles table has a row per role and model, with the warn tone under 70% and a link to the failed runs", () => {
  const o = (role: string, model: string, rate: number, extra = {}) => ({ role, model, runs: 10, succeeded: rate * 10, failed: 10 - rate * 10, stuck: 0, rate, p50: 60, cost: 1.5, baseline: 0.7, ...extra });
  const html = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [o("worker", "haiku", 0.6, { firstPass: 4, reviewPass: 0.5 }), o("worker", "gpt-oss-20b", 0.8, { firstPass: 6, reviewPass: 1 }), o("reviewer", "unset", 0.9, { pass: 9, fail: 1 })] } });
  const row = (name: string) => html.match(new RegExp(`<tr><td>${name}</td>.*?</tr>`))![0];
  expect(row("Worker · haiku")).toMatch(/<td class="num warn">60%.*?class="tr[^"]*"/);
  expect(row("Worker · haiku")).toContain('href="#/factory/jobs?role=worker&condition=failed"');
  expect(row("Worker · gpt-oss-20b")).toMatch(/<td class="num">80%.*?class="tr[^"]*"/);
  expect(row("Worker · gpt-oss-20b")).not.toContain("warn");
  expect(row("Worker · gpt-oss-20b")).toContain('<td class="num">10</td><td class="num">8</td><td class="num">2</td>');
  expect(row("Reviewer · unset")).toContain('<td class="num">9</td><td class="num">1</td>');
});

test("the tiles come from the state and the agents", () => {
  const h = renderFactoryAgents(S, D);
  expect([...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1])).toEqual(["Usage", "Runs today", "Worker slots", "Agents live"]);
  for (const t of ["<em> / $71.94</em>", "<b>1<em> / 5</em></b>", "<em> / 4</em>", "<span>mean</span><span class=\"m\"> / peak</span>"]) expect(h).toContain(t);
});

test("no usage data says usage unknown; while the speed data loads the page says so", () => {
  const h = renderFactoryAgents({ ...S, usage: undefined }, null);
  expect(h).toContain("usage unknown");
  expect(h).toContain(`<p class="quiet" role="status">Loading the agents…</p>`);
  expect(renderFactoryAgents(S, { error: "no data" })).toContain("no data");
});

test("the chart has one area of the total agents live", () => {
  expect(totals(agents)).toEqual([1.5, 0]);
  const o = liveOption(D, "#123");
  expect(o.series.length).toBe(1);
  expect(o.series[0].data).toEqual([1.5, 0]);
});

test("the title is the sidebar name, whatever the data", () => {
  expect(renderFactoryAgents(S, D)).toContain('<header class="ph"><h1>Agents</h1><span class="count">last 7 days</span><div class="aside"><div class="fbar">');
  expect(renderFactoryAgents({ ...S, usage: undefined }, null)).toContain('<header class="ph"><h1>Agents</h1><span class="count">last 7 days</span><div class="aside"><div class="fbar">');
});
