import { afterEach, beforeEach, expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { loadSpeed } from "./views/speed.js";
// @ts-ignore plain JS shared with the page
import { goQuery, parseHash, storeWindow, windowOf, wireScope } from "./lib.js";
// @ts-ignore plain JS shared with the page
import * as eff from "./views/efficiency.js";
// @ts-ignore plain JS shared with the page
import * as agents from "./views/factory-agents.js";
// @ts-ignore plain JS shared with the page
import * as fjobs from "./views/factory-jobs.js";
// @ts-ignore plain JS shared with the page
import * as jobs from "./views/jobs.js";
// @ts-ignore plain JS shared with the page
import * as now from "./views/now.js";
import { full } from "./test-now.ts";

const WINDOWS = ["hour", "day", "week", "month"] as const;
const WORDS = { hour: "last hour", day: "last 24 hours", week: "last 7 days", month: "last 30 days" };
const BUCKET = { hour: "minute", day: "hour", week: "day", month: "day" };
const DAYS = { hour: "0.041667", day: "1", week: null, month: "30" }; // week is the API default

const P = (n: number) => ({ count: n, p50: 60, p90: 120, hist: [0, 1, 0, 0, 0, 0, 0], worst: 300 });
const speed = (window: string): any => ({
  window, flaky: 1, lost: { hours: 1, share: 0.1 }, notCounted: { runs: 0, hours: 0 },
  issues: { landed: 1, firstPass: 0.5, fixRounds: 0, week: null, usage: [] }, classes: [],
  phases: { lead: P(1), intake: P(1), queue: P(1), implement: P(1), land: P(1) }, buckets: [{ at: new Date(2026, 9, 28).toISOString(), lead: 1 }],
  checks: [], models: [], agents: { live: 0, workers: 0, cap: 5, mean: 1, peak: 2, roles: [], points: [{ at: new Date(2026, 9, 28).toISOString() }] },
});
const S: any = { now: "2026-11-01T08:00:00Z", factory: { runsToday: 1, costToday: 1, dayCap: 9, liveRuns: 0, liveCap: 5 } };

const PAGES: Record<string, { path: string; view: any; render: (w: string) => string }> = {
  jobs: { path: "#/factory/jobs", view: fjobs.view, render: (w) => fjobs.renderFactoryJobs(speed(w), null) },
  efficiency: { path: "#/factory/efficiency", view: eff.view, render: (w) => eff.renderEfficiency(speed(w)) },
  agents: { path: "#/factory/agents", view: agents.view, render: (w) => agents.renderFactoryAgents(S, speed(w), "live", w) },
  status: { path: "#/", view: now.view, render: (w) => now.view.render(full, {}, new URLSearchParams(`window=${w}`)) },
  all: { path: "#/jobs", view: jobs.view, render: (w) => jobs.renderJobs([], { window: w }) },
};
// Agents loads /api/state, then the speed of the window the mount asks for.
const request = (p: { view: any }, q: URLSearchParams): string => {
  if (typeof p.view.api === "function") return p.view.api(null, q);
  let url = "";
  void loadSpeed(windowOf(q), async (u: string) => { url = u; return { ok: true, json: async () => ({}) } as any; });
  return url;
};
const query = () => new URLSearchParams(location.hash.split("?")[1] ?? "");
const pressed = (h: string) => [...(h.match(/data-name="window">(.*?)<\/div>/)?.[1] ?? "").matchAll(/data-value="(\w+)" aria-pressed="(\w+)"/g)];

const g: any = globalThis;
let store: Map<string, string> | null;
beforeEach(() => {
  store = new Map();
  g.localStorage = { getItem: (k: string) => store!.get(k) ?? null, setItem: (k: string, v: string) => void store!.set(k, v) };
  g.location = { hash: "" };
  g.history = { replaceState: (_a: unknown, _b: unknown, url: string) => { g.location.hash = url; } };
});
afterEach(() => { delete g.localStorage; delete g.location; delete g.history; });

test("each of the four pages renders the same four options, with the current window pressed", () => {
  for (const [name, p] of Object.entries(PAGES)) for (const w of WINDOWS) {
    const h = p.render(w);
    expect(pressed(h).map((m) => m[1]), name).toEqual(["hour", "day", "week", "month"]);
    expect(h, name).toContain(">Hour</button><button type=\"button\" data-value=\"day\"");
    expect(pressed(h).filter((m) => m[2] === "true").map((m) => m[1]), `${name} ${w}`).toEqual([w]);
  }
});

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
    if (name === "all") expect(url).toBe(DAYS[w] ? `/api/jobs?days=${DAYS[w]}` : "/api/jobs");
    else expect(url).toBe(`/api/speed?window=${w}${name === "efficiency" ? "&baseline=1" : ""}`);
    const shown = p.render(w);
    expect(shown, `${name} ${w}`).toContain(name === "all" ? WORDS[w].replace("last ", "") : name === "status" ? `data-value="${w}" aria-pressed="true"` : WORDS[w]);
    expect(html).toBeTruthy();
  }
});

test("Jobs titles its day rows by the bucket of the window", () => {
  for (const w of WINDOWS) expect(PAGES.jobs.render(w)).toContain(`Median by ${BUCKET[w]}`);
});

test("the trend against the last 24 hours shows only for week and month", () => {
  for (const w of WINDOWS) {
    const on = w === "week" || w === "month";
    for (const h of [fjobs.renderFactoryJobs(speed(w), speed("day"))])
      expect(/in the last 24 h\b/.test(h), w).toBe(on);
    expect(/vs 30-day average/.test(eff.renderEfficiency(speed(w))), w).toBe(false);
    expect(/in the last 24 h\b/.test(eff.renderEfficiency(speed(w))), w).toBe(false);
  }
});

test("the window stays when the reader moves to another page, and an address beats the store", () => {
  storeWindow("month");
  for (const p of Object.values(PAGES)) expect(request(p, new URLSearchParams())).toBe(p === PAGES.all ? "/api/jobs?days=30" : p === PAGES.efficiency ? "/api/speed?window=month&baseline=1" : "/api/speed?window=month");
  expect(request(PAGES.jobs, new URLSearchParams("window=hour"))).toBe("/api/speed?window=hour");
  expect(windowOf(new URLSearchParams("window=nope"))).toBe("month");
});

test("without storage the pages render and use the address, else week", () => {
  g.localStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  storeWindow("day");
  expect(windowOf(new URLSearchParams())).toBe("week");
  expect(windowOf(new URLSearchParams("window=day"))).toBe("day");
  delete g.localStorage;
  expect(windowOf(new URLSearchParams())).toBe("week");
});

test("All jobs keeps an old ?days= address open", () => {
  expect(jobs.view.api(null, new URLSearchParams("days=90"))).toBe("/api/jobs?days=90");
  expect(jobs.view.api(null, new URLSearchParams("days=30"))).toBe("/api/jobs?days=30");
  expect(pressed(jobs.renderJobs([], { days: "30" })).filter((m) => m[2] === "true").map((m) => m[1])).toEqual(["month"]);
  expect(pressed(jobs.renderJobs([], { days: "90" })).filter((m) => m[2] === "true")).toEqual([]);
});

test("live values on Agents say they are live", () => {
  expect(PAGES.agents.render("hour")).toContain("live, in use now");
  expect(PAGES.agents.render("hour")).toContain("live, not the window");
});

test("the picker works from an address with no hash", () => {
  g.location.hash = "";
  goQuery({ window: "day" });
  expect(g.location.hash).toBe("#/?window=day");
  g.location.hash = "#?week=1";
  goQuery({ window: "day" });
  expect(g.location.hash).toBe("#/?week=1&window=day");
  g.location.hash = "#/jobs?x=1";
  goQuery({ window: "day" });
  expect(g.location.hash).toBe("#/jobs?x=1&window=day");
});

test("the route of #?window=day is Status, on the day window", () => {
  const { path, query } = parseHash("#?window=day");
  expect(path).toBe("/");
  expect(path).toBe(now.view.path);
  expect(windowOf(query)).toBe("day");
  expect(parseHash("")).toEqual({ path: "/", query: new URLSearchParams() });
  expect(parseHash("#/jobs/a?x=1").path).toBe("/jobs/a");
});
