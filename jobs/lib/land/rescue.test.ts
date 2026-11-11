import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { readList, writeList } from "../../../issues/lib/store.ts";
import * as issues from "../../../issues/lib/todo.ts";
import { dispatchIssues } from "../transitions/factory.ts";
import { applyActions, pendingCases } from "../roles/director.ts";
import { readEvents } from "../../../lib/layout.ts";
import { loadRegistry } from "../records/ledger.ts";
import { askOf } from "../asks/ask.ts";
import { newIssue, mk, ask, fakes, setup, teardown } from "../transitions/factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

test("a run with a question waits for a spec edit: the Ask says so, and an edit drops the run, clears the Ask and starts the issue", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { cause: "no-commit", reason: "no commit", question: "which wins?" }, { "result.md": "Stopped." });
  const f = fakes();
  await dispatchIssues(f.start, undefined, f.rescue);
  const a = askOf(`fac-${id}`)!;
  expect(a.reason).toBe("question");
  expect(a.recommended).toBeUndefined();
  expect(a.question).toContain("waits for a spec edit");
  // Nothing changed: the next dispatch starts nothing.
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(f.calls).toEqual([]);
  expect(f.specs).toEqual([]);
  // Chris edits the spec.
  writeList({ key: "fac" }, "edit", (doc) => { issues.find(doc, id)!.spec = "A clearer spec."; return true; });
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(f.calls).toContain(`drop fac-${id}`);
  expect(ask(id)).toBeNull();
  expect(f.specs.length).toBe(1);
});

test("a rescue that throws gives a failed event whose note holds the failure", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { cause: "no-commit", reason: "no commit", question: "which wins?" }, { "result.md": "Stopped." });
  const f = fakes();
  await dispatchIssues(f.start, undefined, f.rescue);
  writeList({ key: "fac" }, "edit", (doc) => { issues.find(doc, id)!.spec = "A clearer spec."; return true; });
  await dispatchIssues(f.start, undefined, { ...f.rescue, drop: async () => { throw new Error("drop broke"); } });
  const e = readEvents().find((x) => x.action === "failed" && x.sub === "rescue");
  expect(e?.by).toBe("firefighter");
  expect(e?.note).toContain("drop broke");
});

test("a run the API refused for credit waits: the rescue starts no rerun, recheck or drop, and writes no Ask", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { cause: "credit", reason: "API Error: 402 This request would exceed your available credits", ended: "2026-06-01T11:58:00.000Z" });
  const f = fakes();
  setSystemTime(new Date("2026-06-01T12:00:00.000Z"));
  try { await dispatchIssues(f.start, undefined, f.rescue); } finally { setSystemTime(); }
  expect(f.calls).toEqual([]);
  expect(ask(id)).toBeNull();
});

test("a run the API refused for credit that ended long ago is started again by the dispatch", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { cause: "credit", reason: "API Error: 402", ended: "2026-01-01T00:00:00.000Z" });
  const f = fakes();
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(f.calls).toEqual([`start fac-${id}`]);
});

test("a spec question run, then the director's answer: the answer is refused, and the job keeps its Ask and starts nothing", async () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { cause: "no-commit", reason: "no commit", question: "which wins?" }, { "result.md": "Stopped." });
  const f = fakes();
  // The real rescue path sets the plain question Ask and writes asked-spec.
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(ask(id)?.options).toEqual([]);
  const c = pendingCases([loadRegistry().fac]).find((x) => x.on === `fac-${id}`)!;
  if (c.at === "lesson") throw new Error("not an item case");
  const r = await applyActions(c, [{ do: "answer", note: "the grep wins" }], { land: async () => null, drop: f.rescue.drop, after: () => {} });
  // The run waits for a spec edit: the director's answer is refused, and the next dispatch keeps the Ask and starts nothing.
  expect(r.refused).toEqual([`answer: the grep wins: the run fac-${id} asked about the spec and waits for a spec edit; use edit, or drop it`]);
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(ask(id)).toMatchObject({ reason: "question", options: [] });
  expect(f.specs).toEqual([]);
});

test("a time box that runs out on a child filed with from: asks Chris and sets no plan, as intake skips a child", async () => {
  const parent = newIssue();
  const id = writeList({ key: "fac" }, "add a child", (doc) => issues.add(doc, "[ship] the child", { spec: "Do the part.", from: `fac-${parent}` }).id, true)!.value;
  mk(`fac-${id}`, "build", "failed", { cause: "timeout", reason: "time box" });
  const f = fakes();
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(f.calls).toEqual([]);
  expect(ask(id)).toMatchObject({ reason: "rescue", recommended: "Rerun", options: [{ label: "Rerun" }, { label: "Another way" }] });
  expect(ask(id)!.why).toContain("Intake cannot split it again");
  expect(issues.find(readList(loadRegistry().fac)!, id)!.fm.plan).toBeUndefined();
});
