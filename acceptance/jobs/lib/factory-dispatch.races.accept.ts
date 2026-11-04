// Archived goal tests from jobs/lib/factory-dispatch.races.test.ts: `bun run accept` runs them, `bun run test` does not.
// The dispatch and a goal that changes while it runs: during the baseline, while an earlier goal starts, and while another dispatch holds the baseline.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeList } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { dispatchIssues } from "../../../jobs/lib/factory.ts";
import { goal, change, setup, teardown } from "../../../jobs/lib/factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

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
  }, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.started).toEqual([`fac-${first}`]);
  expect(out.skipped).toEqual([`fac-${second}: after fac-${other}.1`]);
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
  }, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.started).toEqual([`fac-${first}`]);
  expect(out.skipped).toEqual([`fac-${second}: not a goal`]);
});

// A dispatch that finds the baseline held skips with `main baseline running`; the holder starts the goal.
test("a goal added while another dispatch holds the baseline is started by the holder", async () => {
  goal();
  let added = 0;
  let checksRun = 0;
  let b: Awaited<ReturnType<typeof dispatchIssues>> | undefined;
  const a = await dispatchIssues(async () => null, async () => {
    checksRun++;
    added = goal();
    b = await dispatchIssues(async () => null, async () => { checksRun++; return null; }, undefined, undefined, undefined, undefined, undefined, () => {});
    return null;
  }, undefined, undefined, undefined, undefined, undefined, () => {});
  expect(checksRun).toBe(1);
  expect(b!.started).toEqual([]);
  expect(b!.skipped).toContain(`fac-${added}: main baseline running`);
  expect(a.started).toContain(`fac-${added}`);
});
