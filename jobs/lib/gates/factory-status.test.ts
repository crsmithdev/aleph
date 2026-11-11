import { afterEach, beforeEach, expect, test } from "bun:test";
import { readList } from "../../../issues/lib/store.ts";
import { setup, teardown, mk, newIssue } from "../transitions/factory.helpers.ts";
import { firefighterLines, issueFacts, nextRun, backendHold, gates, heldGoal, holdBackend, probeHold, recordHold } from "./factory-status.ts";
import { issueDecision } from "./issue-decision.ts";
import { allJobs, loadRegistry } from "../records/ledger.ts";
import { logEvent, readEvents } from "../../../lib/layout.ts";

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

test("a first run that ended with the API credit error is no start, and the issue waits for credit from the newest such run", () => {
  const id = newIssue();
  const credit = { cause: "credit", reason: "API Error: 402 This request would exceed your available credits" } as const;
  mk(`fac-${id}`, "build", "failed", { started: ago(50 * MIN), ended: ago(45 * MIN), ...credit });
  mk(`fac-${id}`, "build", "failed", { started: ago(30 * MIN), ended: ago(25 * MIN) });
  mk(`fac-${id}`, "build", "failed", { started: ago(10 * MIN), ended: ago(5 * MIN), ...credit });
  const f = allFacts(id);
  expect(f.startsInHour).toBe(1);
  expect(f.creditWait).toBe(5 * MIN);
});

test("first runs that ended with the API credit error set no run-cap Ask: past the credit wait, the hour count stays below the cap", () => {
  const id = newIssue();
  for (const m of [50, 40, 30, 20]) mk(`fac-${id}`, "build", "dropped", { started: ago(m * MIN), ended: ago((m - 5) * MIN), cause: "credit", reason: "API Error: 402" });
  const f = allFacts(id);
  expect(f.startsInHour).toBe(0);
  expect(issueDecision({ ...f, done: () => false }).kind).toBe("ready");
});

test("a run whose stderr.log holds the credit error but that states no credit cause is a start and sets no credit wait", () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { started: ago(10 * MIN), ended: ago(5 * MIN) }, { "stderr.log": "API Error: 402 This request would exceed your available credits\n" });
  const f = allFacts(id);
  expect(f.startsInHour).toBe(1);
  expect(f.creditWait).toBeNull();
});

test("a held backend binds the gates for a run on its own model and not for a Claude run", async () => {
  await holdBackend("openrouter", "API Error: 402 This request would exceed your available credits");
  const held = gates({ run: { model: "deepseek-v4.1-flash" } });
  expect(held?.gate).toBe("backend");
  expect(held?.why).toBe("waits for OpenRouter: API Error: 402 This request would exceed your available credits");
  expect(gates({ run: { model: "haiku" } })).toBeNull();
  expect(gates({ run: { model: "sonnet" } })).toBeNull();
});

test("the hold lifts when the probe answers, and stays when the probe fails", async () => {
  await holdBackend("openrouter", "API Error: 402 This request would exceed your available credits");
  expect(await probeHold(async () => false)).toBeNull();
  expect(backendHold()?.via).toBe("openrouter");
  expect(await probeHold(async () => true)).toBe("OpenRouter answers again: the hold is off");
  expect(readEvents().filter((e) => e.subject === "openrouter").map((e) => [e.action, e.note])).toEqual([
    ["paused", "held OpenRouter: API Error: 402 This request would exceed your available credits"],
    ["reran", "OpenRouter answers again: the hold is off"],
  ]);
  expect(backendHold()).toBeNull();
});

test("an issue with no run that the hold held stays held with no new routing, until the hold lifts", async () => {
  await holdBackend("openrouter", "API Error: 402 This request would exceed your available credits");
  recordHold("fac-1", "backend", "waits for OpenRouter: API Error: 402 This request would exceed your available credits");
  recordHold("fac-2", "live-cap", "3 agent runs are live");
  expect(heldGoal("fac-1")?.why).toBe("waits for OpenRouter: API Error: 402 This request would exceed your available credits");
  expect(heldGoal("fac-2")).toBeNull();
  await probeHold(async () => true);
  expect(heldGoal("fac-1")).toBeNull();
});

test("recordHold logs its hold event once, and not again for the same kind and text", () => {
  const ev = { action: "paused" };
  recordHold("fac-3", "live-cap", "3 agent runs are live", ev);
  recordHold("fac-3", "live-cap", "3 agent runs are live", ev);
  expect(readEvents().filter((e) => e.subject === "fac-3").map((e) => e.action)).toEqual(["paused"]);
});

test("firefighterLines returns the line of a firefighter event", () => {
  logEvent({ by: "firefighter", subject: "fac", action: "filed", note: "from the event log" });
  expect(firefighterLines().map((l) => l.line)).toEqual(["firefighter: from the event log"]);
});

test("after a clock step back, nextRun returns the build run with the higher ID though it started earlier", () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { started: ago(10 * MIN) });
  mk(`fac-${id}`, "build", "passed", { started: ago(50 * MIN) });
  const run = nextRun("fac", `fac-${id}`, allJobs());
  expect(run?.condition).toBe("passed");
  expect(run?.started).toBe(ago(50 * MIN));
});

test("a land that failed on a lock does not hide the job's passed build", () => {
  const id = newIssue();
  const { job } = mk(`fac-${id}`, "build", "passed", { started: ago(20 * MIN), ended: ago(15 * MIN) });
  mk(`fac-${id}`, "land", "failed", { job, started: ago(10 * MIN), ended: ago(5 * MIN), cause: "locked", reason: "busy lock" });
  const f = allFacts(id);
  expect(f.open).toBe("passed");
  expect(f.job).toBe(`fac-${id}#1`);
});

test("an open job whose last run ended with the API credit error holds the issue for the credit wait, then the issue is ready", () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { started: ago(10 * MIN), ended: ago(5 * MIN), cause: "credit", reason: "API Error: 402" });
  const decide = (at: number) => issueDecision({ ...issueFacts(loadRegistry().fac, readList({ key: "fac" })!.items.find((i) => i.id === id)!, allJobs(), at), done: () => false }).kind;
  expect(decide(NOW)).toBe("credit-wait");
  expect(decide(NOW + 6 * MIN)).toBe("ready");
});
