import { expect, test } from "bun:test";
import { goalDecision, refDone, type GoalFacts } from "./goal-decision.ts";

const item = (fm: Record<string, unknown> = {}) => ({ fm, notes: [] }) as unknown as GoalFacts["item"];
const facts = (f: Partial<GoalFacts> = {}): GoalFacts => ({ name: "fac-9", item: item(), done: () => false, ...f });
const kind = (f: Partial<GoalFacts>) => goalDecision(facts(f)).kind;
const gate = { gate: "live", why: "12 agent runs are live", text: "Waiting for a slot (12 of 12 running)" } as const;

test("a goal with no fact against it is ready, and a fact not read stops nothing", () => {
  expect(goalDecision(facts())).toEqual({ kind: "ready", why: "ready", text: "Starts at the next dispatch" });
});

test("waits_on names only the open refs, in both lines", () => {
  const d = goalDecision(facts({ item: item({ after: ["fac-1", "fac-2", "fac-3"] }), done: (r) => r === "fac-1" }));
  expect(d).toEqual({ kind: "waits_on", ids: ["fac-2", "fac-3"], why: "blocked: after fac-2,fac-3", text: "Waits on fac-2, fac-3" });
});

test("the first fact in the dispatch's order decides", () => {
  const all: Partial<GoalFacts> = { red: "main is red", done: (r) => r === "fac-9", item: item({ after: ["fac-1"] }), open: "running", planning: true, gate, busy: "waits for fac-1: both change the busy file a.ts", noCommits: 3, startsInHour: 3 };
  const order = ["red", "done", "waits_on", "open", "planning", "gate", "busy", "no-commit", "run-cap"];
  const clear: Partial<GoalFacts>[] = [{ red: null }, { done: (r) => r !== "fac-9" && r !== "fac-1" }, { done: () => false, item: item() }, { open: null }, { planning: false }, { gate: null }, { busy: null }, { noCommits: 0 }, { startsInHour: 0 }];
  let f = all;
  for (const [i, k] of order.entries()) {
    expect(kind(f)).toBe(k as any);
    f = { ...f, ...clear[i] };
  }
  expect(kind(f)).toBe("ready");
});

test("the Queued lane reads the stops it once left out", () => {
  expect(goalDecision(facts({ busy: "waits for fac-1: both change the busy file a.ts" })).text).toBe("Waits for fac-1: both change the busy file a.ts");
  expect(goalDecision(facts({ noCommits: 3 }))).toMatchObject({ why: "3 runs in a row with no commit", text: "The last 3 runs ended with no commit; the next dispatch asks you" });
  expect(goalDecision(facts({ startsInHour: 4 }))).toMatchObject({ kind: "run-cap", starts: 4, why: "4 runs in the last hour" });
});

test("no-commit and run-cap start at their limits; an answered run cap skips the hour count", () => {
  expect(kind({ noCommits: 2 })).toBe("ready");
  expect(kind({ startsInHour: 2 })).toBe("ready");
  expect(kind({ startsInHour: 3, capHeld: true })).toBe("ready");
});

test("a gate gives the dispatch its why and Chris its text", () => {
  expect(goalDecision(facts({ gate }))).toEqual({ kind: "gate", gate: "live", why: gate.why, text: gate.text });
});

test("refDone: an item absent from a read list is done; a list not read blocks", () => {
  expect(refDone(undefined, true, undefined)).toBe(true);
  expect(refDone(undefined, false, undefined)).toBe(false);
  expect(refDone({ fm: { closed_as: "done" } } as any, true, undefined)).toBe(true);
  expect(refDone({ fm: {} } as any, true, undefined)).toBe(false);
  expect(refDone({ fm: {} } as any, true, "done")).toBe(true);
  expect(refDone({ fm: { parked: "true" } } as any, true, undefined)).toBe(false);
});
