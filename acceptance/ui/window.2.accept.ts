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

const WINDOWS = ["hour", "day", "week", "month"] as const; // week is the API default

const P = (n: number) => ({ count: n, p50: 60, p90: 120, hist: [0, 1, 0, 0, 0, 0, 0], worst: 300 });
const speed = (window: string): any => ({
  window, flaky: 1, lost: { hours: 1, share: 0.1 }, notCounted: { runs: 0, hours: 0 },
  issues: { landed: 1, firstPass: 0.5, fixRounds: 0, week: null, usage: [] }, classes: [],
  phases: { lead: P(1), intake: P(1), queue: P(1), implement: P(1), land: P(1) }, buckets: [{ at: new Date(2026, 9, 28).toISOString(), lead: 1 }],
  checks: [], models: [], agents: { live: 0, workers: 0, cap: 5, mean: 1, peak: 2, roles: [], points: [{ at: new Date(2026, 9, 28).toISOString() }] },
});

const g: any = globalThis;
let store: Map<string, string> | null;
beforeEach(() => {
  store = new Map();
  g.localStorage = { getItem: (k: string) => store!.get(k) ?? null, setItem: (k: string, v: string) => void store!.set(k, v) };
  g.location = { hash: "" };
  g.history = { replaceState: (_a: unknown, _b: unknown, url: string) => { g.location.hash = url; } };
});
afterEach(() => { delete g.localStorage; delete g.location; delete g.history; });

test("the trend against the last 24 hours shows only for week and month", () => {
  for (const w of WINDOWS) {
    const on = w === "week" || w === "month";
    for (const h of [fjobs.renderFactoryJobs(speed(w), speed("day"))])
      expect(/in the last 24 h\b/.test(h), w).toBe(on);
    expect(/vs 30-day average/.test(eff.renderEfficiency(speed(w))), w).toBe(false);
    expect(/in the last 24 h\b/.test(eff.renderEfficiency(speed(w))), w).toBe(false);
  }
});

test("without storage the pages render and use the address, else week", () => {
  g.localStorage = { getItem: () => { throw new Error("denied"); }, setItem: () => { throw new Error("denied"); } };
  storeWindow("day");
  expect(windowOf(new URLSearchParams())).toBe("week");
  expect(windowOf(new URLSearchParams("window=day"))).toBe("day");
  delete g.localStorage;
  expect(windowOf(new URLSearchParams())).toBe("week");
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
