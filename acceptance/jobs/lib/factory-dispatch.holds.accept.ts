// Archived goal tests from jobs/lib/factory-dispatch.holds.test.ts: `bun run accept` runs them, `bun run test` does not.
// The hold record of a goal the dispatch skips: one per reason, for each reason the goal loop has.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { writeList } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { dispatchIssues, setPaused } from "../../../jobs/lib/factory.ts";
import { readHolds } from "../../../jobs/lib/factory-status.ts";
import { lock } from "../../../jobs/lib/ledger.ts";
import { goal, change, mk, fakes, setup, teardown } from "../../../jobs/lib/factory.helpers.ts";

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
  expect(recs()[0]).toMatchObject({ name, kind: "not-ready", text: expect.stringContaining(`after fac-${blocker}`) });
  expect(Number.isNaN(Date.parse(recs()[0].at))).toBe(false);
  await dispatchIssues(start, async () => null, f.land, f.rescue, undefined, undefined, undefined, () => {});
  expect(recs()).toHaveLength(1);
  expect(readHolds([`fac-${blocker}`]).map((r) => r.kind)).toEqual(["not-ready"]);
  await change(blocker, (item) => issues.setStatus(item, "done"));
  mk(`fac-${blocker}`, "build", "passed", { commit: "abc" });
  await dispatchIssues(f.start, async () => null, f.land, f.rescue, undefined, undefined, undefined, () => {});
  expect(recs().map((r) => r.kind)).toContain("started");
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
  expect(recs[0]).toMatchObject({ kind: "busy-file", text: `waits for fac-${first}: both change the busy file jobs/busy.ts` });
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
    expect(readHolds([name])).toMatchObject([{ kind: "not-ready", text: "another dispatch is starting it" }]);
  });

  test("a ref that is not a goal", async () => {
    const first = goal();
    const second = goal();
    const out = await dispatchIssues(async (_repo, name) => {
      if (name === `fac-${first}`) await change(second, (item) => { item.spec = ""; });
      return null;
    }, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
    expect(out.skipped).toEqual([`fac-${second}: not a goal`]);
    expect(readHolds([`fac-${second}`])).toMatchObject([{ kind: "not-ready", text: "not a goal" }]);
  });

  test("a goal skipped because the factory paused while its rating ran", async () => {
    const id = goal();
    const out = await dispatchIssues(async () => null, async () => null, undefined, undefined, async () => { setPaused(true); return null; }, undefined, undefined, () => {});
    setPaused(false);
    expect(out.skipped).toEqual([`fac-${id}: paused`]);
    expect(readHolds([`fac-${id}`])).toMatchObject([{ kind: "pause", text: "paused" }]);
  });
});
