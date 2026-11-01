import { expect, test } from "bun:test";
import { newsLine, type Run } from "./ledger.ts";
import { causeOf, checksStopped, failedCheckOf } from "./outcome.ts";

const run = (o: Partial<Run>) => ({ kind: "build", job: "j", name: "n", repo: "fac", condition: "stuck", told: false, started: "", ...o }) as Run;

test("a stated cause wins over the sentence, so a drop does not change it", () => {
  expect(causeOf(run({ cause: "time-box", condition: "dropped", reason: "no commit" }))).toBe("time-box");
  expect(failedCheckOf(run({ cause: "check", checkName: "tests", condition: "dropped", reason: "not needed" }))).toBe("tests");
});

test.each([
  ["no commit", "no-commit", undefined],
  ["time box", "time-box", undefined],
  ["job lock busy", "lock-busy", undefined],
  ["fetch failed: x", "infra", undefined],
  ["fetch failed", "infra", undefined],
  ["hidden checks unreadable", "infra", undefined],
  ["merge conflict: a.ts", "conflict", undefined],
  ["main moved during the land; land again", "moved", undefined],
  ["the branch changes docs/todo.md; change the list with aleph issue", "own-list", undefined],
  ["tests failed", "check", "tests"],
  ["timed out: check types", "check", "types"],
  ["hidden check failed: 1 of 2 tests", "hidden-check", undefined],
] as const)("an old run with the sentence %p has the cause %p", (reason, cause, check) => {
  expect(causeOf(run({ reason }))).toBe(cause);
  expect(failedCheckOf(run({ reason }))).toBe(check);
});

test("an old dropped run keeps its no-commit mark, and free prose states no cause", () => {
  expect(causeOf(run({ condition: "dropped", noCommit: true, reason: "a duplicate" }))).toBe("no-commit");
  expect(causeOf(run({ condition: "dropped", reason: "the work has no commit and a time box" }))).toBeUndefined();
});

test("the check runners' sentences become causes, and an unknown one is other", () => {
  expect(checksStopped("tests failed")).toEqual({ cause: "check", checkName: "tests", reason: "tests failed" });
  expect(checksStopped("checks did not start (exit 1)")).toEqual({ cause: "other", reason: "checks did not start (exit 1)" });
});

test("the news names the stated check, and no other cause", () => {
  expect(newsLine(run({ condition: "failed", cause: "check", checkName: "tests", reason: "tests failed" }))).toBe("fac/n failed tests");
  expect(newsLine(run({ condition: "failed", cause: "other", reason: "commit-tree failed" }))).toBe("fac/n failed");
});
