import { afterEach, beforeEach, expect, test } from "bun:test";
import { readList, writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { dispatchIssues } from "./factory.ts";
import { goal, change, fakes, dispatch, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

const park = (id: number) => change(id, (item) => issues.setStatus(item, "parked"));

test("a parked goal is not started, and is started once it is open again", async () => {
  const id = goal();
  await park(id);
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([]);
  expect(out.started).toEqual([]);
  await change(id, (item) => issues.setStatus(item, "open"));
  const again = fakes();
  expect((await dispatch(again)).started).toEqual([`fac-${id}`]);
});

test("a goal parked during the baseline is not started", async () => {
  const id = goal();
  const f = fakes();
  await dispatchIssues(f.start, async () => { await park(id); return null; }, f.land, f.rescue, undefined, undefined, undefined, () => {});
  expect(f.calls).toEqual([]);
});

test("a parked plan issue gets no planner run", async () => {
  const id = writeList({ key: "fac" }, "add", (doc) => { const i = issues.add(doc, "plan me"); i.fm.plan = "true"; issues.setStatus(i, "parked"); return i.id; }, true)!.value;
  const planned: string[] = [];
  const f = fakes();
  const out = await dispatchIssues(f.start, async () => null, f.land, f.rescue, undefined, (_r, n) => { planned.push(`${n}`); }, undefined, () => {});
  expect(planned).toEqual([]);
  expect(out.planned).toBeUndefined();
  expect(f.calls).toEqual([]);
  expect(id).toBeGreaterThan(0);
});

const parentWithDonePart = (parked: boolean): number => writeList({ key: "fac" }, "add", (doc) => {
  const i = issues.add(doc, "parent");
  issues.setStatus(issues.addPart(doc, i, { title: "g", spec: "Do it." }), "done");
  if (parked) issues.setStatus(i, "parked");
  return i.id;
}, true)!.value;
const statusOf = (id: number) => issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!);

test("a parked parent whose parts are done is not closed; an open one is", async () => {
  const parked = parentWithDonePart(true);
  const open = parentWithDonePart(false);
  const f = fakes();
  await dispatchIssues(f.start, async () => null, f.land, f.rescue, undefined, undefined, undefined, () => {});
  expect(statusOf(open)).toBe("done");
  expect(statusOf(parked)).toBe("parked");
});
