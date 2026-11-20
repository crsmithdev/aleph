import { afterEach, beforeEach, expect, test } from "bun:test";
import { putJson } from "../../../lib/db.ts";
import { readList } from "../../../lib/store.ts";
import { setup, teardown, mk, newIssue } from "../transitions/factory.testkit.ts";
import { logTo } from "../records/run-files.ts";
import { firefighterLines, issueFacts, nextRun, gates } from "./factory-status.ts";
import { backendHold, heldIssue, holdBackend, holdIssue, probeHold, recordHold } from "./holds.ts";
import { issueDecision } from "./issue-decision.ts";
import { allJobs, loadRegistry } from "../records/ledger.ts";
import { logEvent, readEvents } from "../../../lib/layout.ts";
import { setModel } from "../routing/models.ts";

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
  const last = mk(`fac-${id}`, "build", "failed", { started: ago(10 * MIN), ended: ago(5 * MIN), ...credit });
  const f = allFacts(id);
  expect(f.startsInHour).toBe(1);
  expect(f.creditWait).toEqual({ job: last.job, ago: 5 * MIN });
});

test("first runs that ended with the API credit error set no run-cap Ask: past the credit wait, the hour count stays below the cap", () => {
  const id = newIssue();
  for (const m of [50, 40, 30, 20]) mk(`fac-${id}`, "build", "dropped", { started: ago(m * MIN), ended: ago((m - 5) * MIN), cause: "credit", reason: "API Error: 402" });
  const f = allFacts(id);
  expect(f.startsInHour).toBe(0);
  expect(issueDecision({ ...f, done: () => false }).kind).toBe("ready");
});

test("a run whose stderr holds the credit error but that states no credit cause is a start and sets no credit wait", () => {
  const id = newIssue();
  logTo(mk(`fac-${id}`, "build", "failed", { started: ago(10 * MIN), ended: ago(5 * MIN) }).folder, "stderr", "API Error: 402 This request would exceed your available credits\n");
  const f = allFacts(id);
  expect(f.startsInHour).toBe(1);
  expect(f.creditWait).toBeNull();
});

test("a held backend binds the gates for a run on its own model and not for a Claude run", async () => {
  await holdBackend("openrouter", "API Error: 402 This request would exceed your available credits");
  const held = gates({ run: { model: "deepseek-v4.1-flash" } });
  expect(held?.gate).toBe("waiting");
  expect(held?.why).toBe("waits for OpenRouter: API Error: 402 This request would exceed your available credits");
  expect(gates({ run: { model: "haiku" } })).toBeNull();
  expect(gates({ run: { model: "sonnet" } })).toBeNull();
});

test("the hold lifts when the probe answers, and stays when the probe fails", async () => {
  await holdBackend("openrouter", "API Error: 402 This request would exceed your available credits");
  await holdBackend("openrouter", "API Error: 402 This request would exceed your available credits");
  expect(await probeHold(async () => false)).toBeNull();
  expect(backendHold()?.via).toBe("openrouter");
  expect(await probeHold(async () => true)).toBe("OpenRouter answers again: the hold is off");
  expect(readEvents().filter((e) => e.object === "settings").map((e) => [e.subject, e.action, e.detail])).toEqual([
    ["gate", "changed", "credit: on: openrouter: API Error: 402 This request would exceed your available credits"],
    ["gate", "changed", "credit: off"],
  ]);
  expect(backendHold()).toBeNull();
});

test("an issue with no run that the hold held stays held with no new routing, until the hold lifts", async () => {
  setModel("small", { model: "deepseek-v4.1-flash" });
  await holdBackend("openrouter", "API Error: 402 This request would exceed your available credits");
  holdIssue("fac-1");
  expect(heldIssue("fac-1")?.why).toBe("waits for OpenRouter: API Error: 402 This request would exceed your available credits");
  expect(heldIssue("fac-2")).toBeNull();
  await probeHold(async () => true);
  expect(heldIssue("fac-1")).toBeNull();
});

test("a held issue stops binding once no size runs on the held backend, while the hold stays", async () => {
  setModel("small", { model: "deepseek-v4.1-flash" });
  setModel("medium", { model: "sonnet" });
  setModel("large", { model: "claude-opus-5-5" });
  await holdBackend("openrouter", "API Error: 402 This request would exceed your available credits");
  holdIssue("fac-1");
  expect(heldIssue("fac-1")?.why).toBe("waits for OpenRouter: API Error: 402 This request would exceed your available credits");
  setModel("small", { model: "haiku" });
  expect(heldIssue("fac-1")).toBeNull();
  expect(backendHold()?.via).toBe("openrouter");
});

test("a backend-hold row stored with the old goals field still holds its issues", () => {
  setModel("small", { model: "deepseek-v4.1-flash" });
  putJson("state", "backend-hold", { via: "openrouter", why: "API Error: 402", since: "2026-11-01T00:00:00Z", goals: ["fac-1"] });
  expect(heldIssue("fac-1")?.why).toBe("waits for OpenRouter: API Error: 402");
  holdIssue("fac-2");
  expect(backendHold()?.issues).toEqual(["fac-1", "fac-2"]);
  expect(backendHold()).not.toHaveProperty("goals");
});

test("recordHold logs its hold event once, and not again for the same kind and text", () => {
  const ev = { action: "held", detail: "full: 3 / 3 jobs" };
  recordHold("fac-3", "full", ev);
  recordHold("fac-3", "full", ev);
  expect(readEvents().filter((e) => e.object === "fac-3").map((e) => e.action)).toEqual(["held"]);
});

test("firefighterLines returns the line of a firefighter event", () => {
  logEvent({ subject: "firefighter", action: "filed", object: "fac", detail: "from the event log" });
  expect(firefighterLines().map((l) => l.line)).toEqual(["firefighter: from the event log"]);
});

test("after a clock step back, nextRun returns the build run with the higher ID though it started earlier", () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { started: ago(10 * MIN) });
  mk(`fac-${id}`, "build", "passed", { started: ago(50 * MIN) });
  const run = nextRun("fac", `issue.${id}`, allJobs());
  expect(run?.state).toBe("passed");
  expect(run?.started).toBe(ago(50 * MIN));
});

test("a land that failed on a lock does not hide the job's passed build", () => {
  const id = newIssue();
  const { job } = mk(`fac-${id}`, "build", "passed", { started: ago(20 * MIN), ended: ago(15 * MIN) });
  mk(`fac-${id}`, "land", "failed", { job, started: ago(10 * MIN), ended: ago(5 * MIN), cause: "locked", reason: "busy lock" });
  const f = allFacts(id);
  expect(f.open).toBe("passed");
  expect(f.job).toBe(job);
});

test("an open job whose last run ended with the API credit error holds the issue for the credit wait, then the issue is ready", () => {
  const id = newIssue();
  mk(`fac-${id}`, "build", "failed", { started: ago(10 * MIN), ended: ago(5 * MIN), cause: "credit", reason: "API Error: 402" });
  const decide = (at: number) => issueDecision({ ...issueFacts(loadRegistry().fac, readList({ key: "fac" })!.items.find((i) => i.id === id)!, allJobs(), at), done: () => false }).kind;
  expect(decide(NOW)).toBe("credit");
  expect(decide(NOW + 6 * MIN)).toBe("ready");
});
