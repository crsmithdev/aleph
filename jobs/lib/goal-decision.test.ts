import { expect, test } from "bun:test";
import { GATES, goalDecision, refDone, type GoalFacts } from "./goal-decision.ts";

const item = (fm: Record<string, unknown> = {}) => ({ fm, notes: [] }) as unknown as GoalFacts["item"];
const facts = (f: Partial<GoalFacts> = {}): GoalFacts => ({ name: "fac-9", item: item(), done: () => false, ...f });
const kind = (f: Partial<GoalFacts>) => goalDecision(facts(f)).kind;
const live = { why: "12 agent runs are live", text: "Waiting for a slot (12 of 12 running)" };

test("a goal with no fact against it is ready, and a fact not read stops nothing", () => {
  expect(goalDecision(facts())).toEqual({ kind: "ready", why: "ready", text: "Starts at the next dispatch" });
});

test("Not ready names only the open after refs, in both lines", () => {
  const d = goalDecision(facts({ item: item({ after: ["fac-1", "fac-2", "fac-3"] }), done: (r) => r === "fac-1" }));
  expect(d).toEqual({ kind: "not-ready", ids: ["fac-2", "fac-3"], why: "after fac-2,fac-3", text: "Waits on fac-2, fac-3" });
});

test("the 6 gates bind in the order of GATES, Loop guard last", () => {
  expect([...GATES]).toEqual(["pause", "baseline", "not-ready", "live-cap", "busy-file", "loop-guard"]);
  const all: Partial<GoalFacts> = { pause: { why: "paused", text: "The factory is paused" }, red: "main is red", open: "running", "live-cap": live, busy: "waits for fac-1: both change the busy file a.ts", noCommits: 3 };
  const clear: Partial<GoalFacts>[] = [{ pause: null }, { red: null }, { open: null }, { "live-cap": null }, { busy: null }, { noCommits: 0 }];
  let f = all;
  for (const [i, k] of GATES.entries()) {
    expect(kind(f)).toBe(k);
    f = { ...f, ...clear[i] };
  }
  expect(kind(f)).toBe("ready");
});

test("Baseline binds on each line the dispatch gives for a main that is not green: red, running and unchecked", () => {
  for (const red of ["main is red at abc1234: tests", "main baseline running", "main is unchecked: fetch failed"]) {
    expect(goalDecision(facts({ red }))).toEqual({ kind: "baseline", why: red, text: red });
  }
  expect(kind({ red: null })).toBe("ready");
});

test("Baseline lets the red-main fix through, and the later gates still bind on it", () => {
  const fix = item({ labels: ["red-main"] });
  expect(kind({ item: fix, red: "main is red at abc1234: tests" })).toBe("ready");
  // The firefighter's `add` writes the label into `areas`, as aleph-1161 has it.
  expect(kind({ item: item({ areas: ["red-main"] }), red: "main is red at abc1234: tests" })).toBe("ready");
  expect(kind({ item: fix, red: "main is red at abc1234: tests", "live-cap": live })).toBe("live-cap");
});

test("Not ready covers a done goal, an after ref, an open job, a planner and a spec check, in that order", () => {
  const all: Partial<GoalFacts> = { done: (r) => r === "fac-9", item: item({ after: ["fac-1"] }), open: "running", planning: true, checking: true };
  expect(goalDecision(facts(all)).why).toBe("the item is already done");
  expect(goalDecision(facts({ ...all, done: () => false })).why).toBe("after fac-1");
  expect(goalDecision(facts({ ...all, done: () => false, item: item() })).why).toBe("its job is running");
  expect(goalDecision(facts({ ...all, done: () => false, item: item(), open: null })).why).toBe("planning");
  expect(goalDecision(facts({ checking: true }))).toMatchObject({ kind: "not-ready", why: "spec check running" });
});

test("the Queued lane reads the stops it once left out", () => {
  expect(goalDecision(facts({ busy: "waits for fac-1: both change the busy file a.ts" })).text).toBe("Waits for fac-1: both change the busy file a.ts");
  expect(goalDecision(facts({ noCommits: 3 }))).toMatchObject({ kind: "loop-guard", ask: "no-commit", why: "3 runs in a row with no commit" });
  expect(goalDecision(facts({ startsInHour: 4 }))).toMatchObject({ kind: "loop-guard", ask: "run-cap", starts: 4, why: "4 runs in the last hour" });
});

test("Loop guard binds at its limits; an answered run cap skips the hour count", () => {
  expect(kind({ noCommits: 2 })).toBe("ready");
  expect(kind({ startsInHour: 2 })).toBe("ready");
  expect(kind({ startsInHour: 3, capHeld: true })).toBe("ready");
});

test("a factory gate gives the dispatch its why and Chris its text", () => {
  expect(goalDecision(facts({ "live-cap": live }))).toEqual({ kind: "live-cap", ...live });
});

test("refDone: an item absent from a read list is done; a list not read blocks", () => {
  expect(refDone(undefined, true, undefined)).toBe(true);
  expect(refDone(undefined, false, undefined)).toBe(false);
  expect(refDone({ fm: { closed_as: "done" } } as any, true, undefined)).toBe(true);
  expect(refDone({ fm: {} } as any, true, undefined)).toBe(false);
  expect(refDone({ fm: {} } as any, true, "done")).toBe(true);
  expect(refDone({ fm: { parked: "true" } } as any, true, undefined)).toBe(false);
});
