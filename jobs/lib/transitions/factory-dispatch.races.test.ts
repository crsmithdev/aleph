// The dispatch and an issue that changes while it runs: while an earlier issue starts.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeList } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { dispatchIssues } from "./factory.ts";
import { readHolds } from "../gates/factory-status.ts";
import { newIssue, change, mk, fakes, dispatch, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

// An "already met" drop closes a factory item with no commit that names it; the issues that wait on it still start.
test("an issue waiting on a factory item the store says done, with no commit naming it, starts", async () => {
  const blocker = writeList({ key: "fac" }, "add the blocker", (doc) => issues.add(doc, "met elsewhere").id, true)!.value;
  mk(`fac-${blocker}`, "build", "dropped", { reason: "the goal is already met" });
  await change(blocker, (item) => issues.setStatus(item, "done"));
  const waiter = newIssue();
  await change(waiter, (item) => { item.fm.after = [`fac-${blocker}`]; });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([`fac-${waiter}`]);
  expect(out.skipped).toEqual([]);
});

// The status gap is between the read of the list and an issue's lock: an earlier issue's start closes it.
test("an issue set to done while an earlier issue starts is skipped as done", async () => {
  const first = newIssue();
  const second = newIssue();
  const calls: string[] = [];
  const out = await dispatchIssues(async (_repo, name) => {
    calls.push(name);
    if (name === `fac-${first}`) await change(second, (item) => issues.setStatus(item, "done"));
    return null;
  }, undefined, undefined);
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.started).toEqual([`fac-${first}`]);
  expect(out.skipped).toEqual([`fac-${second}: the item is done`]);
  expect(readHolds([`fac-${second}`])).toMatchObject([{ kind: "not-ready", text: "the item is done" }]);
});

// The label gap is between the read of the list and an issue's lock: an earlier issue's start removes it.
test("an issue turned back into a plain issue while an earlier issue starts is not started", async () => {
  const first = newIssue();
  const second = newIssue();
  const calls: string[] = [];
  const out = await dispatchIssues(async (_repo, name) => {
    calls.push(name);
    if (name === `fac-${first}`) await change(second, (item) => { item.spec = ""; });
    return null;
  }, undefined, undefined);
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.started).toEqual([`fac-${first}`]);
  expect(out.skipped).toEqual([`fac-${second}: not a goal`]);
});
