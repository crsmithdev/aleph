// The hold record of a goal the dispatch skips: one per reason, for each reason the goal loop has.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import { dispatchIssues, setPaused } from "./factory.ts";
import { readHolds } from "./factory-status.ts";
import { lock } from "./ledger.ts";
import { goal, change, mk, fakes, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

test("a goal that waits on an open after gets one hold record; a second dispatch with the same reason adds none; when it starts a started record ends the hold", async () => {
  const blocker = goal();
  const waiter = goal();
  await change(waiter, (item) => { item.fm.after = [`fac-${blocker}`]; });
  const name = `fac-${waiter}`;
  const f = fakes();
  const start = async (r: unknown, n: string, id: number | string, spec: string) => (n === `fac-${blocker}` ? "no slot" : f.start(r, n, id, spec));
  await dispatchIssues(start, async () => null, f.land, f.rescue, undefined, undefined, undefined, () => {});
  const recs = () => readHolds([name]);
  expect(recs()).toHaveLength(1);
  expect(recs()[0]).toMatchObject({ name, kind: "waits_on", text: expect.stringContaining(`after fac-${blocker}`) });
  expect(Number.isNaN(Date.parse(recs()[0].at))).toBe(false);
  await dispatchIssues(start, async () => null, f.land, f.rescue, undefined, undefined, undefined, () => {});
  expect(recs()).toHaveLength(1);
  expect(readHolds([`fac-${blocker}`]).map((r) => r.kind)).toEqual(["start"]);
  await change(blocker, (item) => issues.setStatus(item, "done"));
  mk(`fac-${blocker}`, "build", "passed", { commit: "abc" });
  await dispatchIssues(f.start, async () => null, f.land, f.rescue, undefined, undefined, undefined, () => {});
  expect(recs().map((r) => r.kind)).toContain("started");
});

test("a goal that a red main holds gets one hold record; main's checks run once for its commit", async () => {
  const id = goal();
  let checksRun = 0;
  const red = async () => { checksRun++; return { cause: "check" as const, checkName: "tests", reason: "tests failed" }; };
  const first = await dispatchIssues(async () => null, red, undefined, undefined, undefined, undefined, undefined, () => {});
  const second = await dispatchIssues(async () => null, red, undefined, undefined, undefined, undefined, undefined, () => {});
  expect(checksRun).toBe(1);
  for (const out of [first, second]) {
    expect(out.started).toEqual([]);
    expect(out.skipped).toEqual([expect.stringMatching(new RegExp(`^fac-${id}: main is red at [0-9a-f]{7}: tests$`))]);
  }
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

describe("each skip in the goal loop gets one hold record", () => {
  test("a goal whose goal lock another holder has", async () => {
    const id = goal();
    const name = `fac-${id}`;
    const release = (await lock(`goal-${name}`, 0))!;
    process.env.ALEPH_GOAL_LOCK_WAIT_MS = "200";
    try {
      const out = await dispatchIssues(async () => null, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
      expect(out.skipped).toEqual([`${name}: another dispatch is starting it`]);
    } finally {
      delete process.env.ALEPH_GOAL_LOCK_WAIT_MS;
      release();
    }
    expect(readHolds([name])).toMatchObject([{ kind: "locked", text: "another dispatch is starting it" }]);
  });

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
      const out = await dispatchIssues(async () => null, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
      expect(out.skipped).toEqual([`${name}: the item is parked`]);
    } finally {
      spy.mockRestore();
    }
    expect(readHolds([name])).toMatchObject([{ kind: "closed", text: "the item is parked" }]);
  });

  test("a ref that is not a goal", async () => {
    const first = goal();
    const second = goal();
    const out = await dispatchIssues(async (_repo, name) => {
      if (name === `fac-${first}`) await change(second, (item) => { item.spec = ""; });
      return null;
    }, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
    expect(out.skipped).toEqual([`fac-${second}: not a goal`]);
    expect(readHolds([`fac-${second}`])).toMatchObject([{ kind: "not-a-goal", text: "not a goal" }]);
  });

  test("a goal skipped because the factory paused while its rating ran", async () => {
    const id = goal();
    const out = await dispatchIssues(async () => null, async () => null, undefined, undefined, async () => { setPaused(true); return null; }, undefined, undefined, () => {});
    setPaused(false);
    expect(out.skipped).toEqual([`fac-${id}: paused`]);
    expect(readHolds([`fac-${id}`])).toMatchObject([{ kind: "paused", text: "paused" }]);
  });
});
