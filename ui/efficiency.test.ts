import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { speed } from "./api/speed.ts";
// @ts-ignore plain JS shared with the page
import { renderEffCards, renderEfficiency, renderHours } from "./views/speed.js";

let base: string;
const saved: Record<string, string | undefined> = {};
const now = new Date(2026, 9, 28, 15, 0, 0);
let n = 0;
function run(job: string, r: Record<string, unknown>) {
  const dir = join(base, "jobs", `r${String(++n).padStart(3, "0")}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ job, name: `${job}-${n}`, told: true, ...r }));
}
const at = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
const span = (h: number, s: number) => ({ started: at(h), ended: new Date(Date.parse(at(h)) + s * 1000).toISOString() });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-eff-"));
  for (const [k, v] of Object.entries({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_UI_FETCH_TTL: "0" })) { saved[k] = process.env[k]; process.env[k] = v; }
  // g1 landed first try; g2 landed after two fix rounds; g3 landed first try; g4 is not landed
  run("g1", { kind: "agent", state: "passed", cost: 1, ...span(8, 600) });
  run("g1", { kind: "land", state: "landed", ...span(9, 30) });
  run("g2", { kind: "agent", state: "stuck", failed: "tests", cost: 2, ...span(8, 600) });
  run("g2", { kind: "agent", state: "stuck", failed: "review", round: 1, cost: 2, ...span(9, 600) });
  run("g2", { kind: "agent", state: "passed", round: 2, cost: 2, ...span(10, 600) });
  run("g2", { kind: "land", state: "landed", ...span(11, 30) });
  run("g3", { kind: "agent", state: "passed", cost: 3, ...span(8, 600) });
  run("g3", { kind: "land", state: "landed", ...span(12, 30) });
  run("g4", { kind: "agent", state: "stuck", failed: "tests", cost: 9, ...span(8, 600) });
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

test("goal stats: first-pass share, median fix rounds, cost per landed goal", () => {
  const g = speed("day", now).goals;
  expect(g).toEqual({ landed: 3, firstPass: 0.6667, fixRounds: 0, cost: 3.33 });
});

test("the efficiency cards say first pass, fix rounds, cost per goal, wasted and reruns", () => {
  const d = speed("day", now);
  const h = renderEfficiency(d);
  for (const k of ["Reruns", "First pass", "Fix rounds", "Cost per goal", "Wasted"]) expect(h).toContain(`<span class="k">${k}</span>`);
  expect(h.match(/class="med"/g)?.length).toBe(5);
  expect(h).toContain('<span class="v">67%</span><span class="quiet">landed goals with 0 fix rounds</span>');
  expect(h).toContain('<span class="v">0</span><span class="quiet">median per landed goal</span>');
  expect(h).toContain('<span class="v">$3.33</span>');
  expect(h).toContain("of agent hours on dropped or stuck runs");
});

test("with no landed goal the goal cards show a dash", () => {
  const h = renderEffCards({ window: "week", flaky: 0, wasted: 0, goals: { landed: 0, firstPass: null, fixRounds: null, cost: null } });
  expect(h.match(/<span class="v">–<\/span><span class="quiet">no goal landed<\/span>/g)?.length).toBe(3);
});

test("the agent-hours bar puts a label in a wide segment and under a thin one, in the same slot", () => {
  const ends = { passed: { hours: 8, cost: 10, count: 4 }, dropped: { hours: 1, cost: 1, count: 1 }, stuck: { hours: 1, cost: 2, count: 2 }, "needs-you": { hours: 0, cost: 0, count: 0 } };
  const h = renderHours({ ends, wasted: 0.2 });
  expect(h).toContain('<span class="in">Passed 8.0 h · $10.00 · 4 runs</span>');
  expect(h).not.toContain('<span class="in">Dropped');
  expect(h).toContain('<li style="flex:8"></li>');
  expect(h).toContain('<li style="flex:1"><span class="under">');
  expect(h.match(/<li /g)?.length).toBe(h.match(/style="flex:/g)!.length / 2);
});
