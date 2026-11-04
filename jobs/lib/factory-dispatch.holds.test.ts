// The hold record of a goal the dispatch skips: one per reason, for each reason the goal loop has.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import { join } from "node:path";
import { dispatchIssues, suiteStep } from "./factory.ts";
import { readHolds } from "./factory-status.ts";
import { ctx, goal, notes, setup, sh, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

test("a goal that a red main holds gets one hold record; the suite runs main's checks once for its commit", async () => {
  const id = goal();
  let checksRun = 0;
  const red = async () => { checksRun++; return { cause: "check" as const, checkName: "tests", reason: "tests failed" }; };
  await suiteStep(red);
  await suiteStep(red);
  expect(checksRun).toBe(1);
  const first = await dispatchIssues(async () => null, undefined, undefined, undefined);
  const second = await dispatchIssues(async () => null, undefined, undefined, undefined);
  for (const out of [first, second]) {
    expect(out.started).toEqual([]);
    expect(out.skipped).toEqual([expect.stringMatching(new RegExp(`^fac-${id}: main is red at [0-9a-f]{7}: tests$`))]);
  }
  const recs = readHolds([`fac-${id}`]);
  expect(recs).toHaveLength(1);
  expect(recs[0].kind).toBe("baseline");
});

test("a red main holds goals after main moves, until a suite run on the new commit is green", async () => {
  const id = goal();
  await suiteStep(async () => ({ cause: "check" as const, checkName: "tests", reason: "tests failed" }));
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "a fix");
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  const held = await dispatchIssues(async () => null, undefined, undefined, undefined);
  expect(held.skipped).toEqual([expect.stringMatching(/main is red at/)]);
  expect(await suiteStep(async () => null)).toEqual({ fac: "green" });
  const out = await dispatchIssues(async () => null, undefined, undefined, undefined);
  expect(out.started).toEqual([`fac-${id}`]);
});

test("an open goal whose work is on main closes as done, and no later dispatch lists it", async () => {
  const id = goal();
  sh(join(ctx.base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nIssue: fac-${id}`);
  sh(join(ctx.base, "repo"), "git", "push", "-q", "origin", "main");
  const first = await dispatchIssues(async () => null, undefined, undefined, undefined);
  expect(first.skipped.filter((l) => l.startsWith(`fac-${id}:`))).toEqual([]);
  expect(store.readList({ key: "fac" })!.items.find((i) => i.id === id)!.fm.closed_as).toBe("done");
  expect(notes(id)).toMatch(/its work is on origin\/main: [0-9a-f]{7}$/m);
  const second = await dispatchIssues(async () => null, undefined, undefined, undefined);
  expect(second.skipped.filter((l) => l.startsWith(`fac-${id}:`))).toEqual([]);
});

test("a main that no suite run has checked, or whose checks gave no verdict, does not hold a goal", async () => {
  const id = goal();
  expect(await suiteStep(async () => ({ cause: "infra" as const, reason: "no runner" }))).toEqual({ fac: "main is unchecked: no runner" });
  const out = await dispatchIssues(async () => null, undefined, undefined, undefined);
  expect(out.started).toEqual([`fac-${id}`]);
});

describe("each skip in the goal loop gets one hold record", () => {
  test("a goal parked after the first read", async () => {
    const id = goal();
    const name = `fac-${id}`;
    // Park it between the read under the lock and the last read before the start.
    const real = store.goal;
    const spy = spyOn(store, "goal").mockImplementation((place, ref) => {
      const item = real(place, ref);
      writeList({ key: "fac" }, "park", (doc) => { issues.setStatus(issues.find(doc, ref)!, "parked"); return true; });
      return item;
    });
    try {
      const out = await dispatchIssues(async () => null, undefined, undefined, undefined);
      expect(out.skipped).toEqual([`${name}: the item is parked`]);
    } finally {
      spy.mockRestore();
    }
    expect(readHolds([name])).toMatchObject([{ kind: "not-ready", text: "the item is parked" }]);
  });

});
