import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { OFFERS } from "../../jobs/lib/routing/models.ts";
import { MODELS } from "../../lib/models.ts";
// @ts-ignore plain JS shared with the page
import { MODEL_ORDER, costFrame, liveFrame, renderFactoryAgents, tokensFrame, view } from "./factory-agents.js";
// @ts-ignore plain JS shared with the page
import { label, option } from "./lib/chart.js";
// @ts-ignore plain JS shared with the page
import { dur, shortModel } from "./lib/format.js";
// @ts-ignore plain JS shared with the page
import { pace, usageCard, weekGone } from "./lib/flow-parts.js";

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

test("Per output is cost over built for a size, over verdicts for the reviewer and over OK runs for another role, and a worker OK under 70% has the warn tone", () => {
  const h = page([full("worker", "haiku", { size: "small", rate: 0.6, cost: 12, built: 4, firstPass: 3, reviewPass: 0.5 }), full("reviewer", "opus", { cost: 12, pass: 5, fail: 1 }), full("intake", "opus", { cost: 12, succeeded: 24 })]);
  const per = (r: string) => r.match(/<td[^>]*>.*?<\/td>/g)![8];
  expect(per(row(h, "Small"))).toBe('<td class="num">$3.00</td>');
  expect(per(row(h, "Reviewer"))).toBe('<td class="num">$2.00</td>');
  expect(per(row(h, "Intake"))).toBe('<td class="num">$0.50</td>');
  expect(row(h, "Small")).toMatch(/<td class="num warn">60%/);
  expect(row(h, "Intake")).not.toContain("warn");
  expect(row(h, "Small")).toContain('<td class="out">4 landed <span class="quiet">· 75% first · 50% review</span></td>');
  expect(row(h, "Reviewer")).toContain('<td class="out">6 verdicts</td>');
});

const row = (h: string, name: string) => h.match(new RegExp(`<tr><td title="${name}">${name}</td>.*?</tr>`))![0];

test("an outcome on a full model id joins the row of its short model; an unset model never reads not recorded", () => {
  const o = (role: string, model: string, runs: number) => ({ role, model, runs, succeeded: runs, failed: 0, error: 0, ended: runs, rate: 1, p50: 60, cost: 1.5, baseline: 0.7 });
  const outcomes = [o("intake", "claude-opus-5-5", 151), { ...o("worker", "claude-haiku-4-5-20251001", 7), size: "small" }, o("reviewer", "unset", 3)];
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes } }, "live", "week", { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(row(h, "Intake")).toMatch(/<\/select><\/td><td class="num">151<\/td>/);
  expect(h.match(/<td title="Intake">Intake<\/td>/g)!.length).toBe(1);
  expect(row(h, "Small")).toMatch(/<\/select><\/td><td class="num">7<\/td>/);
  expect(h).not.toMatch(/<td>claude-/);
  // The reviewer's unset outcome is an earlier model under its one row.
  expect(row(h, "Reviewer")).toContain('data-fold="review"');
  expect(h.match(/<td title="Reviewer">/g)!.length).toBe(1);
  expect(h).not.toContain("not recorded");
});

test("the tiles are usage, OpenRouter spend for the window's UTC period, live agents, follow-ups and success", () => {
  const keys = (h: string) => [...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1]);
  const m = { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: ["deepseek-v4.1-flash"], spend: { day: 1.5, week: 17.54, month: 18 } };
  const h = renderFactoryAgents(S, D, "live", "week", m);
  expect(keys(h)).toEqual(["Usage", "OpenRouter", "Live agents", "Follow\u2011ups", "Success"]);
  for (const t of ["<b>1<em> / 0</em></b>", "<b>down<em> / $17.54</em></b>"]) expect(h).toContain(t);
  expect(renderFactoryAgents(S, { ...D, window: "hour" }, "live", "hour", m)).toContain("<b>down<em> / $1.50</em></b>");
  const loading = renderFactoryAgents(S, D);
  expect(loading).toContain('<i class="spin" role="status" aria-label="Loading"></i></span><b>&nbsp;</b><span class="q"><span>status</span>');
  expect(h).not.toContain("Backends");
  // A failed models fetch is null.
  expect(renderFactoryAgents(S, D, "live", "week", null)).not.toContain("Local server");
});

/** The inner HTML of each metric tile of the scorecard. */
const tiles = (h: string) => [...h.matchAll(/<(?:div|a|button) class="tile sc"[^>]*>([\s\S]*?)<\/(?:div|a|button)>/g)].map((m) => m[1]);
/** The tile whose key is `k`. */
const tile = (h: string, k: string) => tiles(h).find((t) => t.includes(`<span class="k">${k}</span>`))!;

test("one tile holds the live worker runs over the other live agents", () => {
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, live: 3, workers: 1 } });
  const live = tile(h, "Live agents");
  expect(live).toContain("<b>1<em> / 2</em></b>");
  expect(live).toContain('<span class="q"><span>workers</span><span class="m"> / other</span></span>');
  expect(live).not.toContain("cap");
  expect(live).not.toContain("others");
  expect(live).not.toContain('class="q m"');
  // No other tile shows a live count.
  expect(tiles(h).filter((t) => t.includes("<b>1<em> / 2</em></b>"))).toEqual([live]);
});

test("with no flow the live tile keeps the worker runs and spins in place of the other agents", () => {
  const h = renderFactoryAgents(S, null);
  expect(tile(h, "Live agents")).toContain('<i class="spin" role="status" aria-label="Loading"></i></span><b>1</b>');
  expect(h).not.toContain("undefined");
  expect(h).not.toContain("–");
});

test("a failed flow fetch stops the spinners: a still ring with the error line in each flow card", () => {
  const h = renderFactoryAgents(S, { error: "Could not load the flow." } as any, "live", "week", undefined);
  const ring = '<i class="spin bad" role="img" aria-label="Could not load the flow." title="Could not load the flow.">!</i>';
  for (const k of ["Live agents", "Follow\u2011ups", "Success"]) expect(tile(h, k)).toContain(ring);
  expect(tile(h, "Success")).toContain("<b>&nbsp;</b>");
  expect(tile(h, "Success")).not.toContain('role="status"');
});

test("the OpenRouter tile holds OpenRouter's status over the window's spend, and nothing else", () => {
  const m = (down: string[]) => ({ models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down, spend: { day: 1.5, week: 17.54, month: 18 } });
  const up = tile(renderFactoryAgents(S, D, "live", "week", m([])), "OpenRouter");
  expect(up).toContain("<b>up<em> / $17.54</em></b>");
  expect(up).toContain('<span class="q"><span>status</span><span class="m"> / spend</span></span>');
  expect(up).not.toContain("lights");
  expect(up).not.toContain("event-dot");
  expect(up).not.toContain("Spend");
  const down = tile(renderFactoryAgents(S, D, "live", "week", m(["deepseek-v4.1-flash"])), "OpenRouter");
  expect(down).toContain("<b>down<em> / $17.54</em></b>");
  expect(tile(renderFactoryAgents(S, D), "OpenRouter")).toContain('<i class="spin" role="status" aria-label="Loading"></i>');
  // A failed models fetch is null, so the card shows the failed ring and no figures.
  const failed = tile(renderFactoryAgents(S, D, "live", "week", null), "OpenRouter");
  expect(failed).toContain('<i class="spin bad" role="img" aria-label="Could not load the models." title="Could not load the models.">!</i></span><b>&nbsp;</b>');
});

test("the OpenRouter and Live agents tiles hold one key line, one value line and one qualifier line", () => {
  const m = { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [], spend: { week: 17.54 } };
  const h = renderFactoryAgents(S, D, "live", "week", m);
  // Everything left after the three lines the tile holds: nothing.
  const rest = (t: string) => t.replace(/<span class="r1">[\s\S]*?<\/span><\/span>/, "").replace(/<b>[\s\S]*?<\/b>/, "").replace(/<span class="q">[\s\S]*?<\/span><\/span>/, "");
  for (const k of ["OpenRouter", "Live agents"]) {
    const t = tile(h, k);
    expect(t.match(/class="r1"/g)!.length).toBe(1);
    expect(t.match(/<b[ >]/g)!.length).toBe(1);
    expect(t.match(/class="q"/g)!.length).toBe(1);
    expect(rest(t)).toBe("");
  }
});

test("no usage data shows a dash; while the speed data loads the page says so", () => {
  const h = renderFactoryAgents({ ...S, usage: undefined }, null);
  expect(h).toContain('<span class="k">Usage</span></span><b>–</b>');
  expect(h).toContain(`<p class="quiet" role="status"><i class="spin" aria-hidden="true"></i>Loading the agents…</p>`);
  expect(renderFactoryAgents(S, { error: "no data" })).toContain("no data");
});

const T: any = { done: "#d", need: "#n", error: "#s", "series-1": "#1", "series-2": "#2" };
const buckets = [{ at: new Date(2026, 9, 27).toISOString(), cost: { opus: 1.5, sonnet: 0.25 }, tokens: { opus: 1200, sonnet: 300 } }, { at: new Date(2026, 9, 28).toISOString(), cost: { opus: 2 }, tokens: { opus: 800 } }];
const outcomes = [
  { role: "worker", model: "haiku", succeeded: 6, failed: 2, error: 1 },
  { role: "worker", model: "sonnet", succeeded: 4, failed: 0, error: 0 },
  { role: "triage", model: "opus", succeeded: 5, failed: 0, error: 0 },
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
  maintainer: { enabled: true, model: "sonnet" },
  housekeeper: { enabled: true, model: "opus" },
  judge: { enabled: true, model: "haiku" },
  investigator: { enabled: true, model: "opus" },
});

test("the Roles table holds a select per size and role model in its Model cell, a checkbox on each size only, and no Models card", () => {
  const keys: Record<string, string> = { Small: "small", Medium: "medium", Large: "large", Reviewer: "review", Intake: "intake", Director: "director", Monitor: "monitor", Maintainer: "maintainer", Housekeeper: "housekeeper", Judge: "judge", Investigator: "investigator" };
  // The second offer of each key is configured, so a select that kept its first option fails.
  const want = Object.fromEntries(Object.values(keys).map((k) => [k, (OFFERS as any)[k][1]]));
  const models = Object.fromEntries(Object.entries(want).map(([k, model]) => [k, { enabled: true, model }]));
  const html = renderFactoryAgents(S, E, "live", "week", { models, local: "up", offers: OFFERS, down: [] });
  expect(html).not.toContain('id="models"');
  expect(html).not.toContain(">Models</h2>");
  for (const [name, key] of Object.entries(keys)) {
    const cells = row(html, name).match(/<td[^>]*>.*?<\/td>/g)!;
    const sel = cells[1].match(/<select.*?<\/select>/s)![0];
    expect([...sel.matchAll(/<option value="([^"]+)"/g)].map((x) => x[1])).toEqual((OFFERS as any)[key]);
    expect(sel).toContain(`data-name="${key}"`);
    expect(sel).toMatch(new RegExp(`<option value="${want[key]}"[^>]* selected>`));
    expect(cells[1].includes("checkbox")).toBe(["small", "medium", "large"].includes(key));
  }
  for (const k of ["Small", "Medium", "Large"]) expect(row(html, k)).toContain(`type="checkbox" data-name="${k.toLowerCase()}" aria-label="${k} enabled" checked>`);
  expect((html.match(/type="checkbox"/g) ?? []).length).toBe(3);
  expect(html).not.toContain(">Merge<");
  expect(html).not.toContain(">Succeeded<");
  expect(html).not.toContain(">Failed<");
});

test("a down local server shows one alert, an up one shows nothing, and the Roles table disables gpt-oss-20b to match", () => {
  const down = renderFactoryAgents(S, D, "live", "week", { models: entries("haiku", "sonnet"), local: "down", offers: OFFERS, down: ["gpt-oss-20b"] });
  expect(down).toMatch(/role="alert"[^>]*>Local server down</);
  // Medium is off, so it has no select.
  expect(down.match(/<option value="gpt-oss-20b" disabled>/g)!.length).toBe(10);
  const up = renderFactoryAgents(S, D, "live", "week", { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(up).not.toContain("Local server");
  expect(up).not.toContain("role=\"alert\"");
  expect(up).not.toContain("disabled");
  expect(renderFactoryAgents(S, null, "live", "week", { models: entries("haiku", "sonnet"), local: "down", offers: OFFERS, down: ["gpt-oss-20b"] })).toContain("Local server down");
});

test("the Follow-ups tile shows the follow-ups and all filed, its neutral trend, and none without a baseline", () => {
  const d = { ...D, figures: { followups: 184, filed: 259 }, baseline: { base: { followups: 150 }, prev: { followups: 160 }, basis: "the previous 7 days" } };
  const t = tile(renderFactoryAgents(S, d), "Follow\u2011ups");
  expect(t).toContain("<b>184<em> / 259</em></b>");
  expect(t).toContain('<span class="q"><span>follow-ups</span><span class="m"> / filed</span></span>');
  expect(t).toContain('<span class="tr"');
  expect(t).not.toMatch(/class="tr (good|warn)/);
  expect(t.match(/<(?:span|b|em)\b/g)!.length).toBe(8);
  expect(tile(renderFactoryAgents(S, { ...d, baseline: undefined }), "Follow\u2011ups")).not.toContain('class="tr');
});

test("the Success tile shows the success and first pass shares, its trend with higher good, and none without a baseline", () => {
  const page = (rates: any) => renderFactoryAgents(S, { ...D, agents: { ...agents, rates } });
  const t = tile(page({ success: 0.91, baseline: 0.8, firstPass: 0.64 }), "Success");
  expect(t).toContain("<b>91%<em> / 64%</em></b>");
  expect(t).toContain('<span class="q"><span>runs</span><span class="m"> / first pass</span></span>');
  expect(t).toContain('<span class="tr good"');
  expect(t.match(/<(?:span|b|em)\b/g)!.length).toBe(8);
  expect(tile(page({ success: 0.7, baseline: 0.8, firstPass: 0.64 }), "Success")).toContain('<span class="tr warn"');
  expect(tile(page({ success: 0.91, baseline: null, firstPass: 0.64 }), "Success")).not.toContain('class="tr');
});

const full = (role: string, model: string, extra: any = {}) => ({ role, model, runs: 30, succeeded: 24, failed: 6, error: 0, ended: 30, rate: 0.8, p50: 60, p95: 300, cost: 1.5, baseline: 0.7, ...extra });
const M = { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] };
const page = (outcomes: any[], extra: any = {}) => renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes, ...extra } }, "live", "week", M);

test("a size on two models shows its current model's figures and a ▸ that opens a sub-row of the earlier model with its dates", () => {
  const outs = [full("worker", "gpt-oss-20b", { size: "small", runs: 14, from: "2026-10-20T08:00:00Z", to: "2026-10-23T08:00:00Z" }), full("worker", "haiku", { size: "small", runs: 11 })];
  const h = page(outs);
  expect(row(h, "Small")).toContain('<td class="num">11</td>');
  expect(row(h, "Small")).toContain('<button class="fold" data-fold="small" aria-expanded="false" aria-label="Earlier models of Small">▸</button>');
  expect(h).not.toContain("sub-row");
  (globalThis as any).localStorage = { getItem: (k: string) => (k === "aleph.agents.open" ? '["small"]' : null), setItem() {} };
  try {
    const o = page(outs);
    expect(row(o, "Small")).toContain('aria-expanded="true"');
    expect(o).toMatch(/<tr class="sub-row"><td><\/td><td>gpt-oss-20b <span class="quiet">Oct 20 – Oct 23<\/span><\/td><td class="num">14<\/td>/);
  } finally {
    delete (globalThis as any).localStorage;
  }
});

test("a click on ▸ keeps the size open, and a second click closes it", async () => {
  const store: Record<string, string> = {};
  (globalThis as any).localStorage = { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; } };
  const root: any = { querySelector: () => null };
  const b: any = { dataset: { fold: "small" } };
  const click = () => root.onclick({ target: { closest: (q: string) => (q === "#roles button[data-fold]" ? b : null) } });
  try {
    await view.mount(root, S);
    click();
    expect(store["aleph.agents.open"]).toBe('["small"]');
    click();
    expect(store["aleph.agents.open"]).toBe("[]");
  } finally {
    delete (globalThis as any).localStorage;
  }
});

test("the Workers group holds Small, Medium and Large and no Unsized row, and the Other group a row per role model", () => {
  const h = page([full("worker", "sonnet", { size: null, runs: 17 })]);
  const [workers, rolesPart] = h.split('<tr class="grp"><th colspan="10">Other</th></tr>');
  expect(workers).toContain('<tr class="grp"><th colspan="10">Workers</th></tr>');
  expect([...workers.matchAll(/<td title="([^"]+)">/g)].map((x) => x[1])).toEqual(["Small", "Medium", "Large"]);
  expect(h).not.toContain('title="Unsized"');
  expect([...rolesPart.matchAll(/<td title="([^"]+)">/g)].map((x) => x[1])).toEqual(["Reviewer", "Intake", "Director", "Monitor", "Maintainer", "Housekeeper", "Judge", "Investigator"]);
});

test("no Agent cell stretches; the Output column takes the spare width and holds its whole text", () => {
  const h = page([full("worker", "haiku", { size: "small", runs: 4, built: 4, firstPass: 3, reviewPass: 0.5 })]);
  expect(h).not.toContain('class="wide"');
  expect(row(h, "Small")).toMatch(/<td class="out">4 landed <span class="quiet">· 75% first · 50% review<\/span><\/td><\/tr>$/);
});

test("an off size says where its work goes and shows no select or figures, and the last size on keeps a live checked box", () => {
  const set = (on: string[]) => ({ ...M, models: Object.fromEntries(Object.entries(entries("haiku", "sonnet")).map(([k, v]) => [k, { ...v, enabled: !["small", "medium", "large"].includes(k) || on.includes(k) }])) });
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [full("worker", "opus", { size: "large", runs: 19 })] } }, "live", "week", set(["small", "medium"]));
  expect(row(h, "Large")).toContain('<td><span class="fold" aria-hidden="true"></span> <input type="checkbox" data-name="large" aria-label="Large enabled"> <span class="quiet" title="Goes to Medium">Off</span></td><td colspan="8"></td></tr>');
  expect(row(h, "Large")).not.toContain("<select");
  expect(row(h, "Large")).not.toContain("Off · goes to");
  expect(row(h, "Small")).not.toContain("disabled");
  const one = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [] } }, "live", "week", set(["medium"]));
  expect(row(one, "Medium")).toContain('aria-label="Medium enabled" checked>');
  expect(row(one, "Medium")).not.toContain("disabled");
  expect(row(one, "Small")).toContain('title="Goes to Medium">Off<');
  expect(row(one, "Large")).toContain('title="Goes to Medium">Off<');
});

test("a row under 20 ended runs shows its counts and no percent; 20 or more shows the rate with its ended count", () => {
  const h = page([full("worker", "haiku", { size: "small", ended: 7, succeeded: 5, failed: 2, rate: 5 / 7 }), full("worker", "opus", { size: "large", ended: 24, succeeded: 20, failed: 4, rate: 20 / 24 })]);
  expect(row(h, "Small")).toContain("5 / 7");
  expect(row(h, "Small").match(/<td class="num[^"]*">.*?<\/td>/g)![1]).not.toMatch(/%|class="tr/);
  expect(row(h, "Large")).toMatch(/83%.*?>24</);
  expect(row(h, "Large")).toContain('class="tr');
});

test("the Roles table draws Housekeeper and Maintainer rows, and a size row shows p95 and its landed builds", () => {
  const h = page([full("worker", "haiku", { size: "small", built: 165, firstPass: 110, reviewPass: 0.875 }), full("housekeeper", "opus", { runs: 31 }), full("maintainer", "sonnet", { runs: 32 })]);
  expect(row(h, "Housekeeper")).toContain('<td class="num">31</td>');
  expect(row(h, "Maintainer")).toContain('<td class="num">32</td>');
  const w = row(h, "Small");
  expect(w).toContain(`<td class="num">${dur(300)}</td>`);
  expect(w).toContain("165 landed");
});

test("the Roles card has no first-pass aside: the Success card shows it", () => {
  expect(page([], { rates: { success: 0.8, baseline: 0.7, firstPass: 0.664, local: 0 } })).not.toMatch(/First pass \d/);
});

const th = (h: string) => [...h.matchAll(/<th( class="num")?>([^<]+)</g)].map((m) => [m[2], !!m[1]]);
const one = { role: "worker", size: "small", model: "haiku", runs: 1234, succeeded: 1, failed: 0, error: 0, ended: 1, rate: 1, p50: 60, cost: 1.5, baseline: 0.7 };

test("the Roles table heads Agent to Output in Title Case, each number head with num, and no Failed jobs link, Pass share or worker only cell", () => {
  const h = page([full("worker", "haiku", { size: "small" }), full("reviewer", "opus", { pass: 24, fail: 6 }), full("intake", "opus")]);
  const num = new Set(["Runs", "OK", "Error", "p50", "p95", "Cost", "Per Output"]);
  expect(th(h)).toEqual(["Agent", "Model", "Runs", "OK", "Error", "p50", "p95", "Cost", "Per Output", "Output"].map((t) => [t, num.has(t)]));
  expect(h).not.toMatch(/Failed jobs|failed-jobs|Pass share|worker only/);
  expect(readFileSync(new URL("../app.css", import.meta.url), "utf8")).not.toContain("failed-jobs");
});

test("a Roles count goes through count()", () => {
  expect(renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [one] } })).toContain('<td class="num">1,234</td>');
});

test("a Roles row with no outcome shows a dash in every cell, with num on the number cells", () => {
  const html = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [] } }, "live", "week", { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] });
  expect(row(html, "Director")).toMatch(new RegExp(`</select></td>${'<td class="num"><span title="no runs in this window">–</span></td>'.repeat(7)}<td class="out"><span title="no runs in this window">–</span></td>`));
});

test("an empty Roles table shows the empty line", () => {
  const html = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [] } });
  expect(html).toContain('<div class="empty"><p>No data</p></div>');
  expect(html).not.toContain("<table");
});

test("a failed flow shows one error line with no hint in the Agents and Roles cards and the status under Technical details", () => {
  const h = renderFactoryAgents(S, { error: "Could not load Flow (500)." } as any, "live", "week", M);
  expect(h.match(/<div class="error" role="alert"><p>Could not load the agents\.<\/p>/g)!.length).toBe(2);
  expect(h).not.toContain("Could not load Flow</p>");
  expect(h).not.toContain('class="hint"');
  expect(h.match(/Technical details[\s\S]*?<pre>Could not load Flow \(500\)\.<\/pre>/g)!.length).toBe(2);
});

test("a failed models fetch with the agents loaded shows a bad notice before the Roles table", () => {
  const h = renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [full("worker", "opus", { size: "large" })] } }, "live", "week", null);
  const roles = h.slice(h.indexOf('id="roles"'));
  expect(roles).toContain('<p class="notice bad" role="alert">Could not load the models.</p>');
  expect(roles.indexOf("notice bad")).toBeLessThan(roles.indexOf("<table"));
  expect(renderFactoryAgents(S, { ...D, agents: { ...agents, outcomes: [full("worker", "opus")] } }, "live", "week", M)).not.toContain("Could not load the models.</p>");
});

test("the Usage card is the Status one", () => {
  expect(renderFactoryAgents(S, D, "live", "week", { models: entries("haiku", "sonnet"), local: "up", offers: OFFERS, down: [] })).toContain(usageCard(S));
});

test("a failed model change shows the reason beside the control", async () => {
  const was = { fetch: globalThis.fetch, location: (globalThis as any).location, document: (globalThis as any).document };
  (globalThis as any).location = { hash: "" };
  (globalThis as any).document = { createElement: () => ({ setAttribute() {} }) };
  globalThis.fetch = ((_url: string, init?: any) =>
    Promise.resolve(init?.method === "POST" ? Response.json({ error: "the backend of x is down" }, { status: 422 }) : { ok: false, status: 500, json: async () => ({}) })) as any;
  const root: any = { innerHTML: "", querySelector: () => null };
  const select: any = { after() {}, dataset: { name: "small" }, type: "select-one", value: "x", parentElement: { querySelector: () => null } };
  select.closest = (q: string) => (q === "#roles [data-name]" ? select : null);
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

test("a refused turn-off puts the reason beside the last size's box and checks the box again", async () => {
  const was = { fetch: globalThis.fetch, location: (globalThis as any).location, document: (globalThis as any).document };
  (globalThis as any).location = { hash: "" };
  (globalThis as any).document = { createElement: () => ({ setAttribute() {} }) };
  globalThis.fetch = ((_url: string, init?: any) =>
    Promise.resolve(init?.method === "POST" ? Response.json({ error: "one size stays on" }, { status: 422 }) : { ok: false, status: 500, json: async () => ({}) })) as any;
  const root: any = { innerHTML: "", querySelector: () => null };
  const box: any = { after() {}, dataset: { name: "medium" }, type: "checkbox", checked: false, parentElement: { querySelector: () => null } };
  box.closest = (q: string) => (q === "#roles [data-name]" ? box : null);
  try {
    await view.mount(root, S);
    const msg: any = {};
    (globalThis as any).document.createElement = () => Object.assign(msg, { setAttribute() {} });
    await root.onchange({ target: box, type: "change" });
    expect(msg.textContent).toContain("one size stays on");
    expect(box.checked).toBe(true);
  } finally {
    globalThis.fetch = was.fetch;
    (globalThis as any).location = was.location;
    (globalThis as any).document = was.document;
  }
});

test("the chart colour order lists the model table's short names, and the view imports only what the UI server serves", () => {
  expect(MODEL_ORDER).toEqual([...new Set(Object.keys(MODELS).map(shortModel))]);
  const served = readFileSync(new URL("../server.ts", import.meta.url), "utf8");
  const src = readFileSync(new URL("./factory-agents.js", import.meta.url), "utf8");
  for (const [, lib] of src.matchAll(/from "\.\.\/\.\.\/(lib\/[\w-]+\.ts)"/g)) expect(served).toContain(`"/${lib}"`);
});
