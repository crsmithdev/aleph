import { expect, test } from "bun:test";
import { OFFERS } from "../jobs/lib/routing/models.ts";
// @ts-ignore plain JS shared with the page
import { costFrame, liveFrame, outcomesFrame, renderFactoryAgents, view } from "./views/factory-agents.js";
// @ts-ignore plain JS shared with the page
import { label, option } from "./chart.js";
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
  const o = (role: string, model: string, rate: number, extra = {}) => ({ role, model, runs: 10, succeeded: rate * 10, failed: 10 - rate * 10, stuck: 0, rate, p50: 60, cost: 1.5, baseline: 0.7, ...extra });
  const html = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [o("worker", "haiku", 0.6, { firstPass: 4, reviewPass: 0.5 }), o("worker", "gpt-oss-20b", 0.8, { firstPass: 6, reviewPass: 1 }), o("reviewer", "unset", 0.9, { pass: 9, fail: 1 })] } });
  const row = (name: string) => html.match(new RegExp(`<tr><td>${name.split(" · ")[0]}</td><td>${name.split(" · ")[1]}</td>.*?</tr>`))![0];
  expect(row("Worker · haiku")).toMatch(/<td class="num warn">60%.*?class="tr[^"]*"/);
  expect(row("Worker · haiku")).toContain('href="#/factory/jobs?role=worker&condition=failed"');
  expect(row("Worker · gpt-oss-20b")).toMatch(/<td class="num">80%.*?class="tr[^"]*"/);
  expect(row("Worker · gpt-oss-20b")).not.toContain("warn");
  expect(row("Worker · gpt-oss-20b")).toContain('<td class="num">10</td><td class="num">80%');
  expect(row("Reviewer · not recorded")).toContain('<td class="num">10</td><td class="num">90%');
});

const row = (h: string, name: string) => h.match(new RegExp(`<tr><td>${name}</td>.*?</tr>`))![0];

test("an outcome on a full model id joins the row of its short model; an unset model reads not recorded", () => {
  const o = (role: string, model: string, runs: number) => ({ role, model, runs, succeeded: runs, failed: 0, stuck: 0, rate: 1, p50: 60, cost: 1.5, baseline: 0.7 });
  const outcomes = [o("intake", "claude-opus-5-5", 151), o("worker", "claude-haiku-4-5-20251001", 7), o("reviewer", "unset", 3)];
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes } }, "live", "week", { tiers: tiers("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(row(h, "Intake")).toMatch(/<select.*<td class="num">151<\/td>/);
  expect(h.match(/<td>Intake<\/td>/g)!.length).toBe(1);
  expect(row(h, "Worker")).toMatch(/<select/);
  expect(h).not.toMatch(/<td>claude-/);
  expect(row(h, "Reviewer")).toContain("<select");
  expect(h.match(/<td>Reviewer<\/td>/g)!.length).toBe(1);
  expect(h).not.toMatch(/<td>unset<\/td>/);
});

test("the tiles are usage, OpenRouter spend for the window's UTC period, worker slots and the backend lights", () => {
  const keys = (h: string) => [...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1]);
  const m = { tiers: tiers("haiku", "sonnet"), local: "up", offers: OFFERS, down: ["deepseek-v4.1-flash"], spend: { day: 1.5, week: 17.54, month: 18 } };
  const h = renderFactoryAgents(S, D, "live", "week", m);
  expect(keys(h)).toEqual(["Usage", "Spend", "Worker slots", "Backends"]);
  for (const t of ["<b>1<em> / 5</em></b>", "<b>$17.54</b>", "OpenRouter, this week (UTC)", '<span class="event-dot fine"></span>Local server: up', '<span class="event-dot alert"></span>OpenRouter: down']) expect(h).toContain(t);
  expect(renderFactoryAgents(S, { ...D, window: "hour" }, "live", "hour", m)).toContain("<b>$1.50</b>");
  const none = renderFactoryAgents(S, D);
  expect(none).toContain("OpenRouter spend unknown");
  expect(none).toContain("Local server: –");
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

test("the page has three chart panels in one row, each with role img and an aria-label from its frame", () => {
  const html = renderFactoryAgents(S, E);
  const row = html.slice(html.indexOf('<div class="trio">'), html.indexOf('id="roles"'));
  expect([...row.matchAll(/<aleph-chart key="factory\/agents\/(\w+)">/g)].map((m) => m[1])).toEqual(["live", "outcomes", "cost"]);
  const labels = [...row.matchAll(/<div class="chartbox" role="img" aria-label="([^"]+)"><\/div>/g)].map((m) => m[1]);
  expect(labels).toEqual(["Agents Live by Role: Worker peak 1, Triage peak 0.5", "Outcomes by Role: Succeeded 15, Failed 2, Stuck 1", "Cost by Model: opus $3.50, sonnet $0.25"]);
  for (const t of ["Agents Live by Role", "Outcomes by Role", "Cost by Model"]) expect(row).toContain(`<h2>${t}</h2>`);
});

test("a chart with no outcomes or cost shows the empty line under its title", () => {
  const html = renderFactoryAgents(S, { ...E, buckets: [{ at: buckets[0].at, cost: {} }], agents: { ...agents, outcomes: [] } });
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

test("the outcomes frame sums succeeded, failed and stuck per role, as horizontal stacked bars", () => {
  const o = option(outcomesFrame(E), "stacked", T);
  expect(o.yAxis.type).toBe("category");
  expect(o.yAxis.data).toEqual(["Worker", "Triage"]);
  expect(o.series.map((s: any) => [s.name, s.stack, s.color, s.data])).toEqual([["Succeeded", "all", "#d", [10, 5]], ["Failed", "all", "#n", [2, 0]], ["Stuck", "all", "#s", [1, 0]]]);
});

test("the cost frame has one key per model with the bucket costs, and its axis goes through money()", () => {
  const o = option(costFrame(E), "columns", T);
  expect(o.series.map((s: any) => [s.name, s.type, s.stack, s.data])).toEqual([["opus", "bar", "all", [1.5, 2]], ["sonnet", "bar", "all", [0.25, 0]]]);
  expect(o.yAxis.axisLabel.formatter(1.5)).toBe("$1.50");
  expect(label(costFrame(E))).toBe("Cost by Model: opus $3.50, sonnet $0.25");
});

test("the title is the sidebar name, whatever the data", () => {
  expect(renderFactoryAgents(S, D)).toContain('<header class="ph"><h1>Agents</h1><span class="count">last 7 days</span><div class="aside"><div class="fbar">');
  expect(renderFactoryAgents({ ...S, usage: undefined }, null)).toContain('<header class="ph"><h1>Agents</h1><span class="count">last 7 days</span><div class="aside"><div class="fbar">');
});

const tiers = (low: string, medium: string) => ({
  "worker-low": { enabled: true, model: low },
  "worker-medium": { enabled: false, model: medium },
  merge: { enabled: true, model: "haiku" },
  reviewer: { enabled: true, model: "opus" },
  intake: { enabled: true, model: "opus" },
  director: { enabled: true, model: "opus" },
  monitor: { enabled: true, model: "deepseek-v4.1-flash" },
  title: { enabled: true, model: "haiku" },
  judge: { enabled: true, model: "haiku" },
});

test("the Roles table carries the model choice: no Models card, a select per tier, fixed text for the rest, one Success column", () => {
  const html = renderFactoryAgents(S, E, "live", "week", { tiers: tiers("haiku", "gpt-oss-20b"), local: "up", offers: OFFERS, down: [] });
  expect(html).not.toContain(">Models<");
  const row = (name: string) => html.match(new RegExp(`<tr><td>${name}</td>.*?</tr>`))![0];
  const opts = (r: string) => [...r.matchAll(/<option value="([^"]+)"/g)].map((x) => x[1]);
  const w = row("Worker");
  const lowSelect = w.match(/<select data-tier="worker-low".*?<\/select>/s)![0];
  const medSelect = w.match(/<select data-tier="worker-medium".*?<\/select>/s)![0];
  expect(opts(lowSelect)).toEqual(OFFERS["worker-low"]);
  expect(opts(medSelect)).toEqual(OFFERS["worker-medium"]);
  expect(OFFERS["worker-low"]).toContain("deepseek-v4.1-flash");
  expect(w).toContain('type="checkbox" data-tier="worker-low" aria-label="Worker low enabled" checked');
  expect(w).toContain('type="checkbox" data-tier="worker-medium" aria-label="Worker medium enabled">');
  expect(w).toContain('<option value="gpt-oss-20b" selected>');
  for (const n of ["Merge", "Reviewer", "Intake", "Director", "Monitor", "Title", "Judge"]) { expect(row(n)).toContain("<select"); expect(row(n)).not.toContain("checkbox"); }
  expect(html).not.toContain(">Succeeded<");
  expect(html).not.toContain(">Failed<");
});

test("the Backends tile says the local server is up or down and the Roles table disables gpt-oss-20b to match", () => {
  const down = renderFactoryAgents(S, D, "live", "week", { tiers: tiers("haiku", "sonnet"), local: "down", offers: OFFERS, down: ["gpt-oss-20b"] });
  expect(down).toContain("Local server: down");
  expect(down.match(/<option value="gpt-oss-20b" disabled>/g)!.length).toBe(9);
  const up = renderFactoryAgents(S, D, "live", "week", { tiers: tiers("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(up).toContain("Local server: up");
  expect(up).not.toContain("disabled");
  expect(renderFactoryAgents(S, null, "live", "week", { tiers: tiers("haiku", "sonnet"), local: "down", offers: OFFERS, down: ["gpt-oss-20b"] })).toContain("Local server: down");
});

test("the Backends tile says OpenRouter is down when the flash model is down, and the Roles card has no status line", () => {
  const m = (down: string[]) => ({ tiers: tiers("haiku", "sonnet"), local: "up", offers: OFFERS, down });
  expect(renderFactoryAgents(S, D, "live", "week", m([]))).toContain("OpenRouter: up");
  expect(renderFactoryAgents(S, D, "live", "week", m(["deepseek-v4.1-flash"]))).toContain("OpenRouter: down");
  expect(renderFactoryAgents(S, D, "live", "week", m([]))).not.toContain('<p class="quiet">Local server');
});

test("an outcome joins the tier row of its role and model; non-tier roles stay their own row", () => {
  const o = (role: string, model: string, rate: number) => ({ role, model, runs: 10, succeeded: rate * 10, failed: 10 - rate * 10, stuck: 0, rate, p50: 60, cost: 1.5, baseline: 0.7 });
  const row = (h: string, name: string) => h.match(new RegExp(`<tr><td>${name}</td>.*?</tr>`))![0];
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [o("intake", "opus", 0.95), o("triage", "opus", 0.9)] } }, "live", "week", { tiers: tiers("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(row(h, "Intake")).toMatch(/<select.*<td class="num">10<\/td><td class="num">95%/);
  expect(h.match(/<td>Intake<\/td>/g)!.length).toBe(1);
  expect(row(h, "Triage")).toContain("90%");
  expect(row(h, "Worker")).toMatch(/<select/);
});

test("the Worker row adds up the worker outcomes and the Reviewer row has its own counts", () => {
  const o = (role: string, model: string, extra: any) => ({ role, model, runs: 10, succeeded: 8, failed: 2, stuck: 0, rate: 0.8, p50: 60, cost: 1.5, baseline: 0.7, ...extra });
  const outcomes = [
    o("worker", "haiku", { runs: 100, succeeded: 80, failed: 20, cost: 20, firstPass: 30, built: 60, reviewPass: 0.5 }),
    o("worker", "gpt-oss-20b", { runs: 50, succeeded: 40, failed: 10, cost: 10, firstPass: 10, built: 30, reviewPass: 1 }),
    o("reviewer", "unset", { runs: 90, succeeded: 60, failed: 30, rate: 0.6667, pass: 60, fail: 30 }),
  ];
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes } }, "live", "week", { tiers: tiers("haiku", "gpt-oss-20b"), local: "up", offers: OFFERS, down: [] });
  const w = row(h, "Worker");
  expect(w).toContain('<td class="num">150</td><td class="num">80% </td>');
  expect(w).toContain('<td class="num">$30.00</td><td><a');
  expect(w).toContain('href="#/factory/jobs?role=worker&condition=failed"');
  expect(row(h, "Reviewer")).toContain('<td class="num">90</td><td class="num warn">67% ');
});

const th = (h: string) => [...h.matchAll(/<th( class="num")?>([^<]+)</g)].map((m) => [m[2], !!m[1]]);
const one = { role: "worker", model: "haiku", runs: 1234, succeeded: 1, failed: 0, stuck: 0, rate: 1, p50: 60, cost: 1.5, baseline: 0.7 };

test("the Roles headers are in Title Case, and every number header has num", () => {
  const heads = th(renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [one] } }));
  expect(heads.filter(([, n]) => n).map(([h]) => h)).toEqual(["Jobs", "Success", "p50", "Cost"]);
});

test("the Roles table heads its job count Jobs, and no head keeps the old words", () => {
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [one] } });
  const names = th(h).map(([t]) => String(t));
  expect(names).toContain("Jobs");
  expect(names.filter((t) => /runs|goal|part/i.test(t))).toEqual([]);
  expect(h).toContain(">Failed jobs</a>");
});

test("a Roles count goes through count()", () => {
  expect(renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [one] } })).toContain('<td class="num">1,234</td>');
});

test("a Roles row with no outcome shows a dash in every cell, with num on the number cells", () => {
  const html = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [] } }, "live", "week", { tiers: tiers("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(row(html, "Director")).toMatch(new RegExp(`<select.*>${'<td class="num">–</td>'.repeat(4)}<td>–</td>`));
});

test("an empty Roles table shows the empty line", () => {
  const html = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [] } });
  expect(html).toContain('<div class="empty"><p>No agent ran in this window.</p></div>');
  expect(html).not.toContain("<table");
});

test("a failed load shows the error state", () => {
  expect(renderFactoryAgents(S, { error: "no data" })).toContain('<div class="error" role="alert"><p>no data</p>');
});

test("Worker slots shows a dash for a missing cap, and the Usage card is the Status one", () => {
  const html = renderFactoryAgents({ ...S, factory: { ...S.factory, liveCap: undefined } }, { ...D, agents }, "live", "week", { tiers: tiers("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(html).toContain("<b>1<em> / –</em></b>");
  expect(html).not.toContain("undefined");
  expect(html).toContain(usageCard(S));
});

test("the Agents view does not redraw over another page after the /api/models fetch", async () => {
  const was = { fetch: globalThis.fetch, location: (globalThis as any).location };
  let answer = (_v: any) => {};
  (globalThis as any).location = { hash: "" };
  globalThis.fetch = ((url: string) =>
    url === "/api/models" ? new Promise((ok) => { answer = ok; }) : Promise.resolve({ ok: false, status: 500 })) as any;
  const root: any = { innerHTML: "", querySelector: (sel: string) => (sel === "#capacity" && root.innerHTML.includes('id="capacity"') ? {} : null) };
  try {
    const done = view.mount(root, S);
    expect(root.innerHTML).toContain('id="capacity"');
    root.innerHTML = '<div class="page" id="jobs">Jobs</div>';
    answer({ json: async () => ({ down: [] }) });
    await done;
    expect(root.innerHTML).toBe('<div class="page" id="jobs">Jobs</div>');
  } finally {
    globalThis.fetch = was.fetch;
    (globalThis as any).location = was.location;
  }
});

test("a failed model change shows the reason beside the control", async () => {
  const was = { fetch: globalThis.fetch, location: (globalThis as any).location, document: (globalThis as any).document };
  (globalThis as any).location = { hash: "" };
  (globalThis as any).document = { createElement: () => ({ setAttribute() {} }) };
  globalThis.fetch = ((_url: string, init?: any) =>
    Promise.resolve(init?.method === "POST" ? Response.json({ error: "the backend of x is down" }, { status: 422 }) : { ok: false, status: 500, json: async () => ({}) })) as any;
  const root: any = { innerHTML: "", querySelector: () => null };
  const select: any = { after() {}, dataset: { tier: "worker" }, type: "select-one", value: "x", parentElement: { querySelector: () => null } };
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
