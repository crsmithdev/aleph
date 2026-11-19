import { afterAll, afterEach, beforeAll, expect, setSystemTime, spyOn, test } from "bun:test";
import { recordFlake } from "../../jobs/lib/gates/tables.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jobFolder } from "../../jobs/lib/records/run-files.ts";
import { closePass, openPass } from "../../lib/sources.ts";
import { withEnv } from "../server.testkit.ts";
import { filed } from "../../lib/store.ts";
import { inputs, routes, speed } from "./flow.ts";
import { activeIssues, phaseTimes, phases } from "../flow/phases.ts";
import { agentStats } from "../flow/agents.ts";
import { CLASSES, classify } from "../flow/classes.ts";
import { buckets } from "../../lib/windows.ts";
import { activeEnd } from "../../jobs/lib/infra/process.ts";
// @ts-ignore plain JS shared with the page
import { bar, statusCards, usageCard } from "../views/lib/flow-parts.js";
// @ts-ignore plain JS shared with the page
import { pct, xLabel } from "../views/lib/format.js";
// @ts-ignore plain JS shared with the page
import { seed } from "../../jobs/job.testkit.ts";
import { conn } from "../../lib/db.ts";
import { averageFigures, figures } from "../flow/baseline.ts";
import { writeRepos } from "../../tests/projects.testkit.ts";
import { readModels } from "../../jobs/lib/routing/models.ts";

let base: string;
let restore: () => void;
const now = new Date(2026, 9, 28, 15, 0, 0);
const at = (daysAgo: number, h: number, m = 0) => new Date(2026, 9, 28 - daysAgo, h, m).toISOString();
/** The jobs a test adds: they go after it, so the next test reads the jobs of the setup only. */
const made: string[] = [];
/** Make a job; `on` is the issue `<repo>-<n>` and `job` is dropped, a job's work being its `prev` chain. */
function run({ on, job: _job, n: _n, ...r }: Record<string, unknown>) {
  made.push(seed({ name: "job", ...(on ? { target: `issue.${String(on).split("-")[1]}` } : {}), ...r } as any).id);
}
const secs = (daysAgo: number, h: number, s: number) => ({ started: at(daysAgo, h), ended: new Date(Date.parse(at(daysAgo, h)) + s * 1000).toISOString() });
/** The author and committer of the commits a store a test writes takes. */
const GIT = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
/** A git command in the store `dir` a test writes. */
const storeGit = (dir: string) => (...a: string[]) => Bun.spawnSync(["git", "-C", dir, ...a], { stderr: "ignore", env: { ...process.env, ...GIT } });

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-speed-"));
  // A project filter names a registry key, or it matches nothing.
  writeRepos({ alpha: { path: "/nonexistent/alpha" }, beta: { path: "/nonexistent/beta" }, pc: { path: "/nonexistent/pc" } }, join(base, "issues"));
  restore = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_DB: join(base, "aleph.db"), ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_UI_FETCH_TTL: "0", ALEPH_ITEMS: join(base, "issues") });
  // today: agents of 600 s (passed, tests 36), 1200 s (dropped), 1800 s (error, model unset), a 5 h broken clock
  run({ role: "build", state: "passed", model: "claude-opus-5-5", cost: 1, checks: [{ name: "tests", ok: true, seconds: 36 }, { name: "types", ok: true, seconds: 8 }], ...secs(0, 9, 600) });
  run({ role: "build", state: "dropped", model: "claude-opus-5-5", cost: 2, ...secs(0, 10, 1200) });
  run({ role: "build", state: "failed", cost: 3, ...secs(0, 10, 1800) });
  run({ role: "build", state: "passed", cost: 9, ...secs(0, 1, 5 * 3600) });
  run({ role: "land", state: "landed", ...secs(0, 9, 40) });
  run({ role: "land", state: "landed", ...secs(0, 9, 46) }); // both without an issue: one key
  run({ role: "land", state: "failed", ...secs(0, 9, 100) });
  run({ role: "intake", state: "done", ...secs(0, 11, 20) });
  run({ role: "build", state: "running", started: at(0, 14) });
  // three days ago and 20 days ago
  run({ role: "build", state: "passed", model: "claude-sonnet-5-5", cost: 0.5, checks: [{ name: "tests", ok: true, seconds: 40 }], ...secs(3, 9, 300) });
  run({ role: "intake", state: "done", ...secs(20, 9, 90) });
  made.length = 0;
});
afterEach(() => {
  for (const id of made) { conn().run("DELETE FROM jobs WHERE id = ?", [id]); rmSync(jobFolder(id), { recursive: true, force: true }); }
  conn().run("DELETE FROM events WHERE subject = 'gate' AND action IN ('question', 'answered')");
  made.length = 0;
});
afterAll(() => {
  restore();
  rmSync(base, { recursive: true, force: true });
});

test("done and issues.landed count landed issues, not land runs", () => {
  // 40 days back, so no other test's window sees these runs.
  const old = (h: number, m: number, extra: object) => run({ role: "land", state: "landed", ...extra, started: at(40, h, m), ended: at(40, h, m + 1) });
  old(9, 0, { repo: "zz", target: "issue.5" });
  old(9, 30, { repo: "zz", target: "issue.5" }); // the same issue lands again
  old(9, 45, { repo: "zz", target: "issue.6" });
  old(9, 50, {}); // no issue
  old(9, 55, {}); // no issue: one key with the one above
  const d = speed("day", new Date(2026, 8, 18, 15));
  expect(Object.keys(d.kinds)).toEqual(["land", "intake"]);
  expect(d.kinds.land.count).toBe(5);
  expect(d.done).toBe(3); // zz-5, zz-6 and the no-issue key
  expect(d.issues.landed).toBe(3);
});

test("GET /api/flow takes a window (default week) and answers JSON", async () => {
  const get = async (q: string) => routes["GET /api/flow"](new Request(`http://x/api/flow${q}`), {}, new URL(`http://x/api/flow${q}`));
  expect((await (await get("?window=month")).json()).window).toBe("month");
  expect((await (await get("")).json()).window).toBe("week");
  expect((await get("?window=year")).status).toBe(400);
  expect((await (await get("?window=week")).json()).baseline).toBeUndefined();
  const b = await (await get("?window=week&baseline=1")).json();
  expect(b.window).toBe("week");
  expect(Object.keys(b.baseline).sort()).toEqual(["base", "basis", "prev"]);
  expect(Object.keys(b.baseline.prev)).toContain("asks");
  const { baseline: _b, figures: f, ...d } = b;
  expect(f).toEqual(figures(d));
  expect(Object.keys(f).sort()).toEqual(Object.keys(b.baseline.prev).sort());
  expect(Object.keys(f)).not.toContain("costPerLand");
  for (const k of ["costPerRun", "runs"]) expect([Object.keys(f), Object.keys(b.baseline.prev)].flat()).not.toContain(k);
});

test("the Status cards show the answer's figures and trend them against its baseline", () => {
  // The raw fields disagree with `figures`, so a card that read them would show 90% and 9.0h.
  const d = { classes: [{ hours: 9 }], lost: { share: 0.9, hours: 9 }, asks: { count: 1, manual: 0 }, figures: { lost: 0.2, hours: 2, leadP50: null, leadP90: null, asks: 3, landed: null, firstPass: null }, baseline: { prev: { lost: 0.4 }, base: { lost: 0.4 }, basis: "the previous 7 days" } };
  const h = statusCards({ now: "2026-11-01T08:00:00Z", factory: { liveRuns: 0 }, queued: [] }, d, {});
  expect(h).toContain("<b>20%<em> / 2.0h</em></b>");
  expect(h).toContain("baseline 40%, the previous 7 days");
  });

test("figures: the follow-ups are the agent subjects' filed events in the window, and filed is all of them", () => {
  const file = (subject: string, object: string, time: Date) => conn().run("INSERT INTO events (time, subject, action, object) VALUES (?, ?, 'filed', ?)", [time.toISOString(), subject, object]);
  // From 2026-11-13T18:09:00Z a filed event names its filer, so the subject decides a follow-up.
  const t = new Date("2026-11-13T18:30:00Z"), now = new Date("2026-11-13T19:00:00Z");
  for (const s of ["worker", "intake", "gate", "claude", "human"]) file(s, "alpha-9001", t);
  file("worker", "alpha-9001", new Date("2026-11-12T10:00:00Z")); // before the window
  conn().run("INSERT INTO events (time, subject, action, object) VALUES (?, 'worker', 'started', 'alpha-9001')", [t.toISOString()]); // not a filing
  file("worker", "beta-9001", t); // another project's
  expect(figures(speed("day", now))).toMatchObject({ followups: 4, filed: 6 });
  expect(figures(speed("day", now, null, "alpha"))).toMatchObject({ followups: 3, filed: 5 });
  expect(figures(speed("day", now, null, "beta"))).toMatchObject({ followups: 1, filed: 1 });
  conn().run("DELETE FROM events WHERE object LIKE '%-9001'");
});

test("figures: before the filer is named, a filed event counts by the issue's source, not its subject", () => {
  const store = join(base, "sources");
  writeRepos({ alpha: {} }, store);
  for (const [n, source] of [[1, "worker"], [2, "chris"]] as const) {
    mkdirSync(join(store, "issues", String(n)), { recursive: true });
    writeFileSync(join(store, "issues", String(n), "issue.md"), `---\nproject: project.1\nsource: ${source}\n---\n`);
  }
  const git = storeGit(store);
  git("init", "-q");
  git("add", ".");
  git("commit", "-qm", "alpha: add");
  git("update-ref", "refs/remotes/origin/main", "HEAD");
  const restore = withEnv({ ALEPH_ITEMS: store });
  const file = (object: string, time: string) => conn().run("INSERT INTO events (time, subject, action, object) VALUES (?, 'rule', 'filed', ?)", [time, object]);
  file("issue.1", "2026-11-13T17:00:00Z"); // source: worker, before the filer is named
  file("issue.2", "2026-11-13T17:10:00Z"); // source: chris, before it
  file("issue.2", "2026-11-13T18:30:00Z"); // source: chris, after it: the subject decides
  try {
    expect(figures(speed("day", new Date("2026-11-13T19:00:00Z")))).toMatchObject({ followups: 2, filed: 3 });
  } finally {
    conn().run("DELETE FROM events WHERE object IN ('issue.1', 'issue.2')");
    restore();
  }
});

test("the Usage card note is the pace word, and the bar title holds the percent off this machine", () => {
  const u = { now: { seven_day: 40, seven_day_resets_at: "2026-11-07T08:00:00Z" } };
  const h = usageCard({ now: "2026-11-01T08:00:00Z", usage: { ...u, off: 12 } });
  expect(h).toContain("40%");
  expect(h).toContain('title="40% used, 14% of the week gone, 12% off this machine"');
  expect(h).toContain('<span class="q m" title="over pace">over pace</span>');
  expect(usageCard({ now: "2026-11-01T08:00:00Z", usage: { ...u, off: null } })).not.toContain("off this machine");
});

test("the Status Usage meter fill takes the default fill", () => {
  const h = statusCards({ now: "2026-11-01T08:00:00Z", factory: { liveRuns: 0 }, queued: [], usage: { now: { seven_day: 7, seven_day_resets_at: "2026-11-07T08:00:00Z" } } }, null, {});
  expect(h).toContain('<span class="meter" role="img"');
  expect(h).not.toContain("c-use");
});

test("phases: implement spans a job's fix rounds, land starts at the last finish, and each counts where it ends", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (job: string, kind: string, state: string, a: string, b: string) => ({ n: 1, role: kind, job, name: job, state: state, started: a, ended: b }) as any;
  const since = new Date(2026, 9, 28, 5).getTime(), end = new Date(2026, 9, 28, 15).getTime();
  const none = { issue: new Map() };
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

test("filed: an issue's created field is its filing, else its file's add time; a bulk commit's time does not count", () => {
  const store = join(base, "store");
  mkdirSync(store, { recursive: true });
  writeRepos({ fx: {} }, store);
  const restore = withEnv({ ALEPH_ITEMS: store });
  const git = storeGit(store);
  const add = (when: number, msg: string, ...ids: string[]) => {
    for (const spec of ids) {
      const [id, created] = spec.split("@");
      mkdirSync(join(store, `issues/${id}`), { recursive: true });
      writeFileSync(join(store, `issues/${id}/issue.md`), `---\nproject: project.1\n${created ? `created: ${created}\n` : ""}---\n`);
    }
    git("add", ".");
    const stamp = `@${when} +0000`;
    Bun.spawnSync(["git", "-C", store, "commit", "-qm", msg], { env: { ...process.env, ...GIT, GIT_AUTHOR_DATE: stamp, GIT_COMMITTER_DATE: stamp } });
    git("update-ref", "refs/remotes/origin/main", "HEAD");
  };
  git("init", "-q");
  add(1000, "fx: add", "1", "2");
  add(2100, "migrate: work model, 3 items", "3");
  try {
  const f = filed(store);
  expect([f.issue.get("fx-1"), f.issue.get("fx-2"), f.issue.get("fx-3"), f.issue.size]).toEqual([1000_000, 1000_000, null, 3]);
  // A new commit reads only what it adds.
  add(3000, "fx: add", "5");
  expect(filed(store).issue.get("fx-5")).toBe(3000_000);
  // The created field wins over the commit time, and an unparsable one falls back to it.
  add(4000, "fx: add", "6@2026-11-08T04:13:00.000Z", "7@soon");
  const g = filed(store);
  expect([g.issue.get("fx-6"), g.issue.get("fx-7")]).toEqual([Date.parse("2026-11-08T04:13:00.000Z"), 4000_000]);
  // Lead runs from the created time, not the add time.
  add(5000, "fx: add", "8@1970-01-01T00:00:10.000Z");
  const lead = phases([{ role: "land", job: "fx-8", name: "x", repo: "fx", target: "issue.8", state: "landed", started: new Date(6000_000).toISOString(), ended: new Date(7000_000).toISOString() } as any], filed(store), 0, 9_999_000);
  expect(lead.lead).toMatchObject({ count: 1, p50: 6990 });
  } finally { restore(); }
});

test("classify: one run of each class, with its cause", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (job: string, todo: number, h: number, m: number, o: Record<string, unknown> = {}) =>
    ({ n: 1, role: "build", job, name: job, repo: "fx", target: `issue.${todo}`, state: "passed", started: t(h, m), ended: t(h, m + 10), ...o }) as any;
  const runs = [
    // issue 1: a fix round and the landing run in job a, an earlier job z restarted, then a run after the land
    r("z", 1, 1, 0, { state: "failed", reason: "agent run z: stalled" }),
    r("a", 1, 2, 0, { state: "failed", failed: "tests" }),
    r("a", 1, 3, 0),
    { n: 1, role: "land", job: "a", name: "a", repo: "fx", target: "issue.1", state: "landed", started: t(3, 20), ended: t(3, 25) },
    r("b", 1, 5, 0),
    // issue 2: four starts in an hour, the 4th is a loop; they have no landing, the first three are not counted
    r("l1", 2, 6, 0), r("l2", 2, 6, 10), r("l3", 2, 6, 20), r("l4", 2, 6, 30),
    // issue 3 is dropped
    r("d", 3, 8, 0, { state: "failed", noCommit: true }),
    // issue 4 is open and unclassed
    r("o", 4, 9, 0),
  ];
  const status = (g: string) => (g === "fx-3" ? "dropped" : "open");
  const out = classify(runs, status, new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const by = (k: string) => out.classes.find((c) => c.key === k)!;
  expect(by("landed").causes.map((c) => c.name)).toEqual(["After fix rounds"]);
  expect(out.classes.map((c) => c.key)).toEqual(["landed", "returned", "failed", "reran", "dropped"]);
  expect(out.classes.map((c) => c.lost)).toEqual([false, false, true, true, true]);
  expect(by("returned").causes.map((c) => c.name)).toEqual(["Checks failed"]);
  expect(by("reran").causes.map((c) => c.name).sort()).toEqual(["Restart loop", "Stalled or timed out"]);
  expect(by("failed").causes.map((c) => c.name)).toEqual(["Issue had landed"]);
  expect(by("dropped").causes.map((c) => c.name)).toEqual(["No commit"]);
  expect(by("dropped").top[0]).toMatchObject({ issue: "fx-3", href: "#/issues/fx/3" });
  for (const c of out.classes) {
    expect(c).toHaveProperty("week");
    for (const e of [...c.causes, ...c.top]) expect(e).not.toHaveProperty("week");
  }
  expect(out.notCounted).toEqual({ runs: 4, issues: 2, hours: round2(4 * 10 / 60) });
  expect(out.lost.hours).toBeCloseTo(Math.round(out.classes.filter((c) => c.lost).reduce((a, c) => a + c.hours, 0) * 100) / 100, 1);
  const d = speed("day", now);
  expect(d.classes.map((c) => c.key)).toEqual([...CLASSES]);
  expect(d.issues.week).toBeNull();
});
const round2 = (n: number) => Math.round(n * 100) / 100;

test("builds, wait and size: one entry per build run; an issue's size is its last build's; wait is queue over lead of the landed issues", () => {
  const t = (h: number, m = 0) => at(5, h, m), filedAt = Date.parse(t(8));
  const inp = { ...inputs(), filed: { issue: new Map<string, number | null>([["alpha-1", filedAt], ["alpha-2", filedAt], ["alpha-4", filedAt]]) } };
  const on = (n: number) => ({ repo: "alpha", target: `issue.${n}` });
  // alpha-1: a small build retried as a medium one, then landed. alpha-2: no size and no model, landed. alpha-4: a build, not landed. One build on no issue.
  run({ role: "build", state: "failed", model: "claude-opus-5-5", size: "small", ...on(1), ...secs(5, 9, 400) });
  run({ role: "build", state: "passed", model: "claude-opus-5-5", size: "medium", ...on(1), ...secs(5, 10, 200) });
  run({ role: "land", state: "landed", ...on(1), ...secs(5, 11, 40) });
  run({ role: "build", state: "passed", ...on(2), ...secs(5, 9, 300) });
  run({ role: "land", state: "landed", ...on(2), ...secs(5, 12, 40) });
  run({ role: "build", state: "passed", model: "sonnet", size: "small", ...on(4), ...secs(5, 13, 100) });
  run({ role: "build", state: "passed", model: "sonnet", size: "large", repo: "alpha", ...secs(5, 14, 50) });
  run({ role: "recheck", state: "passed", model: "sonnet", size: "small", ...on(4), ...secs(5, 15, 70) });
  const d = speed("month", now, null, "alpha", inp);
  expect(d.builds).toEqual([
    { issue: "alpha-1", model: "opus", size: "small", secs: 400, landed: true },
    { issue: "alpha-1", model: "opus", size: "medium", secs: 200, landed: true },
    { issue: "alpha-2", model: "unset", size: null, secs: 300, landed: true },
    { issue: "alpha-4", model: "sonnet", size: "small", secs: 100, landed: false },
    { issue: null, model: "sonnet", size: "large", secs: 50, landed: false },
  ]);
  expect(Object.fromEntries(d.times.map((i) => [i.id, i.size]))).toEqual({ "alpha-1": "medium", "alpha-2": null, "alpha-4": "small" });
  // alpha-1: queue 3600 of lead 10840 (08:00 to 11:00:40); alpha-2: 3600 of 14440. The p50 of two is the lower one.
  expect(d.wait).toEqual({ count: 2, p50: 0.2493 });
  expect(d).not.toHaveProperty("models");
  // Under 20 landed issues the baseline's figure is empty.
  expect(figures(d).waitShare).toBeNull();
  expect(figures({ ...d, wait: { count: 20, p50: 0.3 } }).waitShare).toBe(0.3);
});

test("figures: kept hours are the counted hours less the lost ones, null with no hours", () => {
  const d = speed("day", new Date("2026-10-28T12:00:00Z"));
  const hrs = (xs: number[]) => xs.map((hours) => ({ hours })) as any;
  expect(figures({ ...d, classes: hrs([10, 4, 2]), lost: { hours: 2, share: 0.125 } })).toMatchObject({ kept: 14, hours: 2 });
  expect(figures({ ...d, classes: hrs([0]), lost: { hours: 0, share: 0 } })).toMatchObject({ kept: null, hours: null });
});

test("a build run counts as an agent run", () => {
  const before = speed("week", now);
  run({ role: "build", state: "passed", model: "claude-opus-5-5", cost: 1, checks: [{ name: "tests", ok: true, seconds: 20 }], ...secs(1, 11, 7000) });
  const d = speed("week", now);
  expect(d.slowest[0]).toMatchObject({ state: "passed", took: 7000, tests: 20 });
  expect(d.builds.filter((b) => b.model === "opus").length).toBe(before.builds.filter((b) => b.model === "opus").length + 1);
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (o: Record<string, unknown>) => ({ n: 1, job: "b", name: "b", repo: "fx", target: "issue.1", state: "passed", ...o }) as any;
  const out = classify([
    r({ role: "build", state: "failed", failed: "tests", started: t(2), ended: t(2, 10) }),
    r({ role: "build", started: t(3), ended: t(3, 10) }),
    { n: 1, role: "land", job: "b", name: "b", repo: "fx", target: "issue.1", state: "landed", started: t(3, 20), ended: t(3, 25) },
  ], () => "open", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  expect(out.classes.find((c) => c.key === "landed")!.causes.map((c) => c.name)).toEqual(["After fix rounds"]);
});

test("classify: a held run that later landed is landed, its earlier held rounds are returned", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (o: Record<string, unknown>) => ({ n: 1, role: "build", job: "h", name: "h", repo: "fx", target: "issue.1", state: "waiting", reason: "held path package.json", ...o }) as any;
  const land = (job: string, state: string, h: number) => ({ n: 1, role: "land", job, name: job, repo: "fx", target: "issue.1", state: state, started: t(h, 20), ended: t(h, 25) }) as any;
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

test("classify: a drop's fate, not its prose, sets the failed class and the Needed the user cause", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const r = (todo: number, o: Record<string, unknown>) =>
    ({ n: 1, role: "build", job: `j${todo}`, name: `j${todo}`, repo: "fx", target: `issue.${todo}`, state: "failed", started: t(todo), ended: t(todo, 10), ...o }) as any;
  const runs = [
    r(1, { fate: "met", reason: "agent run j1: stopped" }),
    r(2, { fate: "duplicate" }),
    // No fate: the prose says duplicate or already met, but the run is a plain drop.
    r(3, { reason: "found it already met" }),
    r(4, { reason: "duplicate of 2" }),
    r(5, { fate: "manual" }),
    // No fate: the prose says by hand or aleph drop, but it has no Needed the user cause.
    r(6, { reason: "dropped by hand" }),
    r(7, { reason: "aleph drop" }),
  ];
  const out = classify(runs, () => "dropped", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  const by = (k: string) => out.classes.find((c) => c.key === k)!;
  expect(by("failed").runs).toBe(2);
  expect(by("failed").causes.map((c) => c.name)).toEqual(["Work on main from another issue"]);
  expect(by("dropped").runs).toBe(5);
  expect(by("dropped").causes.map((c) => c.name).sort()).toEqual(["Needed the user", "Other"]);
  expect(by("dropped").causes.find((c) => c.name === "Needed the user")!.runs).toBe(1);
  expect(by("dropped").causes.find((c) => c.name === "Needed the user")!.text).toBe("The run waited for the user, or the user restarted or dropped it by hand.");
});

test("runs read their issue from target: an issue run counts under its number", () => {
  const t = (h: number, m = 0) => new Date(2026, 9, 28, h, m).toISOString();
  const a = (job: string, o: Record<string, unknown>) => ({ n: 1, role: "build", job, name: job, repo: "aleph", state: "passed", cost: 1, started: t(1), ended: t(2), ...o }) as any;
  const runs = [
    a("p", { target: "issue.1430" }), a("q", { target: "issue.1430" }), a("r", { target: "issue.1359" }),
  ];
  const seen: string[] = [];
  classify(runs, (g) => { seen.push(g); return "open"; }, new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
  expect(new Set(seen)).toEqual(new Set(["aleph-1430", "aleph-1359"]));

  const land = (job: string, o: Record<string, unknown>) => ({ ...a(job, o), role: "land", state: "landed" });
  for (const r of [a("p", { target: "issue.1430" }), a("q", { target: "issue.1430" }), land("p", { target: "issue.1430" }), land("q", { target: "issue.1430" })]) run({ ...r, started: at(1, 9), ended: at(1, 10) });
  const fit = { fable: 0.1, rest: 0.1, pooled: true, hours: 24 };
  const w = speed("week", now, fit);
  expect(w.issues.week).toBe(0.2); // the runs under the one key aleph-1430
  expect(w.issues.usage).toEqual([{ issue: "aleph-1430", href: "#/issues/aleph/1430", week: 0.2, runs: 2 }]);
  expect(speed("week", now).issues.usage).toEqual([]);
  run({ ...a("r", { target: "issue.1359" }), started: at(1, 9), ended: at(1, 10) }); run({ ...land("r", { target: "issue.1359" }), started: at(1, 9), ended: at(1, 10) });
  const w2 = speed("week", now, fit);
  expect(w2.issues.week).toBe(0.1); // aleph-1359 counts too: median of 0.2 and 0.1
  expect(w2.issues.usage).toEqual([{ issue: "aleph-1430", href: "#/issues/aleph/1430", week: 0.2, runs: 2 }, { issue: "aleph-1359", href: "#/issues/aleph/1359", week: 0.1, runs: 1 }]);
});

test("phases: intake runs from the filing to the first triage end, queue from there to the first agent start, lead from the filing to the last land", () => {
  const r = (n: number, kind: string, state: string, a: number, b: number, repo = "fx") => ({ role: kind, job: `${repo}-${n}-${a}`, name: "x", repo, target: `issue.${n}`, state: state, started: new Date(a).toISOString(), ended: new Date(b).toISOString() }) as any;
  const f = { issue: new Map<string, number | null>([["fx-1", 1000_000], ["fx-2", null], ["fx-3", 1000_000]]) };
  const p = phases([
    r(1, "intake", "done", 1000_000, 1060_000),
    r(1, "build", "failed", 1660_000, 1700_000), r(1, "build", "passed", 1800_000, 1900_000),
    r(1, "land", "landed", 2000_000, 2100_000), r(1, "land", "landed", 3000_000, 4600_000),
    // fx-2 has a bulk filing: a queue from its triage, and no intake or lead. fx-3 has no triage: it queues from its filing.
    r(2, "intake", "done", 1000_000, 1060_000), r(2, "build", "passed", 1120_000, 1200_000), r(2, "land", "landed", 1300_000, 1400_000),
    r(3, "build", "passed", 1120_000, 1200_000), r(3, "land", "landed", 1300_000, 1400_000),
  ], f, 0, 9_999_000);
  expect(p.intake.count).toBe(1);
  expect(p.queue).toMatchObject({ count: 3, p50: 120, p90: 600 }); // fx-1 600, fx-2 60, fx-3 120
  expect(p.lead).toMatchObject({ count: 2, p50: 400, p90: 3600 }); // fx-1 3600, fx-3 400
  const later = phases([r(1, "build", "passed", 1660_000, 1700_000)], f, 2000_000, 9_999_000);
  expect(later.queue.count).toBe(0);
});

test("per-issue times carry each issue's phases and outcome, and a bucket has a p90 next to its p50", () => {
  const r = (n: number, kind: string, state: string, a: number, b: number) => ({ role: kind, job: `fx-${n}`, name: "x", repo: "fx", target: `issue.${n}`, state: state, started: new Date(a).toISOString(), ended: new Date(b).toISOString() }) as any;
  const f = { issue: new Map<string, number | null>([["fx-1", 1000_000], ["fx-2", 1000_000]]) };
  const t = phaseTimes([
    r(1, "intake", "done", 1000_000, 1060_000), r(1, "build", "passed", 1660_000, 1900_000), r(1, "land", "landed", 2000_000, 2100_000),
    r(2, "intake", "done", 1000_000, 1100_000), r(2, "build", "passed", 1400_000, 1500_000),
  ], f, 0, 9_999_000);
  const by = Object.fromEntries(t.issues.map((i) => [i.id, i]));
  expect(by["fx-1"]).toEqual({ id: "fx-1", href: "#/issues/fx/1", outcome: "landed", filed: new Date(1000_000).toISOString(), intake: 60, queue: 600, implement: 240, land: 200, lead: 1100 });
  expect(by["fx-2"]).toEqual({ id: "fx-2", href: "#/issues/fx/2", outcome: "unlanded", filed: new Date(1000_000).toISOString(), intake: 100, queue: 300, implement: 100, land: null, lead: null });
  // Two jobs finish in one hour: builds of 600 and 1200 s.
  const now2 = new Date(2026, 2, 10, 15), h = (m: number) => new Date(2026, 2, 10, 9, m).toISOString();
  run({ role: "build", job: "pa", repo: "px", target: "issue.1", state: "passed", started: h(0), ended: h(10) });
  run({ role: "build", job: "pb", repo: "px", target: "issue.2", state: "passed", started: h(5), ended: h(25) });
  const d = speed("day", now2);
  const b = d.buckets.find((x) => x.implement !== null)!;
  expect(b.implement).toBe(600);
  expect(b.p90.implement).toBe(1200);
  expect(d.times.map((i) => i.id).sort()).toEqual(["px-1", "px-2"]);
});

test("agents: each role's live, runs, hours and models, with a peak over all roles", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  const e = (kind: string, a: number, b: number | null, extra: object = {}) => ({ folder: `f${a}`, id: `f${a}`, run: { n: 1, role: kind, state: b === null ? "running" : "passed", started: iso(a), ...(b === null ? {} : { ended: iso(b) }), ...extra } }) as any;
  const runs = [
    e("build", 1, 3, { model: "sonnet", review: { call: "passed" } }), e("build", 2, 4, { model: "sonnet" }), e("build", 3, 3.5, { model: "haiku" }),
    e("build", 7, null), e("build", 6, null), e("build", 0, 9.5), // a live run, a lost one, and a broken clock
    e("intake", 2, 2.5, { model: "claude-opus-5-5" }), e("director", 4, 5, { model: "claude-fable-5-1" }), e("land", 1, 8), e("recheck", 1, 2),
    e("build", 5, 6, { model: "sonnet" }),
  ];
  const a = agentStats(runs, 0, 8 * H, H, 2, (x) => x.folder === "f7");
  const r = Object.fromEntries(a.roles.map((x) => [x.key, x]));
  expect([a.live, a.workers, a.cap, a.peak]).toEqual([1, 1, 2, 3]); // 2-2.5: two workers and triage
  expect(r.worker).toMatchObject({ live: 1, runs: 7, hours: 6.5, p50: 3600, models: ["sonnet", "haiku"] });
  expect(r.intake).toMatchObject({ live: 0, runs: 1, hours: 0.5, models: ["opus"] });
  expect(r.director).toMatchObject({ live: 0, runs: 1, hours: 1, models: ["fable"] });
  expect(a.roles.map((x) => x.key)).toEqual(["worker", "intake", "director", "monitor", "housekeeper", "maintainer", "lens", "title", "judge", "reviewer"]);
  expect(a.mean).toBe(1); // 8 agent hours over 8
  expect(a.points.map((p) => p.worker ?? 0)).toEqual([0, 1, 2, 1.5, 0, 1, 0, 1]);
  expect(a.points[2].intake).toBe(0.5);
});

test("agents: outcome rows per role and model, with first pass, reviewer verdicts and a baseline rate", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  let n = 0;
  const e = (kind: string, a: number, extra: object) => ({ folder: `o${n}`, id: `o${n++}`, run: { n: 1, role: kind, job: `j${n}`, state: "passed", size: "small", started: iso(a), ended: iso(a + 1), ...extra } }) as any;
  const runs = [
    // Window 10..20: haiku has one pass that landed first time, one run sent back by the reviewer, one timed out; gpt-oss has one failed check.
    e("build", 10, { model: "claude-haiku", cost: 1, job: "a" }), e("land", 12, { job: "a", state: "landed" }),
    e("build", 11, { model: "claude-haiku", cost: 0.5, state: "returned", failed: "review", reason: "reviewer: no" }),
    e("build", 13, { model: "claude-haiku", state: "failed", cause: "timeout" }),
    e("build", 14, { model: "gpt-oss-20b", state: "failed", failed: "tests", cost: 0.25 }),
    e("intake", 15, { model: "gpt-oss-20b" }),
    // The span before, 0..10: haiku one of two, gpt-oss none.
    e("build", 1, { model: "claude-haiku" }), e("build", 2, { model: "claude-haiku", state: "failed" }),
  ];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false, [[0, 10 * H]]);
  const by = (role: string, model: string) => a.outcomes.find((x) => x.role === role && x.model === model)!;
  expect(by("worker", "claude-haiku")).toMatchObject({ runs: 3, succeeded: 1, failed: 1, error: 1, rate: 0.3333, p50: 3600, cost: 1.5, firstPass: 1, reviewPass: 0.5, baseline: 0.5 });
  expect(by("worker", "gpt-oss-20b")).toMatchObject({ runs: 1, succeeded: 0, failed: 1, error: 0, rate: 0, cost: 0.25, firstPass: 0, reviewPass: null, baseline: null });
  expect(by("intake", "gpt-oss-20b")).toMatchObject({ runs: 1, succeeded: 1, rate: 1 });
  // The verdicts give the pass and fail counts; the runs are those of the review jobs, and there are none here, so no rate.
  expect(by("reviewer", "unset")).toMatchObject({ pass: 1, fail: 1, runs: 0, ended: 0, rate: null });
  expect(a.outcomes.map((x) => x.role)).toEqual(["worker", "worker", "intake", "reviewer"]);
});

test("agents: a build the reviewer returned is no first pass, with no failed field", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  const e = (id: string, a: number, extra: object) => ({ folder: id, id, run: { n: 1, role: "build", job: "a", state: "passed", size: "small", started: iso(a), ended: iso(a + 1), model: "claude-haiku", ...extra } }) as any;
  const runs = [
    e("f1", 10, { state: "returned", review: { call: "returned" } }), e("f2", 12, {}), e("f3", 14, { role: "land", state: "landed" }),
  ];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false);
  expect(a.outcomes.find((x) => x.role === "worker")).toMatchObject({ built: 1, firstPass: 0, reviewPass: 0.5 });
});

test("agents: a landed build whose job retries one sent back is no first pass", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  const e = (id: string, job: string, a: number, extra: object) => ({ folder: id, id, run: { n: 1, role: "build", job, target: "issue.1", state: "passed", size: "small", started: iso(a), ended: iso(a + 1), model: "claude-haiku", ...extra } }) as any;
  const runs = [
    e("b1", "a", 10, { state: "returned", failed: "review" }), e("b2", "b", 12, { retryOf: "b1" }), e("b3", "b", 14, { role: "land", state: "landed" }),
  ];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false);
  expect(a.outcomes.find((x) => x.role === "worker")).toMatchObject({ built: 1, firstPass: 0 });
  expect(a.rates.firstPass).toBe(0);
});

test("agents: the reviewer's runs, model, cost and times come from its review jobs", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  let n = 0;
  const e = (kind: string, a: number, b: number, extra: object = {}) => ({ folder: `v${n}`, id: `v${n++}`, run: { n: 1, role: kind, job: `j${n}`, state: "done", started: iso(a), ended: iso(b), ...extra } }) as any;
  const runs = [
    e("review", 10, 10.5, { model: "claude-opus-5-5", cost: 1.25 }), e("review", 11, 12, { model: "claude-opus-5-5", cost: 0.75 }),
    e("build", 10, 11, { model: "claude-haiku", review: { call: "passed", model: "claude-opus-5-5" } }),
  ];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false);
  expect(a.outcomes.find((x) => x.role === "reviewer")).toMatchObject({ model: "claude-opus-5-5", runs: 2, cost: 2, p50: 1800, p95: 3600, pass: 1, fail: 0, succeeded: 2, ended: 2 });
  expect(a.roles.find((x) => x.key === "reviewer")).toMatchObject({ live: 0, runs: 2, hours: 1.5, p50: 1800, p95: 3600, models: ["opus"] });
});

test("agents: the reviewer's rate is its verdicts over its ended runs, and a worker's reviewPass the pass share of its verdicts", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  let n = 0;
  const e = (kind: string, a: number, extra: object = {}) => ({ folder: `q${n}`, id: `q${n++}`, run: { n: 1, role: kind, job: `j${n}`, state: "done", started: iso(a), ended: iso(a + 1), model: "claude-opus-5-5", ...extra } }) as any;
  const verdict = (call: string) => ({ model: "claude-haiku", size: "small", state: call === "passed" ? "passed" : "returned", review: { call, model: "claude-opus-5-5" } });
  // Four review runs end, one fails: three verdicts, two passes.
  const runs = [e("review", 10), e("review", 11), e("review", 12), e("review", 13, { state: "failed", failed: "x" }), e("build", 10, verdict("passed")), e("build", 11, verdict("passed")), e("build", 12, verdict("returned"))];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false);
  expect(a.outcomes.find((x) => x.role === "reviewer")).toMatchObject({ ended: 4, pass: 2, fail: 1, rate: 0.75 });
  expect(a.outcomes.find((x) => x.role === "worker")).toMatchObject({ reviewPass: 0.6667 });
});

test("agents: worker rows are one per size and model, a build with no size has no row but its verdict still counts for the reviewer, and each row runs from its first to its last start", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  let n = 0;
  const e = (a: number, extra: object = {}) => ({ folder: `s${n}`, id: `s${n++}`, run: { n: 1, role: "build", job: `j${n}`, state: "passed", started: iso(a), ended: iso(a + 1), model: "claude-haiku", ...extra } }) as any;
  const runs = [e(14, { size: "small" }), e(11, { size: "small" }), e(12, { size: "medium" }), e(13, { review: { call: "passed", model: "claude-opus-5-5" } }), e(9, { size: "small" })];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false);
  expect(a.outcomes.filter((x) => x.role === "worker").map((x) => [x.size, x.model, x.runs, x.from, x.to])).toEqual([["small", "claude-haiku", 2, iso(11), iso(14)], ["medium", "claude-haiku", 1, iso(12), iso(12)]]);
  expect(a.outcomes.some((x) => x.role === "worker" && x.size === null)).toBe(false);
  expect(a.outcomes.find((x) => x.role === "reviewer")).toMatchObject({ model: "claude-opus-5-5", pass: 1 });
});

test("agents: a model's provider prefix falls away, so its runs share one reviewer row", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  let n = 0;
  const e = (a: number, b: number, model: string) => ({ folder: `x${n}`, id: `x${n++}`, run: { n: 1, role: "review", job: `j${n}`, state: "done", started: iso(a), ended: iso(b), model } }) as any;
  const runs = [e(10, 10.5, "deepseek/deepseek-v4.1-flash"), e(11, 12, "deepseek-v4.1-flash")];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false);
  expect(a.outcomes.filter((x) => x.role === "reviewer").map((x) => [x.model, x.runs])).toEqual([["deepseek-v4.1-flash", 2]]);
});

test("agents: a verdict with no review.model takes the model of the build's review job", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  const runs = [
    { folder: "vb", id: "b1", run: { n: 1, role: "build", job: "b1", state: "returned", failed: "review", started: iso(10), ended: iso(11), model: "claude-haiku" } },
    { folder: "vr", id: "r1", run: { n: 1, role: "review", job: "b1", prev: "b1", state: "done", started: iso(10), ended: iso(11), model: "deepseek-v4.1-flash" } },
  ] as any;
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false);
  expect(a.outcomes.filter((x) => x.role === "reviewer").map((x) => [x.model, x.fail, x.runs])).toEqual([["deepseek-v4.1-flash", 1, 1]]);
});

test("agents: a build with no model counts under its size's configured model", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  const runs = [{ folder: "sz", id: "sz", run: { n: 1, role: "build", job: "sz", state: "passed", size: "small", started: iso(10), ended: iso(11) } }] as any;
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false);
  expect(a.outcomes.filter((x) => x.role === "worker").map((x) => [x.model, x.runs])).toEqual([[readModels().small.model, 1]]);
});

test("agents: housekeeper and maintainer runs are roles with their own outcome rows", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  let n = 0;
  const e = (kind: string, a: number, extra: object = {}) => ({ folder: `h${n}`, id: `h${n++}`, run: { n: 1, role: kind, job: `j${n}`, state: "done", started: iso(a), ended: iso(a + 1), ...extra } }) as any;
  const runs = [e("housekeeper", 10, { model: "claude-opus-5-5", cost: 0.5 }), e("housekeeper", 12, { model: "claude-opus-5-5", cost: 0.25 }), e("maintainer", 14, { model: "claude-sonnet-5-5", cost: 1 })];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false);
  expect(a.outcomes.map((x) => [x.role, x.runs, x.cost])).toEqual([["housekeeper", 2, 0.75], ["maintainer", 1, 1]]);
  expect(a.roles.map((x) => x.key)).toEqual(expect.arrayContaining(["housekeeper", "maintainer"]));
});

test("agents: lens runs are a role with their own outcome row", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  const runs = [{ folder: "l1", id: "l1", run: { n: 1, role: "lens", job: "j1", state: "done", started: iso(10), ended: iso(11), model: "claude-opus-5-5", cost: 2 } }] as any;
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false);
  expect(a.outcomes.map((x) => [x.role, x.runs, x.cost])).toEqual([["lens", 1, 2]]);
  expect(a.roles.find((x) => x.key === "lens")).toMatchObject({ name: "Lens", runs: 1 });
});

test("agents: title and judge runs are roles with their own outcome rows and cost", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  let n = 0;
  const e = (kind: string, a: number, extra: object = {}) => ({ folder: `t${n}`, id: `t${n++}`, run: { n: 1, role: kind, job: `j${n}`, state: "done", started: iso(a), ended: iso(a + 0.1), model: "haiku", ...extra } }) as any;
  const runs = [e("title", 10, { cost: 0.01 }), e("title", 12, { cost: 0.02 }), e("judge", 14, { cost: 0.04 })];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false);
  expect(a.outcomes.map((x) => [x.role, x.model, x.runs, x.cost])).toEqual([["title", "haiku", 2, 0.03], ["judge", "haiku", 1, 0.04]]);
});

test("agents: each outcome row has ended, p95 and, for a worker, the cost per built job", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  let n = 0;
  const e = (kind: string, a: number, len: number, extra: object = {}) => ({ folder: `p${n}`, id: `p${n++}`, run: { n: 1, role: kind, job: `j${n}`, state: "passed", size: "small", started: iso(a), ended: iso(a + len), ...extra } }) as any;
  const runs = [
    e("intake", 10, 1, { model: "m" }), e("intake", 12, 3, { model: "m", state: "failed", failed: "x" }), e("intake", 14, 2, { model: "m", state: "failed" }),
    { folder: "pr", id: "pr", run: { n: 1, role: "intake", job: "jr", state: "running", started: iso(16), model: "m" } } as any,
    // Workers: one built job at 0.91, and a build that never landed.
    e("build", 10, 1, { model: "w", cost: 0.91, job: "a" }), e("land", 12, 1, { job: "a", state: "landed" }), e("build", 15, 1, { model: "x", cost: 2 }),
  ];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => true);
  const intake = a.outcomes.find((x) => x.role === "intake")!;
  expect(intake).toMatchObject({ runs: 4, succeeded: 1, failed: 1, error: 1, ended: 3, p50: 7200, p95: 10800 });
  for (const o of a.outcomes) { expect(o.ended).toBe(o.succeeded + o.failed + o.error); if (o.p50 !== null) expect(o.p95).toBeGreaterThanOrEqual(o.p50); }
  expect(a.outcomes.find((x) => x.model === "w")).toMatchObject({ built: 1, perBuilt: 0.91 });
  expect(a.outcomes.find((x) => x.model === "x")).toMatchObject({ built: 0, perBuilt: null });
  // 150.27 over 165 built jobs is 0.91 a job.
  const many = Array.from({ length: 165 }, (_, i) => [e("build", 10, 1, { model: "w", job: `b${i}`, cost: i ? 0 : 150.27 }), e("land", 12, 1, { job: `b${i}`, state: "landed" })]).flat();
  expect(agentStats(many, 10 * H, 20 * H, H, 2, () => true).outcomes[0]).toMatchObject({ cost: 150.27, built: 165, perBuilt: 0.91 });
});

test("agents: the all-roles success rate, its baseline, the worker first pass and the local share", () => {
  const H = 3600_000, iso = (h: number) => new Date(h * H).toISOString();
  let n = 0;
  const e = (kind: string, a: number, extra: object) => ({ folder: `r${n}`, id: `r${n++}`, run: { n: 1, role: kind, job: `j${n}`, state: "passed", size: "small", started: iso(a), ended: iso(a + 1), ...extra } }) as any;
  const runs = [
    // Window 10..20: job a landed first time, job b landed after a fix round, a gpt-oss triage passed, a gpt-oss build failed.
    e("build", 10, { model: "claude-haiku", job: "a" }), e("land", 12, { job: "a", state: "landed" }),
    e("build", 13, { model: "claude-haiku", job: "b", state: "returned", failed: "review" }), e("build", 14, { model: "claude-haiku", job: "b" }), e("land", 16, { job: "b", state: "landed" }),
    e("intake", 15, { model: "gpt-oss-20b" }), e("build", 17, { model: "gpt-oss-20b", state: "failed", failed: "tests" }),
    // The span before, 0..10: one of two ended runs succeeded.
    e("build", 1, { model: "claude-haiku" }), e("build", 2, { model: "claude-haiku", state: "failed" }),
  ];
  const a = agentStats(runs, 10 * H, 20 * H, H, 2, () => false, [[0, 10 * H]]);
  expect(a.rates).toEqual({ success: 0.6, baseline: 0.5, firstPass: 0.5, local: 0.4 });
  expect(agentStats(runs, 30 * H, 40 * H, H, 2, () => false).rates).toEqual({ success: null, baseline: null, firstPass: null, local: null });
});

test("an unlanded run of an issue that left the store is Dropped", () => {
  const t = (h: number) => new Date(2026, 9, 28, h).toISOString();
  const r = { n: 1, job: "g", name: "g", repo: "fx", target: "issue.659", state: "failed", role: "build", started: t(8), ended: t(9) } as any;
  const since = new Date(2026, 9, 27).getTime(), at = new Date(2026, 9, 28, 15).getTime();
  expect(classify([r], () => "gone", since, at, null).classes.find((c) => c.key === "dropped")!.runs).toBe(1);
  expect(classify([r], () => undefined, since, at, null).notCounted.runs).toBe(1);
});

test("the shared formats", () => {
  expect([pct(0.02), pct(2.5)]).toEqual(["<0.1%", "3%"]);
  expect([xLabel(new Date(2026, 9, 28, 13, 36).toISOString(), "hour"), xLabel(new Date(2026, 9, 28).toISOString(), "week")]).toEqual(["1:36p", "Oct 28"]);
});

test("the outcome bar with no hours names a job, not a run", () => {
  const h = bar({ window: "week", classes: [], figures: { kept: null, hours: null } }, "all");
  expect(h).not.toMatch(/\bruns?\b/i);
  expect(h).toContain('<div class="empty"><p>No data</p></div>');
});

test("the outcome bar's legend share has no brackets", () => {
  const h = bar({ window: "week", classes: [{ key: "landed", hours: 3, text: "t" }], figures: { kept: 3, hours: 0 } }, "all");
  expect(h).toContain("landed <em>3.0h 100%</em>");
  expect(h).not.toContain("(");
});

test("activeEnd pulls ended back to the last worker activity", () => {
  const { utimesSync } = require("node:fs");
  const dir = mkdtempSync(join(tmpdir(), "aleph-active-"));
  const t0 = Date.parse("2026-10-28T10:00:00Z"), min = 60_000;
  const mk = (name: string, files: Record<string, number>) => {
    const folder = join(dir, name);
    mkdirSync(folder);
    for (const [f, m] of Object.entries(files)) { writeFileSync(join(folder, f), "x"); utimesSync(folder + "/" + f, (t0 + m * min) / 1000, (t0 + m * min) / 1000); }
    return { id: name, folder, run: { n: 1, role: "build", job: name, name, told: true, started: new Date(t0).toISOString(), ended: new Date(t0 + 180 * min).toISOString() } as any };
  };
  // killed: last output at 24 min, noticed at 180 min
  expect(Date.parse(activeEnd(mk("a", { log: 24, exit: 180 })).ended!)).toBe(t0 + 24 * min);
  // exit older than later review files: the newest non-exit file counts
  expect(Date.parse(activeEnd(mk("b", { log: 20, exit: 30, "call.md": 100 })).ended!)).toBe(t0 + 100 * min);
  // no activity files: keeps ended
  expect(Date.parse(activeEnd(mk("c", { exit: 180 })).ended!)).toBe(t0 + 180 * min);
  rmSync(dir, { recursive: true, force: true });
});

test("flakes count each test name; a row without tests counts under its check", async () => {
  const row = (check: string, tests?: string[]) => ({ repo: "r", check, run: "x", at: at(1, 9), ...(tests ? { tests } : {}) });
  for (const r of [row("tests", ["a.test.ts > one", "b.test.ts > two"]), row("tests", ["a.test.ts > one"]), row("tests"), row("types")]) recordFlake(r);
  try {
      const d = await speed("week", now);
    expect(d.flaky).toBe(4);
    expect(d.flakes).toEqual([{ name: "a.test.ts > one", count: 2 }, { name: "b.test.ts > two", count: 1 }, { name: "tests", count: 1 }, { name: "types", count: 1 }]);
  } finally {
    conn().run("DELETE FROM flaky");
    }
});

test("the day baseline in one read equals the baseline of seven spans each read alone", async () => {
  const { baseline } = await import("./flow.ts");
  const { figures, averageFigures } = await import("../flow/baseline.ts");
  const at = now;
  let seen = 0;
  for (const w of ["hour", "day", "week", "month"] as const) {
    const one = baseline(w, at);
    const { n, step } = { hour: { n: 12, step: 3600_000 }, day: { n: 7, step: 864e5 }, week: { n: 1, step: 7 * 864e5 }, month: { n: 1, step: 30 * 864e5 } }[w];
    const spans = Array.from({ length: n }, (_, i) => figures(speed(w, new Date(at.getTime() - (i + 1) * step))));
    expect(one.prev).toEqual(spans[0]);
    expect(one.base).toEqual(n > 1 ? averageFigures(spans) : spans[0]);
    seen += spans.filter((f) => f.landed !== null).length;
  }
  expect(seen).toBeGreaterThan(0); // the spans hold runs, so the two ways compare real figures
});

test("GET /api/flow?baseline=1 reads the job records once for the window, the other windows and every span", async () => {
  setSystemTime(new Date(2026, 9, 28, 15));
  // The reads of the whole jobs table: the records are cached, so the many callers share one.
  const d = conn(), real = d.query.bind(d);
  let calls = 0;
  const spy = spyOn(d, "query").mockImplementation(((sql: string) => { if (sql.startsWith("SELECT * FROM jobs ")) calls++; return real(sql); }) as any);
  try {
    run({ role: "land", state: "landed", ...secs(0, 13, 60) });
    calls = 0;
    // The page builds in a pass (ui/build-worker.ts), where the jobs read is cached for the pass.
    openPass({}, "t");
    const r = await routes["GET /api/flow"](new Request("http://x/api/flow?window=day&baseline=1"), {}, new URL("http://x/api/flow?window=day&baseline=1"));
    expect(r.status).toBe(200);
    expect(calls).toBe(1);
  } finally { closePass(); spy.mockRestore(); setSystemTime(); }
});

test("cardTrend writes a sub-point change with pct() and keeps the flat marker for 0", async () => {
  // @ts-ignore plain JS shared with the page
  const { cardTrend } = await import("../views/lib/html.js");
  const o = { kind: "points", lowerIsGood: true, format: String, basis: "b" };
  expect(cardTrend(0.503, 0.5, null, o)).toContain("▲ 0.3%");
  expect(cardTrend(0.5, 0.5, null, o)).toContain("▬ 0%");
  expect(cardTrend(0.63, 0.5, null, o)).toContain("▲ 13%");
});

test("asks: the window counts the Asks set, and those that came to Chris, in the answer and in figures()", () => {
  const dir = (ref: string, at: string, outcome: string) => made.push(seed({ role: "director", state: "done", started: at, decision: { at, ref, outcome } }).id);
  // An Ask is a `question` event of the issue, then an `answered` event when it goes.
  const ev = (time: string, action: string, issue: number) => conn().run("INSERT INTO events (time, subject, action, object, detail) VALUES (?, 'gate', ?, ?, ?)", [time, action, `issue.${issue}`, action === "question" ? "question" : null]);
  const rec = (issue: number, asks: { set: string; cleared?: string }[]) => asks.forEach((a) => { ev(a.set, "question", issue); if (a.cleared) ev(a.cleared, "answered", issue); });
  rec(1, [{ set: at(1, 9), cleared: at(1, 10) }]); dir("fx-1", at(1, 9, 30), "escalated"); // escalated between set and cleared
  rec(2, [{ set: at(0, 7) }, { set: at(40, 9), cleared: at(40, 10) }]); dir("fx-2", at(0, 6), "escalated"); dir("fx-2", at(0, 7, 5), "decided"); // escalated before the set; decided; one outside the window
  const s = speed("week", now);
  expect(s.asks).toEqual({ count: 2, manual: 1 });
  expect(figures(s)).toMatchObject({ asks: 2 });
  expect(figures(speed("hour", new Date(2026, 8, 1)))).toMatchObject({ asks: 0 });
  expect(averageFigures([figures(s)]).asks).toBe(2);
});

test("GET /api/flow?project= counts only that repo's runs and issues, in the answer and the baseline", async () => {
  // 60 days back (this week) and 67 days back (the week before), so no other test's window sees these runs.
  const land = (daysAgo: number, repo: string, i: number) => run({ role: "land", state: "landed", repo, target: `issue.${i}`, ...secs(daysAgo, 9, 60) });
  land(60, "alpha", 1); land(60, "beta", 1); land(60, "beta", 2);
  run({ role: "build", state: "passed", repo: "alpha", target: "issue.1", ...secs(60, 8, 300) });
  run({ role: "build", state: "passed", repo: "beta", target: "issue.1", ...secs(60, 8, 300) });
  run({ role: "build", state: "passed", repo: "beta", target: "issue.2", ...secs(60, 8, 300) });
  land(67, "alpha", 3); land(67, "beta", 3); land(67, "beta", 4);
  setSystemTime(new Date(2026, 9, 28 - 60, 15));
  try {
    const get = async (q: string) => (await routes["GET /api/flow"](new Request(`http://x/api/flow${q}`), {}, new URL(`http://x/api/flow${q}`))).json();
    const a = await get("?window=week&project=alpha");
    expect(a.done).toBe(1);
    const both = await get("?window=week");
    expect(both.done).toBe(3);
    const b = await get("?window=week&project=alpha&baseline=1");
    expect(b.baseline.prev.landed).toBe(1);
    expect((await get("?window=week&baseline=1")).baseline.prev.landed).toBe(3);
  } finally { setSystemTime(); }
});

test("a bucket's cost per model is the recorded cost of the agent runs that started in it", () => {
  const now3 = new Date(2026, 4, 10, 15), h = (hh: number, m = 0) => new Date(2026, 4, 10, hh, m).toISOString();
  run({ role: "build", repo: "pc", state: "passed", model: "opus", cost: 1.25, started: h(9, 5), ended: h(9, 10) });
  run({ role: "build", repo: "pc", state: "passed", model: "opus", cost: 0.5, started: h(9, 40), ended: h(10, 10) }); // ends in the next hour, counts where it starts
  run({ role: "build", repo: "pc", state: "passed", model: "sonnet", cost: 2, started: h(9, 20), ended: h(9, 30) });
  run({ role: "build", repo: "pc", state: "passed", cost: 4, started: h(11), ended: h(11, 5) });
  const d = speed("day", now3, null, "pc");
  const at9 = d.buckets.find((b) => b.at === h(9))!, at11 = d.buckets.find((b) => b.at === h(11))!;
  expect(at9.cost).toEqual({ opus: 1.75, sonnet: 2 });
  expect(at11.cost).toEqual({ unset: 4 });
  expect(d.buckets.find((b) => b.at === h(12))!.cost).toEqual({});
});

test("a bucket's tokens per model are the saved tokens of the agent runs that started in it, 0 for a run with none", () => {
  const now3 = new Date(2026, 4, 10, 15), h = (hh: number, m = 0) => new Date(2026, 4, 10, hh, m).toISOString();
  run({ role: "build", repo: "pc", state: "passed", model: "opus", tokens: 1000, started: h(9, 5), ended: h(9, 10) });
  run({ role: "build", repo: "pc", state: "passed", model: "opus", tokens: 500, started: h(9, 40), ended: h(10, 10) });
  run({ role: "build", repo: "pc", state: "passed", model: "sonnet", tokens: 2000, started: h(9, 20), ended: h(9, 30) });
  run({ role: "build", repo: "pc", state: "passed", tokens: 40, started: h(11), ended: h(11, 5) });
  run({ role: "build", repo: "pc", state: "passed", model: "sonnet", started: h(13), ended: h(13, 5) });
  const d = speed("day", now3, null, "pc");
  expect(d.buckets.find((b) => b.at === h(9))!.tokens).toEqual({ opus: 1500, sonnet: 2000 });
  expect(d.buckets.find((b) => b.at === h(11))!.tokens).toEqual({ unset: 40 });
  expect(d.buckets.find((b) => b.at === h(13))!.tokens).toEqual({ sonnet: 0 });
  expect(d.buckets.find((b) => b.at === h(12))!.tokens).toEqual({});
});

test("every Status card with a second value has a qualifier, Lost time too, and none prints undefined", () => {
  const d = { asks: { count: 4, manual: 1 }, figures: { lost: 0.3, hours: 6, leadP50: 60, leadP90: 600, asks: 4, landed: 5, firstPass: 0.8 } };
  const s = { now: "2026-11-01T08:00:00Z", factory: { liveRuns: 0 }, queued: [], usage: { now: { seven_day: 7, seven_day_resets_at: "2026-11-07T08:00:00Z" } } };
  for (const html of [statusCards(s, d, {}), statusCards({ now: s.now, factory: { liveRuns: 0 }, queued: [] }, null, {})]) {
    expect(html).not.toContain("undefined");
    const cards = html.split(/(?=<(?:a|div|button) [^>]*class="tile sc")/);
    for (const c of cards) if (c.includes("<em>")) expect(c).toContain('<span class="q">');
  }
  expect(statusCards(s, d, {})).toContain('<b>30%<em> / 6.0h</em></b><span class="q"><span>lost</span><span class="m"> / hours</span>');
});

test("speed: a build on an unchanged store spawns one git process and reads the same filing times and titles", () => {
  // A store of its own: its registry would replace the alpha, beta and pc of the shared one.
  const store = join(base, "speed-issues");
  const off = withEnv({ ALEPH_ITEMS: store });
  mkdirSync(join(store, "issues/7"), { recursive: true });
  writeRepos({ tt: {} }, store);
  writeFileSync(join(store, "issues/7/issue.md"), "---\nproject: project.1\ntitle: Seven\n---\n");
  const who = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t", GIT_AUTHOR_DATE: "@5000 +0000", GIT_COMMITTER_DATE: "@5000 +0000" };
  for (const a of [["init", "-q"], ["add", "."], ["commit", "-qm", "tt: add"], ["update-ref", "refs/remotes/origin/main", "HEAD"]]) Bun.spawnSync(["git", "-C", store, ...a], { env: { ...process.env, ...who } });
  run({ role: "build", state: "passed", repo: "tt", target: "issue.7", cost: 1, ...secs(0, 9, 600) });
  run({ role: "land", state: "landed", repo: "tt", target: "issue.7", ...secs(0, 9, 40) });
  const read = () => { const d = speed("week", now, { fable: 0.1, rest: 0.1, pooled: true, hours: 24 }); return [d.times.map((x) => x.filed), d.issues.usage.map((u) => u.title)]; };
  const first = read();
  expect(first[1]).toContain("Seven");
  const spawn = Bun.spawnSync, calls: string[][] = [];
  Bun.spawnSync = ((cmd: string[], ...rest: unknown[]) => (calls.push(cmd), (spawn as Function)(cmd, ...rest))) as typeof Bun.spawnSync;
  try {
    expect(read()).toEqual(first);
  } finally {
    Bun.spawnSync = spawn;
    off();
  }
  expect(calls.filter((c) => c[0] === "git").length).toBeLessThanOrEqual(1);
});

test("classify: the restart loop starts at the run cap setting", () => {
  const off = withEnv({ ALEPH_RUN_CAP: "5" });
  try {
    const t = (m: number) => new Date(2026, 9, 28, 8, m).toISOString();
    const runs = [0, 1, 2, 3, 4, 5].map((i) => ({ n: 1, role: "build", job: `l${i}`, name: `l${i}`, repo: "fx", target: "issue.2", state: "passed", started: t(i * 5), ended: t(i * 5 + 4) }) as any);
    const out = classify(runs, () => "open", new Date(2026, 9, 27).getTime(), new Date(2026, 9, 28, 15).getTime(), null);
    const reran = out.classes.find((c) => c.key === "reran")!;
    expect(reran.causes.map((c) => c.name)).toEqual(["Restart loop"]);
    expect(reran.causes[0].text).toContain("6 or more");
    expect(reran.issues).toBe(1);
    expect(out.notCounted.runs).toBe(5);
  } finally { off(); }
});

test("activeIssues counts each issue once per bucket in each stage it was in", () => {
  const H = 3600_000, t0 = new Date(2026, 2, 10, 12).getTime(), at = (h: number) => t0 + h * H;
  const r = (n: number, kind: string, state: string, a: number, b: number) => ({ role: kind, job: `ax-${n}`, name: "x", repo: "ax", target: `issue.${n}`, state: state, started: new Date(at(a)).toISOString(), ended: new Date(at(b)).toISOString() }) as any;
  // The day window ends in the hour of `now` (15:30): hourly buckets from 16:00 the day before.
  const now = at(3.5), b = buckets("day", now), slot = (h: number) => b.slotOf(at(h));
  const f = { issue: new Map<string, number | null>([["ax-1", at(-2)], ["ax-2", at(0.5)]]) };
  const rows = activeIssues([
    // ax-1: filed -2h, triaged 0.5h (intake), starts 1.5h (queued), builds to 2.5h, lands 3h.
    r(1, "intake", "done", 0, 0.5), r(1, "build", "passed", 1.5, 2.5), r(1, "land", "landed", 2.9, 3),
    // ax-2: filed 0.5h with no intake run, starts 2h and is still running.
    { ...r(2, "build", "running", 2, 2), ended: undefined },
  ], f, b, now);
  const at2 = (h: number) => rows[slot(h)];
  expect(at2(-2)).toMatchObject({ intake: 1, queue: 0, running: 0, landed: 0 }); // ax-1 is in intake from its filing
  expect(at2(0.7)).toMatchObject({ intake: 1, queue: 2, running: 0 }); // ax-1 is triaged at 0.5h and ax-2 is filed then
  expect(at2(1.7)).toMatchObject({ intake: 0, queue: 2, running: 1 }); // ax-1 starts at 1.5h and ax-2 still waits
  expect(at2(2.2)).toMatchObject({ queue: 0, running: 2, landed: 0 }); // ax-2 starts at 2h: the edge is not in the hour before
  expect(at2(3.2)).toMatchObject({ running: 1, landed: 1 }); // ax-1 landed at 3h: it counts as landed, not running, in that hour
  expect(rows).toHaveLength(24);
});

test("activeIssues counts an open issue with no agent run in intake, then in the queue", () => {
  const H = 3600_000, t0 = new Date(2026, 2, 10, 12).getTime(), at = (h: number) => t0 + h * H;
  const now = at(3.5), b = buckets("day", now), slot = (h: number) => b.slotOf(at(h));
  const intake = { role: "intake", job: "ax-2", name: "x", repo: "ax", target: "issue.2", state: "done", started: new Date(at(0)).toISOString(), ended: new Date(at(2)).toISOString() } as any;
  const f = { issue: new Map<string, number | null>([["ax-1", at(0.5)], ["ax-2", at(-1)], ["ax-3", at(0.5)]]) };
  // ax-1 is open with no run, ax-2 is open with an ended intake run, ax-3 is closed with no run.
  const rows = activeIssues([intake], f, b, now, (k) => k !== "ax-3");
  const at2 = (h: number) => rows[slot(h)];
  expect(at2(-0.5)).toMatchObject({ intake: 1, queue: 0 }); // ax-2 only: ax-1 is filed at 0.5h
  expect(at2(1.2)).toMatchObject({ intake: 2, queue: 0 }); // both wait in intake
  expect(at2(2.2)).toMatchObject({ intake: 1, queue: 1 }); // ax-2 left intake at 2h: the edge is not in the hour before
  expect(at2(3.2)).toMatchObject({ intake: 1, queue: 1, running: 0, landed: 0 }); // up to now
  expect(rows.slice(slot(-1) + 1).every((r) => r.intake + r.queue <= 2)).toBe(true); // ax-3 is never counted
});
