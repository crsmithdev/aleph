import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Run } from "./ledger.ts";
import { fixRounds } from "../infra/settings.ts";
import * as record from "./record.ts";

let dir: string;
const saved = process.env.ALEPH_RECORDS_DIR;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aleph-record-")); process.env.ALEPH_RECORDS_DIR = dir; });
afterEach(() => { setSystemTime(); rmSync(dir, { recursive: true, force: true }); if (saved === undefined) delete process.env.ALEPH_RECORDS_DIR; else process.env.ALEPH_RECORDS_DIR = saved; });

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

test("a record from before docs/naming.md reads in the new words: waiting, returned, failed, the subs and the review call", () => {
  const old = (o: Record<string, unknown>) => ({ ...run(), ...o }) as unknown as record.RunRecord;
  record.write({ ...record.empty("aleph-7"), runs: [
    old({ id: "1", condition: "awaiting", review: { call: "back", reason: "no" } }),
    old({ id: "2", condition: "stuck", cause: "reviewer", failed: "review", next: "worker" }),
    old({ id: "3", condition: "stuck", cause: "time-box" }),
    old({ id: "4", condition: "dropped", fate: "by-hand" }),
  ] });
  const runs = record.read("aleph-7")!.runs;
  expect(runs.map((x) => x.condition)).toEqual(["waiting", "returned", "failed", "dropped"]);
  expect(runs.map((x) => x.cause ?? x.fate)).toEqual([undefined, "review", "timeout", "manual"]);
  expect(runs[0].review).toEqual({ call: "returned", reason: "no" });
  expect(record.getRun("2")?.condition).toBe("returned");
  expect(record.all()[0].runs[0].condition).toBe("waiting");
});

test("a write derives the cost of all runs and the fix rounds of the newest job", () => {
  record.putRun("1", run({ job: "old", failed: "tests", condition: "failed", cost: 1 }));
  record.putRun("2", run({ job: "new", failed: "tests", condition: "failed", cost: 0.25 }));
  record.putRun("3", run({ job: "new", failed: "review", condition: "returned", cost: 0.5 }));
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
  expect(record.next(rec([{ condition: "waiting" }])).step).toBe("ask");
});

test("next: each run condition gives its step", () => {
  const cases: [Partial<Run>[], record.Step["step"]][] = [
    [[{ condition: "running" }], "run"],
    [[{ condition: "returned", failed: "tests", next: "worker" }], "worker"],
    [[{ condition: "returned", failed: "doc-claims", next: "recheck" }], "recheck"],
    [[{ condition: "passed", next: "land" }], "land"],
    [[{ kind: "land", condition: "failed", next: "land" }], "land"],
    [[{ condition: "passed" }], "wait"],
    [[{ condition: "passed", next: "land" }, { kind: "land", condition: "failed", cause: "locked" }], "land"],
    [[{ condition: "failed", reason: "no commit" }], "rescue"],
    [[{ condition: "failed" }], "rescue"],
    [[{ kind: "land", condition: "landed", commit: "abc1234def" }], "none"],
    [[{ condition: "dropped", reason: "dropped by Chris" }], "none"],
    [[{ kind: "land", condition: "landed" }, { kind: "facts", condition: "running" }], "none"],
    [[{ condition: "failed", reason: "no commit" }, { kind: "director", condition: "done" }], "rescue"],
    [[{ condition: "passed", next: "land" }, { kind: "director", condition: "passed" }], "land"],
  ];
  for (const [runs, step] of cases) expect([runs, record.next(rec(runs)).step]).toEqual([runs, step]);
  expect(record.next(rec([{ condition: "failed", reason: "no commit" }, { kind: "director", condition: "done" }])).sub).toBe("no-commit");
});

test("next: each case gives its step as event words", () => {
  const ask = { kind: "input" as const, reason: "question", question: "q", options: [], why: [] };
  expect(record.next(rec([{ condition: "passed" }], { ask }))).toEqual({ step: "ask", action: "waiting", to: "human" });
  expect(record.next(rec([{ condition: "running", on: "aleph-1375", n: 6 }]))).toEqual({ step: "run", action: "running", on: ["aleph-1375#6"] });
  expect(record.next(rec([{ condition: "returned", cause: "check", next: "worker" }], { rounds: 1 }))).toEqual({ step: "worker", action: "returned", sub: "check", count: `1 / ${fixRounds()}` });
  expect(record.next(rec([{ kind: "land", condition: "landed", commit: "4240d76abc9" }]))).toEqual({ step: "none", action: "landed", on: ["4240d76"] });
  expect(record.next(rec([{ condition: "failed", cause: "review" }]))).toEqual({ step: "rescue", action: "failed", sub: "review" });
  expect(record.next(rec([]))).toEqual({ step: "start", action: "starting" });
});

test("next: no step keeps the why sentence", () => {
  const cases: Partial<Run>[][] = [[], [{ condition: "running" }], [{ condition: "waiting" }], [{ condition: "returned", cause: "check", next: "worker" }], [{ condition: "passed", next: "land" }], [{ condition: "passed" }], [{ condition: "failed", cause: "review" }], [{ kind: "land", condition: "landed", commit: "4240d76abc9" }], [{ condition: "dropped", reason: "dropped by Chris" }], [{ condition: "done" }]];
  for (const runs of cases) expect("why" in record.next(rec(runs))).toBe(false);
});

test("next: a stuck run the factory asked Chris about waits", () => {
  const events = [{ at: AT, kind: "asked", what: "q", run: "0" }];
  expect(record.next(rec([{ condition: "failed" }], { events })).step).toBe("wait");
});

test("next: an issue with no run waits for its hold, else starts", () => {
  expect(record.next(rec([], { wait: { kind: "after", reason: "after aleph-6", since: AT } }))).toEqual({ step: "wait", action: "waiting" });
  expect(record.next(rec([])).step).toBe("start");
});

test("an Ask with a recommended option keeps the label in its entry after the Ask is cleared", () => {
  const ask = { kind: "input" as const, reason: "question", question: "q", options: [], why: [], recommended: "B" };
  setSystemTime(new Date("2026-11-04T10:00:00.000Z"));
  record.setIssueAsk("aleph-7", ask);
  setSystemTime(new Date("2026-11-04T10:05:00.000Z"));
  record.setIssueAsk("aleph-7", null);
  expect(record.read("aleph-7")!.asks).toEqual([
    { set: "2026-11-04T10:00:00.000Z", cleared: "2026-11-04T10:05:00.000Z", reason: "question", recommended: "B" },
  ]);
});

test("an Ask set on a record and cleared keeps its set time and clear time, through the issue and through a run", () => {
  const ask = { kind: "input" as const, reason: "question", question: "q", options: [], why: [] };
  setSystemTime(new Date("2026-11-04T10:00:00.000Z"));
  record.setIssueAsk("aleph-7", ask);
  record.setIssueAsk("aleph-7", { ...ask, situation: "case text" });
  setSystemTime(new Date("2026-11-04T10:05:00.000Z"));
  record.setIssueAsk("aleph-7", null);
  setSystemTime(new Date("2026-11-04T11:00:00.000Z"));
  record.putRun("r1", run({ ask }));
  setSystemTime(new Date("2026-11-04T11:10:00.000Z"));
  record.patchRun("r1", { ask: { ...ask, situation: "case text" } });
  setSystemTime(new Date("2026-11-04T11:30:00.000Z"));
  record.patchRun("r1", { ask: undefined, condition: "passed" });
  expect(record.read("aleph-7")!.asks).toEqual([
    { set: "2026-11-04T10:00:00.000Z", cleared: "2026-11-04T10:05:00.000Z", reason: "question" },
    { set: "2026-11-04T11:00:00.000Z", cleared: "2026-11-04T11:30:00.000Z", reason: "question" },
  ]);
});

test("a land or build run of the job that joins after the run an Ask is on clears that Ask, a director run or another job's land does not", () => {
  const ask = { kind: "input" as const, reason: "question", question: "the reviewer sent it back once: free-text column gets td.wide", options: [], why: [] };
  setSystemTime(new Date("2026-11-04T10:00:00.000Z"));
  record.putRun("1", run({ condition: "waiting", ask }));
  setSystemTime(new Date("2026-11-04T10:02:00.000Z"));
  record.putRun("2", run({ kind: "director", condition: "passed" }));
  record.putRun("25", run({ kind: "land", job: "j2", condition: "landed" }));
  expect(record.read("aleph-7")!.ask).toEqual(ask);
  expect(record.next(record.read("aleph-7")!).step).toBe("ask");
  setSystemTime(new Date("2026-11-04T10:05:00.000Z"));
  record.putRun("3", run({ kind: "land", condition: "failed", failed: "conflict" }));
  setSystemTime(new Date("2026-11-04T10:10:00.000Z"));
  record.putRun("4", run({ condition: "failed", reason: "doc claims: x after 2 fix rounds" }));
  const r = record.read("aleph-7")!;
  expect(r.ask).toBeNull();
  expect(r.asks!.at(-1)!.cleared).toBe("2026-11-04T10:05:00.000Z");
  const s = record.next(r);
  expect(s).toEqual({ step: "rescue", action: "failed" });
});
