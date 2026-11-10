import { afterAll, beforeAll, expect, setSystemTime, spyOn, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { withEnv } from "./test-server.ts";
import { agentStats, CLASSES, classify, clearCache, filed, staleCache, phaseTimes, phases, routes, speed } from "./api/speed.ts";
import { activeEnd } from "../jobs/lib/infra/process.ts";
// @ts-ignore plain JS shared with the page
import { bar, statusCards, weekText, xLabel } from "./views/speed.js";
// @ts-ignore plain JS shared with the page
import { writeRun } from "../jobs/lib/records/ledger.ts";
import * as record from "../jobs/lib/records/record.ts";
import { averageFigures, figures } from "./api/speed.ts";

let base: string;
let restore: () => void;
const now = new Date(2026, 9, 28, 15, 0, 0);
const at = (daysAgo: number, h: number, m = 0) => new Date(2026, 9, 28 - daysAgo, h, m).toISOString();
let n = 0;
function run(r: Record<string, unknown>) {
  const dir = join(base, "jobs", `r${String(++n).padStart(3, "0")}`);
  mkdirSync(dir, { recursive: true });
  writeRun(join(dir), { job: `j${n}`, name: `j${n}`, told: true, ...r } as any);
}
const secs = (daysAgo: number, h: number, s: number) => ({ started: at(daysAgo, h), ended: new Date(Date.parse(at(daysAgo, h)) + s * 1000).toISOString() });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-speed-"));
  restore = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_UI_FETCH_TTL: "0", ALEPH_ISSUES: join(base, "issues") });
  // today: agents of 600 s (passed, tests 36), 1200 s (dropped), 1800 s (stuck, model unset), a 5 h broken clock
  run({ kind: "build", condition: "passed", model: "claude-opus-5-5", cost: 1, checks: [{ name: "tests", ok: true, seconds: 36 }, { name: "types", ok: true, seconds: 8 }], ...secs(0, 9, 600) });
  run({ kind: "build", condition: "dropped", model: "claude-opus-5-5", cost: 2, ...secs(0, 10, 1200) });
  run({ kind: "build", condition: "failed", cost: 3, ...secs(0, 10, 1800) });
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
  expect(Object.keys(b.baseline.prev)).toContain("asks");
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
    r("a", "build", "failed", t(6), t(6, 10)), r("a", "build", "passed", t(6, 30), t(7)), r("a", "land", "landed", t(7, 5), t(7, 10)), r("a", "build", "passed", t(8), t(8, 5)),
    // A held run that a land took 30 minutes later.
    r("b", "build", "waiting", t(9), t(9, 20)), r("b", "land", "landed", t(9, 45), t(9, 50)),
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
    // issue 1: a fix round and the landing run in job a, an earlier job z restarted, then a run after the land
    r("z", 1, 1, 0, { condition: "failed", reason: "agent run z: stalled" }),
    r("a", 1, 2, 0, { condition: "failed", failed: "tests" }),
    r("a", 1, 3, 0),
    { kind: "land", job: "a", name: "a", repo: "fx", on: "fx-1", condition: "landed", started: t(3, 20), ended: t(3, 25) },
    r("b", 1, 5, 0),
    // issue 2: four starts in an hour, the 4th is a loop; they have no landing, the first three are not counted
    r("l1", 2, 6, 0), r("l2", 2, 6, 10), r("l3", 2, 6, 20), r("l4", 2, 6, 30),
    // issue 3 is dropped
    r("d", 3, 8, 0, { condition: "failed", noCommit: true }),
    // issue 4 is open and unclassed
    r("o", 4, 9, 0),
  ];
  const status = (g: string) => (g === "fx-3" ? "dropped" : "open");
  const out = classify(runs, status, new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const by = (k: string) => out.classes.find((c) => c.key === k)!;
  expect(by("landed").causes.map((c) => c.name)).toEqual(["After fix rounds"]);
  expect(out.classes.map((c) => c.key)).toEqual(["landed", "returned", "failed", "reran", "dropped"]);
  expect(out.classes.map((c) => c.name)).toEqual(["landed", "returned", "failed", "reran", "dropped"]);
  expect(by("returned").causes.map((c) => c.name)).toEqual(["Checks failed"]);
  expect(by("reran").causes.map((c) => c.name).sort()).toEqual(["Restart loop", "Stalled or timed out"]);
  expect(by("failed").causes.map((c) => c.name)).toEqual(["Issue had landed"]);
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

test("classify: a held run that later landed is landed, its earlier held rounds are returned", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (o: Record<string, unknown>) => ({ kind: "build", job: "h", name: "h", repo: "fx", on: "fx-1", condition: "waiting", reason: "held path package.json", ...o }) as any;
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
  expect([runs("landed"), runs("returned"), runs("dropped")]).toEqual([1, 1, 1]);
});

test("classify: a drop's fate, not its prose, sets the failed class and the Needed Chris cause", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (todo: number, o: Record<string, unknown>) =>
    ({ kind: "build", job: `j${todo}`, name: `j${todo}`, repo: "fx", on: `fx-${todo}`, condition: "failed", started: t(todo), ended: t(todo, 10), ...o }) as any;
  const runs = [
    r(1, { fate: "met", reason: "agent run j1: stopped" }),
    r(2, { fate: "duplicate" }),
    // No fate: the prose says duplicate or already met, but the run is a plain drop.
    r(3, { reason: "found it already met" }),
    r(4, { reason: "duplicate of 2" }),
    r(5, { fate: "manual" }),
    // No fate: the prose says by hand or aleph drop, but it has no Needed Chris cause.
    r(6, { reason: "dropped by hand" }),
    r(7, { reason: "aleph drop" }),
  ];
  const out = classify(runs, () => "dropped", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const by = (k: string) => out.classes.find((c) => c.key === k)!;
  expect(by("failed").runs).toBe(2);
  expect(by("failed").causes.map((c) => c.name)).toEqual(["Work on main from another issue"]);
  expect(by("dropped").runs).toBe(5);
  expect(by("dropped").causes.map((c) => c.name).sort()).toEqual(["Needed Chris", "Other"]);
  expect(by("dropped").causes.find((c) => c.name === "Needed Chris")!.runs).toBe(1);
});

test("runs read their issue from on: a part counts under its own ref, an issue run under its number", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const a = (job: string, o: Record<string, unknown>) => ({ kind: "build", job, name: job, repo: "aleph", condition: "passed", cost: 1, started: t(1), ended: t(2), ...o }) as any;
  const runs = [
    a("p", { on: "aleph-1430" }), a("q", { on: "aleph-1430.1" }), a("r", { on: "aleph-1359" }),
  ];
  const seen: string[] = [];
  classify(runs, (g) => { seen.push(g); return "open"; }, new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  expect(new Set(seen)).toEqual(new Set(["aleph-1430", "aleph-1430.1", "aleph-1359"]));

  const land = (job: string, o: Record<string, unknown>) => ({ ...a(job, o), kind: "land", condition: "landed" });
  for (const r of [a("p", { on: "aleph-1430" }), a("q", { on: "aleph-1430.1" }), land("p", { on: "aleph-1430" }), land("q", { on: "aleph-1430.1" })]) run({ ...r, started: at(1, 9), ended: at(1, 10) });
  const fit = { pooled: 0.1, byModel: {} } as any;
  const w = speed("week", now, fit);
  expect(w.issues.week).toBe(0.2); // both runs under the one key aleph-1430
  expect(w.issues.usage).toEqual([{ goal: "aleph-1430", href: "#/issues/aleph/1430", week: 0.2, runs: 2 }]);
  expect(speed("week", now).issues.usage).toEqual([]);
  run({ ...a("r", { on: "aleph-1359" }), started: at(1, 9), ended: at(1, 10) }); run({ ...land("r", { on: "aleph-1359" }), started: at(1, 9), ended: at(1, 10) });
  const w2 = speed("week", now, fit);
  expect(w2.issues.week).toBe(0.1); // aleph-1359 counts too: median of 0.2 and 0.1
  expect(w2.issues.usage).toEqual([{ goal: "aleph-1430", href: "#/issues/aleph/1430", week: 0.2, runs: 2 }, { goal: "aleph-1359", href: "#/issues/aleph/1359", week: 0.1, runs: 1 }]);
});

test("phases: intake runs from the filing to the first triage end, queue from there to the first agent start, lead from the filing to the last land", () => {
  const r = (n: number, kind: string, state: string, a: number, b: number, repo = "fx") => ({ kind, job: `${repo}-${n}-${a}`, name: "x", repo, on: `${repo}-${n}`, condition: state, started: new Date(a).toISOString(), ended: new Date(b).toISOString() }) as any;
  const f = { issue: new Map<string, number | null>([["fx-1", 1000_000], ["fx-2", null], ["fx-3", 1000_000]]) };
  const p = phases([
    r(1, "triage", "done", 1000_000, 1060_000),
    r(1, "build", "failed", 1660_000, 1700_000), r(1, "build", "passed", 1800_000, 1900_000),
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

test("per-issue times carry each issue's phases and outcome, and a bucket has a p90 next to its p50", () => {
  const r = (n: number, kind: string, state: string, a: number, b: number) => ({ kind, job: `fx-${n}`, name: "x", repo: "fx", on: `fx-${n}`, condition: state, started: new Date(a).toISOString(), ended: new Date(b).toISOString() }) as any;
  const f = { issue: new Map<string, number | null>([["fx-1", 1000_000], ["fx-2", 1000_000]]) };
  const t = phaseTimes([
    r(1, "triage", "done", 1000_000, 1060_000), r(1, "build", "passed", 1660_000, 1900_000), r(1, "land", "landed", 2000_000, 2100_000),
    r(2, "triage", "done", 1000_000, 1100_000), r(2, "build", "passed", 1400_000, 1500_000),
  ], f, 0, 9_999_000);
  const by = Object.fromEntries(t.issues.map((i) => [i.id, i]));
  expect(by["fx-1"]).toEqual({ id: "fx-1", href: "#/issues/fx/1", outcome: "landed", filed: 1000_000, intake: 60, queue: 600, implement: 240, land: 200, lead: 1100 });
  expect(by["fx-2"]).toEqual({ id: "fx-2", href: "#/issues/fx/2", outcome: "unlanded", filed: 1000_000, intake: 100, queue: 300, implement: 100, land: null, lead: null });
  // Two jobs finish in one hour: builds of 600 and 1200 s.
  const now2 = new Date(2026, 2, 10, 15), h = (m: number) => new Date(2026, 2, 10, 9, m).toISOString();
  run({ kind: "build", job: "pa", repo: "px", on: "px-1", condition: "passed", started: h(0), ended: h(10) });
  run({ kind: "build", job: "pb", repo: "px", on: "px-2", condition: "passed", started: h(5), ended: h(25) });
  const d = speed("day", now2);
  const b = d.buckets.find((x) => x.implement !== null)!;
  expect(b.implement).toBe(600);
  expect(b.p90.implement).toBe(1200);
  expect(d.times.map((i) => i.id).sort()).toEqual(["px-1", "px-2"]);
});

test("agents: each role's live, runs, hours and models, with a peak over all roles", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  const e = (kind: string, a: number, b: number | null, extra: object = {}) => ({ folder: `f${a}`, id: `f${a}`, run: { kind, condition: b === null ? "running" : "passed", started: iso(a), ...(b === null ? {} : { ended: iso(b) }), ...extra } }) as any;
  const runs = [
    e("build", 1, 3, { model: "sonnet", review: { call: "passed" } }), e("build", 2, 4, { model: "sonnet" }), e("agent", 3, 3.5, { model: "haiku" }),
    e("build", 7, null), e("build", 6, null), e("build", 0, 9.5), // a live run, a lost one, and a broken clock
    e("triage", 2, 2.5, { model: "claude-opus-5-5" }), e("director", 4, 5, { model: "claude-fable-5-1" }), e("land", 1, 8), e("recheck", 1, 2),
    e("build", 5, 6, { model: "sonnet" }),
  ];
  const a = agentStats(runs, 0, 8 * H, H, 2, (x) => x.folder === "f7");
  const r = Object.fromEntries(a.roles.map((x) => [x.key, x]));
  expect([a.live, a.workers, a.cap, a.peak]).toEqual([1, 1, 2, 3]); // 2-2.5: two workers and triage
  expect(r.worker).toMatchObject({ live: 1, runs: 7, hours: 6.5, p50: 3600, models: ["sonnet", "haiku"] });
  expect(r.triage).toMatchObject({ live: 0, runs: 1, hours: 0.5, models: ["opus"] });
  expect(r.director).toMatchObject({ live: 0, runs: 1, hours: 1, models: ["fable"] });
  expect(r.reviewer).toMatchObject({ live: null, runs: 1, hours: null, p50: null });
  expect(a.roles.map((x) => x.key)).toEqual(["worker", "intake", "triage", "planner", "director", "monitor", "reviewer"]);
  expect(a.mean).toBe(1); // 8 agent hours over 8
  expect(a.points.map((p) => p.worker ?? 0)).toEqual([0, 1, 2, 1.5, 0, 1, 0, 1]);
  expect(a.points[2].triage).toBe(0.5);
});

test("agents: outcome rows per role and model, with first pass, reviewer verdicts and a baseline rate", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  let n = 0;
  const e = (kind: string, a: number, extra: object) => ({ folder: `o${n}`, id: `o${n++}`, run: { kind, job: `j${n}`, condition: "passed", started: iso(a), ended: iso(a + 1), ...extra } }) as any;
  const runs = [
    // Window 10..20: haiku has one pass that landed first time, one run sent back by the reviewer, one timed out; gpt-oss has one failed check.
    e("build", 10, { model: "claude-haiku", cost: 1, job: "a" }), e("land", 12, { job: "a", condition: "landed" }),
    e("build", 11, { model: "claude-haiku", cost: 0.5, condition: "returned", failed: "review", reason: "reviewer: no" }),
    e("build", 13, { model: "claude-haiku", condition: "failed", cause: "timeout" }),
    e("build", 14, { model: "gpt-oss-20b", condition: "failed", failed: "tests", cost: 0.25 }),
    e("triage", 15, { model: "gpt-oss-20b" }),
    // The span before, 0..10: haiku one of two, gpt-oss none.
    e("build", 1, { model: "claude-haiku" }), e("build", 2, { model: "claude-haiku", condition: "failed" }),
  ];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false, [[0, 10 * H]]);
  const by = (role: string, model: string) => a.outcomes.find((x) => x.role === role && x.model === model)!;
  expect(by("worker", "claude-haiku")).toMatchObject({ runs: 3, succeeded: 1, failed: 1, stuck: 1, rate: 0.3333, p50: 3600, cost: 1.5, firstPass: 1, reviewPass: 0.5, baseline: 0.5 });
  expect(by("worker", "gpt-oss-20b")).toMatchObject({ runs: 1, succeeded: 0, failed: 1, stuck: 0, rate: 0, cost: 0.25, firstPass: 0, reviewPass: null, baseline: null });
  expect(by("triage", "gpt-oss-20b")).toMatchObject({ runs: 1, succeeded: 1, rate: 1 });
  expect(by("reviewer", "unset")).toMatchObject({ pass: 1, fail: 1, runs: 2, rate: 0.5 });
  expect(a.outcomes.map((x) => x.role)).toEqual(["worker", "worker", "triage", "reviewer"]);
});

test("agents: the all-roles success rate, its baseline, the worker first pass and the local share", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  let n = 0;
  const e = (kind: string, a: number, extra: object) => ({ folder: `r${n}`, id: `r${n++}`, run: { kind, job: `j${n}`, condition: "passed", started: iso(a), ended: iso(a + 1), ...extra } }) as any;
  const runs = [
    // Window 10..20: job a landed first time, job b landed after a fix round, a gpt-oss triage passed, a gpt-oss build failed.
    e("build", 10, { model: "claude-haiku", job: "a" }), e("land", 12, { job: "a", condition: "landed" }),
    e("build", 13, { model: "claude-haiku", job: "b", condition: "returned", failed: "review" }), e("build", 14, { model: "claude-haiku", job: "b" }), e("land", 16, { job: "b", condition: "landed" }),
    e("triage", 15, { model: "gpt-oss-20b" }), e("build", 17, { model: "gpt-oss-20b", condition: "failed", failed: "tests" }),
    // The span before, 0..10: one of two ended runs succeeded.
    e("build", 1, { model: "claude-haiku" }), e("build", 2, { model: "claude-haiku", condition: "failed" }),
  ];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false, [[0, 10 * H]]);
  expect(a.rates).toEqual({ success: 0.6, baseline: 0.5, firstPass: 0.5, local: 0.4 });
  expect(agentStats(runs, 30 * H, 40 * H, H, 2, () => false).rates).toEqual({ success: null, baseline: null, firstPass: null, local: null });
});

test("an unlanded run of an issue that left the store is Dropped", () => {
  const t = (h: number) => new Date(2026, 9, 28, h).toISOString();
  const r = { job: "g", name: "g", repo: "fx", on: "fx-659", condition: "failed", kind: "build", started: t(8), ended: t(9) } as any;
  const since = new Date(2026, 9, 27).getTime(), at = new Date(2026, 9, 28, 15).getTime();
  expect(classify([r], () => "gone", since, at, null).classes.find((c) => c.key === "dropped")!.runs).toBe(1);
  expect(classify([r], () => undefined, since, at, null).notCounted.runs).toBe(1);
});

test("the shared formats", () => {
  expect([weekText(0.02), weekText(2.5)]).toEqual(["<0.1%", "3%"]);
  expect([xLabel(new Date(2026, 9, 28, 13, 36).toISOString(), "hour"), xLabel(new Date(2026, 9, 28).toISOString(), "week")]).toEqual(["1:36p", "Oct 28"]);
});

test("the outcome bar with no hours names a job, not a run", () => {
  const h = bar({ window: "week", classes: [] }, "all");
  expect(h).toContain("No agent job on an issue ended in the last 7 days.");
  expect(h).not.toMatch(/\bruns?\b/i);
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

test("a change signal answers /api/speed from the kept values and rebuilds one speed() per turn after it", async () => {
  const restoreTtl = withEnv({ ALEPH_UI_FETCH_TTL: "60" });
  setSystemTime(new Date(2026, 9, 28, 15));
  const get = async () => (await routes["GET /api/speed"](new Request("http://x/api/speed?window=day&baseline=1"), {}, new URL("http://x/api/speed?window=day&baseline=1"))).json();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  const real = record.all;
  let calls = 0;
  const spy = spyOn(record, "all").mockImplementation((...a: []) => { calls++; return real(...a); });
  try {
    clearCache();
    const old = await get();
    await tick();
    run({ kind: "land", condition: "landed", ...secs(0, 13, 60) });
    calls = 0;
    staleCache();
    expect((await get()).kinds.land.count).toBe(old.kinds.land.count);
    expect(calls).toBe(0);
    // Each tick is a turn of other work: the rebuild gives way to it after each speed().
    const turns: number[] = [];
    for (let i = 0; i < 12; i++) { const at = calls; await tick(); turns.push(calls - at); }
    expect(calls).toBe(9); // day, month and the 7 spans of the day baseline
    expect(Math.max(...turns)).toBe(1);
    expect((await get()).kinds.land.count).toBe(old.kinds.land.count + 1);
  } finally { spy.mockRestore(); setSystemTime(); restoreTtl(); clearCache(); }
});

test("cardTrend writes a sub-point change with pct() and keeps the flat marker for 0", async () => {
  // @ts-ignore plain JS shared with the page
  const { cardTrend } = await import("./lib.js");
  const o = { kind: "points", lowerIsGood: true, format: String, basis: "b" };
  expect(cardTrend(0.503, 0.5, null, o)).toContain("▲ 0.3%");
  expect(cardTrend(0.5, 0.5, null, o)).toContain("▬ 0%");
  expect(cardTrend(0.63, 0.5, null, o)).toContain("▲ 13%");
});

test("asks: the window counts the Asks set, and those that came to Chris, in the answer and in figures()", () => {
  const dir = (a: string, outcome: string) => ({ at: a, kind: "director", what: outcome, data: { outcome } });
  const rec = (key: string, asks: { set: string; cleared?: string }[], events: unknown[] = []) => record.write({ ...record.empty(key), asks, events: events as never });
  rec("fx-1", [{ set: at(1, 9), cleared: at(1, 10) }], [dir(at(1, 9, 30), "escalated")]); // escalated between set and cleared
  rec("fx-2", [{ set: at(0, 7) }, { set: at(40, 9), cleared: at(40, 10) }], [dir(at(0, 6), "escalated"), dir(at(0, 7, 5), "decided")]); // escalated before the set; decided; one outside the window
  const s = speed("week", now);
  expect(s.asks).toEqual({ count: 2, manual: 1 });
  expect(figures(s)).toMatchObject({ asks: 2 });
  expect(figures(speed("hour", new Date(2026, 8, 1)))).toMatchObject({ asks: 0 });
  expect(averageFigures([figures(s)]).asks).toBe(2);
});

test("GET /api/speed?project= counts only that repo's runs and issues, in the answer and the baseline", async () => {
  clearCache();
  // 60 days back (this week) and 67 days back (the week before), so no other test's window sees these runs.
  const land = (daysAgo: number, repo: string, i: number) => run({ kind: "land", condition: "landed", repo, on: `${repo}-${i}`, ...secs(daysAgo, 9, 60) });
  land(60, "alpha", 1); land(60, "beta", 1); land(60, "beta", 2);
  run({ kind: "build", condition: "passed", repo: "alpha", on: "alpha-1", ...secs(60, 8, 300) });
  run({ kind: "build", condition: "passed", repo: "beta", on: "beta-1", ...secs(60, 8, 300) });
  run({ kind: "build", condition: "passed", repo: "beta", on: "beta-2", ...secs(60, 8, 300) });
  land(67, "alpha", 3); land(67, "beta", 3); land(67, "beta", 4);
  setSystemTime(new Date(2026, 9, 28 - 60, 15));
  try {
    const get = async (q: string) => (await routes["GET /api/speed"](new Request(`http://x/api/speed${q}`), {}, new URL(`http://x/api/speed${q}`))).json();
    const a = await get("?window=week&project=alpha");
    expect(a.done).toBe(1);
    expect(a.kinds.agent.count).toBe(1);
    const both = await get("?window=week");
    expect(both.done).toBe(3);
    expect(both.kinds.agent.count).toBe(3);
    const b = await get("?window=week&project=alpha&baseline=1");
    expect(b.baseline.prev.landed).toBe(1);
    expect((await get("?window=week&baseline=1")).baseline.prev.landed).toBe(3);
  } finally { setSystemTime(); }
});

test("a bucket's cost per model is the recorded cost of the agent runs that started in it", () => {
  const now3 = new Date(2026, 4, 10, 15), h = (hh: number, m = 0) => new Date(2026, 4, 10, hh, m).toISOString();
  run({ kind: "build", repo: "pc", condition: "passed", model: "opus", cost: 1.25, started: h(9, 5), ended: h(9, 10) });
  run({ kind: "build", repo: "pc", condition: "passed", model: "opus", cost: 0.5, started: h(9, 40), ended: h(10, 10) }); // ends in the next hour, counts where it starts
  run({ kind: "build", repo: "pc", condition: "passed", model: "sonnet", cost: 2, started: h(9, 20), ended: h(9, 30) });
  run({ kind: "build", repo: "pc", condition: "passed", cost: 4, started: h(11), ended: h(11, 5) });
  const d = speed("day", now3, null, "pc");
  const at9 = d.buckets.find((b) => b.at === h(9))!, at11 = d.buckets.find((b) => b.at === h(11))!;
  expect(at9.cost).toEqual({ opus: 1.75, sonnet: 2 });
  expect(at11.cost).toEqual({ unset: 4 });
  expect(d.buckets.find((b) => b.at === h(12))!.cost).toEqual({});
});

test("every Status card with a second value has a qualifier, Lost time too, and none prints undefined", () => {
  const d = { classes: [{ hours: 6 }], lost: { share: 0.3, hours: 6 }, phases: { lead: { count: 2, p50: 60, p90: 600 } }, asks: { count: 4, manual: 1 }, done: 5, issues: { firstPass: 0.8 } };
  const s = { now: "2026-11-01T08:00:00Z", usage: { now: { seven_day: 7, seven_day_resets_at: "2026-11-07T08:00:00Z" } } };
  for (const html of [statusCards(s, d, {}), statusCards({ now: s.now }, null, {})]) {
    expect(html).not.toContain("undefined");
    const cards = html.split(/(?=<(?:a|div|button) [^>]*class="tile sc")/);
    for (const c of cards) if (c.includes("<em>")) expect(c).toContain('<span class="q">');
  }
  expect(statusCards(s, d, {})).toContain('<b>30%<em> / 6.0h</em></b><span class="q"><span>lost</span><span class="m"> / hours</span>');
});

test("speed: a build on an unchanged store spawns one git process and reads the same filing times and titles", () => {
  const store = join(base, "issues");
  mkdirSync(join(store, "tt/backlog/tasks"), { recursive: true });
  writeFileSync(join(store, "tt/backlog/config.yml"), "");
  writeFileSync(join(store, "tt/backlog/tasks/tt-7.md"), "---\nid: tt-7\ntitle: Seven\nstatus: To Do\n---\n");
  const who = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: "@5000 +0000", GIT_COMMITTER_DATE: "@5000 +0000" };
  for (const a of [["init", "-q"], ["add", "."], ["commit", "-qm", "tt: add"], ["update-ref", "refs/remotes/origin/main", "HEAD"]]) Bun.spawnSync(["git", "-C", store, ...a], { env: { ...process.env, ...who } });
  run({ kind: "build", condition: "passed", repo: "tt", on: "tt-7", cost: 1, ...secs(0, 9, 600) });
  run({ kind: "land", condition: "landed", repo: "tt", on: "tt-7", ...secs(0, 9, 40) });
  const read = () => { const d = speed("week", now, { pooled: 0.1, byModel: {} } as any); return [d.times.map((x) => x.filed), d.issues.usage.map((u) => u.title)]; };
  const first = read();
  expect(first[1]).toContain("Seven");
  const spawn = Bun.spawnSync, calls: string[][] = [];
  Bun.spawnSync = ((cmd: string[], ...rest: unknown[]) => (calls.push(cmd), (spawn as Function)(cmd, ...rest))) as typeof Bun.spawnSync;
  try {
    expect(read()).toEqual(first);
  } finally {
    Bun.spawnSync = spawn;
  }
  expect(calls.filter((c) => c[0] === "git").length).toBeLessThanOrEqual(1);
});
