import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OFFERS } from "../jobs/lib/routing/models.ts";
// @ts-ignore plain JS shared with the page
import { costFrame, liveFrame, renderFactoryAgents, tokensFrame, view } from "./views/factory-agents.js";
// @ts-ignore plain JS shared with the page
import { label, option } from "./chart.js";
// @ts-ignore plain JS shared with the page
import { dur, shortModel } from "./lib.js";
// @ts-ignore plain JS shared with the page
import { pace, usageCard, weekGone } from "./views/speed.js";

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
  const o = (role: string, model: string, rate: number, extra = {}) => ({ role, model, runs: 20, succeeded: rate * 20, failed: 20 - rate * 20, stuck: 0, ended: 20, rate, p50: 60, cost: 1.5, baseline: 0.7, ...extra });
  const html = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [o("worker", "haiku", 0.6, { firstPass: 4, reviewPass: 0.5 }), o("worker", "gpt-oss-20b", 0.8, { firstPass: 6, reviewPass: 1 }), o("reviewer", "unset", 0.9, { pass: 9, fail: 1 })] } });
  const row = (name: string) => html.match(new RegExp(`<tr><td class="wide" title="${name.split(" · ")[0]}">${name.split(" · ")[0]}</td><td>${name.split(" · ")[1]}</td>.*?</tr>`))![0];
  expect(row("Worker · haiku")).toMatch(/<td class="num warn">60%.*?class="tr[^"]*"/);
  expect(row("Worker · haiku")).toContain('href="#/factory/jobs?role=worker&state=failed"');
  expect(row("Worker · gpt-oss-20b")).toMatch(/<td class="num">80%.*?class="tr[^"]*"/);
  expect(row("Worker · gpt-oss-20b")).not.toContain("warn");
  expect(row("Worker · gpt-oss-20b")).toContain('<td class="num">20</td><td class="num">80%');
  expect(row("Reviewer · unset")).toContain('<td class="num">20</td><td class="num"><span class="m">Pass share</span> 90%');
});

const row = (h: string, name: string) => h.match(new RegExp(`<tr><td class="wide" title="${name}">${name}</td>.*?</tr>`))![0];

test("an outcome on a full model id joins the row of its short model; an unset model never reads not recorded", () => {
  const o = (role: string, model: string, runs: number) => ({ role, model, runs, succeeded: runs, failed: 0, stuck: 0, ended: runs, rate: 1, p50: 60, cost: 1.5, baseline: 0.7 });
  const outcomes = [o("intake", "claude-opus-5-5", 151), o("worker", "claude-haiku-4-5-20251001", 7), o("reviewer", "unset", 3)];
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes } }, "live", "week", { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(row(h, "Intake")).toMatch(/<td>opus<\/td><td class="num">151<\/td>/);
  expect(h.match(/<td class="wide" title="Intake">Intake<\/td>/g)!.length).toBe(1);
  expect(h.match(/<td class="wide" title="Worker">Worker<\/td><td>(haiku|sonnet|opus)</g)!.length).toBe(3);
  expect(h).not.toMatch(/<td>claude-/);
  expect(row(h, "Reviewer")).not.toContain("<select");
  // The reviewer's set model and its unset outcome are two rows.
  expect(h.match(/<td class="wide" title="Reviewer">Reviewer<\/td>/g)!.length).toBe(2);
  expect(h).not.toContain("not recorded");
});

test("the tiles are usage, OpenRouter spend for the window's UTC period, worker slots and the backend lights", () => {
  const keys = (h: string) => [...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1]);
  const m = { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: ["deepseek-v4.1-flash"], spend: { day: 1.5, week: 17.54, month: 18 } };
  const h = renderFactoryAgents(S, D, "live", "week", m);
  expect(keys(h)).toEqual(["Usage", "Spend", "Worker slots", "Backends"]);
  for (const t of ["<b>1<em> / 5</em></b>", "<b>$17.54</b>", '<span class="event-dot fine" aria-hidden="true"></span>Local server: up', '<span class="event-dot alert" aria-hidden="true"></span>OpenRouter: down']) expect(h).toContain(t);
  expect(renderFactoryAgents(S, { ...D, window: "hour" }, "live", "hour", m)).toContain("<b>$1.50</b>");
  const loading = renderFactoryAgents(S, D);
  expect(loading).toContain('<span class="sr">Loading</span></b><span class="q m" title="OpenRouter">');
  expect(loading).toContain('<span class="sr">Loading</span></b><span class="lights">');
  expect(loading).toContain("Loading the models…");
  // A failed models fetch is null, not a spinner.
  const failed = renderFactoryAgents(S, D, "live", "week", null);
  expect(failed).toContain('<b>–</b><span class="q m" title="OpenRouter">');
  expect(failed).toContain("Local server: –");
  expect(failed).not.toContain("Loading the models");
});

test("no usage data shows a dash; while the speed data loads the page says so", () => {
  const h = renderFactoryAgents({ ...S, usage: undefined }, null);
  expect(h).toContain('<span class="k">Usage</span></span><b>–</b>');
  expect(h).toContain(`<p class="quiet" role="status"><i class="spin" aria-hidden="true"></i>Loading the agents…</p>`);
  expect(renderFactoryAgents(S, { error: "no data" })).toContain("no data");
});

const T: any = { done: "#d", need: "#n", stuck: "#s", "series-1": "#1", "series-2": "#2" };
const buckets = [{ at: new Date(2026, 9, 27).toISOString(), cost: { opus: 1.5, sonnet: 0.25 }, tokens: { opus: 1200, sonnet: 300 } }, { at: new Date(2026, 9, 28).toISOString(), cost: { opus: 2 }, tokens: { opus: 800 } }];
const outcomes = [
  { role: "worker", model: "haiku", succeeded: 6, failed: 2, stuck: 1 },
  { role: "worker", model: "sonnet", succeeded: 4, failed: 0, stuck: 0 },
  { role: "triage", model: "opus", succeeded: 5, failed: 0, stuck: 0 },
];
const E: any = { window: "week", buckets, agents: { ...agents, outcomes } };

test("the page has three chart panels in one row, each with role img and an aria-label from its frame", () => {
  const html = renderFactoryAgents(S, E);
  const row = html.slice(html.indexOf('<div class="trio">'), html.indexOf('id="roles"'));
  expect([...row.matchAll(/<aleph-chart key="factory\/agents\/(\w+)">/g)].map((m) => m[1])).toEqual(["live", "tokens", "cost"]);
  const labels = [...row.matchAll(/<div class="chartbox" role="img" aria-label="([^"]+)"><\/div>/g)].map((m) => m[1]);
  expect(labels).toEqual(["Agents Live by Role: Worker peak 1, Triage peak 0.5", "Tokens by Model: opus 2,000, sonnet 300", "Cost by Model: opus $3.50, sonnet $0.25"]);
  for (const t of ["Agents Live by Role", "Tokens by Model", "Cost by Model"]) expect(row).toContain(`<h2>${t}</h2>`);
  expect(row).not.toContain("Outcomes by Role");
});

test("a chart with no tokens or cost shows the empty line under its title", () => {
  const html = renderFactoryAgents(S, { ...E, buckets: [{ at: buckets[0].at, cost: {}, tokens: {} }] });
  const row = html.slice(html.indexOf('<div class="trio">'), html.indexOf('id="roles"'));
  expect(row.match(/class="chartbox"/g)!.length).toBe(1);
  expect(row.match(/class="empty"/g)!.length).toBe(2);
  expect(row).toContain("<h2>Cost by Model</h2>");
});

test("the live frame has one key per timed role, and a role's colour comes from its place in the fixed role list", () => {
  const f = liveFrame(E);
  expect(f.by.keys).toEqual([{ key: "worker", name: "Worker", color: "series-1" }, { key: "triage", name: "Triage", color: "series-2" }]);
  const o = option(f, "area", T);
  expect(o.series.map((s: any) => [s.name, s.stack, s.color, s.data])).toEqual([["Worker", "all", "#1", [1, 0]], ["Triage", "all", "#2", [0.5, 0]]]);
  const late = liveFrame({ ...E, agents: { ...agents, roles: agents.roles.map((r) => (r.key === "worker" ? { ...r, hours: null } : r)) } });
  expect(late.by.keys).toEqual([{ key: "triage", name: "Triage", color: "series-2" }]);
});

test("the tokens frame has one key per model with the bucket token sums, and a model with none in a bucket counts 0", () => {
  const o = option(tokensFrame(E), "columns", T);
  expect(o.series.map((s: any) => [s.name, s.type, s.stack, s.data])).toEqual([["opus", "bar", "all", [1200, 800]], ["sonnet", "bar", "all", [300, 0]]]);
  expect(label(tokensFrame(E))).toBe("Tokens by Model: opus 2,000, sonnet 300");
});

test("the cost frame has one key per model with the bucket costs, and its axis goes through money()", () => {
  const o = option(costFrame(E), "columns", T);
  expect(o.series.map((s: any) => [s.name, s.type, s.stack, s.data])).toEqual([["opus", "bar", "all", [1.5, 2]], ["sonnet", "bar", "all", [0.25, 0]]]);
  expect(o.yAxis.axisLabel.formatter(1.5)).toBe("$1.50");
  expect(label(costFrame(E))).toBe("Cost by Model: opus $3.50, sonnet $0.25");
});

test("the cost frame names keys by shortModel(), colours each, and folds the models past the sixth into Other", () => {
  const ids = Array.from({ length: 9 }, (_, i) => `claude-m${i}-4-5-20251001`);
  const f = costFrame({ window: "week", buckets: [{ at: buckets[0].at, cost: Object.fromEntries(ids.map((m, i) => [m, i + 1])) }] });
  expect(f.by.keys.map((k: any) => k.name)).toEqual([...ids.slice(0, 6).map((m) => shortModel(m)), "Other"]);
  expect(f.by.keys.every((k: any) => k.color)).toBe(true);
  expect(f.rows[0]).toEqual({ at: buckets[0].at, ...Object.fromEntries(ids.slice(0, 6).map((m, i) => [m, i + 1])), Other: 7 + 8 + 9 });
});

test("the title is the sidebar name, whatever the data", () => {
  expect(renderFactoryAgents(S, D)).toContain('<header class="ph"><h1>Agents</h1><div class="aside"><div class="fbar">');
  expect(renderFactoryAgents({ ...S, usage: undefined }, null)).toContain('<header class="ph"><h1>Agents</h1><div class="aside"><div class="fbar">');
});

const entries = (small: string, medium: string) => ({
  small: { enabled: true, model: small },
  medium: { enabled: false, model: medium },
  large: { enabled: true, model: "opus" },
  review: { enabled: true, model: "opus" },
  intake: { enabled: true, model: "opus" },
  director: { enabled: true, model: "opus" },
  monitor: { enabled: true, model: "deepseek-v4.1-flash" },
  title: { enabled: true, model: "haiku" },
  judge: { enabled: true, model: "haiku" },
});

test("the Roles table is read-only; the Models settings list holds a select per size and role model, a checkbox on Small and Medium only, one Success column", () => {
  const html = renderFactoryAgents(S, E, "live", "week", { models: entries("haiku", "gpt-oss-20b"), local: "up", offers: OFFERS, down: [] });
  const [roles, models] = html.split('id="models"');
  expect(roles).not.toMatch(/<td[^>]*>[^<]*<(select|input|button)/);
  expect(models).toContain(">Models</h2>");
  const row = (name: string) => models.match(new RegExp(`<label class="sl" for="model-[^"]+">${name}</label>.*?</div>`))![0];
  const opts = (r: string) => [...r.matchAll(/<option value="([^"]+)"/g)].map((x) => x[1]);
  expect(opts(row("Small").match(/<select.*?<\/select>/s)![0])).toEqual(OFFERS.small);
  expect(opts(row("Medium").match(/<select.*?<\/select>/s)![0])).toEqual(OFFERS.medium);
  expect(opts(row("Large").match(/<select.*?<\/select>/s)![0])).toEqual(OFFERS.large);
  expect(OFFERS.small).toContain("deepseek-v4.1-flash");
  expect(row("Small")).toContain('type="checkbox" data-name="small" aria-label="Small enabled" checked');
  expect(row("Medium")).toContain('type="checkbox" data-name="medium" aria-label="Medium enabled">');
  expect(row("Medium")).toContain('<option value="gpt-oss-20b" selected>');
  expect(roles).not.toContain(">Merge<");
  for (const n of ["Large", "Reviewer", "Intake", "Director", "Monitor", "Title", "Judge"]) { expect(row(n)).toContain("<select"); expect(row(n)).not.toContain("checkbox"); }
  expect(models).not.toContain("tier");
  expect(html).not.toContain(">Succeeded<");
  expect(html).not.toContain(">Failed<");
});

test("the Backends tile says the local server is up or down and the Roles table disables gpt-oss-20b to match", () => {
  const down = renderFactoryAgents(S, D, "live", "week", { models: entries("haiku", "sonnet"), local: "down", offers: OFFERS, down: ["gpt-oss-20b"] });
  expect(down).toContain("Local server: down");
  expect(down.match(/<option value="gpt-oss-20b" disabled>/g)!.length).toBe(9);
  const up = renderFactoryAgents(S, D, "live", "week", { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(up).toContain("Local server: up");
  expect(up).not.toContain("disabled");
  expect(renderFactoryAgents(S, null, "live", "week", { models: entries("haiku", "sonnet"), local: "down", offers: OFFERS, down: ["gpt-oss-20b"] })).toContain("Local server: down");
});

test("the Backends tile counts the backends up out of 2", () => {
  const m = (down: string[], local = "up") => ({ models: entries("haiku", "sonnet"), local, offers: OFFERS, down });
  const up = renderFactoryAgents(S, D, "live", "week", m(["gpt-oss-20b"]));
  expect(up).toContain("<b>2<em> / 2</em></b>");
  expect(up).toContain('<span class="q"><span>up</span><span class="m"> / backends</span></span>');
  expect(renderFactoryAgents(S, D, "live", "week", m(["deepseek-v4.1-flash"]))).toContain("<b>1<em> / 2</em></b>");
  expect(renderFactoryAgents(S, D, "live", "week", m(["deepseek-v4.1-flash"], "down"))).toContain("<b>0<em> / 2</em></b>");
});

test("the Backends tile says OpenRouter is down when the flash model is down, and the Roles card has no status line", () => {
  const m = (down: string[]) => ({ models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down });
  expect(renderFactoryAgents(S, D, "live", "week", m([]))).toContain("OpenRouter: up");
  expect(renderFactoryAgents(S, D, "live", "week", m(["deepseek-v4.1-flash"]))).toContain("OpenRouter: down");
  expect(renderFactoryAgents(S, D, "live", "week", m([]))).not.toContain('<p class="quiet">Local server');
});

test("an outcome joins the row of its role and model; roles with no model setting stay their own row", () => {
  const o = (role: string, model: string, rate: number) => ({ role, model, runs: 20, succeeded: rate * 20, failed: 20 - rate * 20, stuck: 0, ended: 20, rate, p50: 60, cost: 1.5, baseline: 0.7 });
  const row = (h: string, name: string) => h.match(new RegExp(`<tr><td class="wide" title="${name}">${name}</td>.*?</tr>`))![0];
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [o("intake", "opus", 0.95), o("triage", "opus", 0.9)] } }, "live", "week", { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(row(h, "Intake")).toMatch(/<td>opus<\/td><td class="num">20<\/td><td class="num">95%/);
  expect(h.match(/<td class="wide" title="Intake">Intake<\/td>/g)!.length).toBe(1);
  expect(row(h, "Triage")).toContain("90%");
  expect(h.match(/<td class="wide" title="Worker">Worker<\/td><td>(haiku|sonnet|opus)</g)!.length).toBe(3);
});

const full = (role: string, model: string, extra: any = {}) => ({ role, model, runs: 30, succeeded: 24, failed: 6, stuck: 0, ended: 30, rate: 0.8, p50: 60, p95: 300, cost: 1.5, baseline: 0.7, ...extra });
const M = { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] };
const page = (outcomes: any[], extra: any = {}) => renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes, ...extra } }, "live", "week", M);
/** The row of a role and its model. */
const rowOf = (h: string, name: string, model: string) => h.match(new RegExp(`<tr><td class="wide" title="${name}">${name}</td><td>${model}</td>.*?</tr>`))![0];

test("the Worker rows are one per size model and one per other worker model, each with its own runs and p50", () => {
  const h = page([full("worker", "haiku", { runs: 11, p50: 61 }), full("worker", "sonnet", { runs: 12, p50: 125 }), full("worker", "opus", { runs: 13, p50: 3700 }), full("worker", "gpt-oss-20b", { runs: 14, p50: 9 })]);
  expect(h.match(/<td class="wide" title="Worker">Worker<\/td>/g)!.length).toBe(4);
  expect(rowOf(h, "Worker", "haiku")).toContain('<td class="num">11</td>');
  expect(rowOf(h, "Worker", "haiku")).toContain(`<td class="num">${dur(61)}</td>`);
  expect(rowOf(h, "Worker", "sonnet")).toContain('<td class="num">12</td>');
  expect(rowOf(h, "Worker", "sonnet")).toContain(`<td class="num">${dur(125)}</td>`);
  expect(rowOf(h, "Worker", "opus")).toContain('<td class="num">13</td>');
  expect(rowOf(h, "Worker", "opus")).toContain(`<td class="num">${dur(3700)}</td>`);
  expect(rowOf(h, "Worker", "gpt-oss-20b")).toContain('<td class="num">14</td>');
  expect(rowOf(h, "Worker", "gpt-oss-20b")).toContain(`<td class="num">${dur(9)}</td>`);
});

test("the Reviewer shows every outcome model, and its rate is a Pass share with no trend tone", () => {
  const h = page([full("reviewer", "opus", { runs: 21, pass: 24, fail: 6 }), full("reviewer", "unset", { runs: 22, pass: 24, fail: 6 })]);
  expect(rowOf(h, "Reviewer", "opus")).toContain('<td class="num">21</td>');
  expect(rowOf(h, "Reviewer", "unset")).toContain('<td class="num">22</td>');
  for (const m of ["opus", "unset"]) {
    const r = rowOf(h, "Reviewer", m);
    expect(r).toContain("Pass share");
    expect(r).toMatch(/class="tr"/);
    expect(r).not.toMatch(/class="tr (good|warn)"|class="num warn"/);
  }
  expect(rowOf(h, "Worker", "haiku")).not.toContain("Pass share");
});

test("a row under 20 ended runs shows its counts and no percent; 20 or more shows the rate with its ended count", () => {
  const h = page([full("worker", "haiku", { ended: 7, succeeded: 5, failed: 2, rate: 5 / 7 }), full("worker", "sonnet", { ended: 24, succeeded: 20, failed: 4, rate: 20 / 24 })]);
  expect(rowOf(h, "Worker", "haiku")).toContain("5 / 7");
  expect(rowOf(h, "Worker", "haiku")).not.toMatch(/%|class="tr/);
  expect(rowOf(h, "Worker", "sonnet")).toMatch(/83%.*?>24</);
  expect(rowOf(h, "Worker", "sonnet")).toContain('class="tr');
});

test("the Roles table heads p95, draws Housekeeper and Maintainer rows, and a worker row shows built, cost per built, first pass and review pass", () => {
  const roles = [...agents.roles, { key: "housekeeper", name: "Housekeeper", runs: 1, hours: 1, p50: 1, p95: 1, models: [], live: 0 }, { key: "maintainer", name: "Maintainer", runs: 1, hours: 1, p50: 1, p95: 1, models: [], live: 0 }];
  const h = page([full("worker", "haiku", { built: 165, perBuilt: 0.91, firstPass: 110, reviewPass: 0.875 }), full("housekeeper", "opus", { runs: 31 }), full("maintainer", "opus", { runs: 32 })], { roles });
  expect(th(h).map(([t]) => t)).toContain("p95");
  expect(rowOf(h, "Housekeeper", "opus")).toContain('<td class="num">31</td>');
  expect(rowOf(h, "Maintainer", "opus")).toContain('<td class="num">32</td>');
  const w = rowOf(h, "Worker", "haiku");
  expect(w).toContain(`<td class="num">${dur(300)}</td>`);
  expect(w).toContain("$0.91");
  expect(w).toContain('<td class="num">165</td>');
  expect(w).toContain("66.7%");
  expect(w).toContain("87.5%");
});

test("the page shows the first-pass rate to one decimal", () => {
  expect(page([], { rates: { success: 0.8, baseline: 0.7, firstPass: 0.664, local: 0 } })).toContain("66.4%");
  expect(page([])).not.toMatch(/First pass \d/);
});

const th = (h: string) => [...h.matchAll(/<th( class="num")?>([^<]+)</g)].map((m) => [m[2], !!m[1]]);
const one = { role: "worker", model: "haiku", runs: 1234, succeeded: 1, failed: 0, stuck: 0, ended: 1, rate: 1, p50: 60, cost: 1.5, baseline: 0.7 };

test("the Roles headers are in Title Case, and every number header has num", () => {
  const heads = th(renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [one] } }));
  expect(heads.filter(([, n]) => n).map(([h]) => h)).toEqual(["Jobs", "Success", "p50", "p95", "Cost", "Built", "First pass", "Review pass"]);
});

test("the Roles table heads its job count Jobs, and no head keeps the old words", () => {
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [one] } });
  const names = th(h).map(([t]) => String(t));
  expect(names).toContain("Jobs");
  expect(names.filter((t) => /runs|goal|part/i.test(t))).toEqual([]);
  expect(h).toContain(">Failed jobs</a>");
});

test("the Failed jobs link has no underline until hover or focus", () => {
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [one] } });
  expect(h).toContain('<a class="failed-jobs" href="#/factory/jobs?role=worker&state=failed">Failed jobs</a>');
  const css = readFileSync(new URL("./app.css", import.meta.url), "utf8");
  expect(css).toMatch(/^a\.failed-jobs \{[^}]*text-decoration: none;/m);
  expect(css).toMatch(/^a\.failed-jobs:hover, a\.failed-jobs:focus-visible \{[^}]*text-decoration: underline;/m);
});

test("a Roles count goes through count()", () => {
  expect(renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [one] } })).toContain('<td class="num">1,234</td>');
});

test("a Roles row with no outcome shows a dash in every cell, with num on the number cells", () => {
  const html = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [] } }, "live", "week", { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(row(html, "Director")).toMatch(new RegExp(`<td>opus</td>${'<td class="num"><span title="no runs in this window">–</span></td>'.repeat(8)}<td><span title="no runs in this window">–</span></td>`));
});

test("an empty Roles table shows the empty line", () => {
  const html = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [] } });
  expect(html).toContain('<div class="empty"><p>No data</p></div>');
  expect(html).not.toContain("<table");
});

test("a failed load shows the error state", () => {
  expect(renderFactoryAgents(S, { error: "no data" })).toContain('<div class="error" role="alert"><p>no data</p>');
});

test("Worker slots shows a dash for a missing cap, and the Usage card is the Status one", () => {
  const html = renderFactoryAgents({ ...S, factory: { ...S.factory, liveCap: undefined } }, { ...D, agents }, "live", "week", { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(html).toContain("<b>1<em> / –</em></b>");
  expect(html).not.toContain("undefined");
  expect(html).toContain(usageCard(S));
});

test("a failed model change shows the reason beside the control", async () => {
  const was = { fetch: globalThis.fetch, location: (globalThis as any).location, document: (globalThis as any).document };
  (globalThis as any).location = { hash: "" };
  (globalThis as any).document = { createElement: () => ({ setAttribute() {} }) };
  globalThis.fetch = ((_url: string, init?: any) =>
    Promise.resolve(init?.method === "POST" ? Response.json({ error: "the backend of x is down" }, { status: 422 }) : { ok: false, status: 500, json: async () => ({}) })) as any;
  const root: any = { innerHTML: "", querySelector: () => null };
  const select: any = { after() {}, dataset: { name: "small" }, type: "select-one", value: "x", parentElement: { querySelector: () => null } };
  select.closest = () => select;
  try {
    await view.mount(root, S);
    const msg: any = {};
    (globalThis as any).document.createElement = () => Object.assign(msg, { setAttribute() {} });
    await root.onchange({ target: select, type: "change" });
    expect(msg.className).toBe("act-msg");
    expect(msg.textContent).toContain("the backend of x is down");
  } finally {
    globalThis.fetch = was.fetch;
    (globalThis as any).location = was.location;
    (globalThis as any).document = was.document;
  }
});
