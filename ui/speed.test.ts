import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { clearCache, pct, routes, speed } from "./api/speed.ts";
// @ts-ignore plain JS shared with the page
import { dur, renderMedianCard, renderSpeed, renderSpeedBody } from "./views/speed.js";

let base: string;
const saved: Record<string, string | undefined> = {};
const now = new Date(2026, 9, 28, 15, 0, 0);
const at = (daysAgo: number, h: number, m = 0) => new Date(2026, 9, 28 - daysAgo, h, m).toISOString();
let n = 0;
function run(r: Record<string, unknown>) {
  const dir = join(base, "jobs", `r${String(++n).padStart(3, "0")}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ job: `j${n}`, name: `j${n}`, told: true, ...r }));
}
const secs = (daysAgo: number, h: number, s: number) => ({ started: at(daysAgo, h), ended: new Date(Date.parse(at(daysAgo, h)) + s * 1000).toISOString() });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-speed-"));
  for (const [k, v] of Object.entries({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_UI_FETCH_TTL: "0" })) { saved[k] = process.env[k]; process.env[k] = v; }
  // today: agents of 600 s (passed, tests 36), 1200 s (dropped), 1800 s (stuck, model unset), a 5 h broken clock
  run({ kind: "agent", state: "passed", model: "claude-opus-5-5", cost: 1, checks: [{ name: "tests", ok: true, seconds: 36 }, { name: "types", ok: true, seconds: 8 }], ...secs(0, 9, 600) });
  run({ kind: "agent", state: "dropped", model: "claude-opus-5-5", cost: 2, ...secs(0, 10, 1200) });
  run({ kind: "agent", state: "stuck", cost: 3, ...secs(0, 10, 1800) });
  run({ kind: "agent", state: "passed", cost: 9, ...secs(0, 1, 5 * 3600) });
  run({ kind: "land", state: "landed", ...secs(0, 9, 40) });
  run({ kind: "land", state: "landed", ...secs(0, 9, 46) });
  run({ kind: "land", state: "failed", ...secs(0, 9, 100) });
  run({ kind: "triage", state: "done", ...secs(0, 11, 20) });
  run({ kind: "agent", state: "running", started: at(0, 14) });
  // three days ago and 20 days ago
  run({ kind: "agent", state: "passed", model: "claude-sonnet-5-5", cost: 0.5, checks: [{ name: "tests", ok: true, seconds: 40 }], ...secs(3, 9, 300) });
  run({ kind: "plan", state: "done", ...secs(20, 9, 90) });
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

test("percentiles are nearest rank", () => {
  expect(pct([], 0.5)).toBe(0);
  expect([pct([1, 2, 3, 4], 0.5), pct([1, 2, 3, 4], 0.9), pct([5], 0.9)]).toEqual([2, 4, 5]);
});

test("today: counts, medians, wasted share, buckets, slowest, models", () => {
  const d = speed(1, now);
  expect(d.kinds.agent).toEqual({ count: 3, p50: 1200, p90: 1800 }); // the 5 h run and the running one are out
  expect(d.kinds.land).toEqual({ count: 3, p50: 46, p90: 100 });
  expect(d.kinds.triage.count).toBe(1);
  expect(d.kinds.plan.count).toBe(0);
  expect(d.checks).toEqual([{ name: "tests", count: 1, p50: 36, p90: 36 }, { name: "types", count: 1, p50: 8, p90: 8 }]);
  expect(d.ends.passed).toEqual({ hours: round(600 / 3600), cost: 1, count: 1 });
  expect(d.ends.dropped.count + d.ends.stuck.count).toBe(2);
  expect(d.ends["needs-you"].count).toBe(0);
  expect(d.wasted).toBeCloseTo(3000 / 3600, 3);
  expect(d.buckets.length).toBe(24);
  expect(d.buckets[9]).toMatchObject({ label: "09:00", agent: 600, tests: 36, lands: 2 });
  expect(d.buckets[10]).toMatchObject({ agent: 1200, tests: null, lands: 0 });
  expect(d.slowest.map((r) => [r.state, r.took])).toEqual([["stuck", 1800], ["dropped", 1200], ["passed", 600]]);
  expect(d.slowest[0].model).toBe("unset");
  expect(d.slowest[2]).toMatchObject({ tests: 36, cost: 1 });
  expect(d.models).toEqual([{ model: "claude-opus-5-5", count: 2, p50: 600 }, { model: "unset", count: 1, p50: 1800 }]);
  expect(d.flaky).toBe(0);
});

test("7 and 30 days: one bucket per local day, wider windows add runs", () => {
  const w = speed(7, now);
  expect(w.buckets.length).toBe(7);
  expect(w.kinds.agent.count).toBe(4);
  expect(w.buckets[6]).toMatchObject({ label: "10-28", lands: 2 });
  expect(w.buckets[3]).toMatchObject({ label: "10-25", agent: 300, tests: 40 });
  expect(w.models.map((m) => m.model)).toContain("claude-sonnet-5-5");
  const m = speed(30, now);
  expect(m.buckets.length).toBe(30);
  expect(m.kinds.plan.count).toBe(1);
});

test("GET /api/speed validates days and answers JSON", async () => {
  clearCache();
  const res = await routes["GET /api/speed"](new Request("http://x/api/speed?days=7"), {}, new URL("http://x/api/speed?days=7"));
  expect((await res.json()).days).toBe(7);
  const bad = await routes["GET /api/speed"](new Request("http://x/api/speed?days=3"), {}, new URL("http://x/api/speed?days=3"));
  expect(bad.status).toBe(400);
});

test("the view: median card, section parts and empty states", () => {
  const d = speed(7, now);
  const card = renderMedianCard(d);
  expect(card).toContain("Median run");
  expect(card).toMatch(/land 46s · tests 36s · 77% wasted/);
  expect(renderMedianCard(null)).toContain("no runs yet");
  const h = renderSpeed(speed(1, now), 1);
  for (const t of ["Speed", "Today", "7 days", "30 days", "24–27 s alone", "Where the agent hours went", "Slowest agent runs", "Agent runs by model", "unset", 'data-chart="lands"', "of the agent hours were wasted", 'href="#/jobs/j']) expect(h).toContain(t);
  expect(renderSpeedBody(null, 7)).toContain("Loading");
  expect(dur(43)).toBe("43s");
  expect(dur(245)).toBe("4m 05s");
});
const round = (x: number) => Math.round(x * 100) / 100;
