import { expect, test } from "bun:test";
import { newsLine, type Entry, type Run } from "./ledger.ts";
import { CAUSES } from "../../../lib/naming.ts";
import { causeOf, failedCheckOf, policyOf, POLICY } from "./outcome.ts";

const run = (o: Partial<Run>) => ({ role: "build", job: "job.1", name: "n", repo: "fac", state: "failed", told: false, started: "", ...o }) as Run;
const entry = (o: Partial<Run>, id = "job.1"): Entry => ({ id, folder: "f", run: run(o) });

test("a stated cause wins over the sentence, so a drop does not change it", () => {
  expect(causeOf(run({ cause: "timeout", state: "dropped", reason: "no commit" }))).toBe("timeout");
  expect(failedCheckOf(run({ cause: "check", checkName: "tests", state: "dropped", reason: "not needed" }))).toBe("tests");
});

test("causeOf gives the stored cause, and none for a run with only a sentence: the word migration stated it", () => {
  expect(causeOf(run({ cause: "timeout", reason: "time box" }))).toBe("timeout");
  expect(causeOf(run({ reason: "time box" }))).toBeUndefined();
  expect(failedCheckOf(run({ reason: "tests failed" }))).toBeUndefined();
});

test("a run the API refused for credit has the credit cause it states", () => {
  expect(causeOf(run({ cause: "credit", reason: "API Error: 402 This request would exceed your available credits" }))).toBe("credit");
});

test("POLICY has one row per cause; only credit counts to no cap, has no rescue, holds its backend and waits", () => {
  expect(Object.keys(POLICY).sort()).toEqual([...CAUSES].sort());
  const plain = { countsToCap: true, rescuable: true, holdsBackend: false, waitMs: 0 };
  for (const c of CAUSES) expect([c, POLICY[c]]).toEqual([c, c === "credit" ? { countsToCap: false, rescuable: false, holdsBackend: true, waitMs: 10 * 60_000 } : plain]);
  expect(policyOf(undefined)).toBe(POLICY.other);
});

test("an old dropped run keeps its no-commit mark, and free prose states no cause", () => {
  expect(causeOf(run({ state: "dropped", noCommit: true, reason: "a duplicate" }))).toBe("no-commit");
  expect(causeOf(run({ state: "dropped", reason: "the work has no commit and a time box" }))).toBeUndefined();
});

test("the news names the stated check, and no other cause", () => {
  expect(newsLine(entry({ repo: "aleph", target: "issue.1421", state: "failed", cause: "check", checkName: "tests", reason: "tests failed" }, "job.6"))).toBe("job.6 failed check → tests");
  expect(newsLine(entry({ repo: "aleph", target: "issue.1421", state: "failed", cause: "other", reason: "commit-tree failed" }, "job.6"))).toBe("job.6 failed other");
});

test("the news is the job ID and the state word", () => {
  expect(newsLine(entry({ repo: "aleph", target: "issue.1421", state: "landed" }, "job.6"))).toBe("job.6 landed");
});

test("a waiting run takes its sub from its Ask's needs, in the sub set's words", () => {
  const wait = (reason: string): Partial<Run> => ({ state: "waiting", ask: { kind: "approval", reason, question: "q", options: [], why: [] } });
  expect(newsLine(entry(wait("held-path")))).toBe("job.1 waiting protected");
  expect(newsLine(entry(wait("question")))).toBe("job.1 waiting question");
});

test("a landed reason and the repo note follow on a second line, indented two spaces", () => {
  expect(newsLine(entry({ state: "landed", reason: "no net change" }))).toBe("job.1 landed\n  no net change");
  expect(newsLine(entry({ state: "landed", reason: "no net change" }), "the tests are flaky")).toBe("job.1 landed\n  no net change the tests are flaky");
});

test("the news drops the check-open and next-step joins, and holds no semicolon", () => {
  const landed = newsLine(entry({ state: "landed", check: "open", next: "worker", reason: "no net change" }));
  expect(landed).toBe("job.1 landed\n  no net change");
  expect(landed).not.toContain(";");
  expect(newsLine(entry({ state: "passed", next: "land" }))).toBe("job.1 passed");
});
