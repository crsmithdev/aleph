import { afterEach, beforeEach, expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { loadSpeed, speedOf } from "./views/speed.js";
// @ts-ignore plain JS shared with the page
import { goQuery, parseHash, projectOf, storeWindow, windowOf, wireScope } from "./lib.js";
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
const WORDS = { hour: "last hour", day: "last 24 hours", week: "last 7 days", month: "last 30 days" };

const P = (n: number) => ({ count: n, p50: 60, p90: 120, hist: [0, 1, 0, 0, 0, 0, 0], worst: 300 });
const speed = (window: string): any => ({
  window, flaky: 1, lost: { hours: 1, share: 0.1 }, notCounted: { runs: 0, hours: 0 },
  issues: { landed: 1, firstPass: 0.5, fixRounds: 0, week: null, usage: [] }, classes: [],
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
// Status and Agents load /api/factory, then the speed of the window the mount asks for: the request is the speed one.
const request = (p: { view: any }, q: URLSearchParams): string => {
  if (typeof p.view.api === "function" && p.view !== now.view && p.view !== agents.view) return [p.view.api(null, q)].flat().join(" ");
  let url = "";
  void loadSpeed(windowOf(q), async (u: string) => { url = u; return { ok: true, json: async () => ({}) } as any; });
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

test("picking an option on each page asks for that window and the page says its period", () => {
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
    expect(url).toBe(`/api/flow?window=${w}${name === "efficiency" ? "&baseline=1" : ""}`);
    const shown = p.render(w);
    expect(shown, `${name} ${w}`).toContain(name === "status" ? `data-value="${w}" aria-pressed="true"` : WORDS[w]);
    expect(html).toBeTruthy();
  }
});

test("the window stays when the reader moves to another page, and an address beats the store", () => {
  storeWindow("month");
  for (const p of Object.values(PAGES)) expect(request(p, new URLSearchParams())).toBe(p === PAGES.efficiency ? "/api/flow?window=month&baseline=1" : "/api/flow?window=month");
  expect(request(PAGES.jobs, new URLSearchParams("window=hour"))).toBe("/api/flow?window=hour");
  expect(windowOf(new URLSearchParams("window=nope"))).toBe("month");
});

test("a picked window asks for the jobs of the same window, and the state goes along", () => {
  for (const w of WINDOWS) expect(listUrl(null, new URLSearchParams(`window=${w}`))).toBe(w === "week" ? "/api/jobs?limit=2000" : `/api/jobs?window=${w}&limit=2000`);
  expect(listUrl(null, new URLSearchParams("window=week&role=worker&state=failed"))).toBe("/api/jobs?state=failed&limit=2000");
});

test("the route of #?window=day is Status, on the day window", () => {
  const { path, query } = parseHash("#?window=day");
  expect(path).toBe("/");
  expect(path).toBe(now.view.path);
  expect(windowOf(query)).toBe("day");
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
    expect(request(p, query()), name).toContain(`window=${windowOf(query())}`);
    g.location.hash = "#/other";
    expect(request(p, new URLSearchParams()), name).toContain("project=alpha");
    change({ target: { name: "project", value: "", matches: () => true } });
    expect(request(p, new URLSearchParams()), name).not.toContain("project=");
  }
  expect(projectOf(new URLSearchParams("project=beta"))).toBe("beta");
  expect(PAGES.status.view.api(null, new URLSearchParams("project=alpha"))).toEqual(["/api/factory?window=week&project=alpha", "/api/automation?window=week&project=alpha"]);
});

test("the Automation page asks for the chosen window and project", () => {
  expect(gates.view.api(null, new URLSearchParams("window=day&project=alpha"))).toEqual(["/api/automation?window=day&project=alpha", "/api/factory?project=alpha"]);
});

test("an answer for a project that is no longer cached does not enter the cache", async () => {
  let late: (v: unknown) => void = () => {};
  const slow = () => new Promise((ok) => { late = ok; }).then(() => ({ ok: true, json: async () => ({ window: "week", who: "A", others: { day: { who: "A" } } }) }) as any);
  const fast = async () => ({ ok: true, json: async () => ({ window: "week", who: "B", others: { day: { who: "B" }, month: { who: "B" } } }) }) as any;
  const a = loadSpeed("week", slow as any, false, "A");
  await loadSpeed("week", fast, false, "B");
  late(0);
  await a;
  for (const w of ["week", "day", "month"]) expect((speedOf(w) as any).who, w).toBe("B");
});
