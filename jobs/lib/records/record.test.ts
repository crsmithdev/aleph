import { afterEach, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Entry, Run } from "./ledger.ts";
import { fixRounds } from "../infra/settings.ts";
import { eventsDir, readEvents } from "../infra/layout.ts";
import * as record from "./record.ts";

let dir: string;
const saved = process.env.ALEPH_RECORDS_DIR;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aleph-record-")); process.env.ALEPH_RECORDS_DIR = dir; });
afterEach(() => { setSystemTime(); rmSync(dir, { recursive: true, force: true }); rmSync(record.archiveDir(), { recursive: true, force: true }); if (saved === undefined) delete process.env.ALEPH_RECORDS_DIR; else process.env.ALEPH_RECORDS_DIR = saved; });

const AT = "2026-11-04T10:00:00.000Z";
const run = (o: Partial<Run> = {}): Run => ({ kind: "build", job: "j1", name: "aleph-7", repo: "aleph", on: "aleph-7", condition: "running", told: false, started: AT, ...o });

test("update writes the whole record through a rename and leaves no temporary file", () => {
  record.update("aleph-7", (r) => { r.wait = { kind: "after", reason: "after aleph-6", since: AT }; });
  expect(record.read("aleph-7")).toEqual({ issue: "aleph-7", ask: null, wait: { kind: "after", reason: "after aleph-6", since: AT }, rounds: 0, cost: 0, runs: [], events: [] });
  expect(readdirSync(dir)).toEqual(["aleph-7.json"]);
});

test("a write that changes a run's state logs one event by gate in the file of its day; a write that keeps it logs none", () => {
  const mine = () => readEvents().filter((e) => e.subject === "aleph-31");
  const r = run({ on: "aleph-31", name: "aleph-31", n: 2 });
  record.putRun("r31", r);
  record.putRun("r31", { ...r, phase: "worker" });
  record.patchRun("r31", { condition: "failed", cause: "timeout" });
  expect(mine().map(({ by, subject, action, sub, on }) => ({ by, subject, action, sub, on }))).toEqual([
    { by: "gate", subject: "aleph-31", action: "running", sub: undefined, on: ["aleph-31#2"] },
    { by: "gate", subject: "aleph-31", action: "failed", sub: "timeout", on: ["aleph-31#2"] },
  ]);
  const day = mine()[0].at.slice(0, 10);
  expect(readdirSync(eventsDir())).toContain(`${day}.jsonl`);
  expect(readEvents(Date.parse(mine()[1].at) + 1).filter((e) => e.subject === "aleph-31")).toEqual([]);
});

test("a run that ends logs its cost, a run that lands also its commit, and an Ask set then cleared logs two events", () => {
  const r = run({ on: "aleph-32", name: "aleph-32", n: 1 });
  record.putRun("r32", r);
  record.patchRun("r32", { condition: "landed", cost: 1.5, commit: "abc1234" });
  record.update("aleph-32", (x) => { x.ask = { kind: "input", reason: "question", question: "q", options: [], why: [] }; });
  record.update("aleph-32", (x) => { x.ask = null; });
  const mine = readEvents().filter((e) => e.subject === "aleph-32");
  expect(mine.map(({ action, cost, commit }) => ({ action, cost, commit }))).toEqual([
    { action: "running", cost: undefined, commit: undefined },
    { action: "landed", cost: 1.5, commit: "abc1234" },
    { action: "question", cost: undefined, commit: undefined },
    { action: "answered", cost: undefined, commit: undefined },
  ]);
});

test("a run keys by its issue, else by its job id", () => {
  expect(record.keyOf({ on: "aleph-7", job: "j1" })).toBe("aleph-7");
  expect(record.keyOf({ job: "20260925-192116-aleph-vault-date-agent" })).toBe("20260925-192116-aleph-vault-date-agent");
});

test("record.putRun adds and replaces a run, record.patchRun changes fields and drops undefined ones, and both keep the runs in id order", () => {
  record.putRun("b", run({ phase: "worker" }));
  record.putRun("a", run({ condition: "failed", failed: "tests" }));
  expect(record.read("aleph-7")!.runs.map((x) => x.id)).toEqual(["a", "b"]);
  const out = record.patchRun("b", { condition: "passed", phase: undefined, cost: 1.5 });
  expect(out).toMatchObject({ id: "b", condition: "passed", cost: 1.5 });
  expect("phase" in out!).toBe(false);
  expect(record.getRun("b")).toEqual(out);
  expect(() => record.patchRun("nope", { told: true })).toThrow("no record holds the run nope");
});

test("record.getRun finds a run that another process wrote: it scans the records", () => {
  record.write({ ...record.empty("aleph-9"), runs: [{ ...run({ on: "aleph-9" }), id: "x9" }] });
  expect(record.getRun("x9")?.on).toBe("aleph-9");
  expect(record.getRun("missing")).toBeNull();
});

test("read returns a stored run's condition as it is: the word migration owns the old words", () => {
  const old = { ...run(), id: "1", condition: "stuck", failed: "review" } as unknown as record.RunRecord;
  record.write({ ...record.empty("aleph-7"), runs: [old] });
  expect(record.read("aleph-7")!.runs[0].condition as string).toBe("stuck");
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
        [[{ condition: "failed", reason: "no commit" }, { kind: "director", condition: "done" }], "rescue"],
    [[{ condition: "passed", next: "land" }, { kind: "director", condition: "passed" }], "land"],
  ];
  for (const [runs, step] of cases) expect([runs, record.next(rec(runs)).step]).toEqual([runs, step]);
  expect(record.next(rec([{ condition: "failed", cause: "no-commit", reason: "no commit" }, { kind: "director", condition: "done" }])).sub).toBe("no-commit");
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

/** The job of `runs` as allJobs gives it: entries in id order. */
const job = (runs: Partial<Run>[]): Entry[] => runs.map((x, i) => ({ id: String(i), folder: `/runs/${i}`, run: run(x) }));

test("endRun writes the end and its next in one write: no reader sees the ended run with no next", () => {
  record.putRun("b1", run({ n: 1 }));
  const seen: string[] = [];
  const ended = record.endRun("b1", { condition: "returned", failed: "tests", ended: AT }, (r) => {
    seen.push(record.next(record.read("aleph-7")!).step);
    return r.condition === "returned" ? "worker" : undefined;
  });
  seen.push(record.next(record.read("aleph-7")!).step);
  expect(seen).toEqual(["run", "worker"]);
  expect(ended).toMatchObject({ id: "b1", condition: "returned", next: "worker", ended: AT });
});

test("endRun gives decide the job's land runs with the ended one in its ended state", () => {
  record.putRun("l1", run({ kind: "land", condition: "failed", conflicts: ["a.ts"] }));
  record.putRun("l2", run({ kind: "land" }));
  record.putRun("x1", run({ kind: "land", job: "j2", condition: "failed", conflicts: ["b.ts"] }));
  let lands: Run[] = [];
  record.endRun("l2", { condition: "failed", conflicts: ["a.ts"] }, (_, l) => { lands = l; return undefined; });
  expect(lands.map((x) => [x.job, x.condition, x.conflicts])).toEqual([["j1", "failed", ["a.ts"]], ["j1", "failed", ["a.ts"]]]);
  expect("next" in record.getRun("l2")!).toBe(false);
});

test("counting and next pick the same run: not a land that found the lock busy, not a director run", () => {
  const runs: Partial<Run>[] = [{ condition: "waiting", n: 1 }, { kind: "land", condition: "failed", cause: "locked", n: 2 }];
  expect(record.counting(job(runs)).id).toBe("0");
  expect(record.next(rec(runs)).on).toEqual([record.jobIdOf(record.counting(job(runs)))]);
  expect(record.next(rec([...runs, { kind: "director", job: "d1", condition: "done", n: 3 }])).on).toEqual(["aleph-7#1"]);
  expect(record.counting(job([{ kind: "director", job: "d1", condition: "done" }])).id).toBe("0");
});

test("stepOf is next over the job's runs with the Ask of the record of its run that counts", () => {
  const ask = { kind: "input" as const, reason: "question", question: "q", options: [], why: [] };
  record.setIssueAsk("aleph-7", ask);
  expect(record.stepOf(job([{ condition: "passed" }]))).toEqual({ step: "ask", action: "waiting", to: "human" });
  record.setIssueAsk("aleph-7", null);
  expect(record.stepOf(job([{ condition: "passed", next: "land" }, { kind: "land", condition: "failed", cause: "locked" }])).step).toBe("land");
});

test("jobIdOf: a numbered run reads its n; an un-numbered one its place in start order on its subject in runs, else 1", () => {
  const runs = job([{ on: "aleph-1375", n: 6 }, { on: "aleph-1375" }, { on: undefined, kind: "monitor", name: "monitor", n: 14 }, { on: "aleph-1375" }]);
  expect(runs.map((e) => record.jobIdOf(e))).toEqual(["aleph-1375#6", "aleph-1375#1", "monitor#14", "aleph-1375#1"]);
  expect(runs.map((e) => record.jobIdOf(e, runs))).toEqual(["aleph-1375#6", "aleph-1375#2", "monitor#14", "aleph-1375#3"]);
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

const DAY = 864e5, T0 = Date.parse("2026-11-20T00:00:00.000Z");
const startedAgo = (days: number) => new Date(T0 - days * DAY).toISOString();

test("archiveOld moves a finished record whose newest run started over 7 days ago, and keeps a running, a waiting, an Ask and a newer one", () => {
  record.putRun("z1", run({ on: "a-1", job: "a1", condition: "done", started: startedAgo(8) }));
  record.putRun("z2", run({ on: "a-2", job: "a2", condition: "done", started: startedAgo(9) }));
  record.putRun("z3", run({ on: "a-2", job: "a2", condition: "running", started: startedAgo(8) }));
  record.putRun("z4", run({ on: "a-3", job: "a3", condition: "waiting", started: startedAgo(9) }));
  record.putRun("z5", run({ on: "a-4", job: "a4", condition: "done", started: startedAgo(9) }));
  record.setIssueAsk("a-4", { kind: "approval", reason: "x", question: "", options: [], why: [] } as any);
  record.putRun("z6", run({ on: "a-5", job: "a5", condition: "done", started: startedAgo(6) }));
  expect(record.archiveOld(T0)).toEqual(["a-1"]);
  expect(readdirSync(dir).filter((f) => f.endsWith(".json")).sort()).toEqual(["a-2.json", "a-3.json", "a-4.json", "a-5.json"]);
  expect(readdirSync(record.archiveDir())).toEqual(["a-1.json"]);
});

test("an archived record still reads in all and allRunRecords, and record.putRun of a new run moves it back with the old runs", () => {
  record.putRun("y1", run({ condition: "done", started: startedAgo(8) }));
  record.archiveOld(T0);
  expect(record.all().map((r) => r.issue)).toEqual(["aleph-7"]);
  expect(record.all(true)).toEqual([]);
  expect(record.allRunRecords().map((x) => x.id)).toEqual(["y1"]);
  record.putRun("y2", run({ condition: "running", started: startedAgo(0) }));
  expect(readdirSync(record.archiveDir())).toEqual([]);
  expect(readdirSync(dir).filter((f) => f.endsWith(".json"))).toEqual(["aleph-7.json"]);
  expect(record.read("aleph-7")!.runs.map((x) => x.id)).toEqual(["y1", "y2"]);
});
