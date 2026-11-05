import { expect, test } from "bun:test";
import { newsLine, type Run } from "./ledger.ts";
import { setCodes } from "../../../lib/naming.ts";
import { causeOf, failedCheckOf } from "./outcome.ts";

const run = (o: Partial<Run>) => ({ kind: "build", job: "j", name: "n", repo: "fac", condition: "failed", told: false, started: "", ...o }) as Run;

test("a stated cause wins over the sentence, so a drop does not change it", () => {
  expect(causeOf(run({ cause: "timeout", condition: "dropped", reason: "no commit" }))).toBe("timeout");
  expect(failedCheckOf(run({ cause: "check", checkName: "tests", condition: "dropped", reason: "not needed" }))).toBe("tests");
});

test.each([
  ["no commit", "no-commit", undefined],
  ["time box", "timeout", undefined],
  ["job lock busy", "locked", undefined],
  ["fetch failed: x", "infra", undefined],
  ["fetch failed", "infra", undefined],
  ["merge conflict: a.ts", "conflict", undefined],
  ["main moved during the land; land again", "moved", undefined],
  ["the branch changes docs/todo.md; change the list with aleph issue", "other", undefined],
  ["tests failed", "check", "tests"],
  ["timed out: check types", "check", "types"],
  ["malformed verdict: x", "unanswered", undefined],
  ["malformed plan: x", "unanswered", undefined],
  ["failed: x", "unanswered", undefined],
] as const)("an old run with the sentence %p has the cause %p", (reason, cause, check) => {
  expect(causeOf(run({ reason }))).toBe(cause);
  expect(failedCheckOf(run({ reason }))).toBe(check);
});

test("an old dropped run keeps its no-commit mark, and free prose states no cause", () => {
  expect(causeOf(run({ condition: "dropped", noCommit: true, reason: "a duplicate" }))).toBe("no-commit");
  expect(causeOf(run({ condition: "dropped", reason: "the work has no commit and a time box" }))).toBeUndefined();
});

test("the news names the stated check, and no other cause", () => {
  expect(newsLine(run({ condition: "failed", cause: "check", checkName: "tests", reason: "tests failed" }))).toBe("n failed tests");
  expect(newsLine(run({ condition: "failed", cause: "other", reason: "commit-tree failed" }))).toBe("n failed");
});

test("the news starts with the short id of the run's name", () => {
  setCodes({ aleph: "a" });
  expect(newsLine(run({ repo: "aleph", name: "aleph-1421", condition: "landed" }))).toStartWith("a1421 landed");
  setCodes({});
});
