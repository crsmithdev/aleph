// Archived goal tests from ui/window.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { loadSpeed } from "../../ui/views/speed.js";
// @ts-ignore plain JS shared with the page
import { goQuery, parseHash, storeWindow, windowOf, wireScope } from "../../ui/lib.js";
// @ts-ignore plain JS shared with the page
import * as eff from "../../ui/views/efficiency.js";
// @ts-ignore plain JS shared with the page
import * as agents from "../../ui/views/factory-agents.js";
// @ts-ignore plain JS shared with the page
import * as fjobs from "../../ui/views/factory-jobs.js";
// @ts-ignore plain JS shared with the page
import * as jobs from "../../ui/views/jobs.js";
// @ts-ignore plain JS shared with the page
import * as now from "../../ui/views/now.js";
import { full } from "../../ui/test-now.ts";

const WINDOWS = ["hour", "day", "week", "month"] as const;
const BUCKET = { hour: "minute", day: "hour", week: "day", month: "day" }; // week is the API default

const P = (n: number) => ({ count: n, p50: 60, p90: 120, hist: [0, 1, 0, 0, 0, 0, 0], worst: 300 });
const speed = (window: string): any => ({
  window, flaky: 1, lost: { hours: 1, share: 0.1 }, notCounted: { runs: 0, hours: 0 },
  issues: { landed: 1, firstPass: 0.5, fixRounds: 0, week: null, usage: [] }, classes: [],
  phases: { lead: P(1), intake: P(1), queue: P(1), implement: P(1), land: P(1) }, buckets: [{ at: new Date(2026, 9, 28).toISOString(), lead: 1 }],
  checks: [], models: [], agents: { live: 0, workers: 0, cap: 5, mean: 1, peak: 2, roles: [], points: [{ at: new Date(2026, 9, 28).toISOString() }] },
});
const S: any = { now: "2026-11-01T08:00:00Z", factory: { runsToday: 1, costToday: 1, liveRuns: 0, liveCap: 5 } };

const PAGES: Record<string, { path: string; view: any; render: (w: string) => string }> = {
  jobs: { path: "#/factory/jobs", view: fjobs.view, render: (w) => fjobs.renderFactoryJobs(speed(w), null) },
  efficiency: { path: "#/factory/efficiency", view: eff.view, render: (w) => eff.renderEfficiency(speed(w)) },
  agents: { path: "#/factory/agents", view: agents.view, render: (w) => agents.renderFactoryAgents(S, speed(w), "live", w) },
  status: { path: "#/", view: now.view, render: (w) => now.view.render(full, {}, new URLSearchParams(`window=${w}`)) },
  all: { path: "#/jobs", view: jobs.view, render: (w) => jobs.renderJobs([], { window: w }) },
};
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

test("Jobs titles its day rows by the bucket of the window", () => {
  for (const w of WINDOWS) expect(PAGES.jobs.render(w)).toContain(`Median by ${BUCKET[w]}`);
});

test("live values on Agents say they are live", () => {
  expect(PAGES.agents.render("hour")).toContain("live, in use now");
  expect(PAGES.agents.render("hour")).toContain("live, not the window");
});
