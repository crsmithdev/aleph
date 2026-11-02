import { afterEach, beforeEach, expect, test } from "bun:test";
import { askOf, readList, writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { dispatchIssues } from "./factory.ts";
import { grant } from "./ask.ts";
import { goal, mk, lines, notes, ask, fakes, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

test("time box of a plain issue: dropped and sent to the planner, with no rerun", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "time box" }, { "result.md": lines(25) });
  const f = fakes();
  const planned: number[] = [];
  const out = await dispatchIssues(f.start, undefined, undefined, f.rescue, undefined, (_repo, n) => { planned.push(n); });
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(f.specs).toEqual([]);
  expect(planned).toEqual([id]);
  expect(out.held).toBeUndefined();
  expect(ask(id)).toBeNull();
  expect(notes(id)).toContain("goes to the planner to split");
});

test("time box of a child issue gets an Ask, with no planner and no rerun", async () => {
  const id = goal();
  const ref = writeList({ key: "fac" }, "add part", (doc) => issues.refOf(issues.addPart(doc, issues.find(doc, id)!, { title: "part", spec: "Do part." })), true)!.value;
  mk(`fac-${ref}`, "build", "stuck", { reason: "time box" }, { "result.md": lines(3) });
  const f = fakes();
  const planned: number[] = [];
  await dispatchIssues(f.start, undefined, undefined, f.rescue, undefined, (_repo, n) => { planned.push(n); });
  expect(f.calls).toEqual([]);
  expect(planned).toEqual([]);
  expect(askOf(readList({ key: "fac" })!.items.find((i) => issues.refOf(i) === ref)!)).not.toBeNull();
});

test("time box of an issue the planner has split gets an Ask", async () => {
  const id = goal();
  mk(`plan-fac-${id}`, "plan", "done", { reason: "planned", on: `fac-${id}` });
  mk(`fac-${id}`, "build", "stuck", { reason: "time box" }, { "result.md": lines(3) });
  const f = fakes();
  const planned: number[] = [];
  await dispatchIssues(f.start, undefined, undefined, f.rescue, undefined, (_repo, n) => { planned.push(n); });
  expect(f.calls).toEqual([]);
  expect(planned).toEqual([]);
  expect(ask(id)).not.toBeNull();
});

test("a no-commit run that ended with a QUESTION asks Chris and is not rerun on an always rule", async () => {
  const id = goal();
  grant("rescue", "recommended");
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": "Stopped.\nQUESTION: The Oracle grep and the test assertion conflict; which wins?" });
  const f = fakes();
  await dispatchIssues(f.start, undefined, undefined, f.rescue);
  expect(f.calls).toEqual([]);
  expect(f.specs).toEqual([]);
  expect(askOf(readList({ key: "fac" })!.items.find((i) => issues.refOf(i) === String(id))!)).not.toBeNull();
  expect(notes(id)).toContain("asked: The Oracle grep");
});

test("a non-no-commit run whose result.md has a QUESTION line is still rerun, not held for a spec edit", async () => {
  const id = goal();
  grant("rescue", "recommended");
  mk(`fac-${id}`, "build", "stuck", { reason: "fetch failed" }, { "result.md": "Partial.\nQUESTION: which wins?" });
  const f = fakes();
  await dispatchIssues(f.start, undefined, undefined, f.rescue);
  expect(f.calls.some((c: any) => String(c).includes("drop"))).toBe(true);
  expect(f.specs.length).toBe(1);
  expect(notes(id)).toContain("the goal reruns");
});

test("a QUESTION run waits for a spec edit: the Ask says so, and an edit drops the run, clears the Ask and starts the goal", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": "Stopped.\nQUESTION: which wins?" });
  const f = fakes();
  await dispatchIssues(f.start, undefined, undefined, f.rescue);
  const a = askOf(readList({ key: "fac" })!.items.find((i) => issues.refOf(i) === String(id))!)!;
  expect(a.reason).toBe("question");
  expect(a.recommended).toBeUndefined();
  expect(a.question).toContain("waits for a spec edit");
  // Nothing changed: the next dispatch starts nothing.
  await dispatchIssues(f.start, undefined, undefined, f.rescue);
  expect(f.calls).toEqual([]);
  expect(f.specs).toEqual([]);
  // Chris edits the spec.
  writeList({ key: "fac" }, "edit", (doc) => { issues.find(doc, id)!.spec = "A clearer spec."; return true; });
  await dispatchIssues(f.start, undefined, undefined, f.rescue);
  expect(f.calls).toContain(`drop fac-${id}`);
  expect(ask(id)).toBeNull();
  expect(f.specs.length).toBe(1);
});
