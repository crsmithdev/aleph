// The dispatch and a goal that changes while it runs: during the baseline, while an earlier goal starts, and while another dispatch holds the baseline.
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
  }, undefined, undefined, undefined, undefined, undefined);
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
  }, undefined, undefined, undefined, undefined, undefined);
  expect(calls).toEqual([]);
  expect(out.skipped).toEqual([]);
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
  }, async () => null, undefined, undefined, undefined, undefined, undefined);
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.started).toEqual([`fac-${first}`]);
  expect(out.skipped).toEqual([`fac-${second}: not a goal`]);
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
      b = await dispatchIssues(async () => null, async () => null, undefined, undefined, undefined, undefined, undefined);
    }
    return null;
  }, undefined, undefined, undefined, undefined, undefined);
  expect(b!.skipped).toContain(`two-${first}: main baseline running`);
  expect(b!.skipped).toContain(`two-${second}: main baseline running`);
  expect(a.started).toContain(`two-${first}`);
  expect(a.started).toContain(`two-${second}`);
});
