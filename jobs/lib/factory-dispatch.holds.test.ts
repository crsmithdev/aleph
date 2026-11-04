// The hold record of a goal the dispatch skips: one per reason, for each reason the goal loop has.
import { afterEach, beforeEach, describe, expect, spyOn, test } from "bun:test";
import { writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import * as store from "../../todo/lib/store.ts";
import { dispatchIssues } from "./factory.ts";
import { readHolds, saveProbe } from "./factory-status.ts";
import { lock } from "./ledger.ts";
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
  expect(recs[0].kind).toBe("baseline");
});

test("a main whose baseline is running or unchecked holds the goal at the Baseline gate too", async () => {
  const id = goal();
  const name = `fac-${id}`;
  // Another dispatch holds the baseline lock: this one finds it running.
  const release = (await lock("baseline-fac", 0))!;
  try {
    const out = await dispatchIssues(async () => null, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
    expect(out.skipped).toEqual([`${name}: main baseline running`]);
  } finally {
    release();
  }
  // Checks that could not run leave main unchecked.
  const out = await dispatchIssues(async () => null, async () => ({ cause: "infra" as const, reason: "no runner" }), undefined, undefined, undefined, undefined, undefined, () => {});
  expect(out.skipped).toEqual([`${name}: main is unchecked: no runner`]);
  expect(readHolds([name]).map((r) => r.kind)).toEqual(["baseline", "baseline"]);
});

test("a failed probe holds each goal at the Probe gate, and starts nothing", async () => {
  const id = goal();
  const name = `fac-${id}`;
  saveProbe({ at: "2026-11-03T00:00:00Z", ok: false, failed: ["no network"] });
  const started: string[] = [];
  const out = await dispatchIssues(async (_r, n) => { started.push(n); return null; }, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
  expect(started).toEqual([]);
  expect(out.skipped).toEqual([`${name}: the sandbox probe at 2026-11-03T00:00:00Z failed: no network`]);
  expect(readHolds([name]).map((r) => r.kind)).toEqual(["probe"]);
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
    expect(readHolds([name])).toMatchObject([{ kind: "not-ready", text: "the item is parked" }]);
  });

});
