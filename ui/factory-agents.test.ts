import { expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { costOption, liveOption, outcomesOption, renderFactoryAgents } from "./views/factory-agents.js";
// @ts-ignore plain JS shared with the page
import { pace, weekGone } from "./views/speed.js";

const S: any = { now: "2026-11-01T08:00:00Z", usage: { now: { seven_day: 7, seven_day_resets_at: "2026-11-07T08:00:00Z" } }, factory: { runsToday: 198, costToday: 71.94, liveRuns: 1, liveCap: 5, liveLocal: 1, localCap: 1 } };
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
  const keys = (h: string) => [...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1]);
  const rates = { success: 0.8, baseline: 0.7, firstPass: 0.5, local: 0.25 };
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, rates } });
  expect(keys(h)).toEqual(["Usage", "Worker slots", "Success rate", "Worker first pass", "Local share"]);
  for (const t of ["<b>1<em> / 5</em></b>", "<b>80%</b>", "<b>50%</b>", "<b>25%</b>"]) expect(h).toContain(t);
  expect(h).toMatch(/Success rate<\/span><span class="tr good"/);
  const none = renderFactoryAgents(S, { ...D, agents: { ...agents, rates: { success: null, baseline: null, firstPass: null, local: null } } });
  expect(none.match(/<b>–<\/b>/g)!.length).toBe(3);
});

test("no usage data says usage unknown; while the speed data loads the page says so", () => {
  const h = renderFactoryAgents({ ...S, usage: undefined }, null);
  expect(h).toContain("usage unknown");
  expect(h).toContain(`<p class="quiet" role="status">Loading the agents…</p>`);
  expect(renderFactoryAgents(S, { error: "no data" })).toContain("no data");
});

const T: any = { done: "#d", need: "#n", stuck: "#s", "series-1": "#1", "series-2": "#2" };
const buckets = [{ at: new Date(2026, 9, 27).toISOString(), cost: { opus: 1.5, sonnet: 0.25 } }, { at: new Date(2026, 9, 28).toISOString(), cost: { opus: 2 } }];
const outcomes = [
  { role: "worker", model: "haiku", succeeded: 6, failed: 2, stuck: 1 },
  { role: "worker", model: "sonnet", succeeded: 4, failed: 0, stuck: 0 },
  { role: "triage", model: "opus", succeeded: 5, failed: 0, stuck: 0 },
];
const E: any = { window: "week", buckets, agents: { ...agents, outcomes } };

test("the page has three chart boxes in one row, each with role img and an aria-label", () => {
  const html = renderFactoryAgents(S, E);
  const row = html.slice(html.indexOf('<div class="trio">'), html.indexOf('id="models"'));
  const boxes = [...row.matchAll(/<div class="chartbox" data-chart="(\w+)" role="img" aria-label="([^"]+)"><\/div>/g)];
  expect(boxes.map((m) => m[1])).toEqual(["live", "outcomes", "cost"]);
  expect(boxes[1][2]).toBe("Outcomes by role: 15 succeeded, 2 failed, 1 stuck");
  expect(boxes[2][2]).toBe("Cost by model: opus $3.50, sonnet $0.25");
  expect(html.match(/class="chartbox"/g)!.length).toBe(3);
});

test("the live option has one stacked series per timed role with the point values", () => {
  const o = liveOption(E, T);
  expect(o.series.map((s: any) => [s.name, s.stack, s.color, s.data])).toEqual([["Worker", "all", "#1", [1, 0]], ["Triage", "all", "#2", [0.5, 0]]]);
});

test("the outcomes option has horizontal stacked bars of succeeded, failed and stuck, summed per role", () => {
  const o = outcomesOption(E, T);
  expect(o.yAxis.type).toBe("category");
  expect(o.yAxis.data).toEqual(["Worker", "Triage"]);
  expect(o.series.map((s: any) => [s.name, s.stack, s.data])).toEqual([["Succeeded", "all", [10, 5]], ["Failed", "all", [2, 0]], ["Stuck", "all", [1, 0]]]);
});

test("the cost option has one stacked series per model with the bucket costs", () => {
  const o = costOption(E);
  expect(o.series.map((s: any) => [s.name, s.stack, s.data])).toEqual([["opus", "all", [1.5, 2]], ["sonnet", "all", [0.25, 0]]]);
});

test("the title is the sidebar name, whatever the data", () => {
  expect(renderFactoryAgents(S, D)).toContain('<header class="ph"><h1>Agents</h1><span class="count">last 7 days</span><div class="aside"><div class="fbar">');
  expect(renderFactoryAgents({ ...S, usage: undefined }, null)).toContain('<header class="ph"><h1>Agents</h1><span class="count">last 7 days</span><div class="aside"><div class="fbar">');
});

test("the Models card has a Claude | Local control per slot and four fixed rows; the card says up or down and the Local buttons follow", () => {
  const slots = { "worker.haiku": "claude", "worker.sonnet": "local", merge: "claude", title: "claude", judge: "local" };
  const down = renderFactoryAgents(S, D, "live", "week", { slots, local: "down" });
  expect(down).toContain("Local server: down");
  expect(down.match(/<button type="button" data-value="local" aria-pressed="(true|false)" disabled>/g)!.length).toBe(5);
  const up = renderFactoryAgents(S, D, "live", "week", { slots, local: "up" });
  expect(up).toContain("Local server: up");
  expect(up).not.toContain("disabled");
  const group = (slot: string) => up.match(new RegExp(`data-slot="${slot}">(.*?)</div>`))![1];
  expect(group("worker.sonnet")).toContain('data-value="local" aria-pressed="true"');
  expect(group("worker.sonnet")).toContain('data-value="claude" aria-pressed="false"');
  expect(group("merge")).toContain('data-value="claude" aria-pressed="true"');
  expect([...up.matchAll(/<b>(\w+)<\/b><span>Claude, fixed/g)].map((x) => x[1])).toEqual(["Intake", "Review", "Monitor", "Director"]);
  expect(renderFactoryAgents(S, D)).toContain("Loading the models");
});
