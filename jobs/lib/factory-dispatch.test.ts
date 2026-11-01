import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { dispatchIssues } from "./factory.ts";
import { ctx, sh, goal, change, mk, fakes, dispatch, setup, teardown } from "./factory.helpers.ts";

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
