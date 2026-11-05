import { expect, test } from "bun:test";
import { newsLine, type Entry, type Run } from "./ledger.ts";
import { setCodes } from "../../../lib/naming.ts";
import { causeOf, failedCheckOf } from "./outcome.ts";

const run = (o: Partial<Run>) => ({ kind: "build", job: "j", name: "n", repo: "fac", n: 1, condition: "failed", told: false, started: "", ...o }) as Run;
const entry = (o: Partial<Run>): Entry => ({ id: "20200101-000000-n-1", folder: "f", run: run(o) });

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
  setCodes({ aleph: "a" });
  expect(newsLine(entry({ repo: "aleph", on: "aleph-1421", n: 6, condition: "failed", cause: "check", checkName: "tests", reason: "tests failed" }))).toBe("a1421#6 failed check → tests");
  expect(newsLine(entry({ repo: "aleph", on: "aleph-1421", n: 6, condition: "failed", cause: "other", reason: "commit-tree failed" }))).toBe("a1421#6 failed other");
  setCodes({});
});

test("the news is the job ID and the state word", () => {
  setCodes({ aleph: "a" });
  expect(newsLine(entry({ repo: "aleph", on: "aleph-1421", n: 6, condition: "landed" }))).toBe("a1421#6 landed");
  setCodes({});
});

test("a waiting run takes its sub from its Ask's needs, in the sub set's words", () => {
  const wait = (reason: string): Partial<Run> => ({ condition: "waiting", ask: { kind: "approval", reason, question: "q", options: [], why: [] } });
  expect(newsLine(entry(wait("held-path")))).toBe("n#1 waiting protected");
  expect(newsLine(entry(wait("question")))).toBe("n#1 waiting question");
});

test("a landed reason and the repo note follow on a second line, indented two spaces", () => {
  expect(newsLine(entry({ condition: "landed", reason: "no net change" }))).toBe("n#1 landed\n  no net change");
  expect(newsLine(entry({ condition: "landed", reason: "no net change" }), "the tests are flaky")).toBe("n#1 landed\n  no net change the tests are flaky");
});

test("the news drops the check-open and next-step joins, and holds no semicolon", () => {
  const landed = newsLine(entry({ condition: "landed", check: "open", next: "worker", reason: "no net change" }));
  expect(landed).toBe("n#1 landed\n  no net change");
  expect(landed).not.toContain(";");
  expect(newsLine(entry({ condition: "passed", next: "land" }))).toBe("n#1 passed");
});
