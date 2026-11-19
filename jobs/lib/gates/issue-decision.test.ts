import { expect, test } from "bun:test";
import { conn, putJson } from "../../../lib/db.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GATES, issueDecision, refDone, type IssueFacts } from "./issue-decision.ts";
import { factoryGates } from "./factory-status.ts";
import { holdBackend } from "./holds.ts";
import { withEnv } from "../../../ui/server.testkit.ts";

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
  expect(d).toEqual({ kind: "after", ids: ["fac-2", "fac-3"], why: "after fac-2,fac-3", text: "Waits on fac-2, fac-3", ev: { action: "held", detail: "after: fac-2 fac-3" } });
});

test("each hold is a held event: the hold word, then its facts", () => {
  expect(issueDecision(facts({ item: item({ after: ["issue.2985", "issue.2993"] }) })).ev).toEqual({ action: "held", detail: "after: issue.2985 issue.2993" });
  expect(issueDecision(facts({ open: "running", job: "job.8910" })).ev).toEqual({ action: "held", detail: "job: job.8910" });
  expect(issueDecision(facts({ busy: { why: "waits for issue.2990: both change the busy file docs/design.md", on: "issue.2990", job: "job.8890", file: "docs/design.md" } })).ev).toEqual({ action: "held", detail: "file: docs/design.md: job.8890" });
  expect(issueDecision(facts({ creditWait: { job: "job.8870", ago: 3 * MIN } })).ev).toEqual({ action: "held", detail: "credit: job.8870 hit the API credit error" });
  expect(issueDecision(facts({ red: "main is red at 298a44e: tests" })).ev).toEqual({ action: "held", detail: "red" });
});

test("the gates bind in the order of GATES, the Ask last", () => {
  expect([...GATES]).toEqual(["paused", "waiting", "red", "done", "after", "job", "full", "file", "credit", "ask"]);
  const all: Partial<IssueFacts> = {
    paused: { why: "paused", text: "The factory is paused" }, waiting: backend, red: "main is red", done: () => true, item: item({ after: ["fac-1"] }), open: "running", job: "job.1", full: live,
    busy: { why: "waits for fac-1: both change the busy file a.ts", on: "fac-1", job: "job.2", file: "a.ts" }, creditWait: { job: "job.3", ago: MIN }, noCommits: 3,
  };
  const clear: Partial<IssueFacts>[] = [{ paused: null }, { waiting: null }, { red: null }, { done: () => false }, { item: item() }, { open: null }, { full: null }, { busy: null }, { creditWait: null }, { noCommits: 0 }];
  let f = all;
  for (const [i, k] of GATES.entries()) {
    expect(kind(f)).toBe(k);
    f = { ...f, ...clear[i] };
  }
  expect(kind(f)).toBe("ready");
});

test("Baseline binds on each line the dispatch gives for a main that is not green: red, running and unchecked", () => {
  for (const red of ["main is red at abc1234: tests", "main baseline running", "main is unchecked: fetch failed"]) {
    expect(issueDecision(facts({ red }))).toEqual({ kind: "red", why: red, text: red, ev: { action: "held", detail: "red" } });
  }
  expect(kind({ red: null })).toBe("ready");
});

test("Baseline lets the red-main fix through, and the later gates still bind on it", () => {
  const fix = item({ labels: ["red-main"] });
  expect(kind({ item: fix, red: "main is red at abc1234: tests" })).toBe("ready");
  // The firefighter's `add` writes the label into `areas`, as aleph-1161 has it.
  expect(kind({ item: item({ areas: ["red-main"] }), red: "main is red at abc1234: tests" })).toBe("ready");
  expect(kind({ item: fix, red: "main is red at abc1234: tests", full: live })).toBe("full");
});

test("a done issue, an after ref and an open job each stop the issue, in that order; a done issue has no event", () => {
  const all: Partial<IssueFacts> = { done: (r) => r === "fac-9", item: item({ after: ["fac-1"] }), open: "running" };
  expect(issueDecision(facts(all))).toMatchObject({ kind: "done", why: "the item is already done" });
  expect(issueDecision(facts(all))).not.toHaveProperty("ev");
  expect(issueDecision(facts({ ...all, done: () => false })).why).toBe("after fac-1");
  expect(issueDecision(facts({ ...all, done: () => false, item: item() })).why).toBe("its job is running");
});

test("the pending after refs of the parent hold the issue when only the parent has an after", () => {
  const d = issueDecision(facts({ item: item(), parent: item({ after: ["fac-1", "fac-2"] }), done: (r) => r === "fac-1" }));
  expect(d).toMatchObject({ kind: "after", ids: ["fac-2"], why: "after fac-2" });
});

test("the Queued lane reads the stops it once left out", () => {
  const busy = { why: "waits for fac-1: both change the busy file a.ts", on: "fac-1", job: "job.2", file: "a.ts" };
  expect(issueDecision(facts({ busy })).text).toBe("Waits for fac-1: both change the busy file a.ts");
  expect(issueDecision(facts({ busy }))).toMatchObject({ kind: "file", on: "fac-1" });
  expect(issueDecision(facts({ noCommits: 3 }))).toMatchObject({ kind: "ask", ask: "no-commit", why: "3 runs in a row with no commit" });
  expect(issueDecision(facts({ startsInHour: 4 }))).toMatchObject({ kind: "ask", ask: "run-cap", starts: 4, why: "4 runs in the last hour" });
});

test("the Ask binds at its limits; an answered run cap skips the hour count", () => {
  expect(kind({ noCommits: 2 })).toBe("ready");
  expect(kind({ startsInHour: 2 })).toBe("ready");
  expect(kind({ startsInHour: 3, capHeld: true })).toBe("ready");
});

test("a run that ended with the API credit error holds the issue for its wait and sets no run-cap Ask; past the wait the issue is ready", () => {
  const waiting = issueDecision(facts({ creditWait: { job: "job.8870", ago: 3 * MIN }, startsInHour: 4 }));
  expect(waiting.kind).toBe("credit");
  expect(waiting).not.toHaveProperty("ask");
  expect(issueDecision(facts({ creditWait: { job: "job.8870", ago: 12 * MIN } })).kind).toBe("ready");
});

test("a factory gate gives the dispatch its why and Chris its text", () => {
  expect(issueDecision(facts({ full: live }))).toEqual({ kind: "full", ...live });
});

test("an issue whose run is on the held backend gets the hold decision, not a start", async () => {
  const dir = mkdtempSync(join(tmpdir(), "hold-"));
  // Its own aleph.db: the live jobs an earlier file of the process left running would bind the live cap.
  const off = withEnv({ ALEPH_FACTORY_DIR: dir, ALEPH_DB: join(dir, "aleph.db"), SIDETONE_TELL_URL: "http://127.0.0.1:1/tell" });
  try {
    await holdBackend("openrouter", "API Error: 402 This request would exceed your available credits");
    expect(issueDecision(facts({ ...factoryGates(undefined, { model: "deepseek-v4.1-flash" }) }))).toEqual({
      kind: "waiting",
      why: "waits for OpenRouter: API Error: 402 This request would exceed your available credits",
      text: "Waiting for OpenRouter: API Error: 402 This request would exceed your available credits",
      ev: { action: "held", detail: "waiting: for OpenRouter" },
    });
    expect(issueDecision(facts({ ...factoryGates(undefined, { model: "haiku" }) })).kind).toBe("ready");
  } finally {
    putJson("state", "backend-hold", null);
    off();
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
  const dir = mkdtempSync(join(tmpdir(), "caps-"));
  const off = withEnv({ ALEPH_FACTORY_DIR: dir });
  try {
    expect(kind({ startsInHour: 3 })).toBe("ask");
    putJson("settings", "caps", { run: 5 });
    expect(kind({ startsInHour: 4 })).toBe("ready");
    expect(issueDecision(facts({ startsInHour: 5 }))).toMatchObject({ kind: "ask", ask: "run-cap", starts: 5, facts: "5 starts in 1h" });
  } finally {
    conn().run("DELETE FROM settings WHERE key = 'caps'");
    off();
    rmSync(dir, { recursive: true, force: true });
  }
});
