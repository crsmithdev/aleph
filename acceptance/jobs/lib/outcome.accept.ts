// Archived goal tests from jobs/lib/outcome.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
import { type Run } from "../../../jobs/lib/ledger.ts";
import { causeOf, failedCheckOf } from "../../../jobs/lib/outcome.ts";

const run = (o: Partial<Run>) => ({ kind: "build", job: "j", name: "n", repo: "fac", condition: "stuck", told: false, started: "", ...o }) as Run;

test("an old run with only the runners' sentence still reads as a cause", () => {
  const old = (reason: string) => run({ condition: "failed", reason });
  expect([causeOf(old("tests failed")), failedCheckOf(old("tests failed"))]).toEqual(["check", "tests"]);
  expect([causeOf(old("timed out: check lint")), failedCheckOf(old("timed out: check lint"))]).toEqual(["check", "lint"]);
  expect(causeOf(old("checkout failed"))).toBe("infra");
  expect(causeOf(old("hidden check failed: 1 of 3 tests"))).toBe("hidden-check");
  expect(causeOf(old("checks did not start (exit 1)"))).toBeUndefined();
});
