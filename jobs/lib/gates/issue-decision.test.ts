import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATES, issueDecision, refDone, type IssueFacts } from "./issue-decision.ts";
import { factoryGates, holdBackend } from "./factory-status.ts";

const item = (fm: Record<string, unknown> = {}) => ({ fm, notes: [] }) as unknown as IssueFacts["item"];
const facts = (f: Partial<IssueFacts> = {}): IssueFacts => ({ name: "fac-9", item: item(), done: () => false, ...f });
const kind = (f: Partial<IssueFacts>) => issueDecision(facts(f)).kind;
const live = { why: "12 agent runs are live", text: "Waiting for a slot (12 of 12 running)" };
const backend = { why: "waits for OpenRouter: the API credit ran out", text: "Waiting for OpenRouter: the API credit ran out" };
const MIN = 60_000;

test("an issue with no fact against it is ready, and a fact not read stops nothing", () => {
  expect(issueDecision(facts())).toEqual({ kind: "ready", why: "ready", text: "Starts at the next dispatch" });
});

test("Not ready names only the open after refs, in both lines", () => {
  const d = issueDecision(facts({ item: item({ after: ["fac-1", "fac-2", "fac-3"] }), done: (r) => r === "fac-1" }));
  expect(d).toEqual({ kind: "not-ready", ids: ["fac-2", "fac-3"], why: "after fac-2,fac-3", text: "Waits on fac-2, fac-3", ev: { action: "after", on: ["fac-2", "fac-3"] } });
});

test("the 7 gates bind in the order of GATES, Loop guard last", () => {
  expect([...GATES]).toEqual(["pause", "backend", "baseline", "not-ready", "live-cap", "busy-file", "loop-guard"]);
  const all: Partial<IssueFacts> = { pause: { why: "paused", text: "The factory is paused" }, backend: backend, red: "main is red", open: "running", "live-cap": live, busy: { why: "waits for fac-1: both change the busy file a.ts", on: "fac-1", file: "a.ts" }, noCommits: 3 };
  const clear: Partial<IssueFacts>[] = [{ pause: null }, { backend: null }, { red: null }, { open: null }, { "live-cap": null }, { busy: null }, { noCommits: 0 }];
  let f = all;
  for (const [i, k] of GATES.entries()) {
    expect(kind(f)).toBe(k);
    f = { ...f, ...clear[i] };
  }
  expect(kind(f)).toBe("ready");
});

test("Baseline binds on each line the dispatch gives for a main that is not green: red, running and unchecked", () => {
  for (const red of ["main is red at abc1234: tests", "main baseline running", "main is unchecked: fetch failed"]) {
    expect(issueDecision(facts({ red }))).toEqual({ kind: "baseline", why: red, text: red, ev: { action: "red" } });
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

test("Not ready covers a done issue, an after ref and an open job, in that order", () => {
  const all: Partial<IssueFacts> = { done: (r) => r === "fac-9", item: item({ after: ["fac-1"] }), open: "running" };
  expect(issueDecision(facts(all)).why).toBe("the item is already done");
  expect(issueDecision(facts({ ...all, done: () => false })).why).toBe("after fac-1");
  expect(issueDecision(facts({ ...all, done: () => false, item: item() })).why).toBe("its job is running");
});

test("the Queued lane reads the stops it once left out", () => {
  expect(issueDecision(facts({ busy: { why: "waits for fac-1: both change the busy file a.ts", on: "fac-1", file: "a.ts" } })).text).toBe("Waits for fac-1: both change the busy file a.ts");
  expect(issueDecision(facts({ busy: { why: "waits for fac-1: both change the busy file a.ts", on: "fac-1", file: "a.ts" } }))).toMatchObject({ kind: "busy-file", on: "fac-1" });
  expect(issueDecision(facts({ noCommits: 3 }))).toMatchObject({ kind: "loop-guard", ask: "no-commit", why: "3 runs in a row with no commit" });
  expect(issueDecision(facts({ startsInHour: 4 }))).toMatchObject({ kind: "loop-guard", ask: "run-cap", starts: 4, why: "4 runs in the last hour" });
});

test("Loop guard binds at its limits; an answered run cap skips the hour count", () => {
  expect(kind({ noCommits: 2 })).toBe("ready");
  expect(kind({ startsInHour: 2 })).toBe("ready");
  expect(kind({ startsInHour: 3, capHeld: true })).toBe("ready");
});

test("a run that ended with the API credit error holds the issue for its wait and sets no run-cap Ask; past the wait the issue is ready", () => {
  const waiting = issueDecision(facts({ creditWait: 3 * MIN, startsInHour: 4 }));
  expect(waiting.kind).toBe("credit-wait");
  expect(waiting.ev).toEqual({ action: "credit" });
  expect(waiting).not.toHaveProperty("ask");
  expect(issueDecision(facts({ creditWait: 12 * MIN })).kind).toBe("ready");
});

test("a factory gate gives the dispatch its why and Chris its text", () => {
  expect(issueDecision(facts({ "live-cap": live }))).toEqual({ kind: "live-cap", ...live });
});

test("an issue whose run is on the held backend gets the hold decision, not a start", async () => {
  const was = process.env.ALEPH_FACTORY_DIR, url = process.env.SIDETONE_TELL_URL, dir = mkdtempSync(join(tmpdir(), "hold-"));
  process.env.ALEPH_FACTORY_DIR = dir;
  process.env.SIDETONE_TELL_URL = "http://127.0.0.1:1/tell";
  try {
    await holdBackend("openrouter", "API Error: 402 This request would exceed your available credits");
    expect(issueDecision(facts({ ...factoryGates(undefined, { model: "deepseek-v4.1-flash" }) }))).toEqual({
      kind: "backend",
      why: "waits for OpenRouter: API Error: 402 This request would exceed your available credits",
      text: "Waiting for OpenRouter: API Error: 402 This request would exceed your available credits",
      ev: { action: "waiting", count: "for OpenRouter" },
    });
    expect(issueDecision(facts({ ...factoryGates(undefined, { model: "haiku" }) })).kind).toBe("ready");
  } finally {
    if (was === undefined) delete process.env.ALEPH_FACTORY_DIR; else process.env.ALEPH_FACTORY_DIR = was;
    if (url === undefined) delete process.env.SIDETONE_TELL_URL; else process.env.SIDETONE_TELL_URL = url;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("refDone: an item absent from a read list is done; a list not read blocks", () => {
  expect(refDone(undefined, true, undefined)).toBe(true);
  expect(refDone(undefined, false, undefined)).toBe(false);
  expect(refDone({ fm: { closed_as: "done" } } as any, true, undefined)).toBe(true);
  expect(refDone({ fm: {} } as any, true, undefined)).toBe(false);
  expect(refDone({ fm: {} } as any, true, "done")).toBe(true);
  expect(refDone({ fm: { parked: "true" } } as any, true, undefined)).toBe(false);
});

test("the run cap is the stored cap: 5 lets 4 starts through and binds at 5; unset, 3 binds", () => {
  const was = process.env.ALEPH_FACTORY_DIR, dir = mkdtempSync(join(tmpdir(), "caps-"));
  process.env.ALEPH_FACTORY_DIR = dir;
  try {
    expect(kind({ startsInHour: 3 })).toBe("loop-guard");
    writeFileSync(join(dir, "caps.json"), JSON.stringify({ run: 5 }));
    expect(kind({ startsInHour: 4 })).toBe("ready");
    expect(issueDecision(facts({ startsInHour: 5 }))).toMatchObject({ kind: "loop-guard", ask: "run-cap", starts: 5 });
  } finally {
    if (was === undefined) delete process.env.ALEPH_FACTORY_DIR; else process.env.ALEPH_FACTORY_DIR = was;
    rmSync(dir, { recursive: true, force: true });
  }
});
