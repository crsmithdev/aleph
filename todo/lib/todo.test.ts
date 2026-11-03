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
