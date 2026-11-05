import { afterEach, beforeEach, expect, test } from "bun:test";
import { writeList } from "../../issues/lib/store.ts";
import * as issues from "../../issues/lib/todo.ts";
import { dispatchIssues } from "./factory.ts";
import { applyActions, pendingCases } from "./director.ts";
import { loadRegistry } from "./ledger.ts";
import { askOf } from "./ask.ts";
import { goal, mk, ask, fakes, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

test("a run with a question waits for a spec edit: the Ask says so, and an edit drops the run, clears the Ask and starts the goal", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit", question: "which wins?" }, { "result.md": "Stopped." });
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

test("a spec question run, then the director's answer: the job keeps its Ask or is started again, never open with neither", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit", question: "which wins?" }, { "result.md": "Stopped." });
  const f = fakes();
  // The real rescue path sets the plain question Ask and writes asked-spec.
  await dispatchIssues(f.start, undefined, f.rescue);
  expect(ask(id)?.options).toEqual([]);
  const c = pendingCases([loadRegistry().fac]).find((x) => x.on === `fac-${id}`)!;
  if (c.at === "lesson") throw new Error("not an item case");
  const r = await applyActions(c, [{ do: "answer", note: "the grep wins" }], { land: async () => null, drop: f.rescue.drop });
  // The next dispatch: the director's answer must not leave the goal open with no Ask and no run.
  await dispatchIssues(f.start, undefined, f.rescue);
  const hasAsk = ask(id) !== null;
  const started = f.specs.length > 0;
  expect(hasAsk || started).toBe(true);
  expect(r.refused.length + (started ? 1 : 0)).toBeGreaterThan(0);
});
