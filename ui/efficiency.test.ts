import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { speed } from "./api/speed.ts";
// @ts-ignore plain JS shared with the page
import { renderEffCards, renderEfficiency, renderBar, renderBreakdown, mountSpeed, resetSpeed } from "./views/speed.js";

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

test("goal stats: first-pass share, median fix rounds", () => {
  const g = speed("day", now).goals;
  expect(g).toEqual({ landed: 3, firstPass: 0.6667, fixRounds: 0, week: null });
  expect(g).not.toHaveProperty("cost");
});

test("the efficiency cards say reruns, first pass, fix rounds, week per goal and lost time", () => {
  const d = speed("day", now);
  const h = renderEfficiency(d);
  for (const k of ["Reruns", "First pass", "Fix rounds", "Week per goal", "Lost time"]) expect(h).toContain(`<span class="k">${k}</span>`);
  expect([...h.matchAll(/<span class="k">([^<]*)<\/span>/g)].map((m) => m[1])).toEqual(["Reruns", "First pass", "Fix rounds", "Week per goal", "Lost time"]);
  const cards = renderEffCards(d);
  for (const t of ["Cost per goal", "Wasted", "$"]) expect(cards).not.toContain(t);
  expect(h.match(/class="med"/g)?.length).toBe(5);
  expect(h).toContain('<span class="v">67%</span><span class="quiet">landed goals with 0 fix rounds</span>');
  expect(h).toContain('<span class="v">0</span><span class="quiet">median per landed goal</span>');
});

test("Week per goal and Lost time show their values and notes", () => {
  const base = { window: "week", flaky: 0, goals: { landed: 2, firstPass: 1, fixRounds: 0, week: 2.5 }, lost: { hours: 1.5, share: 0.25 } };
  const h = renderEffCards(base);
  expect(h).toContain('<span class="v">2.5%</span><span class="quiet">of the weekly limit, median per landed goal</span>');
  expect(h).toContain("1.5 h");
  expect(h).toContain("25% of agent hours on runs whose work did not reach main");
  const n = renderEffCards({ ...base, goals: { ...base.goals, week: null } });
  expect(n).toContain('<span class="v">–</span><span class="quiet">needs 6 hours of usage snapshots</span>');
});

test("with no landed goal the goal cards show a dash", () => {
  const h = renderEffCards({ window: "week", flaky: 0, wasted: 0, goals: { landed: 0, firstPass: null, fixRounds: null, week: null }, lost: { hours: 0, share: 0 } });
  expect(h.match(/<span class="v">–<\/span><span class="quiet">no goal landed<\/span>/g)?.length).toBe(3);
});

const C = (key: string, name: string, hours: number, week: number, text = `${name} text.`) => ({ key, name, text, hours, week, runs: 5, goals: 2, causes: [{ name: "First run of the job", hours, week, runs: 5 }], top: [] });
const classes = (h: number[], w: number[]) => [["landed", "Landed"], ["fixed", "Fixed in place"], ["nothing", "Nothing to do"], ["loop", "Loop"], ["restarted", "Restarted"], ["dropped", "Dropped"]].map(([k, n], i) => C(k, n, h[i], w[i]));
const D = { window: "week", notCounted: { runs: 11, goals: 4, hours: 0.4 } };

test("the agent-time bar: sentence, brackets, segments, narrow line, not counted", () => {
  const d = { ...D, classes: classes([60, 10, 20, 1, 24, 1], [3, 0.5, 1, 0.1, 1.2, 0.1]) };
  const h = renderBar(d);
  const bar = h.slice(h.indexOf('class="abar"'), h.indexOf("</div>", h.indexOf('class="abar"')));
  for (const n of ["Landed", "Fixed in place", "Nothing to do", "Loop", "Restarted", "Dropped"]) expect(bar.split(`>${n}<`).length - 1).toBeLessThanOrEqual(1);
  expect(h).toContain("<b>46 h</b> of 116 h (40%) of agent time in the last 7 days went to runs whose work did not reach main.");
  const br = h.slice(h.indexOf('class="brackets"'), h.indexOf("</div>", h.indexOf('class="brackets"')));
  expect(br).toContain("Reached main");
  expect(br).toContain("Did not reach main");
  expect(br.replace(/style="[^"]*"/g, "")).not.toMatch(/\d/);
  expect([...bar.matchAll(/data-class="(\w+)"/g)].map((m) => m[1])).toEqual(["landed", "fixed", "nothing", "loop", "restarted", "dropped"]);
  expect(bar).toContain('title="Landed text.\nFirst run of the job: 60 h · 5 runs"');
  expect(h).not.toContain("undefined");
  const nar = h.slice(h.indexOf('class="narrow"'), h.indexOf("</ul>"));
  for (const n of ["Fixed in place", "Loop", "Dropped"]) expect(nar).toContain(` ${n} <b>`);
  for (const n of ["Landed", "Nothing to do", "Restarted"]) expect(nar).not.toContain(` ${n} <b>`);
  expect(h).toContain("Not counted: 11 runs of 4 open goals, 0.4 h");
  expect(renderBar({ ...d, classes: classes([0, 0, 0, 0, 0, 0], [0, 0, 0, 0, 0, 0]) })).toContain("No agent run of a goal ended in this period.");
});

test("the flex values are shares of the total, also under 1 h", () => {
  const h = renderBar({ ...D, classes: classes([0.3, 0.1, 0.05, 0.02, 0.1, 0.03], [0, 0, 0, 0, 0, 0]) });
  const bar = h.slice(h.indexOf('class="abar"'), h.indexOf("</div>", h.indexOf('class="abar"')));
  const flex = [...bar.matchAll(/style="flex:([\d.e-]+)"/g)].map((m) => Number(m[1]));
  expect(flex.length).toBe(6);
  expect(Math.abs(flex.reduce((a, b) => a + b, 0) - 1)).toBeLessThan(0.001);
});

const withTop = () => {
  const cs = classes([60, 10, 20, 1, 24, 1], [3, 0.5, 1, 0.1, 1.2, 0.1]);
  cs[4].causes = [{ name: "Land conflict", hours: 20, week: 1, runs: 3 }, { name: "Other", hours: 4, week: 0.2, runs: 1 }];
  (cs[4] as any).top = [{ goal: "fx-7", href: "#/issues/fx/7", reason: "merge conflict in ui/x.ts", hours: 20, week: 1, runs: 3 }];
  return { ...D, hasWeek: true, classes: cs };
};

test("the breakdown under the bar, the hours view, the pin", () => {
  const d = withTop();
  const h = renderEfficiency(d);
  for (const t of ['class="brk" data-class="restarted"', "By cause", "Goals that took the most", 'href="#/issues/fx/7"', "merge conflict in ui/x.ts"]) expect(h).toContain(t);
  expect(renderEfficiency(d, { pinned: "loop" })).toContain('class="brk" data-class="loop"');
  expect(h).not.toContain("data-measure");
  expect(h.slice(h.indexOf('class="brk"'))).toContain("1.2% of week · 5 runs"); // the week share, as the quiet part of the heading
  expect(renderEfficiency({ ...d, hasWeek: false })).not.toContain("of week ·");
  expect(renderBreakdown(d, null)).toBe("");
});

test("mountSpeed: a click on a segment re-renders the efficiency section", async () => {
  resetSpeed();
  const d = { ...withTop(), window: "week", kinds: Object.fromEntries(["agent","land","triage","plan"].map((k) => [k, { count: 0, p50: null, p90: null }])), checks: [], buckets: [], done: 1, flaky: 0, goals: { landed: 1, firstPass: 1, fixRounds: 0, week: 1 }, lost: { hours: 1, share: 0.1 } };
  const mk = () => ({ innerHTML: "", dataset: {} as Record<string, string>, isConnected: true, handler: null as any, addEventListener(_: string, f: any) { this.handler = f; }, querySelector: () => null, querySelectorAll: () => [] });
  const top = mk(), eff = mk();
  const root = { querySelector: (s: string) => (s === "#speed" ? top : s === "#efficiency" ? eff : null) };
  await mountSpeed(root, async () => ({ ok: true, json: async () => d }));
  eff.handler({ target: { closest: (s: string) => (s.includes("abar") ? { dataset: { class: "loop" } } : null) } });
  expect(eff.innerHTML).toContain('class="brk" data-class="loop"');
  resetSpeed();
});

test("renderEfficiency wraps the bar and the detail in one .effbody after the cards; loading has none", () => {
  const d = withTop();
  const h = renderEfficiency(d);
  expect(h.match(/class="effbody"/g)?.length).toBe(1);
  const at = h.indexOf('class="effbody"');
  expect(at).toBeGreaterThan(h.lastIndexOf('class="med"'));
  const body = h.slice(at);
  expect(body).toContain('class="abar"');
  expect(body).toContain('class="brk"');
  expect(body.indexOf('class="effbar"')).toBeGreaterThanOrEqual(0);
  expect(body.indexOf('class="effbar"')).toBeLessThan(body.indexOf('class="brk"'));
  expect(renderEfficiency(null)).not.toContain("effbody");
});

test("Efficiency at 1600px and wider: the bar spans the column, the detail sits below it", async () => {
  const css = await Bun.file(new URL("./index.html", import.meta.url)).text();
  expect(css).not.toContain(".effbody { display: grid");
});
