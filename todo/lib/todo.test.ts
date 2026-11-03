import { expect, test } from "bun:test";
import * as issues from "./todo.ts";

test("titleProblem passes a part title with its group and refuses length, a final period and a prefix", () => {
  expect(issues.titleProblem("[Status layout] Put the metrics on the left", { part: true })).toBeNull();
  expect(issues.titleProblem("Fix the lane height")).toBeNull();
  expect(issues.titleProblem("[G] " + "a".repeat(57), { part: true })).toContain("60");
  expect(issues.titleProblem("a".repeat(60))).toBeNull();
  expect(issues.titleProblem("Check foo: bar")).not.toBeNull();
  expect(issues.titleProblem("Fix it.")).not.toBeNull();
});

test("add stores kind task by default, refuses an unknown kind, and addPart copies the parent's kind", () => {
  const doc = issues.blank("r");
  expect(issues.add(doc, "A").fm.kind).toBe("task");
  expect(() => issues.add(doc, "B", { kind: "epic" })).toThrow(issues.KINDS.join(", "));
  const bug = issues.add(doc, "C", { kind: "bug" });
  expect(issues.addPart(doc, bug, { title: "[C] part", spec: "x" }).fm.kind).toBe("bug");
});

test("lint names the bad title of an open or parked item and a missing or unknown kind; fix moves kind areas into kind", () => {
  const doc = issues.blank("r");
  const item = (title: string, fm: Record<string, unknown>) => { const i = issues.add(doc, title); delete i.fm.kind; Object.assign(i.fm, fm); return i; };
  item("Fix the lane height", { kind: "task", areas: ["ui"] });
  item("a".repeat(61), { kind: "task" });
  item("Fix it.", { kind: "task", parked: "true" });
  item("Check foo: bar", { kind: "task", closed_as: "done" });
  item("Fix the flaky gate", { areas: ["flakes", "tests"] });
  item("Fix red main", { areas: ["red-main", "check"] });
  item("Old goal", { kind: "goal", areas: ["deps"] });
  const bug = item("Fix the bug", { areas: ["bug"] });
  delete issues.addPart(doc, bug, { title: "[Bug] Find the cause: first", spec: "x" }).fm.kind;
  const found = (id: string) => issues.lint(doc).filter((f) => f.id === id).map((f) => f.problem);
  expect(found("1")).toEqual([]);
  expect(found("2")[0]).toContain("61 characters");
  expect(found("3")[0]).toContain("period");
  expect(found("4")).toEqual([]);
  expect(found("5")).toEqual(["kind is missing"]);
  expect(found("7")[0]).toContain('unknown kind "goal"');
  expect(found("8.1")).toEqual(["kind is missing", expect.stringContaining("': ' prefix")]);

  issues.fix(doc);
  expect(doc.items.map((i): unknown[] => [issues.refOf(i), i.fm.kind, i.fm.areas])).toEqual([
    ["1", "task", ["ui"]], ["2", "task", []], ["3", "task", []], ["4", "task", []],
    ["5", "flake", ["tests"]], ["6", "bug", ["red-main"]], ["7", "task", []], ["8", "bug", []], ["8.1", "bug", undefined],
  ]);
  expect(issues.lint(doc).filter((f) => f.fixable)).toEqual([]);
});
