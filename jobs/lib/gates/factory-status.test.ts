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

const allFacts = (id: number) => {
  const item = readList({ key: "fac" })!.items.find((i) => i.id === id)!;
  return issueFacts(loadRegistry().fac, item, allJobs(), NOW);
};

const facts = (id: number) => allFacts(id).startsInHour;

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

test("a first run that ended with the API credit error is no start, and the goal waits for credit from the newest such run", () => {
  const id = newIssue();
  const credit = { cause: "credit", reason: "API Error: 402 This request would exceed your available credits" } as const;
  mk(`fac-${id}`, "build", "failed", { started: ago(50 * MIN), ended: ago(45 * MIN), ...credit });
  mk(`fac-${id}`, "build", "failed", { started: ago(30 * MIN), ended: ago(25 * MIN) });
  mk(`fac-${id}`, "build", "failed", { started: ago(10 * MIN), ended: ago(5 * MIN), ...credit });
  const f = allFacts(id);
  expect(f.startsInHour).toBe(1);
  expect(f.creditWait).toBe(5 * MIN);
});

test("a run whose stderr.log holds the credit error but that states no credit cause is a start and sets no credit wait", () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { started: ago(10 * MIN), ended: ago(5 * MIN) }, { "stderr.log": "API Error: 402 This request would exceed your available credits\n" });
  const f = allFacts(id);
  expect(f.startsInHour).toBe(1);
  expect(f.creditWait).toBeNull();
});
