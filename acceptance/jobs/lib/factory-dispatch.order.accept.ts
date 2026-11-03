// Archived goal tests from jobs/lib/factory-dispatch.order.test.ts: `bun run accept` runs them, `bun run test` does not.
// The dispatch's order and baseline: one start per goal, the live cap, planner order, a green baseline, and parents closed on a red or held baseline.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeList } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { dispatchIssues } from "../../../jobs/lib/factory.ts";
import { lock } from "../../../jobs/lib/ledger.ts";
import { readList } from "../../../todo/lib/store.ts";
import { ctx, goal, mk, fakes, withChecks, setup, teardown } from "../../../jobs/lib/factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

test("a goal that stays open and labelled is started exactly once", async () => {
  const id = goal();
  const calls: string[] = [];
  const out = await dispatchIssues(async (_repo, name) => { calls.push(name); return null; }, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
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
  const out = await dispatchIssues(async (_r, name) => { mk(name, "build", "running", { made: Date.now() }); return null; }, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
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
  await dispatchIssues(async () => null, async () => null, undefined, undefined, undefined, (repo, id) => { order.push(`${repo.key}-${id}`); }, undefined, () => {});
  expect(order).toEqual([`zzz-${hi}`, `aaa-${lo}`]);
});

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
