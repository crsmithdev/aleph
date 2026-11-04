import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run } from "./ledger.ts";
import * as record from "./record.ts";

let dir: string;
const saved = process.env.ALEPH_RECORDS_DIR;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aleph-record-")); process.env.ALEPH_RECORDS_DIR = dir; });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); if (saved === undefined) delete process.env.ALEPH_RECORDS_DIR; else process.env.ALEPH_RECORDS_DIR = saved; });

const AT = "2026-11-04T10:00:00.000Z";
const run = (o: Partial<Run> = {}): Run => ({ kind: "build", job: "j1", name: "aleph-7", repo: "aleph", on: "aleph-7", condition: "running", told: false, started: AT, ...o });

test("update writes the whole record through a rename and leaves no temporary file", () => {
  record.update("aleph-7", (r) => { r.wait = { kind: "after", reason: "after aleph-6", since: AT }; });
  expect(record.read("aleph-7")).toEqual({ issue: "aleph-7", ask: null, wait: { kind: "after", reason: "after aleph-6", since: AT }, rounds: 0, cost: 0, runs: [], events: [] });
  expect(readdirSync(dir)).toEqual(["aleph-7.json"]);
});

test("a run keys by its issue, else by its job id", () => {
  expect(record.keyOf({ on: "aleph-7", job: "j1" })).toBe("aleph-7");
  expect(record.keyOf({ job: "20260925-192116-aleph-vault-date-agent" })).toBe("20260925-192116-aleph-vault-date-agent");
});

test("putRun adds and replaces a run, patchRun changes fields and drops undefined ones, and both keep the runs in id order", () => {
  record.putRun("b", run({ phase: "worker" }));
  record.putRun("a", run({ condition: "failed", failed: "tests" }));
  expect(record.read("aleph-7")!.runs.map((x) => x.id)).toEqual(["a", "b"]);
  const out = record.patchRun("b", { condition: "passed", phase: undefined, cost: 1.5 });
  expect(out).toMatchObject({ id: "b", condition: "passed", cost: 1.5 });
  expect("phase" in out!).toBe(false);
  expect(record.getRun("b")).toEqual(out);
  expect(record.patchRun("nope", { told: true })).toBeNull();
});

test("getRun finds a run that another process wrote: it scans the records", () => {
  record.write({ ...record.empty("aleph-9"), runs: [{ ...run({ on: "aleph-9" }), id: "x9" }] });
  expect(record.getRun("x9")?.on).toBe("aleph-9");
  expect(record.getRun("missing")).toBeNull();
});

test("a write derives the cost of all runs and the fix rounds of the newest job", () => {
  record.putRun("1", run({ job: "old", failed: "tests", condition: "failed", cost: 1 }));
  record.putRun("2", run({ job: "new", failed: "tests", condition: "failed", cost: 0.25 }));
  record.putRun("3", run({ job: "new", failed: "review", condition: "stuck", cost: 0.5 }));
  record.putRun("4", run({ job: "new", kind: "land", failed: "tests", condition: "failed" }));
  const r = record.read("aleph-7")!;
  expect(r.cost).toBe(1.75);
  expect(r.rounds).toBe(2);
});

test("allRunRecords gives every run of every record in id order", () => {
  record.putRun("20261104-2", run());
  record.putRun("20261104-1", run({ on: "aleph-8", name: "aleph-8" }));
  expect(record.allRunRecords().map((x) => x.id)).toEqual(["20261104-1", "20261104-2"]);
});

test("addEvent appends and lastEvent finds the newest of a kind", () => {
  record.addEvent("aleph-7", { at: AT, kind: "hold", what: "after aleph-6" });
  record.addEvent("aleph-7", { at: AT, kind: "started", what: "started" });
  record.addEvent("aleph-7", { at: "2026-11-04T11:00:00.000Z", kind: "hold", what: "the live cap is full" });
  expect(record.lastEvent("aleph-7", "hold")?.what).toBe("the live cap is full");
  expect(record.lastEvent("aleph-7", "cap")).toBeUndefined();
});

const rec = (runs: Partial<Run>[], o: Partial<record.JobRecord> = {}): record.JobRecord =>
  ({ ...record.empty("aleph-7"), ...o, runs: runs.map((x, i) => ({ ...run(x), id: String(i) })) });

test("next: an Ask waits for Chris before anything else", () => {
  const ask = { kind: "input" as const, reason: "question", question: "q", options: [], why: [] };
  expect(record.next(rec([{ condition: "passed" }], { ask })).step).toBe("ask");
  expect(record.next(rec([{ condition: "awaiting" }])).step).toBe("ask");
});

test("next: each run condition gives its step", () => {
  const cases: [Partial<Run>[], record.Step["step"]][] = [
    [[{ condition: "running" }], "run"],
    [[{ condition: "stuck", failed: "tests", next: "worker" }], "worker"],
    [[{ condition: "passed", next: "land" }], "land"],
    [[{ kind: "land", condition: "failed", next: "land" }], "land"],
    [[{ condition: "passed" }], "wait"],
    [[{ condition: "passed", next: "land" }, { kind: "land", condition: "failed", cause: "lock-busy" }], "land"],
    [[{ condition: "stuck", reason: "no commit" }], "rescue"],
    [[{ condition: "failed" }], "rescue"],
    [[{ kind: "land", condition: "landed", commit: "abc1234def" }], "none"],
    [[{ condition: "dropped", reason: "dropped by Chris" }], "none"],
    [[{ kind: "land", condition: "landed" }, { kind: "facts", condition: "running" }], "none"],
  ];
  for (const [runs, step] of cases) expect([runs, record.next(rec(runs)).step]).toEqual([runs, step]);
});

test("next: a stuck run the factory asked Chris about waits", () => {
  const events = [{ at: AT, kind: "asked", what: "q", run: "0" }];
  expect(record.next(rec([{ condition: "stuck" }], { events })).step).toBe("wait");
});

test("next: a goal with no run waits for its hold, else starts", () => {
  expect(record.next(rec([], { wait: { kind: "after", reason: "after aleph-6", since: AT } }))).toEqual({ step: "wait", why: "after aleph-6" });
  expect(record.next(rec([])).step).toBe("start");
});
