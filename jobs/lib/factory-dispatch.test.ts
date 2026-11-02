import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { dispatchIssues } from "./factory.ts";
import { readHolds } from "./factory-status.ts";
import { lock } from "./ledger.ts";
import { readList } from "../../todo/lib/store.ts";
import { ctx, sh, goal, change, mk, fakes, dispatch, withChecks, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

test("a goal turned back into an issue during the baseline is not started", async () => {
  const id = goal();
  const calls: string[] = [];
  let baselined = false;
  const out = await dispatchIssues(async (_repo, name) => { calls.push(name); return null; }, async () => {
    baselined = true;
    await change(id, (item) => { item.spec = ""; });
    return null;
  });
  expect(baselined).toBe(true);
  expect(calls).toEqual([]);
  expect(out.skipped).toEqual([]);
});

test("a goal closed during the baseline is not started", async () => {
  const id = goal();
  const calls: string[] = [];
  const out = await dispatchIssues(async (_repo, name) => { calls.push(name); return null; }, async () => {
    await change(id, (item) => issues.setStatus(item, "done"));
    return null;
  });
  expect(calls).toEqual([]);
  expect(out.skipped).toEqual([]);
});

// The baselines all run before the goals are read again, so the gap that matters is between that read and a goal's lock:
// an earlier goal's start is where it opens.
test("a goal given an after while an earlier goal starts is not started", async () => {
  const first = goal();
  const second = goal();
  const other = writeList({ key: "fac" }, "add an open item", (doc) => { const i = issues.add(doc, "not a goal"); issues.setStatus(issues.addPart(doc, i, { title: "g", spec: "b" }), "dropped"); return i.id; }, true)!.value;
  const calls: string[] = [];
  const out = await dispatchIssues(async (_repo, name) => {
    calls.push(name);
    if (name === `fac-${first}`) await change(second, (item) => { item.fm.after = [`fac-${other}.1`]; });
    return null;
  }, async () => null);
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.started).toEqual([`fac-${first}`]);
  expect(out.skipped).toEqual([`fac-${second}: blocked: after fac-${other}.1`]);
});

// An "already met" drop closes a factory item with no commit that names it; the goals that wait on it still start.
test("a goal waiting on a factory item the store says done, with no commit naming it, starts", async () => {
  const blocker = writeList({ key: "fac" }, "add the blocker", (doc) => issues.add(doc, "met elsewhere").id, true)!.value;
  mk(`fac-${blocker}`, "build", "dropped", { reason: "the goal is already met" });
  await change(blocker, (item) => issues.setStatus(item, "done"));
  const waiter = goal();
  await change(waiter, (item) => { item.fm.after = [`fac-${blocker}`]; });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([`fac-${waiter}`]);
  expect(out.skipped).toEqual([]);
});

// The list is read after the baselines, so the label gap is between that read and a goal's lock: an earlier goal's start removes it.
test("a goal turned back into an issue while an earlier goal starts is not started", async () => {
  const first = goal();
  const second = goal();
  const calls: string[] = [];
  const out = await dispatchIssues(async (_repo, name) => {
    calls.push(name);
    if (name === `fac-${first}`) await change(second, (item) => { item.spec = ""; });
    return null;
  }, async () => null);
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.started).toEqual([`fac-${first}`]);
  expect(out.skipped).toEqual([`fac-${second}: not a goal`]);
});

// The list is read after the baselines, so the closed gap is between that read and a goal's lock: an earlier goal's start closes it.
test("a goal closed while an earlier goal starts is not started", async () => {
  const first = goal();
  const second = goal();
  const calls: string[] = [];
  const out = await dispatchIssues(async (_repo, name) => {
    calls.push(name);
    if (name === `fac-${first}`) await change(second, (item) => issues.setStatus(item, "done"));
    return null;
  }, async () => null);
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.started).toEqual([`fac-${first}`]);
  expect(out.skipped).toEqual([`fac-${second}: not a goal`]);
});

// A dispatch that finds the baseline held skips with `main baseline running`; the holder starts the goal.
test("a goal added while another dispatch holds the baseline is started by the holder", async () => {
  goal();
  let added = 0;
  let b: Awaited<ReturnType<typeof dispatchIssues>> | undefined;
  const a = await dispatchIssues(async () => null, async () => {
    added = goal();
    b = await dispatchIssues(async () => null, async () => null);
    return null;
  });
  expect(b!.started).toEqual([]);
  expect(b!.skipped).toContain(`fac-${added}: main baseline running`);
  expect(a.started).toContain(`fac-${added}`);
});

// The baseline of a repo that joins the list while another baseline runs is itself run before the goals start.
test("a goal added while the baseline of a repo that joined the list runs is started by the holder", async () => {
  sh(ctx.base, "git", "init", "-q", "--bare", "-b", "main", join(ctx.base, "two.git"));
  sh(ctx.base, "git", "clone", "-q", join(ctx.base, "two.git"), join(ctx.base, "two"));
  sh(join(ctx.base, "two"), "git", "commit", "-q", "--allow-empty", "-m", "init");
  sh(join(ctx.base, "two"), "git", "push", "-q", "origin", "main");
  writeFileSync(join(ctx.base, "repos.json"), JSON.stringify({
    fac: { path: join(ctx.base, "repo"), sandbox: true, autoland: false },
    two: { path: join(ctx.base, "two"), sandbox: true, autoland: false },
  }));
  goal();
  let first = 0, second = 0;
  let b: Awaited<ReturnType<typeof dispatchIssues>> | undefined;
  const a = await dispatchIssues(async () => null, async (repo) => {
    if (repo.key === "fac") first = goal([], "two");
    else {
      second = goal([], "two");
      b = await dispatchIssues(async () => null, async () => null);
    }
    return null;
  });
  expect(b!.skipped).toContain(`two-${first}: main baseline running`);
  expect(b!.skipped).toContain(`two-${second}: main baseline running`);
  expect(a.started).toContain(`two-${first}`);
  expect(a.started).toContain(`two-${second}`);
});

test("a goal that stays open and labelled is started exactly once", async () => {
  const id = goal();
  const calls: string[] = [];
  const out = await dispatchIssues(async (_repo, name) => { calls.push(name); return null; }, async () => null);
  expect(calls).toEqual([`fac-${id}`]);
  expect(out.started).toEqual([`fac-${id}`]);
  expect(out.skipped).toEqual([]);
});

const prio = (key: string, p: string) =>
  writeList({ key }, "add a goal", (doc) => { const item = issues.add(doc, "ship it", { priority: p, spec: "Do the thing." }); return item.id; }, true)!.value;

test("with a live cap of 1, the critical goal starts and the others wait", async () => {
  process.env.ALEPH_LIVE_CAP = "1";
  prio("fac", "low");
  const hi = prio("fac", "critical");
  prio("fac", "medium");
  // A start makes a live run, as the real one does, so the cap counts it.
  const out = await dispatchIssues(async (_r, name) => { mk(name, "build", "running", { made: Date.now() }); return null; }, async () => null);
  expect(out.started).toEqual([`fac-${hi}`]);
});

test("planner items of two repos are planned high first", async () => {
  writeFileSync(join(ctx.base, "repos.json"), JSON.stringify({
    aaa: { path: join(ctx.base, "repo"), sandbox: true, autoland: false },
    zzz: { path: join(ctx.base, "repo"), sandbox: true, autoland: false },
  }));
  const add = (key: string, p: string) => writeList({ key }, "add", (doc) => { const i = issues.add(doc, "plan me", { priority: p }); i.fm.plan = "true"; return i.id; }, true)!.value;
  const lo = add("aaa", "low");
  const hi = add("zzz", "high");
  const order: string[] = [];
  await dispatchIssues(async () => null, async () => null, undefined, undefined, undefined, (repo, id) => { order.push(`${repo.key}-${id}`); });
  expect(order).toEqual([`zzz-${hi}`, `aaa-${lo}`]);
});

const redBaseline = () => {
  const commit = Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: join(ctx.base, "repo") }).stdout.toString().trim();
  mkdirSync(join(ctx.base, "factory"), { recursive: true });
  writeFileSync(join(ctx.base, "factory", "baseline.json"), JSON.stringify({ fac: { repo: "fac", commit, ok: false, failed: "x" } }));
  return commit;
};
const doneParent = (): number => writeList({ key: "fac" }, "add", (doc) => {
  const i = issues.add(doc, "parent");
  issues.setStatus(issues.addPart(doc, i, { title: "g", spec: "Do it." }), "done");
  return i.id;
}, true)!.value;
const parentStatus = (id: number) => issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!);

test("a land's green baseline on the pushed commit: the next dispatch runs no baseline checks and starts the goal", async () => {
  const commit = Bun.spawnSync(["git", "rev-parse", "origin/main"], { cwd: join(ctx.base, "repo") }).stdout.toString().trim();
  mkdirSync(join(ctx.base, "factory"), { recursive: true });
  writeFileSync(join(ctx.base, "factory", "baseline.json"), JSON.stringify({ fac: { repo: "fac", commit, ok: true } }));
  const id = goal();
  const f = fakes();
  let ran = 0;
  const out = await withChecks(f, async () => { ran++; return null; });
  expect(ran).toBe(0);
  expect(out.started).toEqual([`fac-${id}`]);
});

test("a parent whose parts are all done closes in a dispatch where main's baseline is red", async () => {
  redBaseline();
  const id = doneParent();
  const f = fakes();
  await withChecks(f, async () => { throw new Error("no baseline run"); });
  expect(parentStatus(id)).toBe("done");
});

test("a parent whose parts are all done closes in a dispatch where another dispatch holds the baseline", async () => {
  const id = doneParent();
  const f = fakes();
  const release = await lock("baseline-fac", 0);
  try {
    const out = await withChecks(f, async () => null);
    expect(out.started).toEqual([]);
  } finally {
    release!();
  }
  expect(parentStatus(id)).toBe("done");
});

test("a goal that waits on an open after gets one hold record; a second dispatch with the same reason adds none; when it starts a started record ends the hold", async () => {
  const blocker = goal();
  const waiter = goal();
  await change(waiter, (item) => { item.fm.after = [`fac-${blocker}`]; });
  const name = `fac-${waiter}`;
  const f = fakes();
  const start = async (r: unknown, n: string, id: number | string, spec: string) => (n === `fac-${blocker}` ? "no slot" : f.start(r, n, id, spec));
  await dispatchIssues(start, async () => null, f.land, f.rescue);
  const recs = () => readHolds([name]);
  expect(recs()).toHaveLength(1);
  expect(recs()[0]).toMatchObject({ name, kind: "waits_on", text: expect.stringContaining(`after fac-${blocker}`) });
  expect(Number.isNaN(Date.parse(recs()[0].at))).toBe(false);
  await dispatchIssues(start, async () => null, f.land, f.rescue);
  expect(recs()).toHaveLength(1);
  expect(readHolds([`fac-${blocker}`]).map((r) => r.kind)).toEqual(["start"]);
  await change(blocker, (item) => issues.setStatus(item, "done"));
  mk(`fac-${blocker}`, "build", "passed", { commit: "abc" });
  await dispatchIssues(f.start, async () => null, f.land, f.rescue);
  expect(recs().map((r) => r.kind)).toContain("started");
});

test("a goal that a red main holds gets one hold record", async () => {
  const id = goal();
  await dispatchIssues(async () => null, async () => "tests failed");
  await dispatchIssues(async () => null, async () => "tests failed");
  const recs = readHolds([`fac-${id}`]);
  expect(recs).toHaveLength(1);
  expect(recs[0].kind).toBe("red");
});

test("a goal that a busy file holds gets one hold record", async () => {
  const surface = "## Edit surface\n- jobs/busy.ts (the change)\n";
  const add = () => writeList({ key: "fac" }, "add a goal", (doc) => issues.add(doc, "ship it", { spec: surface }).id, true)!.value;
  for (const n of [901, 902, 903]) mk(`fac-${n}`, "land", "dropped", { conflicts: ["jobs/busy.ts"] });
  const first = add();
  const second = add();
  mk(`fac-${first}`, "build", "passed");
  await dispatchIssues(async () => null);
  await dispatchIssues(async () => null);
  const recs = readHolds([`fac-${second}`]);
  expect(recs).toHaveLength(1);
  expect(recs[0]).toMatchObject({ kind: "busy", text: `waits for fac-${first}: both change the busy file jobs/busy.ts` });
});
