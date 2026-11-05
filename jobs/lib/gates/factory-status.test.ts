import { afterEach, beforeEach, expect, test } from "bun:test";
import { readList } from "../../../issues/lib/store.ts";
import { setup, teardown, mk, newIssue } from "../transitions/factory.helpers.ts";
import { issueFacts } from "./factory-status.ts";
import { allJobs, loadRegistry } from "../records/ledger.ts";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60_000;
beforeEach(() => setup());
afterEach(() => teardown());

const facts = (id: number) => {
  const item = readList({ key: "fac" })!.items.find((i) => i.id === id)!;
  return issueFacts(loadRegistry().fac, item, allJobs(), NOW).startsInHour;
};

test("one job whose first run and two fix rounds started in the last hour is one start", () => {
  const id = newIssue();
  const { job } = mk(`fac-${id}`, "build", "failed", { started: ago(40 * MIN) });
  mk(`fac-${id}`, "build", "failed", { job, started: ago(30 * MIN) });
  mk(`fac-${id}`, "build", "passed", { job, started: ago(10 * MIN) });
  expect(facts(id)).toBe(1);
});

test("three jobs whose first runs started in the last hour are three starts; a job whose first run is older does not count", () => {
  const id = newIssue();
  for (const started of [50, 30, 10]) {
    const { job } = mk(`fac-${id}`, "build", "failed", { started: ago(started * MIN) });
    mk(`fac-${id}`, "build", "passed", { job, started: ago((started - 5) * MIN) });
  }
  const old = mk(`fac-${id}`, "build", "failed", { started: ago(90 * MIN) });
  mk(`fac-${id}`, "build", "passed", { job: old.job, started: ago(10 * MIN) });
  expect(facts(id)).toBe(3);
});
