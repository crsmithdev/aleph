import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { agentStats, CLASSES, classify, clearCache, filed, pct, phases, routes, speed } from "./api/speed.ts";
// @ts-ignore plain JS shared with the page
import { agentsOption, barOption, dur, renderAgents, renderEfficiency, renderPhases, renderPicker, renderSpeedTop, windowOf, xLabel } from "./views/speed.js";

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
  for (const [k, v] of Object.entries({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_UI_FETCH_TTL: "0", ALEPH_ISSUES: join(base, "issues") })) { saved[k] = process.env[k]; process.env[k] = v; }
  // today: agents of 600 s (passed, tests 36), 1200 s (dropped), 1800 s (stuck, model unset), a 5 h broken clock
  run({ kind: "build", condition: "passed", model: "claude-opus-5-5", cost: 1, checks: [{ name: "tests", ok: true, seconds: 36 }, { name: "types", ok: true, seconds: 8 }], ...secs(0, 9, 600) });
  run({ kind: "build", condition: "dropped", model: "claude-opus-5-5", cost: 2, ...secs(0, 10, 1200) });
  run({ kind: "build", condition: "stuck", cost: 3, ...secs(0, 10, 1800) });
  run({ kind: "build", condition: "passed", cost: 9, ...secs(0, 1, 5 * 3600) });
  run({ kind: "land", condition: "landed", ...secs(0, 9, 40) });
  run({ kind: "land", condition: "landed", ...secs(0, 9, 46) }); // both without an issue: one key
  run({ kind: "land", condition: "failed", ...secs(0, 9, 100) });
  run({ kind: "triage", condition: "done", ...secs(0, 11, 20) });
  run({ kind: "build", condition: "running", started: at(0, 14) });
  // three days ago and 20 days ago
  run({ kind: "build", condition: "passed", model: "claude-sonnet-5-5", cost: 0.5, checks: [{ name: "tests", ok: true, seconds: 40 }], ...secs(3, 9, 300) });
  run({ kind: "plan", condition: "done", ...secs(20, 9, 90) });
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
  expect("ends" in d || "wasted" in d).toBe(false);
  expect(d.classes.every((c) => c.text.length > 0)).toBe(true);
  expect(d.window).toBe("day");
  expect(d.done).toBe(1); // two land runs with no issue count as one
  expect(d.buckets.length).toBe(24);
  const b = (h: string) => d.buckets.find((x) => x.label === h)!;
  expect(b("09:00")).toMatchObject({ implement: 600, intake: null });
  expect(b("10:00")).toMatchObject({ implement: null });
  expect(d.slowest.map((r) => [r.condition, r.took])).toEqual([["stuck", 1800], ["dropped", 1200], ["passed", 600]]);
  expect(d.slowest[0].model).toBe("unset");
  expect(d.slowest[2]).toMatchObject({ tests: 36, cost: 1 });
  expect(d.models).toEqual([{ model: "claude-opus-5-5", count: 2, p50: 600 }, { model: "unset", count: 1, p50: 1800 }]);
  expect(d.flaky).toBe(0);
});

test("done and issues.landed count landed issues, not land runs", () => {
  // 40 days back, so no other test's window sees these runs.
  const old = (h: number, m: number, extra: object) => run({ kind: "land", condition: "landed", ...extra, started: at(40, h, m), ended: at(40, h, m + 1) });
  old(9, 0, { repo: "zz", on: "zz-5" });
  old(9, 30, { repo: "zz", on: "zz-5" }); // the same issue lands again
  old(9, 45, { repo: "zz", on: "zz-6" });
  old(9, 50, {}); // no issue
  old(9, 55, {}); // no issue: one key with the one above
  const d = speed("day", new Date(2026, 8, 18, 15));
  expect(d.kinds.land.count).toBe(5);
  expect(d.done).toBe(3); // zz-5, zz-6 and the no-issue key
  expect(d.issues.landed).toBe(3);
});

test("hour: sixty 1-minute buckets over the last hour", () => {
  const h = speed("hour", new Date(2026, 9, 28, 9, 47, 0));
  expect(h.buckets.length).toBe(60);
  expect(h.buckets[0].label).toBe("08:48");
  expect(h.buckets[59].label).toBe("09:47");
  expect(h.kinds.agent.count).toBe(1); // the 09:00 run
  const m = speed("hour", new Date(2026, 9, 28, 9, 7, 0));
  expect(m.done).toBe(1);
});

test("week and month: one bucket per local day, wider windows add runs", () => {
  const w = speed("week", now);
  expect(w.buckets.length).toBe(7);
  expect(w.kinds.agent.count).toBe(4);
  expect(w.buckets[6].label).toBe("10-28");
  expect(w.buckets[3]).toMatchObject({ label: "10-25", implement: 300 });
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

test("the view: five phase cards; charts; efficiency with reruns and the wasted share", () => {
  const d = speed("day", now);
  const h = renderSpeedTop(d);
  for (const k of ["intake", "queue", "implement", "land", "lead"]) expect(h).toContain(`data-chart="${k}"`);
  expect(h).not.toContain("charts3");
  expect(h.match(/class="med"/g)?.length).toBe(5);
  const one = renderPhases({ phases: { intake: { count: 0, p50: 0, p90: 0 }, queue: { count: 0, p50: 0, p90: 0 }, lead: { count: 0, p50: 0, p90: 0 }, implement: { count: 3, p50: 1200, p90: 1800 }, land: { count: 1, p50: 43, p90: 43 } } });
  expect(one).toContain('<span class="k">Intake (0)</span><span class="v">– <small>p50</small></span><span class="p90">– <small>p90</small></span><div class="speedchart spark" data-chart="intake"');
  expect(one).toContain('<span class="k">Implement (3)</span><span class="v">20m 00s <small>p50</small></span><span class="p90">30m 00s <small>p90</small></span>');
  expect(one).toContain('<span class="k">Land (1)</span><span class="v">43s <small>p50</small></span><span class="p90">43s <small>p90</small></span>');
  for (const t of ["Tests check", "Flaky", "24–27 s", "Today", "7 days"]) expect(h).not.toContain(t);
  const e = renderEfficiency(d);
  expect(e).toContain("Reruns");
  for (const [w, step] of [["hour", "minute"], ["day", "hour"], ["week", "day"], ["month", "day"]] as const) expect(renderPhases({ ...d, window: w })).toContain(`Median implement time per ${step}`);
  expect(renderSpeedTop(null)).toContain("Loading performance");
  expect(renderSpeedTop(null)).toContain(">Performance</h2>");
  const o = barOption(d.buckets, "implement", { window: "day", color: "#000" });
  expect(o.series[0].type).toBe("bar");
  expect(o.series[0].data.length).toBe(24);
  expect(o.series[0].markLine.data).toEqual([]);
  expect(o.xAxis.axisLabel.interval(0)).toBe(true);
  expect(o.xAxis.axisLabel.interval(1)).toBe(false);
  expect(o.xAxis.axisLabel.interval(23)).toBe(true);
  const marked = barOption([{ at: at(0, 4), implement: 3100 }, { at: at(0, 13), implement: null }], "implement", { window: "day", color: "#000", p50: 60, lineColor: "#111" });
  expect(marked.series[0].markLine.data).toEqual([{ yAxis: 60 }]);
  expect(marked.series[0].markLine.lineStyle).toEqual({ type: "dotted", color: "#111", width: 1 });
  expect(marked.yAxis).toMatchObject({ show: false, min: 0, max: 3100 });
  expect(marked.xAxis.data).toEqual(["4a", "1p"]);
  // A p50 over the top bar would widen the axis: it has no line.
  expect(barOption([{ at: at(0, 4), implement: 90 }], "implement", { window: "day", color: "#000", p50: 300 }).series[0].markLine.data).toEqual([]);
  expect([xLabel(new Date(2026, 9, 28, 0).toISOString(), "day"), xLabel(new Date(2026, 9, 28, 12).toISOString(), "day"), xLabel(new Date(2026, 9, 28, 13, 36).toISOString(), "hour"), xLabel(new Date(2026, 9, 28).toISOString(), "week"), xLabel(new Date(2026, 9, 5).toISOString(), "month")]).toEqual(["12a", "12p", "1:36p", "10/28", "10/5"]);
  const shown = (w: string, n: number) => Array.from({ length: n }, (_, i) => i).filter((i) => barOption(Array.from({ length: n }, () => ({ at: at(0, 4) })), "implement", { window: w, color: "#000" }).xAxis.axisLabel.interval(i));
  expect(shown("week", 7)).toEqual([0, 2, 4, 6]);
  expect(shown("month", 30)).toEqual([1, 8, 15, 22, 29]);
  expect(shown("day", 24)).toEqual([0, 23]);
  expect(renderPicker("hour")).toMatch(/aria-pressed="true">Hour<[^]*aria-pressed="false">Day/);
  expect(windowOf(new URLSearchParams("window=day"))).toBe("day");
  expect(windowOf(new URLSearchParams("window=x"))).toBe("week");
  expect(dur(43)).toBe("43s");
  expect(dur(245)).toBe("4m 05s");
});

test("phases: implement spans a job's fix rounds, land starts at the last finish, and each counts where it ends", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (job: string, kind: string, state: string, a: string, b: string) => ({ kind, job, name: job, condition: state, started: a, ended: b }) as any;
  const since = new Date(2026, 9, 28, 5).getTime(), end = new Date(2026, 9, 28, 15).getTime();
  const none = { issue: new Map(), goal: new Map() };
  const p = phases([
    // A fix round: 1 hour from the first start to the last finish, then 10 minutes to the land, then a run after the land.
    r("a", "build", "stuck", t(6), t(6, 10)), r("a", "build", "passed", t(6, 30), t(7)), r("a", "land", "landed", t(7, 5), t(7, 10)), r("a", "build", "passed", t(8), t(8, 5)),
    // A held run that a land took 30 minutes later.
    r("b", "build", "awaiting", t(9), t(9, 20)), r("b", "land", "landed", t(9, 45), t(9, 50)),
    // Finished and not landed: implement only.
    r("c", "build", "passed", t(10), t(10, 40)),
    // Never finished: neither.
    r("d", "build", "dropped", t(10), t(10, 40)),
    // Finished before the window, landed in it: land only.
    r("e", "build", "passed", t(4), t(4, 30)), r("e", "land", "landed", t(5, 25), t(5, 30)),
  ], none, since, end);
  expect(p.implement).toEqual({ count: 3, p50: 2400, p90: 3600 }); // 3600 (a), 1200 (b), 2400 (c)
  expect(p.land).toEqual({ count: 3, p50: 1800, p90: 3600 }); // 600 (a), 1800 (b), 3600 (e)
});

test("filed: an issue's file is its filing; a part's file and a bulk commit's time do not count", () => {
  const store = join(base, "store");
  mkdirSync(join(store, "fx/backlog/tasks"), { recursive: true });
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", store, ...a], { stderr: "ignore", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  const add = (when: number, msg: string, ...ids: string[]) => {
    for (const id of ids) writeFileSync(join(store, `fx/backlog/tasks/fx-${id}.md`), id);
    git("add", ".");
    const stamp = `@${when} +0000`;
    Bun.spawnSync(["git", "-C", store, "commit", "-qm", msg], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } });
    git("update-ref", "refs/remotes/origin/main", "HEAD");
  };
  git("init", "-q");
  add(1000, "fx: add", "1", "2");
  add(1600, "fx: plan", "1.1");
  add(2100, "migrate: work model, 3 items", "3");
  const f = filed(store);
  expect([f.issue.get("fx-1"), f.issue.get("fx-2"), f.issue.get("fx-3"), f.issue.size]).toEqual([1000_000, 1000_000, null, 3]);
  // A new commit reads only what it adds.
  add(3000, "fx: add", "5");
  expect(filed(store).issue.get("fx-5")).toBe(3000_000);
});

test("classify: one run of each class, with its cause", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (job: string, todo: number, h: number, m: number, o: Record<string, unknown> = {}) =>
    ({ kind: "build", job, name: job, repo: "fx", on: `fx-${todo}`, condition: "passed", started: t(h, m), ended: t(h, m + 10), ...o }) as any;
  const runs = [
    // goal 1: a fix round and the landing run in job a, an earlier job z restarted, then a run after the land
    r("z", 1, 1, 0, { condition: "stuck", reason: "agent run z: stalled" }),
    r("a", 1, 2, 0, { condition: "failed", failed: "tests" }),
    r("a", 1, 3, 0),
    { kind: "land", job: "a", name: "a", repo: "fx", on: "fx-1", condition: "landed", started: t(3, 20), ended: t(3, 25) },
    r("b", 1, 5, 0),
    // goal 2: four starts in an hour, the 4th is a loop; they have no landing, the first three are not counted
    r("l1", 2, 6, 0), r("l2", 2, 6, 10), r("l3", 2, 6, 20), r("l4", 2, 6, 30),
    // goal 3 is dropped
    r("d", 3, 8, 0, { condition: "stuck", noCommit: true }),
    // goal 4 is open and unclassed
    r("o", 4, 9, 0),
  ];
  const status = (g: string) => (g === "fx-3" ? "dropped" : "open");
  const out = classify(runs, status, new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const by = (k: string) => out.classes.find((c) => c.key === k)!;
  expect(out.classes.map((c) => c.key)).toEqual([...CLASSES]);
  expect(by("landed").causes.map((c) => c.name)).toEqual(["After fix rounds"]);
  expect(by("fixed").causes.map((c) => c.name)).toEqual(["Checks failed"]);
  expect(by("restarted").causes.map((c) => c.name).sort()).toEqual(["Restart loop", "Stalled or timed out"]);
  expect(by("nothing").causes.map((c) => c.name)).toEqual(["Issue had landed"]);
  expect(by("dropped").causes.map((c) => c.name)).toEqual(["No commit"]);
  expect(by("dropped").top[0]).toMatchObject({ goal: "fx-3", href: "#/issues/fx/3" });
  for (const c of out.classes) {
    expect(c).toHaveProperty("week");
    for (const e of [...c.causes, ...c.top]) expect(e).not.toHaveProperty("week");
  }
  expect(out.notCounted).toEqual({ runs: 4, issues: 2, hours: round2(4 * 10 / 60) });
  expect(out.lost.hours).toBeCloseTo(Math.round(out.classes.slice(2).reduce((a, c) => a + c.hours, 0) * 100) / 100, 1);
  const d = speed("day", now);
  expect(d.classes.map((c) => c.key)).toEqual([...CLASSES]);
  expect(d.issues.week).toBeNull();
  expect(d.hasWeek).toBe(false);
});
const round2 = (n: number) => Math.round(n * 100) / 100;

test("classify: a reason over 140 characters ends at a word with an ellipsis; a short one is untouched", () => {
  const t = (h: number) => new Date(2026, 9, 28, h).toISOString();
  const long = "measure per file output of the slow suites before changing the runner so that every worker reports where its time goes " + "and ".repeat(20) + "end";
  const r = (job: string, n: number, reason: string) =>
    ({ kind: "build", job, name: job, repo: "fx", on: `fx-${n}`, condition: "stuck", noCommit: true, reason, started: t(1), ended: t(2) }) as any;
  const out = classify([r("p", 5, "agent run p: " + long), r("q", 6, "Main no")], () => "dropped", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const top = out.classes.find((c) => c.key === "dropped")!.top;
  const a = top.find((e) => e.goal === "fx-5")!.reason, b = top.find((e) => e.goal === "fx-6")!.reason;
  expect(long.length).toBeGreaterThan(140);
  expect(a.length).toBeLessThanOrEqual(140);
  expect(a.endsWith("…")).toBe(true);
  const body = a.slice(0, -1);
  expect(long.startsWith(body)).toBe(true);
  expect(long[body.length]).toBe(" ");
  expect(b).toBe("Main no");
});

test("a build run counts as an agent run", () => {
  const before = speed("week", now);
  run({ kind: "build", condition: "passed", model: "claude-opus-5-5", cost: 1, checks: [{ name: "tests", ok: true, seconds: 20 }], ...secs(1, 11, 7000) });
  const d = speed("week", now);
  expect(d.kinds.agent.count).toBe(before.kinds.agent.count + 1);
  expect(d.slowest[0]).toMatchObject({ condition: "passed", took: 7000, tests: 20 });
  expect(d.models.find((m) => m.model === "claude-opus-5-5")!.count).toBe(before.models.find((m) => m.model === "claude-opus-5-5")!.count + 1);
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (o: Record<string, unknown>) => ({ job: "b", name: "b", repo: "fx", on: "fx-1", condition: "passed", ...o }) as any;
  const out = classify([
    r({ kind: "build", condition: "failed", failed: "tests", started: t(2), ended: t(2, 10) }),
    r({ kind: "build", started: t(3), ended: t(3, 10) }),
    { kind: "land", job: "b", name: "b", repo: "fx", on: "fx-1", condition: "landed", started: t(3, 20), ended: t(3, 25) },
  ], () => "open", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  expect(out.classes.find((c) => c.key === "landed")!.causes.map((c) => c.name)).toEqual(["After fix rounds"]);
});

test("classify: a held run that later landed is landed, its earlier held rounds are fixed", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (o: Record<string, unknown>) => ({ kind: "build", job: "h", name: "h", repo: "fx", on: "fx-1", condition: "awaiting", reason: "held path package.json", ...o }) as any;
  const land = (job: string, state: string, h: number) => ({ kind: "land", job, name: job, repo: "fx", on: "fx-1", condition: state, started: t(h, 20), ended: t(h, 25) }) as any;
  const out = classify([
    r({ started: t(2), ended: t(2, 10) }),
    land("h", "failed", 2),
    r({ started: t(3), ended: t(3, 10) }),
    land("h", "landed", 3),
    // A run of another job that waits at the same time did not land.
    r({ job: "other", started: t(3, 1), ended: t(3, 5) }),
  ], () => "dropped", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const runs = (k: string) => out.classes.find((c) => c.key === k)!.runs;
  expect([runs("landed"), runs("fixed"), runs("dropped")]).toEqual([1, 1, 1]);
});

test("runs read their issue from on: a goal run counts under its issue, an issue run under its number", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const a = (job: string, o: Record<string, unknown>) => ({ kind: "build", job, name: job, repo: "ox", condition: "passed", cost: 1, started: t(1), ended: t(2), ...o }) as any;
  const runs = [
    a("p", { on: "ox-860" }), a("q", { on: "ox-860.1" }), a("r", { on: "ox-7" }),
  ];
  const seen: string[] = [];
  classify(runs, (g) => { seen.push(g); return "open"; }, new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  expect(new Set(seen)).toEqual(new Set(["ox-860", "ox-7"]));

  const land = (job: string, o: Record<string, unknown>) => ({ ...a(job, o), kind: "land", condition: "landed" });
  for (const r of [a("p", { on: "ox-860" }), a("q", { on: "ox-860.1" }), land("p", { on: "ox-860" }), land("q", { on: "ox-860.1" })]) run({ ...r, started: at(1, 9), ended: at(1, 10) });
  const fit = { pooled: 0.1, byModel: {} } as any;
  const w = speed("week", now, fit);
  expect(w.issues.week).toBe(0.2); // both runs under the one key ox-860
  run({ ...a("r", { on: "ox-7" }), started: at(1, 9), ended: at(1, 10) }); run({ ...land("r", { on: "ox-7" }), started: at(1, 9), ended: at(1, 10) });
  expect(speed("week", now, fit).issues.week).toBe(0.1); // ox-7 counts too: median of 0.2 and 0.1
});

test("phases: intake runs from the filing to the first triage end, queue from there to the first agent start, lead from the filing to the last land", () => {
  const r = (n: number, kind: string, state: string, a: number, b: number, repo = "fx") => ({ kind, job: `${repo}-${n}-${a}`, name: "x", repo, on: `${repo}-${n}`, condition: state, started: new Date(a).toISOString(), ended: new Date(b).toISOString() }) as any;
  const f = { issue: new Map<string, number | null>([["fx-1", 1000_000], ["fx-2", null], ["fx-3", 1000_000]]) };
  const p = phases([
    r(1, "triage", "done", 1000_000, 1060_000),
    r(1, "build", "stuck", 1660_000, 1700_000), r(1, "build", "passed", 1800_000, 1900_000),
    r(1, "land", "landed", 2000_000, 2100_000), r(1, "land", "landed", 3000_000, 4600_000),
    // fx-2 has a bulk filing: a queue from its triage, and no intake or lead. fx-3 has no triage: it queues from its filing.
    r(2, "triage", "done", 1000_000, 1060_000), r(2, "build", "passed", 1120_000, 1200_000), r(2, "land", "landed", 1300_000, 1400_000),
    r(3, "build", "passed", 1120_000, 1200_000), r(3, "land", "landed", 1300_000, 1400_000),
  ], f, 0, 9_999_000);
  expect(p.intake.count).toBe(1);
  expect(p.queue).toEqual({ count: 3, p50: 120, p90: 600 }); // fx-1 600, fx-2 60, fx-3 120
  expect(p.lead).toEqual({ count: 2, p50: 400, p90: 3600 }); // fx-1 3600, fx-3 400
  const later = phases([r(1, "build", "passed", 1660_000, 1700_000)], f, 2000_000, 9_999_000);
  expect(later.queue.count).toBe(0);
});

test("agents: each role's live, runs, hours and models, with a peak over all roles", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  const e = (kind: string, a: number, b: number | null, extra: object = {}) => ({ folder: `f${a}`, id: `f${a}`, run: { kind, condition: b === null ? "running" : "passed", started: iso(a), ...(b === null ? {} : { ended: iso(b) }), ...extra } }) as any;
  const runs = [
    e("build", 1, 3, { model: "sonnet", review: { call: "land" } }), e("build", 2, 4, { model: "sonnet" }), e("agent", 3, 3.5, { model: "haiku" }),
    e("build", 7, null), e("build", 6, null), e("build", 0, 9.5), // a live run, a lost one, and a broken clock
    e("triage", 2, 2.5, { model: "claude-opus-5-5" }), e("land", 1, 8), e("recheck", 1, 2),
  ];
  const a = agentStats(runs, 0, 8 * H, H, 2, (x) => x.folder === "f7");
  const r = Object.fromEntries(a.roles.map((x) => [x.key, x]));
  expect([a.live, a.workers, a.cap, a.peak]).toEqual([1, 1, 2, 3]); // 2-2.5: two workers and triage
  expect(r.worker).toMatchObject({ live: 1, runs: 6, hours: 5.5, p50: 7200, models: ["sonnet", "haiku"] });
  expect(r.triage).toMatchObject({ live: 0, runs: 1, hours: 0.5, models: ["opus"] });
  expect(r.reviewer).toMatchObject({ live: null, runs: 1, hours: null, p50: null });
  expect(a.roles.map((x) => x.key)).toEqual(["worker", "triage", "planner", "facts", "firefighter", "reviewer"]);
  expect(a.mean).toBe(0.8); // 6 agent hours over 8
  expect(a.points.map((p) => p.worker ?? 0)).toEqual([0, 1, 2, 1.5, 0, 0, 0, 1]);
  expect(a.points[2].triage).toBe(0.5);
  const o = agentsOption(a, { window: "day", colors: { worker: "#111", triage: "#222" }, muted: "#333" });
  expect(o.series.map((s: any) => s.name)).toEqual(["Worker", "Triage"]);
  expect(o.series[0].stack).toBe("live");
  const html = renderAgents({ window: "week", agents: a });
  expect(html).toContain("1 live · 1 of 2 worker slots");
  expect(html).toContain("sonnet, haiku");
});
