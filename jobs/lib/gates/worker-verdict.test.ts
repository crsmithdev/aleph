import { describe, expect, test } from "bun:test";
import type { ChecksStop } from "./checks.ts";
import type { Run } from "../records/ledger.ts";
import { missingVerdict, workerVerdict, type Branch, type NoVerdict, type ReviewCall, type VerdictPorts } from "./worker-verdict.ts";

const run = (r: Partial<Run> = {}): Run => ({ n: 1, kind: "build", job: "j1", name: "fac-1", condition: "failed", ...r } as Run);
const checked = { checkedBase: "b0", checkedTip: "t1" };

/** Fake ports: each step passes unless given; `calls` names the steps that ran. */
function ports(o: { stop?: ChecksStop; failed?: string; same?: string; claims?: string; kept?: string | NoVerdict; security?: string; rule?: string; oracle?: string | NoVerdict; reviews?: ReviewCall[] } = {}) {
  const calls: string[] = [];
  const reviews = [...(o.reviews ?? [{ reason: null }])];
  const p: VerdictPorts = {
    checks: async () => { calls.push("checks"); return { stop: o.stop ?? null, failed: o.failed }; },
    repeatedFailure: (check) => { calls.push(`repeatedFailure ${check}`); return o.same ? { question: o.same } : null; },
    docClaims: () => { calls.push("docClaims"); return o.claims ?? null; },
    keepGate: async () => { calls.push("keepGate"); return o.kept ?? null; },
    stat: () => " a.ts | 1 +",
    security: () => { calls.push("security"); return o.security ?? null; },
    heldRule: () => o.rule ?? null,
    oracle: async () => { calls.push("oracle"); return o.oracle ?? null; },
    review: async () => { calls.push("review"); return reviews.shift() ?? { reason: null }; },
  };
  return { p, calls };
}
/** The branch facts; `done`, the record's fix rounds, follows the runs sent back unless the test gives it. */
const branch = (b: Partial<Branch> = {}): Branch => {
  const earlier = "earlier" in b ? b.earlier : [];
  return { earlier, done: earlier?.length, rounds: 2, facts: {}, checked, ...b };
};
const two = [run({ failed: "tests" }), run({ failed: "tests" })];

describe("checks", () => {
  const tests: ChecksStop = { cause: "check", checkName: "tests", reason: "tests failed" };

  test("a check's own failure goes back as a fix round, before the doc claims, the Oracle and the reviewer", async () => {
    const { p, calls } = ports({ stop: tests, failed: "tests" });
    const v = await workerVerdict(branch({ earlier: [run({ failed: "tests" })], facts: { cost: 1 } }), p);
    expect(v).toEqual({ outcome: { condition: "returned", cause: "check", checkName: "tests", reason: "tests failed", cost: 1, failed: "tests", round: 1 }, code: 1 });
    // The earlier round failed tests too, so the repeat rule looks; this fake finds no repeat.
    expect(calls).toEqual(["checks", "repeatedFailure tests"]);
  });

  test("at the cap the run stays stuck and its reason counts the rounds; a cap of 0 adds nothing; a recheck has no rounds", async () => {
    expect((await workerVerdict(branch({ earlier: two }), ports({ stop: tests, failed: "tests" }).p)).outcome).toEqual({ condition: "failed", cause: "check", checkName: "tests", reason: "tests failed after 2 fix rounds" });
    expect((await workerVerdict(branch({ rounds: 0 }), ports({ stop: tests, failed: "tests" }).p)).outcome).toEqual({ condition: "failed", cause: "check", checkName: "tests", reason: "tests failed" });
    expect((await workerVerdict(branch({ earlier: undefined }), ports({ stop: tests, failed: "tests" }).p)).outcome).toEqual({ condition: "failed", cause: "check", checkName: "tests", reason: "tests failed" });
  });

  test("only the failed check's own stop goes back: a time-out, another check's stop or an infra stop does not", async () => {
    const plain = async (stop: ChecksStop, failed?: string) => (await workerVerdict(branch(), ports({ stop, failed }).p)).outcome;
    expect(await plain({ ...tests, reason: "timed out: check tests", timedOut: true }, "tests")).toEqual({ condition: "failed", cause: "check", checkName: "tests", reason: "timed out: check tests" });
    expect((await plain({ cause: "check", checkName: "lint", reason: "lint failed" }, "tests")).round).toBeUndefined();
    expect((await plain(tests, undefined)).round).toBeUndefined();
    expect(await plain({ cause: "infra", reason: "bundle failed" }, "tests")).toEqual({ condition: "failed", cause: "infra", reason: "bundle failed" });
    // A check that gave no verdict goes to the rescue, which runs it again; it is not a fix round.
    expect(await plain({ cause: "infra", checkName: "tests", reason: "no verdict: check tests timed out", timedOut: true }, "tests")).toEqual({ condition: "failed", cause: "infra", checkName: "tests", reason: "no verdict: check tests timed out" });
  });

  test("a check that failed the same way on the run before asks Chris instead of a round", async () => {
    const { p, calls } = ports({ stop: tests, failed: "tests", same: "Is the test wrong?" });
    const v = await workerVerdict(branch({ earlier: [run({ failed: "tests" })] }), p);
    expect(v.code).toBe(0);
    expect(v.outcome).toMatchObject({ condition: "waiting", question: "Is the test wrong?", cause: "check", checkName: "tests", reason: tests.reason, ask: { reason: "question" } });
    expect(calls).toEqual(["checks", "repeatedFailure tests"]);
    // No round left, or a recheck: the question is not asked.
    for (const earlier of [two, undefined]) {
      const q = ports({ stop: tests, failed: "tests", same: "Is the test wrong?" });
      expect((await workerVerdict(branch({ earlier }), q.p)).outcome.condition).toBe("failed");
      expect(q.calls).toEqual(["checks"]);
    }
  });

  test("a doc claim the transcript does not back goes back as the check doc-claims", async () => {
    const { p, calls } = ports({ claims: "doc claims: x" });
    expect((await workerVerdict(branch(), p)).outcome).toEqual({ condition: "returned", cause: "check", checkName: "doc-claims", reason: "doc claims: x", failed: "doc-claims", round: 0 });
    expect(calls).toEqual(["checks", "docClaims"]);
  });

  test("a keep-gate failure goes back as the check keep-gate, before the Oracle and the reviewer", async () => {
    const reason = "keep-gate: 1 new test passes on the base commit: a.test.ts > adds";
    const { p, calls } = ports({ kept: reason, security: "jobs/lib/gates/gate.ts" });
    expect((await workerVerdict(branch(), p)).outcome).toEqual({ condition: "returned", cause: "check", checkName: "keep-gate", reason, failed: "keep-gate", round: 0 });
    expect(calls).toEqual(["checks", "docClaims", "keepGate"]);
    expect((await workerVerdict(branch({ earlier: two }), ports({ kept: reason }).p)).outcome.reason).toBe(`${reason} after 2 fix rounds`);
  });

  test("a second-stage keep-gate failure, a new test that earns no keep, goes back the same way", async () => {
    const reason = "keep-gate: 1 new test adds no coverage of the changed lines and kills no mutant: a.test.ts > adds";
    expect((await workerVerdict(branch(), ports({ kept: reason }).p)).outcome).toEqual({ condition: "returned", cause: "check", checkName: "keep-gate", reason, failed: "keep-gate", round: 0 });
  });
});

describe("after the checks", () => {
  test("a pass states the checked base and tip and the reviewer's costs", async () => {
    const { p, calls } = ports({ reviews: [{ reason: null, cost: 0.5 }] });
    expect(await workerVerdict(branch({ facts: { cost: 1 } }), p)).toEqual({ outcome: { condition: "passed", cost: 1.5, ...checked }, code: 0 });
    expect(calls).toEqual(["checks", "docClaims", "keepGate", "oracle", "review", "security"]);
  });

  test("a security path runs Verify and the reviewer, then waits for Chris with a held-path Ask", async () => {
    const { p, calls } = ports({ security: "jobs/lib/gates/gate.ts" });
    const v = await workerVerdict(branch(), p);
    expect(v).toMatchObject({ code: 0, outcome: { condition: "waiting", reason: "held path jobs/lib/gates/gate.ts", stat: " a.ts | 1 +", ask: { reason: "held-path" }, ...checked } });
    expect(calls).toEqual(["checks", "docClaims", "keepGate", "oracle", "review", "security"]);
  });

  test("a security path the reviewer holds is a fix round, not an Ask", async () => {
    const v = await workerVerdict(branch(), ports({ security: "jobs/lib/gates/gate.ts", reviews: [{ reason: "reviewer: no test" }] }).p);
    expect(v.outcome).toMatchObject({ condition: "returned", failed: "review", round: 0 });
    expect(v.outcome.ask).toBeUndefined();
  });

  test("an Oracle failure goes back as the check oracle, with no reviewer", async () => {
    const { p, calls } = ports({ oracle: "oracle failed: bun test x" });
    expect((await workerVerdict(branch(), p)).outcome).toEqual({ condition: "returned", cause: "check", checkName: "oracle", reason: "oracle failed: bun test x", ...checked, failed: "oracle", round: 0 });
    expect(calls).not.toContain("review");
  });

  test("a keep-gate or an Oracle with no verdict is an infra stop: no pass, no fix round, no reviewer", async () => {
    const kept = ports({ kept: { noVerdict: "no verdict: keep-gate: the new tests did not run on the head" } });
    expect((await workerVerdict(branch(), kept.p)).outcome).toEqual({ condition: "failed", cause: "infra", checkName: "keep-gate", reason: "no verdict: keep-gate: the new tests did not run on the head" });
    expect(kept.calls).toEqual(["checks", "docClaims", "keepGate"]);
    const oracle = ports({ oracle: { noVerdict: "no verdict: oracle: bun test x" } });
    expect((await workerVerdict(branch(), oracle.p)).outcome).toEqual({ condition: "failed", cause: "infra", checkName: "oracle", reason: "no verdict: oracle: bun test x", ...checked });
    expect(oracle.calls).not.toContain("review");
  });

  test("a held rule waits for Chris after the reviewer passes, with one held-path Ask and no next step", async () => {
    const v = await workerVerdict(branch(), ports({ rule: "held path held/x.txt" }).p);
    expect(v).toEqual({ code: 0, outcome: { condition: "waiting", reason: "held path held/x.txt", stat: " a.ts | 1 +", ...checked, ask: expect.objectContaining({ reason: "held-path", why: [" a.ts | 1 +"] }) } });
  });
});

describe("the reviewer", () => {
  test("a reviewer with no verdict runs once more; a second miss waits for Chris whatever rounds are left", async () => {
    const miss = { reason: "reviewer: no verdict (time box)", none: true, cost: 1 };
    const { p, calls } = ports({ reviews: [miss, miss] });
    const v = await workerVerdict(branch(), p);
    expect(calls.filter((c) => c === "review")).toHaveLength(2);
    expect(v).toMatchObject({ code: 0, outcome: { condition: "waiting", cause: "review", reason: miss.reason, cost: 2, ask: { reason: "review" } } });
    expect((await workerVerdict(branch(), ports({ reviews: [miss, { reason: null }] }).p)).outcome.condition).toBe("passed");
  });

  test("a reviewer the API refused for credit stops the run with the credit cause, with no second call and no Ask", async () => {
    const line = "API Error: 402 This request would exceed your available credits";
    const { p, calls } = ports({ reviews: [{ reason: `reviewer: no verdict (${line})`, credit: line, none: true }] });
    const v = await workerVerdict(branch(), p);
    expect(v).toEqual({ outcome: { condition: "failed", cause: "credit", reason: line, ...checked }, code: 1 });
    expect(v.outcome.ask).toBeUndefined();
    expect(calls.filter((c) => c === "review")).toHaveLength(1);
  });

  test("a hold goes back as a fix round while rounds are left", async () => {
    const v = await workerVerdict(branch(), ports({ reviews: [{ reason: "reviewer: no test" }] }).p);
    expect(v).toEqual({ outcome: { condition: "returned", cause: "review", reason: "reviewer: no test", stat: " a.ts | 1 +", ...checked, failed: "review", round: 0 }, code: 1 });
  });

  test("a hold after the last round waits for Chris, and says how often it went back", async () => {
    const reason = async (earlier: Run[] | undefined) => (await workerVerdict(branch({ earlier }), ports({ reviews: [{ reason: "reviewer: still no test" }] }).p)).outcome;
    expect(await reason([run({ failed: "review" }), run({ failed: "tests" })])).toMatchObject({ condition: "waiting", reason: "the reviewer sent it back once: still no test", ask: { reason: "review" } });
    expect((await reason(two)).reason).toBe("reviewer: still no test");
    expect((await reason(undefined)).reason).toBe("reviewer: still no test");
  });
});

describe("missingVerdict", () => {
  test("a held run may land once the reviewer gave a verdict; no second review is read", () => {
    expect(missingVerdict(undefined)).toBe("the reviewer has no verdict yet");
    expect(missingVerdict('{"summary":"Looks fine."}')).toBe("the reviewer has no verdict yet");
    expect(missingVerdict('{"verdict":"pass","summary":"s","failures":[]}')).toBeNull();
    expect(missingVerdict('{"verdict":"hold","summary":"s","failures":[]}')).toBeNull();
  });
});
