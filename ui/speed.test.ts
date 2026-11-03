import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv } from "./test-server.ts";
import { activeEnd, agentStats, CLASSES, classify, clearCache, filed, pct, phases, routes, speed } from "./api/speed.ts";
// @ts-ignore plain JS shared with the page
import { durShort, weekText, xLabel } from "./views/speed.js";
// @ts-ignore plain JS shared with the page
import { dur } from "./lib.js";

let base: string;
let restore: () => void;
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
  restore = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_UI_FETCH_TTL: "0", ALEPH_ISSUES: join(base, "issues") });
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
  restore();
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
  expect((await (await get("?window=week")).json()).baseline).toBeUndefined();
  const b = await (await get("?window=week&baseline=1")).json();
  expect(b.window).toBe("week");
  expect(Object.keys(b.baseline).sort()).toEqual(["base", "basis", "prev"]);
  expect(Object.keys(b.baseline.prev)).toContain("queueP90");
  // The Efficiency page reads the day and month answers: Status's one request fills them.
  expect(Object.keys(b.others).sort()).toEqual(["day", "month"]);
  expect(b.others.month.window).toBe("month");
  const m = await (await get("?window=month&baseline=1")).json();
  expect(Object.keys(m.others)).toEqual(["day"]);
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
  expect(p.implement).toMatchObject({ count: 3, p50: 2400, p90: 3600 }); // 3600 (a), 1200 (b), 2400 (c)
  expect(p.land).toMatchObject({ count: 3, p50: 1800, p90: 3600 }); // 600 (a), 1800 (b), 3600 (e)
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

test("classify: a drop's fate, not its prose, sets the nothing class and the Needed Chris cause", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (todo: number, o: Record<string, unknown>) =>
    ({ kind: "build", job: `j${todo}`, name: `j${todo}`, repo: "fx", on: `fx-${todo}`, condition: "stuck", started: t(todo), ended: t(todo, 10), ...o }) as any;
  const runs = [
    r(1, { fate: "already-met", reason: "agent run j1: stopped" }),
    r(2, { fate: "duplicate" }),
    // No fate: the prose says duplicate or already met, but the run is a plain drop.
    r(3, { reason: "found it already met" }),
    r(4, { reason: "duplicate of 2" }),
    r(5, { fate: "by-hand" }),
    // No fate: the prose says by hand or aleph drop, but it has no Needed Chris cause.
    r(6, { reason: "dropped by hand" }),
    r(7, { reason: "aleph drop" }),
  ];
  const out = classify(runs, () => "dropped", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const by = (k: string) => out.classes.find((c) => c.key === k)!;
  expect(by("nothing").runs).toBe(2);
  expect(by("nothing").causes.map((c) => c.name)).toEqual(["Work on main from another issue"]);
  expect(by("dropped").runs).toBe(5);
  expect(by("dropped").causes.map((c) => c.name).sort()).toEqual(["Needed Chris", "Other"]);
  expect(by("dropped").causes.find((c) => c.name === "Needed Chris")!.runs).toBe(1);
});

test("runs read their issue from on: a part counts under its own ref, an issue run under its number", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const a = (job: string, o: Record<string, unknown>) => ({ kind: "build", job, name: job, repo: "ox", condition: "passed", cost: 1, started: t(1), ended: t(2), ...o }) as any;
  const runs = [
    a("p", { on: "ox-860" }), a("q", { on: "ox-860.1" }), a("r", { on: "ox-7" }),
  ];
  const seen: string[] = [];
  classify(runs, (g) => { seen.push(g); return "open"; }, new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  expect(new Set(seen)).toEqual(new Set(["ox-860", "ox-860.1", "ox-7"]));

  const land = (job: string, o: Record<string, unknown>) => ({ ...a(job, o), kind: "land", condition: "landed" });
  for (const r of [a("p", { on: "ox-860" }), a("q", { on: "ox-860.1" }), land("p", { on: "ox-860" }), land("q", { on: "ox-860.1" })]) run({ ...r, started: at(1, 9), ended: at(1, 10) });
  const fit = { pooled: 0.1, byModel: {} } as any;
  const w = speed("week", now, fit);
  expect(w.issues.week).toBe(0.2); // both runs under the one key ox-860
  expect(w.issues.usage).toEqual([{ goal: "ox-860", href: "#/issues/ox/860", week: 0.2, runs: 2 }]);
  expect(speed("week", now).issues.usage).toEqual([]);
  run({ ...a("r", { on: "ox-7" }), started: at(1, 9), ended: at(1, 10) }); run({ ...land("r", { on: "ox-7" }), started: at(1, 9), ended: at(1, 10) });
  const w2 = speed("week", now, fit);
  expect(w2.issues.week).toBe(0.1); // ox-7 counts too: median of 0.2 and 0.1
  expect(w2.issues.usage).toEqual([{ goal: "ox-860", href: "#/issues/ox/860", week: 0.2, runs: 2 }, { goal: "ox-7", href: "#/issues/ox/7", week: 0.1, runs: 1 }]);
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
  expect(p.queue).toMatchObject({ count: 3, p50: 120, p90: 600 }); // fx-1 600, fx-2 60, fx-3 120
  expect(p.lead).toMatchObject({ count: 2, p50: 400, p90: 3600 }); // fx-1 3600, fx-3 400
  const later = phases([r(1, "build", "passed", 1660_000, 1700_000)], f, 2000_000, 9_999_000);
  expect(later.queue.count).toBe(0);
});

test("agents: each role's live, runs, hours and models, with a peak over all roles", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  const e = (kind: string, a: number, b: number | null, extra: object = {}) => ({ folder: `f${a}`, id: `f${a}`, run: { kind, condition: b === null ? "running" : "passed", started: iso(a), ...(b === null ? {} : { ended: iso(b) }), ...extra } }) as any;
  const runs = [
    e("build", 1, 3, { model: "sonnet", review: { call: "land" } }), e("build", 2, 4, { model: "sonnet" }), e("agent", 3, 3.5, { model: "haiku" }),
    e("build", 7, null), e("build", 6, null), e("build", 0, 9.5), // a live run, a lost one, and a broken clock
    e("triage", 2, 2.5, { model: "claude-opus-5-5" }), e("explain", 4, 5, { model: "claude-opus-5-5" }), e("land", 1, 8), e("recheck", 1, 2),
    e("build", 5, 6, { model: "sonnet" }),
  ];
  const a = agentStats(runs, 0, 8 * H, H, 2, (x) => x.folder === "f7");
  const r = Object.fromEntries(a.roles.map((x) => [x.key, x]));
  expect([a.live, a.workers, a.cap, a.peak]).toEqual([1, 1, 2, 3]); // 2-2.5: two workers and triage
  expect(r.worker).toMatchObject({ live: 1, runs: 7, hours: 6.5, p50: 3600, models: ["sonnet", "haiku"] });
  expect(r.triage).toMatchObject({ live: 0, runs: 1, hours: 0.5, models: ["opus"] });
  expect(r.explainer).toMatchObject({ live: 0, runs: 1, hours: 1, models: ["opus"] });
  expect(r.reviewer).toMatchObject({ live: null, runs: 1, hours: null, p50: null });
  expect(a.roles.map((x) => x.key)).toEqual(["worker", "triage", "planner", "facts", "firefighter", "explainer", "reviewer"]);
  expect(a.mean).toBe(1); // 8 agent hours over 8
  expect(a.points.map((p) => p.worker ?? 0)).toEqual([0, 1, 2, 1.5, 0, 1, 0, 1]);
  expect(a.points[2].triage).toBe(0.5);
});

test("an unlanded run of an issue that left the store is Dropped", () => {
  const t = (h: number) => new Date(2026, 9, 28, h).toISOString();
  const r = { job: "g", name: "g", repo: "fx", on: "fx-659", condition: "stuck", kind: "build", started: t(8), ended: t(9) } as any;
  const since = new Date(2026, 9, 27).getTime(), at = new Date(2026, 9, 28, 15).getTime();
  expect(classify([r], () => "gone", since, at, null).classes.find((c) => c.key === "dropped")!.runs).toBe(1);
  expect(classify([r], () => undefined, since, at, null).notCounted.runs).toBe(1);
});

test("phases: hist has 7 bins, an edge falls in the upper bin, counts sum to count, worst is the longest", () => {
  const t = (h: number, m = 0, s = 0) => new Date(2026, 9, 28, h, m, s).toISOString();
  const r = (job: string, a: string, b: string) => ({ kind: "build", job, name: job, condition: "passed", started: a, ended: b }) as any;
  const since = new Date(2026, 9, 28, 0).getTime(), end = new Date(2026, 9, 28, 23).getTime();
  // implement times: 30s, 60s (edge), 299s, 15m (edge), 45m, 2h, 3h
  const runs = [r("a", t(1), t(1, 0, 30)), r("b", t(1), t(1, 1)), r("c", t(1), t(1, 4, 59)), r("d", t(1), t(1, 15)), r("e", t(1), t(1, 45)), r("f", t(1), t(3)), r("g", t(1), t(4))];
  const p = phases(runs, { issue: new Map() }, since, end);
  expect(p.implement.hist).toEqual([1, 2, 0, 1, 1, 2, 0]);
  expect(p.implement.hist.reduce((a, b) => a + b, 0)).toBe(p.implement.count);
  expect(p.implement.worst).toBe(10800);
  expect(p.intake.hist).toEqual([0, 0, 0, 0, 0, 0, 0]);
  expect(p.intake.worst).toBe(0);
});

test("the shared formats", () => {
  expect([dur(43), dur(245), dur(null)]).toEqual(["43s", "4m 05s", "–"]);
  expect([durShort(59), durShort(1570), durShort(16560)]).toEqual(["59s", "26m", "4h 36m"]);
  expect([weekText(0.02), weekText(2.5)]).toEqual(["<0.1%", "2.5%"]);
  expect([xLabel(new Date(2026, 9, 28, 13, 36).toISOString(), "hour"), xLabel(new Date(2026, 9, 28).toISOString(), "week")]).toEqual(["1:36p", "Oct 28"]);
});

test("activeEnd pulls ended back to the last worker activity", () => {
  const { utimesSync } = require("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "aleph-active-"));
  const t0 = Date.parse("2026-10-28T10:00:00Z"), min = 60_000;
  const mk = (name: string, files: Record<string, number>) => {
    const folder = join(dir, name);
    mkdirSync(folder);
    for (const [f, m] of Object.entries(files)) { writeFileSync(join(folder, f), "x"); utimesSync(folder + "/" + f, (t0 + m * min) / 1000, (t0 + m * min) / 1000); }
    return { id: name, folder, run: { kind: "build", job: name, name, told: true, started: new Date(t0).toISOString(), ended: new Date(t0 + 180 * min).toISOString() } as any };
  };
  // killed: last output at 24 min, noticed at 180 min
  expect(Date.parse(activeEnd(mk("a", { "state.json": 180, log: 24, exit: 180 })).ended!)).toBe(t0 + 24 * min);
  // exit before later review files
  expect(Date.parse(activeEnd(mk("b", { log: 20, exit: 30, "call.md": 100 })).ended!)).toBe(t0 + 30 * min);
  // no activity files: keeps ended
  expect(Date.parse(activeEnd(mk("c", { "state.json": 180 })).ended!)).toBe(t0 + 180 * min);
  rmSync(dir, { recursive: true, force: true });
});

test("flakes count each test name; a row without tests counts under its check", async () => {
  const file = join(base, "factory", "flaky.json");
  mkdirSync(join(base, "factory"), { recursive: true });
  const row = (check: string, tests?: string[]) => ({ repo: "r", check, run: "x", at: at(1, 9), ...(tests ? { tests } : {}) });
  writeFileSync(file, JSON.stringify([row("tests", ["a.test.ts > one", "b.test.ts > two"]), row("tests", ["a.test.ts > one"]), row("tests"), row("types")]));
  try {
    clearCache();
    const d = await speed("week", now);
    expect(d.flaky).toBe(4);
    expect(d.flakes).toEqual([{ name: "a.test.ts > one", count: 2 }, { name: "b.test.ts > two", count: 1 }, { name: "tests", count: 1 }, { name: "types", count: 1 }]);
  } finally {
    rmSync(file, { force: true });
    clearCache();
  }
});

test("classify: the parts of one issue are goals of their own, and a top list links to the part", () => {
  const t = (s: number) => new Date(2026, 9, 28, 8, 0, s).toISOString();
  const b = (job: string, ref: string, s: number, e: number) => ({ kind: "build", job, name: job, repo: "fx", on: `fx-${ref}`, condition: "passed", started: t(s), ended: t(e) }) as any;
  const l = (job: string, ref: string, s: number, e: number) => ({ kind: "land", job, name: job, repo: "fx", on: `fx-${ref}`, condition: "landed", started: t(s), ended: t(e) }) as any;
  const runs = [b("p1", "7.1", 0, 100), b("p4", "7.4", 4, 100), l("p4", "7.4", 110, 120), l("p1", "7.1", 130, 140)];
  const out = classify(runs, () => "open", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const by = (k: string) => out.classes.find((c) => c.key === k)!;
  expect(by("landed").runs).toBe(2);
  expect(by("restarted").runs).toBe(0);
  const d = classify([{ ...b("x", "7.2", 0, 100), condition: "stuck", noCommit: true }], () => "dropped", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  expect(d.classes.find((c) => c.key === "dropped")!.top[0]).toMatchObject({ goal: "fx-7.2", href: "#/issues/fx/7.2" });
});

test("serve() warms /api/speed: week, day and month are computed before the first request", async () => {
  const { withServer } = await import("./test-server.ts");
  const { clearCache } = await import("./api/speed.ts");
  clearCache();
  const { server: s, at, stop } = await withServer();
  try {
    await s.warmed["speed.ts"];
    const r = await at("/api/speed?window=week&baseline=1");
    expect(r.status).toBe(200);
  } finally { stop(); }
});

test("averageFigures averages each figure over the spans that have data for it", async () => {
  const { averageFigures } = await import("./api/speed.ts");
  const none = { lost: null, hours: null, leadP50: null, leadP90: null, queueP50: null, queueP90: null, landed: null, firstPass: null };
  const a = averageFigures([{ ...none, lost: 0.2, landed: 4 }, none, { ...none, lost: 0.4, landed: 0 }]);
  expect(a).toMatchObject({ lost: 0.3, landed: 2, leadP50: null, firstPass: null });
});
