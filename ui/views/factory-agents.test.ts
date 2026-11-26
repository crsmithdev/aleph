import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OFFERS } from "../../jobs/lib/routing/models.ts";
import { MODELS } from "../../lib/models.ts";
// @ts-ignore plain JS shared with the page
import { MODEL_ORDER, costFrame, liveFrame, renderFactoryAgents, tokensFrame, view } from "./factory-agents.js";
// @ts-ignore plain JS shared with the page
import { label, option } from "./lib/chart.js";
// @ts-ignore plain JS shared with the page
import { shortModel } from "./lib/format.js";
// @ts-ignore plain JS shared with the page
import { weekGone } from "./lib/flow-parts.js";

const S: any = { now: "2026-11-01T08:00:00Z", usage: { now: { seven_day: 7, seven_day_resets_at: "2026-11-07T08:00:00Z" } }, factory: { runsToday: 198, costToday: 71.94, liveRuns: 1, liveCap: 5, liveLocal: 1, localCap: 1 } };
const agents = {
  live: 1, workers: 1, cap: 5, mean: 1.5, peak: 4,
  roles: [
    { key: "worker", name: "Worker", runs: 10, hours: 9, p50: 400, models: ["sonnet"], live: 1 },
    { key: "triage", name: "Triage", runs: 5, hours: 1, p50: 38, models: ["opus"], live: 0 },
    { key: "reviewer", name: "Reviewer", runs: 3, hours: null, p50: null, models: [], live: null },
  ],
  points: [{ at: new Date(2026, 9, 27).toISOString(), worker: 1, triage: 0.5 }, { at: new Date(2026, 9, 28).toISOString() }],
  rates: { success: 0.8, baseline: 0.7, firstPass: 0.6, local: 0 },
};
const D = { window: "week", agents };
const usage = new URLSearchParams("view=usage");

test("the share of the week gone comes from seven_day_resets_at", () => {
  expect(weekGone("2026-11-07T08:00:00Z", "2026-11-01T08:00:00Z")).toBeCloseTo(14.29, 1);
  expect(weekGone("2026-11-08T08:00:00Z", "2026-11-01T08:00:00Z")).toBe(0);
  expect(weekGone(undefined, S.now)).toBeNull();
});

const T: any = { done: "#d", need: "#n", error: "#s", "series-1": "#1", "series-2": "#2" };
const buckets = [{ at: new Date(2026, 9, 27).toISOString(), cost: { opus: 1.5, sonnet: 0.25 }, tokens: { opus: 1200, sonnet: 300 } }, { at: new Date(2026, 9, 28).toISOString(), cost: { opus: 2 }, tokens: { opus: 800 } }];
const outcomes = [
  { role: "worker", model: "haiku", succeeded: 6, failed: 2, error: 1 },
  { role: "worker", model: "sonnet", succeeded: 4, failed: 0, error: 0 },
  { role: "triage", model: "opus", succeeded: 5, failed: 0, error: 0 },
];
const E: any = { window: "week", buckets, agents: { ...agents, outcomes } };

test("the Usage view opens with a figure band of usage, success, peak live and cost, then the three chart panels in one row", () => {
  const m = { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [], spend: { day: 1.5, week: 17.54, month: 18 } };
  const html = renderFactoryAgents(S, E, usage, m);
  const band = html.slice(html.indexOf('<section class="band"'), html.indexOf('<div class="trio">'));
  expect([...band.matchAll(/<span class="k">([^<]+)</g)].map((x) => x[1])).toEqual(["Usage", "Success", "Peak Live", "Cost"]);
  for (const t of ["<b class=\"num\">7%</b>", "14% of week gone", "80%", "70% baseline", "<b class=\"num\">4</b>", "mean 1.5", "$3.75", "$17.54 OpenRouter"]) expect(band).toContain(t);
  expect(band).toContain('class="cmp good"');
  const row = html.slice(html.indexOf('<div class="trio">'));
  expect([...row.matchAll(/<aleph-chart key="factory\/agents\/(\w+)">/g)].map((x) => x[1])).toEqual(["live", "tokens", "cost"]);
  const labels = [...row.matchAll(/<div class="chartbox" role="img" aria-label="([^"]+)"><\/div>/g)].map((x) => x[1]);
  expect(labels).toEqual(["Agents Live by Role: Worker peak 1, Triage peak 0.5", "Tokens by Model: opus 2,000, sonnet 300", "Cost by Model: opus $3.50, sonnet $0.25"]);
  expect(html).not.toContain("browse");
});

test("the band's usage and success figures turn warn when the week is outrun or the baseline missed", () => {
  const warn = renderFactoryAgents({ ...S, usage: { now: { seven_day: 60, seven_day_resets_at: "2026-11-07T08:00:00Z" } } }, { ...E, agents: { ...agents, rates: { success: 0.5, baseline: 0.7 } } }, usage);
  expect(warn.match(/class="cmp warn"/g)!.length).toBe(2);
  const none = renderFactoryAgents({ ...S, usage: undefined }, { ...E, agents: { ...agents, rates: { success: 0.5, baseline: null } } }, usage);
  expect(none).toContain('<span class="k">Usage</span><b class="num">–</b>');
  expect(none).not.toContain("warn");
});

test("a chart with no tokens or cost shows the empty line under its title", () => {
  const html = renderFactoryAgents(S, { ...E, buckets: [{ at: buckets[0].at, cost: {}, tokens: {} }] }, usage);
  const row = html.slice(html.indexOf('<div class="trio">'));
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

test("a model keeps one colour in every window, and no two keys of a frame share one", () => {
  const frame = (ms: string[]) => costFrame({ window: "week", buckets: [{ at: buckets[0].at, cost: Object.fromEntries(ms.map((m) => [m, 1])) }] });
  const day = frame(["haiku", "sonnet"]), week = frame(["opus", "sonnet", "deepseek-v4.1-flash"]);
  const colour = (f: any, k: string) => f.by.keys.find((x: any) => x.key === k).color;
  expect(colour(day, "sonnet")).toBe(colour(week, "sonnet"));
  for (const f of [day, week]) expect(new Set(f.by.keys.map((k: any) => k.color)).size).toBe(f.by.keys.length);
});

test("model ids with one short name join into one key with their values summed, and the models past the sixth fold into Other", () => {
  const at = buckets[0].at;
  const t = tokensFrame({ window: "week", buckets: [{ at, tokens: { "claude-opus-4-5-20251101": 1000, "claude-opus-4-1": 200 } }, { at, tokens: { "claude-opus-4-1": 50 } }] });
  expect(t.by.keys.map((k: any) => k.key)).toEqual(["opus"]);
  expect(t.rows.map((r: any) => r.opus)).toEqual([1200, 50]);
  const ids = ["haiku", "sonnet", "opus", "gpt-oss-20b", "deepseek-v4.1-flash", "gpt-6-luna", "minimax-m3.1-flash", "step-3.5-flash", "mimo-v2.6-flash", "claude-new-5"];
  const f = costFrame({ window: "week", buckets: [{ at, cost: Object.fromEntries(ids.map((m, i) => [m, i + 1])) }] });
  expect(f.by.keys.map((k: any) => k.name)).toEqual([...ids.slice(0, 6).sort(), "Other"]);
  expect(new Set(f.by.keys.map((k: any) => k.color)).size).toBe(7);
  expect(f.rows[0]).toEqual({ at, ...Object.fromEntries(ids.slice(0, 6).map((m, i) => [m, i + 1])), Other: 7 + 8 + 9 + 10 });
});

test("the live frame folds the roles after the sixth into one Other key holding their sum, with seven different colours", () => {
  const roles = Array.from({ length: 10 }, (_, i) => ({ key: `r${i}`, name: `R${i}`, hours: 1 }));
  const points = [{ at: buckets[0].at, ...Object.fromEntries(roles.map((r, i) => [r.key, i + 1])) }, { at: buckets[1].at, r8: 2, r9: 3 }];
  const f = liveFrame({ window: "week", agents: { ...agents, roles, points } });
  expect(f.by.keys.map((k: any) => k.key)).toEqual(["r0", "r1", "r2", "r3", "r4", "r5", "Other"]);
  expect(new Set(f.by.keys.map((k: any) => k.color)).size).toBe(7);
  expect(f.rows.map((r: any) => r.Other)).toEqual([7 + 8 + 9 + 10, 5]);
});

test("the page has the Roles and Usage views, Roles first, and the title is the sidebar name", () => {
  const h = renderFactoryAgents(S, D);
  expect(h).toContain('<header class="ph"><h1>Agents</h1>');
  expect(h).toContain('data-default="roles"');
  expect(h).toContain('<button type="button" data-view="usage" aria-pressed="false">Usage</button>');
  expect(h).not.toContain('class="trio"');
  expect(renderFactoryAgents({ ...S, usage: undefined }, null, usage)).not.toContain("undefined");
});

const entries = (small: string, medium: string) => ({
  small: { enabled: true, model: small },
  medium: { enabled: false, model: medium },
  large: { enabled: true, model: "opus" },
  review: { enabled: true, model: "opus" },
  intake: { enabled: true, model: "opus" },
  director: { enabled: true, model: "opus" },
  monitor: { enabled: true, model: "deepseek-v4.1-flash" },
  maintainer: { enabled: true, model: "sonnet" },
  housekeeper: { enabled: true, model: "opus" },
  judge: { enabled: true, model: "haiku" },
  investigator: { enabled: true, model: "opus" },
});

const full = (role: string, model: string, extra: any = {}) => ({ role, model, runs: 30, succeeded: 24, failed: 6, error: 0, ended: 30, rate: 0.8, p50: 60, p95: 300, cost: 1.5, baseline: 0.7, ...extra });
const M = { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [], spend: { day: 1.5, week: 17.54, month: 18 } };
const page = (outs: any[], m: any = M, extra: any = {}) => renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: outs, ...extra } }, new URLSearchParams(), m);
/** The page while /api/models loads. */
const loading = (outs: any[]) => renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: outs } }, new URLSearchParams());
/** The list row of a model setting. */
const row = (h: string, key: string) => h.match(new RegExp(`<li class="lrow"[^>]*data-key="${key}".*?</li>`))![0];
/** The cell columns of a row: runs, success, p50, cost, per output. */
const cells = (r: string) => [...r.matchAll(/<span class="c(?: bar)?">(.*?)<\/span>(?=<span class="c|<\/li>)/g)].map((x) => x[1]);

test("the Roles list has three groups of rows, each with a select and a switch on every role", () => {
  const h = page([]);
  expect([...h.matchAll(/<h3 class="sub-head">([^<]+)<\/h3><span class="count">(\d+)</g)].map((x) => [x[1], x[2]])).toEqual([["Workers", "3"], ["Review and Intake", "3"], ["Oversight", "5"]]);
  expect([...h.matchAll(/<li class="lrow"[^>]*data-key="(\w+)"/g)].map((x) => x[1])).toEqual(["small", "medium", "large", "review", "intake", "judge", "director", "monitor", "housekeeper", "maintainer", "investigator"]);
  expect([...h.matchAll(/<span class="h">([^<]+)</g)].map((x) => x[1]).slice(0, 10)).toEqual(["Runs", "Success", "p50", "$", "$ / change", "Runs", "Success", "p50", "$", "$ / output"]);
  // The second offer of each key is configured, so a select that kept its first option fails.
  const models = Object.fromEntries(Object.keys(OFFERS).map((k) => [k, { enabled: true, model: (OFFERS as any)[k][1] }]));
  const all = page([], { ...M, models });
  for (const k of Object.keys(OFFERS)) {
    const r = row(all, k), sel = r.match(/<select.*?<\/select>/s)![0];
    expect([...sel.matchAll(/<option value="([^"]+)"/g)].map((x) => x[1])).toEqual((OFFERS as any)[k]);
    expect(sel).toContain(`data-name="${k}"`);
    expect(sel).toMatch(new RegExp(`<option value="${(OFFERS as any)[k][1]}"[^>]* selected>`));
    expect(r).toContain(`<input type="checkbox" data-name="${k}" aria-label=`);
  }
});

test("every switch is live", () => {
  const h = page([], { ...M, models: Object.fromEntries(Object.entries(M.models).map(([k, v]) => [k, { ...v, enabled: true }])) });
  for (const k of ["small", "medium", "large", "review", "intake", "judge", "director", "monitor", "housekeeper", "maintainer", "investigator"]) expect(row(h, k)).toMatch(new RegExp(`data-name="${k}" aria-label="[\\w ]+ on" checked>`));
  expect(h.match(/type="checkbox"/g)!.length).toBe(11);
});

test("an off role shows Off with what waits, no select and no figures", () => {
  const models = Object.fromEntries(Object.entries(M.models).map(([k, v]) => [k, { ...v, enabled: k !== "director" }]));
  const h = page([full("director", "opus", { runs: 9 })], { ...M, models });
  expect(row(h, "director")).toContain('<input type="checkbox" data-name="director" aria-label="Director on"><span class="quiet" title="Asks wait for you">Off</span>');
  expect(row(h, "director")).not.toContain("<select");
  expect(cells(row(h, "director"))).toEqual(["", "", "", "", ""]);
  expect(row(h, "intake")).toContain("<select");
});

test("the inspector has no link back to its own page", () => {
  expect(page([full("worker", "haiku", { size: "small" })].slice(0, 1)).match(/<template data-inspect="small">.*?<\/template>/s)![0]).not.toContain("Open page");
});

test("a row shows runs, success against its baseline, p50, cost and cost per output, with the per-output unit by role", () => {
  const h = page([full("worker", "haiku", { size: "small", rate: 0.6, cost: 12, built: 4, firstPass: 3 }), full("reviewer", "opus", { cost: 12, pass: 5, fail: 1 }), full("intake", "opus", { cost: 12, succeeded: 24 })]);
  expect(cells(row(h, "small"))).toEqual(["30", expect.stringContaining('<span class="ratebar">'), "1m 00s", "$12.00", "$3.00"]);
  expect(cells(row(h, "review"))[4]).toBe("$2.00");
  expect(cells(row(h, "intake"))[4]).toBe("$0.50");
  expect(cells(row(h, "small"))[1]).toContain("baseline 70%");
  expect(cells(row(h, "small"))[1]).toContain('class="below"');
  expect(cells(row(h, "intake"))[1]).not.toContain("below");
});

test("a row under 20 ended runs shows its counts and no bar; a role with no runs shows blank cells", () => {
  const h = page([full("worker", "haiku", { size: "small", ended: 7, succeeded: 5, failed: 2, rate: 5 / 7 }), full("worker", "opus", { size: "large", ended: 24, succeeded: 20, rate: 20 / 24 })]);
  expect(cells(row(h, "small"))[1]).toBe("5/7");
  expect(cells(row(h, "large"))[1]).toContain("83%");
  expect(cells(row(h, "director"))).toEqual(["", "", "", "", ""]);
});

test("builds with no size get an Unsized row in Workers, only when there are some", () => {
  const h = page([full("worker", "haiku", { size: "small", runs: 5 }), full("worker", "sonnet", { size: null, runs: 7 })]);
  expect(cells(row(h, "unsized"))[0]).toBe("7");
  expect(cells(row(h, "small"))[0]).toBe("5");
  expect(h).toContain("Unsized");
  expect(page([full("worker", "haiku", { size: "small", runs: 5 })])).not.toContain('data-key="unsized"');
});

test("a count goes through count()", () => {
  expect(cells(row(page([full("worker", "haiku", { size: "small", runs: 1234 })]), "small"))[0]).toBe("1,234");
});

test("an outcome on a full model id joins the row of its short model, and each earlier model is a row under it", () => {
  const o = (role: string, model: string, runs: number, extra: any = {}) => ({ ...full(role, model), runs, ...extra });
  const outs = [o("intake", "claude-opus-5-5", 151), o("worker", "gpt-oss-20b", 14, { size: "small", from: "2026-10-20T08:00:00Z", to: "2026-10-23T08:00:00Z" }), o("worker", "haiku", 11, { size: "small" }), o("reviewer", "unset", 3)];
  const h = page(outs);
  expect(cells(row(h, "intake"))[0]).toBe("151");
  expect(cells(row(h, "small"))[0]).toBe("11");
  expect(h.match(/data-key="intake"/g)!.length).toBe(1);
  expect([...h.matchAll(/<li class="lrow"[^>]*data-key="([\w:.-]+)"/g)].map((x) => x[1]).slice(0, 2)).toEqual(["small", "small:gpt-oss-20b"]);
  expect(cells(row(h, "small:gpt-oss-20b"))[0]).toBe("14");
  expect(h.match(/<template data-inspect="small">.*?<\/template>/s)![0]).toContain("Small · haiku");
  expect(h.match(/<template data-inspect="small:gpt-oss-20b">.*?<\/template>/s)![0]).toContain("<dt>Until</dt><dd>Oct 23</dd>");
  expect(h).not.toContain("not recorded");
});

test("the inspector of a role lists its figures and a worker's first pass", () => {
  const t = page([full("worker", "haiku", { size: "small", built: 4, firstPass: 3, reviewPass: 0.5 })]).match(/<template data-inspect="small">.*?<\/template>/s)![0];
  for (const x of ["<dt>Runs</dt><dd>30</dd>", "<dt>Failed</dt><dd>6</dd>", "<dt>First Pass</dt><dd>75%</dd>", "<dt>Review Pass</dt><dd>50%</dd>", "<dt>p95</dt><dd>5m 00s</dd>", "<dt>Output</dt><dd>4 landed</dd>"]) expect(t).toContain(x);
  expect(t).not.toContain("<dt>Error</dt>");
});

test("an off size says where its work goes and shows no select or figures, and the last size on keeps a live checked box", () => {
  const set = (on: string[]) => ({ ...M, models: Object.fromEntries(Object.entries(entries("haiku", "sonnet")).map(([k, v]) => [k, { ...v, enabled: !["small", "medium", "large"].includes(k) || on.includes(k) }])) });
  const h = page([full("worker", "opus", { size: "large", runs: 19 })], set(["small", "medium"]));
  expect(row(h, "large")).toContain('<input type="checkbox" data-name="large" aria-label="Large on"><span class="quiet" title="Goes to Medium">Off</span>');
  expect(row(h, "large")).not.toContain("<select");
  expect(cells(row(h, "large"))).toEqual(["", "", "", "", ""]);
  expect(row(h, "small")).not.toContain("disabled");
  const one = page([], set(["medium"]));
  expect(row(one, "medium")).toContain('aria-label="Medium on" checked>');
  expect(row(one, "medium")).not.toContain("disabled");
  expect(row(one, "small")).toContain('title="Goes to Medium">Off<');
});

test("a down local server disables gpt-oss-20b in each select and draws no alert of its own", () => {
  const down = page([], { ...M, local: "down", down: ["gpt-oss-20b"] });
  // Medium is off, so it has no select.
  expect(down.match(/<option value="gpt-oss-20b" disabled>/g)!.length).toBe(10);
  expect(down).not.toContain("Local server");
  expect(page([])).not.toContain("disabled>");
});

test("the facts line holds the live agents, runs, success and the window's OpenRouter spend", () => {
  const f = page([]).match(/<p class="factline">.*?<\/p>/)![0];
  expect(f.replace(/<[^>]+>/g, "")).toBe("1 of 5 live 18 runs 80% success $17.54 OpenRouter");
  expect(renderFactoryAgents(S, { ...D, window: "hour", agents: { ...agents, outcomes: [] } }, new URLSearchParams(), M)).toContain("$1.50</b> OpenRouter");
  expect(page([full("worker", "opus", { size: "large" })], null)).toContain('<b class="num">–</b> OpenRouter');
});

test("while the models load a row shows the model it last ran on, with no controls", () => {
  const h = loading([full("worker", "haiku", { size: "small", runs: 4 })]);
  expect(row(h, "small")).toContain('<span class="main">haiku</span>');
  expect(row(h, "small")).not.toContain("<input");
  expect(cells(row(h, "small"))[0]).toBe("4");
});

test("with no data the Roles view says so; while the flow loads or fails it says that", () => {
  const h = loading([]);
  expect(h).toContain('<div class="empty"><p>No data</p></div>');
  expect(h).not.toContain("lrows");
  expect(renderFactoryAgents(S, null)).toContain(`<p class="quiet" role="status"><i class="spin" aria-hidden="true"></i>Loading the agents…</p>`);
  const bad = renderFactoryAgents(S, { error: "Could not load Flow (500)." } as any, new URLSearchParams(), M);
  expect(bad).toContain('<div class="error" role="alert"><p>Could not load the agents.</p>');
  expect(renderFactoryAgents(S, { error: "no data" } as any, usage)).toContain("no data");
});

test("a failed models fetch shows a bad notice before the list", () => {
  const h = page([full("worker", "opus", { size: "large" })], null);
  expect(h).toContain('<p class="notice bad" role="alert">Could not load the models.</p>');
  expect(h.indexOf("notice bad")).toBeLessThan(h.indexOf("data-browse"));
  expect(page([full("worker", "opus")], M)).not.toContain("Could not load the models.</p>");
});

/** Mount the view on a root with a fake fetch, then send `target` as a change; `reply` is the POST answer. */
async function change(target: any, reply: any) {
  const was = { fetch: globalThis.fetch, location: (globalThis as any).location, document: (globalThis as any).document };
  (globalThis as any).location = { hash: "" };
  (globalThis as any).document = { createElement: () => ({ setAttribute() {} }) };
  globalThis.fetch = ((_url: string, init?: any) => Promise.resolve(init?.method === "POST" ? Response.json(reply, { status: 422 }) : { ok: false, status: 500, json: async () => ({}) })) as any;
  const root: any = { innerHTML: "", querySelector: () => null };
  target.closest = (q: string) => (q === ".browse [data-name]" ? target : null);
  try {
    await view.mount(root, S);
    const msg: any = {};
    (globalThis as any).document.createElement = () => Object.assign(msg, { setAttribute() {} });
    await root.onchange({ target, type: "change" });
    return msg;
  } finally {
    globalThis.fetch = was.fetch;
    (globalThis as any).location = was.location;
    (globalThis as any).document = was.document;
  }
}

test("a failed model change shows the reason beside the control", async () => {
  const select: any = { after() {}, dataset: { name: "small" }, type: "select-one", value: "x", parentElement: { querySelector: () => null } };
  const msg = await change(select, { error: "the backend of x is down" });
  expect(msg.className).toBe("act-msg");
  expect(msg.textContent).toContain("the backend of x is down");
});

test("a refused turn-off puts the reason beside the last size's box and checks the box again", async () => {
  const box: any = { after() {}, dataset: { name: "medium" }, type: "checkbox", checked: false, parentElement: { querySelector: () => null } };
  const msg = await change(box, { error: "one size stays on" });
  expect(msg.textContent).toContain("one size stays on");
  expect(box.checked).toBe(true);
});

test("the chart colour order lists the model table's short names, and the view imports only what the UI server serves", () => {
  expect(MODEL_ORDER).toEqual([...new Set(Object.keys(MODELS).map(shortModel))]);
  const served = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const src = readFileSync(new URL("./factory-agents.js", import.meta.url), "utf8");
  for (const [, lib] of src.matchAll(/from "\.\.\/\.\.\/(lib\/[\w-]+\.ts)"/g)) expect(served).toContain(`"/${lib}"`);
});
