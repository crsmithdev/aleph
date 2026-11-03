import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { health } from "./factory-status.ts";
import { AWAITING_CAP } from "./settings.ts";
import { allRuns } from "./ledger.ts";
import { ctx, sh, goal, change, mk, notes, ask, fakes, dispatch, setup, teardown } from "./factory.helpers.ts";
import { clearAsk, setAsk } from "./ask.ts";

beforeEach(setup);
afterEach(() => { setSystemTime(); teardown(); });

test("no commit, the item already done: the run is dropped as a duplicate, once, and the factory is not held", async () => {
  const id = goal();
  await change(id, (item) => issues.setStatus(item, "done"));
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(notes(id)).toContain("already done: dropped as a duplicate");
  expect(allRuns()[0].run.reason).toContain("dropped as a duplicate");
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`]);
});

test("no commit, the work on main by its Job trailer: dropped as a duplicate and the item closed", async () => {
  const id = goal();
  const r = mk(`fac-${id}`, "build", "stuck", { reason: "no commit" });
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nJob: ${r.job}`);
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(notes(id)).toMatch(/on main as [0-9a-f]{7}: dropped as a duplicate/);
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
  expect(f.specs).toEqual([]);
});

test("no commit, the item on main by its Item trailer: the open item is closed with a note naming the commit", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" });
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nIssue: fac-${id}\nJob: other`);
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  const sha = Bun.spawnSync(["git", "rev-parse", "--short=7", "HEAD"], { cwd: join(ctx.base, "repo") }).stdout.toString().trim();
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(notes(id)).toContain(`on main as ${sha}: dropped as a duplicate`);
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
  expect(f.specs).toEqual([]);
});

test("a goal whose item is done on main is not dispatched", async () => {
  const id = goal();
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nIssue: fac-${id}\nJob: other`);
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([]);
  expect(f.specs).toEqual([]);
});

test("a fourth no-commit run in a row is not dispatched; the item gets an Ask", async () => {
  const id = goal();
  for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "no commit, run X ended with no commit: dropped as a duplicate", noCommit: true, started: new Date(Date.now() - (4 - i) * 60_000).toISOString() });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([]);
  expect(out.skipped.join()).toContain("3 runs in a row with no commit");
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain("ended with no commit");
  expect(readList({ key: "fac" })!.items.find((i) => i.id === id)!.fm.reason).toBe("no-commit");
  await dispatch(f);
  expect(f.specs).toEqual([]);
});

const noCommitRuns = (id: number, n: number, ago: number) => {
  for (let i = 0; i < n; i++) mk(`fac-${id}`, "build", "dropped", { reason: "run X ended with no commit: dropped", noCommit: true, started: new Date(Date.now() - (ago - i) * 1000).toISOString() });
};
const unlabel = (id: number) => change(id, (item) => clearAsk(item));
const chrisNotes = (id: number) => notes(id).split("asks Chris:").length - 1;

test("answering the Ask restarts the no-commit streak; three more no-commit runs give it another Ask", async () => {
  const id = goal();
  // Two hours back: outside the run cap's hour, so only the streak holds the goal.
  noCommitRuns(id, 3, 7200);
  const f = fakes();
  expect((await dispatch(f)).started).toEqual([]);
  expect(ask(id)).not.toBeNull();
  // The clock is the test's: each step moves it a second, so the Ask's answer comes after the runs before it.
  const t0 = Date.now();
  setSystemTime(new Date(t0 + 1000));
  await unlabel(id);
  expect((await dispatch(f)).started).toEqual([`fac-${id}`]);
  // the started run is not a no-commit run; three more finish after the mark
  setSystemTime(new Date(t0 + 2000));
  noCommitRuns(id, 3, 0);
  const g = fakes();
  expect((await dispatch(g)).started).toEqual([]);
  expect(g.specs).toEqual([]);
  expect(ask(id)).not.toBeNull();
  expect(chrisNotes(id)).toBe(2);
});

test("while the Ask stays on the item, dispatches start nothing and write one note", async () => {
  const id = goal();
  noCommitRuns(id, 3, 600);
  const f = fakes();
  await dispatch(f);
  await dispatch(f);
  expect(f.specs).toEqual([]);
  expect(ask(id)).not.toBeNull();
  expect(chrisNotes(id)).toBe(1);
});

test("a done item gets no run and no run-cap note, even with three recent runs", async () => {
  const id = goal();
  await change(id, (item) => issues.setStatus(item, "done"));
  for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "time box" });
  const f = fakes();
  await dispatch(f);
  expect(f.specs).toEqual([]);
  expect(ask(id)).toBeNull();
});

// The run cap: a fourth agent run of a goal in 60 minutes is not started; one Ask note says so.
const RUN_CAP_NOTE = "the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it";
test("a fourth start in an hour is skipped with one Ask note, and the goal is not started", async () => {
  const id = goal();
  for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - (i + 1) * 60_000).toISOString() });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([]);
  expect(out.skipped.join()).toContain("3 runs in the last hour");
  expect(f.specs).toEqual([]);
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain(RUN_CAP_NOTE);
  await dispatch(f);
  await dispatch(f);
  expect(f.specs).toEqual([]);
  expect(notes(id).split("asks Chris:").length - 1).toBe(1);
});

const recent = (id: number, n: number) => {
  for (let i = 0; i < n; i++) mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - (i + 1) * 60_000).toISOString() });
};
const capPath = (id: number) => join(ctx.base, "factory", "cap", `fac-${id}.txt`);

test("a cap mark with the label holds the goal below the hour count; once Chris removes the label it starts, and the next cap hit notes again", async () => {
  const id = goal();
  recent(id, 3);
  const f = fakes();
  await dispatch(f);
  expect(existsSync(capPath(id))).toBe(true);
  expect(notes(id).split("asks Chris:").length - 1).toBe(1);
  // Old starts leave the window: one start 60 seconds ago.
  const g = goal();
  mk(`fac-${g}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - 60_000).toISOString() });
  mkdirSync(join(ctx.base, "factory", "cap"), { recursive: true });
  writeFileSync(capPath(g), "x\n");
  await change(g, (item) => { setAsk(item, { kind: "input", reason: "run-cap", question: "q", options: [], why: [] }); });
  const out = await dispatch(fakes());
  expect(out.started).not.toContain(`fac-${g}`);
  // An item with an Ask is no goal: the dispatch lists nothing to skip.
  expect(notes(g)).not.toContain("asks Chris:");
  // Chris reruns: the label is removed while 3 starts are in the hour.
  recent(g, 2);
  await change(g, (item) => clearAsk(item));
  const f2 = fakes();
  const out2 = await dispatch(f2);
  expect(out2.started).toEqual([`fac-${g}`]);
  expect(existsSync(capPath(g))).toBe(false);
  // The started run is dropped; the hour count is still at the cap and no mark is left.
  mk(`fac-${g}`, "build", "dropped", { reason: "time box" });
  const out3 = await dispatch(f2);
  expect(out3.started).toEqual([]);
  expect(existsSync(capPath(g))).toBe(true);
  expect(notes(g).split("asks Chris:").length - 1).toBe(1);
  expect(notes(g)).toContain("until Chris reruns it");
  expect(ask(g)).not.toBeNull();
});

test("a failed run-cap note leaves no cap mark", async () => {
  const id = goal();
  recent(id, 3);
  // The clone cannot store a new commit, so the note write fails while the goal still reads.
  const objects = join(ctx.base, "items", ".git", "objects");
  sh(ctx.base, "chmod", "-R", "a-w", objects);
  const f = fakes();
  const out = await dispatch(f).finally(() => sh(ctx.base, "chmod", "-R", "u+w", objects));
  expect(out.started).toEqual([]);
  expect(ask(id)).toBeNull();
  expect(existsSync(capPath(id))).toBe(false);
});

test("a run that is three runs old, or three runs of other goals, does not hold the goal", async () => {
  const id = goal();
  for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - 7200_000).toISOString() });
  mk(`fac-${id + 100}`, "build", "dropped", { reason: "time box" });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([`fac-${id}`]);
  expect(ask(id)).toBeNull();
});

test("ALEPH_AWAITING_CAP=1 with one awaiting run skips the next start with the awaiting gate's line", async () => {
  const waiter = goal();
  const next = goal();
  mk(`fac-${waiter}`, "build", "awaiting", { ask: { kind: "input", reason: "question", question: "q?", options: [], why: [] } });
  process.env.ALEPH_AWAITING_CAP = "1";
  try {
    const f = fakes();
    const out = await dispatch(f);
    expect(out.started).toEqual([]);
    expect(out.skipped).toContain(`fac-${next}: 1 runs wait for Chris`);
    expect(f.specs).toEqual([]);
    expect(health()).toContain("health: 1 runs wait for Chris; no new run starts");
    // A drop of the awaiting run frees its place.
    await f.rescue.drop(`fac-${waiter}`, "test over");
    expect((await dispatch(f)).started).toContain(`fac-${next}`);
  } finally {
    delete process.env.ALEPH_AWAITING_CAP;
  }
});

test("caps.json awaiting sets the cap, and the old waiting key still does", () => {
  mkdirSync(join(ctx.base, "factory"), { recursive: true });
  writeFileSync(join(ctx.base, "factory", "caps.json"), JSON.stringify({ awaiting: 2 }));
  expect(AWAITING_CAP()).toBe(2);
  writeFileSync(join(ctx.base, "factory", "caps.json"), JSON.stringify({ waiting: 3 }));
  expect(AWAITING_CAP()).toBe(3);
  rmSync(join(ctx.base, "factory", "caps.json"));
  expect(AWAITING_CAP()).toBe(5);
});

test("the run cap holds with a standing Rerun: the rerun of the third run is the fourth start and gets the note", async () => {
  mkdirSync(join(ctx.base, "factory"), { recursive: true });
  writeFileSync(join(ctx.base, "factory", "always.json"), JSON.stringify({ rescue: { action: "recommended", at: new Date().toISOString() } }));
  const id = goal();
  mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - 120_000).toISOString() });
  mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - 60_000).toISOString() });
  mk(`fac-${id}`, "build", "stuck", { reason: "tests failed after 2 fix rounds" });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toContain(`drop fac-${id}`);
  expect(f.calls.filter((c) => c.startsWith("start"))).toEqual([]);
  expect(out.skipped.join()).toContain("3 runs in the last hour");
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain(RUN_CAP_NOTE);
  expect(notes(id)).toContain("always: Rerun");
});
