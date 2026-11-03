// The hold record of a goal the dispatch skips: one per reason, for each reason the goal loop has.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import { dispatchIssues } from "./factory.ts";
import { readHolds } from "./factory-status.ts";
import { goal, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

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
      const out = await dispatchIssues(async () => null, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
      expect(out.skipped).toEqual([`${name}: the item is parked`]);
    } finally {
      spy.mockRestore();
    }
    expect(readHolds([name])).toMatchObject([{ kind: "closed", text: "the item is parked" }]);
  });

});
