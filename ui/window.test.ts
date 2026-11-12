import { afterEach, beforeEach, expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { parseHash, remember, scope, wireScope } from "./lib.js";
// @ts-ignore plain JS shared with the page
import * as eff from "./views/efficiency.js";
// @ts-ignore plain JS shared with the page
import * as agents from "./views/factory-agents.js";
// @ts-ignore plain JS shared with the page
import * as fjobs from "./views/factory-jobs.js";
// @ts-ignore plain JS shared with the page
import { listUrl } from "./views/jobs.js";
// @ts-ignore plain JS shared with the page
// @ts-ignore plain JS shared with the page
import * as gates from "./views/gates.js";
// @ts-ignore plain JS shared with the page
import * as now from "./views/now.js";
import { full } from "./test-now.ts";

const WINDOWS = ["hour", "day", "week", "month"] as const;

const P = (n: number) => ({ count: n, p50: 60, p90: 120, hist: [0, 1, 0, 0, 0, 0, 0], worst: 300 });
const speed = (window: string): any => ({
  window, flaky: 1, lost: { hours: 1, share: 0.1 }, notCounted: { runs: 0, hours: 0 },
  issues: { landed: 1, firstPass: 0.5, fixRounds: 0, week: null, usage: [] }, classes: [],
  figures: { lost: null, hours: null, leadP50: 60, leadP90: 120, asks: null, landed: null, firstPass: 0.5 },
  phases: { lead: P(1), intake: P(1), queue: P(1), implement: P(1), land: P(1) }, buckets: [{ at: new Date(2026, 9, 28).toISOString(), lead: 1 }],
  checks: [], models: [], agents: { live: 0, workers: 0, cap: 5, mean: 1, peak: 2, roles: [], outcomes: [], points: [{ at: new Date(2026, 9, 28).toISOString() }] },
});
const S: any = { now: "2026-11-01T08:00:00Z", factory: { runsToday: 1, costToday: 1, liveRuns: 0, liveCap: 5 } };

const PAGES: Record<string, { path: string; view: any; render: (w: string) => string }> = {
  jobs: { path: "#/factory/jobs", view: fjobs.view, render: (w) => fjobs.renderFactoryJobs(speed(w), null) },
  efficiency: { path: "#/flow", view: eff.view, render: (w) => eff.renderEfficiency(speed(w)) },
  agents: { path: "#/factory/agents", view: agents.view, render: (w) => agents.renderFactoryAgents(S, speed(w), "live", w) },
  status: { path: "#/", view: now.view, render: (w) => now.view.render(full, {}, new URLSearchParams(`window=${w}`)) },
};
// Status and Agents load /api/factory, then the /api/flow of the window in their `more`: the request is the flow one.
const request = (p: { view: any }, q: URLSearchParams): string => {
  if (typeof p.view.api === "function" && p.view !== now.view && p.view !== agents.view) return [p.view.api(null, q)].flat().join(" ");
  let url = "";
  const was = g.fetch;
  g.fetch = async (u: string) => { if (u.startsWith("/api/flow")) url = u; return { ok: true, json: async () => ({}) }; };
  try { void p.view.more({}, q); } finally { g.fetch = was; }
  return url;
};
const query = () => new URLSearchParams(location.hash.split("?")[1] ?? "");

const g: any = globalThis;
let store: Map<string, string> | null;
beforeEach(() => {
  store = new Map();
  g.localStorage = { getItem: (k: string) => store!.get(k) ?? null, setItem: (k: string, v: string) => void store!.set(k, v) };
  g.location = { hash: "" };
  g.history = { replaceState: (_a: unknown, _b: unknown, url: string) => { g.location.hash = url; } };
});
afterEach(() => { delete g.localStorage; delete g.location; delete g.history; });

test("picking an option on each page asks for that window and the page marks it", () => {
  for (const [name, p] of Object.entries(PAGES)) for (const w of WINDOWS) {
    g.location.hash = p.path;
    const html = p.render("week");
    let click: any;
    const root = { querySelector: () => ({ addEventListener: (t: string, f: unknown) => { if (t === "click") click = f; } }) };
    wireScope(root);
    const btn = { dataset: { value: w }, parentElement: { dataset: { name: "window" } } };
    click({ target: { closest: () => btn } });
    expect(query().get("window"), name).toBe(w);
    const url = request(p, query());
    expect(url).toBe(`/api/flow?window=${w}${name === "efficiency" || name === "status" ? "&baseline=1" : ""}`);
    const shown = p.render(w);
    expect(shown, `${name} ${w}`).toContain(`data-value="${w}" aria-pressed="true"`);
    expect(html).toBeTruthy();
  }
});

test("the window stays when the reader moves to another page, and an address beats the store", () => {
  remember("window", "month");
  for (const p of Object.values(PAGES)) expect(request(p, new URLSearchParams())).toBe(p === PAGES.efficiency || p === PAGES.status ? "/api/flow?window=month&baseline=1" : "/api/flow?window=month");
  expect(request(PAGES.jobs, new URLSearchParams("window=hour"))).toBe("/api/flow?window=hour");
  expect(scope(new URLSearchParams("window=nope")).window).toBe("month");
});

test("a picked window asks for the jobs of the same window, and the state goes along", () => {
  for (const w of WINDOWS) expect(listUrl(null, new URLSearchParams(`window=${w}`))).toBe(w === "week" ? "/api/jobs?limit=2000" : `/api/jobs?window=${w}&limit=2000`);
  expect(listUrl(null, new URLSearchParams("window=week&role=worker&state=failed"))).toBe("/api/jobs?state=failed&limit=2000");
});

test("the unusable filter of the page goes to the jobs URL", () => {
  expect(listUrl(null, new URLSearchParams("window=day&project=aleph&unusable=1&stage=implement"))).toBe("/api/jobs?project=aleph&window=day&unusable=1&limit=2000");
});

test("the route of #?window=day is Status, on the day window", () => {
  const { path, query } = parseHash("#?window=day");
  expect(path).toBe("/");
  expect(path).toBe(now.view.path);
  expect(scope(query).window).toBe("day");
  expect(parseHash("")).toEqual({ path: "/", query: new URLSearchParams() });
  expect(parseHash("#/jobs/a?x=1").path).toBe("/jobs/a");
});

test("each head has the Project select before the window control, and only Status has Pause", () => {
  for (const [name, p] of Object.entries(PAGES)) {
    const h = p.render("week");
    expect(h.indexOf('<select name="project"'), name).toBeGreaterThan(-1);
    expect(h.indexOf('<select name="project"'), name).toBeLessThan(h.indexOf('data-name="window"'));
    expect(h.includes('data-act="pause"'), name).toBe(name === "status");
  }
});

test("a chosen project is in the address, in each request, and on the next page", () => {
  for (const [name, p] of Object.entries(PAGES)) {
    g.location.hash = p.path;
    let change: any;
    wireScope({ querySelector: () => ({ addEventListener: (t: string, f: unknown) => { if (t === "change") change = f; } }) });
    change({ target: { name: "project", value: "alpha", matches: () => true } });
    expect(query().get("project"), name).toBe("alpha");
    expect(request(p, query()), name).toContain("project=alpha");
    expect(request(p, query()), name).toContain(`window=${scope(query()).window}`);
    g.location.hash = "#/other";
    expect(request(p, new URLSearchParams()), name).toContain("project=alpha");
    change({ target: { name: "project", value: "", matches: () => true } });
    expect(request(p, new URLSearchParams()), name).not.toContain("project=");
  }
  expect(scope(new URLSearchParams("project=beta")).project).toBe("beta");
  expect(PAGES.status.view.api(null, new URLSearchParams("project=alpha"))).toBe("/api/factory?window=week&project=alpha");
});

test("scope wire keeps the window and the project in storage and in the address; week and All stay out of it", () => {
  const root = { querySelector: () => null };
  g.location.hash = "#/flow?window=day&project=alpha";
  scope().wire(root);
  g.location.hash = "#/factory/jobs";
  const s = scope();
  expect([s.window, s.project, s.url("/api/flow?window=day"), s.url("/api/factory")]).toEqual(["day", "alpha", "/api/flow?window=day&project=alpha", "/api/factory?project=alpha"]);
  s.wire(root);
  expect(g.location.hash).toBe("#/factory/jobs?window=day&project=alpha");
  remember("window", "week");
  remember("project", "");
  g.location.hash = "#/flow";
  scope().wire(root);
  expect(g.location.hash).toBe("#/flow");
  expect(scope().url("/api/factory")).toBe("/api/factory");
});

test("the Automation page asks for the chosen window and project, and the Status page's answer for its asks", () => {
  expect(gates.view.api(null, new URLSearchParams("window=day&project=alpha"))).toEqual(["/api/automation?window=day&project=alpha", "/api/factory?window=day&project=alpha"]);
});

