import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLASSES, classify, clearCache, pct, routes, speed } from "./api/speed.ts";
// @ts-ignore plain JS shared with the page
import { areaOption, dur, renderCharts, renderEfficiency, renderPicker, renderSpeedTop, windowOf } from "./views/speed.js";

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

test("day: counts, medians, wasted share, buckets, slowest, models", () => {
  const d = speed("day", now);
  expect(d.kinds.agent).toEqual({ count: 3, p50: 1200, p90: 1800 }); // the 5 h run and the running one are out
  expect(d.kinds.land).toEqual({ count: 3, p50: 46, p90: 100 });
  expect(d.kinds.triage.count).toBe(1);
  expect(d.kinds.plan.count).toBe(0);
  expect(d.checks).toEqual([{ name: "tests", count: 1, p50: 36, p90: 36 }, { name: "types", count: 1, p50: 8, p90: 8 }]);
  expect(d.ends.passed).toEqual({ hours: round(600 / 3600), cost: 1, count: 1 });
  expect(d.ends.dropped.count + d.ends.stuck.count).toBe(2);
  expect(d.ends["needs-you"].count).toBe(0);
  expect(d.wasted).toBeCloseTo(3000 / 3600, 3);
  expect(d.window).toBe("day");
  expect(d.done).toBe(2);
  expect(d.buckets.length).toBe(24);
  const b = (h: string) => d.buckets.find((x) => x.label === h)!;
  expect(b("09:00")).toMatchObject({ agent: 600, tests: 36, lands: 2 });
  expect(b("10:00")).toMatchObject({ agent: 1200, tests: null, lands: 0 });
  expect(d.slowest.map((r) => [r.state, r.took])).toEqual([["stuck", 1800], ["dropped", 1200], ["passed", 600]]);
  expect(d.slowest[0].model).toBe("unset");
  expect(d.slowest[2]).toMatchObject({ tests: 36, cost: 1 });
  expect(d.models).toEqual([{ model: "claude-opus-5-5", count: 2, p50: 600 }, { model: "unset", count: 1, p50: 1800 }]);
  expect(d.flaky).toBe(0);
});

test("hour: sixty 1-minute buckets over the last hour", () => {
  const h = speed("hour", new Date(2026, 9, 28, 9, 47, 0));
  expect(h.buckets.length).toBe(60);
  expect(h.buckets[0].label).toBe("08:48");
  expect(h.buckets[59].label).toBe("09:47");
  expect(h.kinds.agent.count).toBe(1); // the 09:00 run
  const m = speed("hour", new Date(2026, 9, 28, 9, 7, 0));
  expect(m.buckets.find((x) => x.label === "09:00")).toMatchObject({ lands: 2 });
  expect(m.done).toBe(2);
});

test("week and month: one bucket per local day, wider windows add runs", () => {
  const w = speed("week", now);
  expect(w.buckets.length).toBe(7);
  expect(w.kinds.agent.count).toBe(4);
  expect(w.buckets[6]).toMatchObject({ label: "10-28", lands: 2 });
  expect(w.buckets[3]).toMatchObject({ label: "10-25", agent: 300, tests: 40 });
  expect(w.models.map((m) => m.model)).toContain("claude-sonnet-5-5");
  const m = speed("month", now);
  expect(m.buckets.length).toBe(30);
  expect(m.kinds.plan.count).toBe(1);
});

test("GET /api/speed takes a window (default week) and answers JSON", async () => {
  clearCache();
  const get = async (q: string) => routes["GET /api/speed"](new Request(`http://x/api/speed${q}`), {}, new URL(`http://x/api/speed${q}`));
  expect((await (await get("?window=month")).json()).window).toBe("month");
  expect((await (await get("")).json()).window).toBe("week");
  expect((await get("?window=year")).status).toBe(400);
});

test("the view: medians with p50, p90 and runs; charts; efficiency with reruns and the wasted share", () => {
  const d = speed("day", now);
  const h = renderSpeedTop(d);
  expect(h).toContain('data-chart="lands"');
  expect(h.indexOf('class="meds"')).toBeLessThan(h.indexOf('class="charts3"'));
  expect(h.match(/class="med"/g)?.length).toBe(5);
  expect(h).toContain("p90 30m 00s");
  expect(h).toContain('<span class="runs">3</span>');
  for (const t of ["Build", "Land", "Triage", "Plan", "Test"]) expect(h).toContain(`<span class="k">${t}</span>`);
  for (const t of ["Tests", "Agent"]) expect(h).not.toContain(`<span class="k">${t}</span>`);
  expect(h).toContain('<span class="pp"><span class="v">20m 00s</span><span class="p90">p90 30m 00s</span></span>');
  for (const t of ["Tests check", "Flaky", "24–27 s", "Today", "7 days"]) expect(h).not.toContain(t);
  const e = renderEfficiency(d);
  expect(e).toContain("Reruns");
  expect(e).toContain("<b>83%</b> of 1.0 agent hours went to dropped or stuck runs");
  expect(e.indexOf("went to")).toBeLessThan(e.indexOf('class="hbar"'));
  expect(e).toContain('class="hlegend"');
  for (const [w, step] of [["hour", "minute"], ["day", "hour"], ["week", "day"], ["month", "day"]] as const) {
    const c = renderCharts({ ...d, window: w });
    expect(c).toContain(`Build run time by ${step} (median)`);
    expect(c).toContain(`Test time by ${step} (median)`);
    expect(c).toContain(`Lands by ${step}<`);
  }
  expect(renderSpeedTop(null)).toContain("Loading");
  const o = areaOption(d.buckets, "agent", { color: "#000" });
  expect(o.series[0].areaStyle).toBeDefined();
  expect(o.series[0].data.length).toBe(24);
  expect(renderPicker("hour")).toMatch(/aria-pressed="true">Hour<[^]*aria-pressed="false">Day/);
  expect(windowOf(new URLSearchParams("window=day"))).toBe("day");
  expect(windowOf(new URLSearchParams("window=x"))).toBe("week");
  expect(dur(43)).toBe("43s");
  expect(dur(245)).toBe("4m 05s");
});
const round = (x: number) => Math.round(x * 100) / 100;

test("classify: one run of each class, with its cause", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (job: string, todo: number, h: number, m: number, o: Record<string, unknown> = {}) =>
    ({ kind: "agent", job, name: job, repo: "fx", todo, state: "passed", started: t(h, m), ended: t(h, m + 10), ...o }) as any;
  const runs = [
    // goal 1: a fix round and the landing run in job a, an earlier job z restarted, then a run after the land
    r("z", 1, 1, 0, { state: "stuck", reason: "agent run z: stalled" }),
    r("a", 1, 2, 0, { state: "failed", failed: "tests" }),
    r("a", 1, 3, 0),
    { kind: "land", job: "a", name: "a", repo: "fx", todo: 1, state: "landed", started: t(3, 20), ended: t(3, 25) },
    r("b", 1, 5, 0),
    // goal 2: four starts in an hour, the 4th is a loop; they have no landing, the first three are not counted
    r("l1", 2, 6, 0), r("l2", 2, 6, 10), r("l3", 2, 6, 20), r("l4", 2, 6, 30),
    // goal 3 is dropped
    r("d", 3, 8, 0, { state: "stuck", noCommit: true }),
    // goal 4 is open and unclassed
    r("o", 4, 9, 0),
  ];
  const status = (g: string) => (g === "fx-3" ? "dropped" : "open");
  const out = classify(runs, status, new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const by = (k: string) => out.classes.find((c) => c.key === k)!;
  expect(out.classes.map((c) => c.key)).toEqual([...CLASSES]);
  expect(by("landed").causes.map((c) => c.name)).toEqual(["After fix rounds"]);
  expect(by("fixed").causes.map((c) => c.name)).toEqual(["Checks failed"]);
  expect(by("restarted").causes.map((c) => c.name)).toEqual(["Stalled or timed out"]);
  expect(by("nothing").causes.map((c) => c.name)).toEqual(["Goal had landed"]);
  expect(by("loop").causes.map((c) => c.name)).toEqual(["4–9 starts in an hour"]);
  expect(by("dropped").causes.map((c) => c.name)).toEqual(["No commit"]);
  expect(by("dropped").top[0]).toMatchObject({ goal: "fx-3", href: "#/issues/fx/3" });
  expect(out.notCounted).toEqual({ runs: 4, goals: 2, hours: round2(4 * 10 / 60) });
  expect(out.lost.hours).toBeCloseTo(Math.round(out.classes.slice(2).reduce((a, c) => a + c.hours, 0) * 100) / 100, 1);
  const d = speed("day", now);
  expect(d.classes.map((c) => c.key)).toEqual([...CLASSES]);
  expect(d.goals.week).toBeNull();
  expect(d.hasWeek).toBe(false);
});
const round2 = (n: number) => Math.round(n * 100) / 100;
