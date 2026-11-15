import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Entry, Run } from "./ledger.ts";
import { fixRounds } from "../infra/settings.ts";
import { readEvents } from "../../../lib/layout.ts";
import { conn } from "../../../lib/db.ts";
import { seed } from "../../job.testkit.ts";
import * as record from "./record.ts";

let dir: string;
const saved = { db: process.env.ALEPH_DB, jobs: process.env.ALEPH_JOBS_DIR };
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "aleph-record-"));
  process.env.ALEPH_DB = join(dir, "aleph.db");
  process.env.ALEPH_JOBS_DIR = join(dir, "jobs");
});
afterEach(() => {
  for (const [k, v] of [["ALEPH_DB", saved.db], ["ALEPH_JOBS_DIR", saved.jobs]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(dir, { recursive: true, force: true });
});

const AT = "2026-11-04T10:00:00.000Z";
const ASK = { kind: "input" as const, reason: "question", question: "q", options: [], why: [] };
const mine = (object: string) => readEvents().filter((e) => e.object === object).map(({ subject, action, object, detail }) => ({ subject, action, object, detail }));

test("makeJob numbers a job from the job counter, makes its folder, fills it and logs its first state", () => {
  const a = record.makeJob({ role: "build", name: "issue.7", repo: "aleph", target: "issue.7", started: AT }, (folder, id) => writeFileSync(join(folder, "prompt.md"), id));
  const b = record.makeJob({ role: "plain", name: "x" });
  expect([a.id, b.id]).toEqual(["job.1", "job.2"]);
  expect(a.folder).toBe(join(dir, "jobs", "1"));
  expect(readFileSync(join(a.folder, "prompt.md"), "utf8")).toBe("job.1");
  expect(a.run).toMatchObject({ id: "job.1", job: "job.1", role: "build", state: "running", by: "rule", repo: "aleph", target: "issue.7", started: AT, told: false });
  expect(mine("job.1")).toEqual([{ subject: "gate", action: "running", object: "job.1", detail: null }]);
});

test("a job keeps its columns apart from its extra fields, and getRun reads both", () => {
  const { id } = record.makeJob({ role: "build", name: "issue.7", repo: "aleph", target: "issue.7", model: "opus", size: "medium", cost: 1.5, branch: "job/x", phase: "setup" });
  const row = conn().query("SELECT * FROM jobs WHERE id = ?").get(id) as Record<string, unknown>;
  expect(row).toMatchObject({ role: "build", project: "aleph", model: "opus", size: "medium", cost: 1.5, target: "issue.7", prev: null, retry_of: null });
  expect(JSON.parse(row.extra as string)).toMatchObject({ name: "issue.7", branch: "job/x", phase: "setup" });
  expect(record.getRun(id)).toMatchObject({ repo: "aleph", branch: "job/x", cost: 1.5 });
  expect(record.getRun("job.99")).toBeNull();
});

test("setState logs one event by gate for a change of state; a patch that keeps the state logs none", () => {
  const { id } = record.makeJob({ role: "build", name: "issue.31", target: "issue.31" });
  record.patchRun(id, { phase: "worker" });
  record.setState(id, "failed", { cause: "timeout" });
  record.setState(id, "failed", { reason: "again" });
  expect(mine(id)).toEqual([
    { subject: "gate", action: "running", object: id, detail: null },
    { subject: "gate", action: "failed", object: id, detail: "past its time box" },
  ]);
});

test("a run that fails a check logs the reason as the event detail", () => {
  const { id } = record.makeJob({ role: "build", name: "issue.33" });
  record.setState(id, "failed", { cause: "check", checkName: "bun test", reason: "bun test failed: 3 fail (a.test.ts)" });
  expect(mine(id).find((e) => e.action === "failed")).toMatchObject({ detail: "bun test failed: 3 fail (a.test.ts)" });
});

test("a build the reviewer sent back logs its return by the reviewer's job", () => {
  const build = record.makeJob({ role: "build", name: "issue.34" });
  const review = record.makeJob({ role: "review", name: "issue.34", prev: build.id });
  record.setState(build.id, "returned", { cause: "review", reason: "reviewer: no test" });
  expect(mine(build.id).at(-1)).toMatchObject({ subject: review.id, action: "returned" });
});

test("patchRun drops a field set to undefined, and takes a function of the run and its work", () => {
  const a = record.makeJob({ role: "build", name: "w", phase: "setup", reason: "r" });
  const b = record.makeJob({ role: "land", name: "w", prev: a.id });
  record.patchRun(a.id, { phase: undefined });
  expect(record.getRun(a.id)).not.toHaveProperty("phase");
  record.patchRun(b.id, (_run, work) => ({ reason: work.map((x) => x.id).join(",") }));
  expect(record.getRun(b.id)!.reason).toBe(`${a.id},${b.id}`);
  expect(() => record.patchRun("job.99", {})).toThrow();
});

test("a work is the prev chain: its runs share the root as `job`, in job order, and job.10 follows job.9", () => {
  const ids: string[] = [];
  for (let i = 0; i < 10; i++) ids.push(seed({ role: "plain", name: `p${i}` }).id);
  const a = seed({ role: "build", name: "w" }), b = seed({ role: "land", name: "w", prev: a.id }), c = seed({ role: "build", name: "w", prev: b.id });
  expect(record.getRun(c.id)!.job).toBe(a.id);
  expect(record.allRunRecords().map((r) => r.id).slice(8, 11)).toEqual(["job.9", "job.10", "job.11"]);
  expect(record.getRun(ids[9])!.job).toBe(ids[9]);
});

test("rounds are the failed builds of the newest work of a target, and cost is the sum over its jobs", () => {
  const a = seed({ role: "build", name: "issue.5", target: "issue.5", state: "returned", failed: "tests", cost: 1 });
  const r = seed({ role: "review", name: "issue.5", target: "issue.5", prev: a.id, cost: 0.25 });
  seed({ role: "build", name: "issue.5", target: "issue.5", prev: a.id, state: "passed", cost: 2 });
  seed({ role: "build", name: "issue.6", target: "issue.6", state: "returned", failed: "tests", cost: 4 });
  expect(record.roundsOf("issue.5")).toBe(1);
  expect(record.roundsOf("issue.9")).toBe(0);
  expect(record.costOf("issue.5")).toBe(3.25);
  expect(r.run.role).toBe("review");
});

test("an Ask set on the issue and cleared logs a question and an answered event, and read gives the state", () => {
  record.setIssueAsk("issue.32", ASK);
  expect(record.read("issue.32")!.ask).toEqual(ASK);
  expect(record.issueAsk(record.read("issue.32"))).toEqual(ASK);
  record.setIssueAsk("issue.32", { ...ASK, situation: "case text" });
  record.setIssueAsk("issue.32", null);
  expect(record.read("issue.32")).toBeNull();
  expect(mine("issue.32")).toEqual([
    { subject: "gate", action: "question", object: "issue.32", detail: "question" },
    { subject: "gate", action: "answered", object: "issue.32", detail: null },
  ]);
});

test("a run's Ask lives in issue_state with the run as its owner, not in the issue's own Ask", () => {
  const { id } = record.makeJob({ role: "build", name: "issue.7", target: "issue.7", state: "waiting", ask: ASK });
  const s = record.read("issue.7")!;
  expect(s).toMatchObject({ ask: ASK, askJob: id });
  expect(record.issueAsk(s)).toBeNull();
  expect(record.getRun(id)!.ask).toEqual(ASK);
  record.setIssueAsk("issue.7", null);
  expect(record.getRun(id)!.ask).toEqual(ASK);
  record.setState(id, "passed", { ask: undefined });
  expect(record.read("issue.7")).toBeNull();
});

test("a land or build of the work that joins after the run an Ask is on clears that Ask; a director run or another work's land does not", () => {
  const a = record.makeJob({ role: "build", name: "issue.7", target: "issue.7", state: "waiting", ask: ASK });
  record.makeJob({ role: "director", name: "d", target: "issue.7", prev: a.id });
  record.makeJob({ role: "land", name: "other", target: "issue.7" });
  expect(record.read("issue.7")!.ask).toEqual(ASK);
  record.makeJob({ role: "land", name: "issue.7", target: "issue.7", prev: a.id });
  expect(record.read("issue.7")).toBeNull();
  expect(mine("issue.7").map((e) => e.action).filter((x) => x === "question" || x === "answered")).toEqual(["question", "answered"]);
});

test("issue_state has no wait column, and a row with only a CI result reads back with it", () => {
  const cols = (conn().query("PRAGMA table_info(issue_state)").all() as { name: string }[]).map((c) => c.name);
  expect(cols).toEqual(["issue", "ask", "ask_job", "ci"]);
  const ci = { url: "u", commit: "c", failure: "f" };
  record.editIssueState("issue.8", (s) => { s.ci = ci; });
  expect(record.read("issue.8")).toEqual({ ask: null, ci });
});

test("copyEnd copies the pid and exit files of the folder to the row", () => {
  const { id, folder } = record.makeJob({ role: "plain", name: "x" });
  writeFileSync(join(folder, "pid"), "4242");
  writeFileSync(join(folder, "exit"), "3");
  record.copyEnd(id);
  expect(conn().query("SELECT pid, exit_code FROM jobs WHERE id = ?").get(id)).toEqual({ pid: 4242, exit_code: 3 });
  expect(existsSync(join(folder, "exit"))).toBe(true);
});

test("decisions reads the decision of each director job, oldest first", () => {
  record.makeJob({ role: "director", name: "d1", decision: { at: "a", outcome: "decided" } });
  record.makeJob({ role: "build", name: "b" });
  record.makeJob({ role: "director", name: "d2", decision: { at: "b", outcome: "escalated" } });
  expect(record.decisions<{ at: string }>().map((d) => d.at)).toEqual(["a", "b"]);
});

// The next step is a function of the runs and the issue's state.
const run = (o: Partial<Run> = {}): Run => ({ role: "build", name: "issue.7", repo: "aleph", target: "issue.7", state: "running", told: false, started: AT, made: 0, by: "rule", job: "job.1", ...o });
const runs = (xs: Partial<Run>[]): record.RunRecord[] => xs.map((x, i) => ({ ...run(x), id: `job.${i + 1}` }));
const nx = (xs: Partial<Run>[], live?: record.Live) => record.next(runs(xs), live);
const job = (xs: Partial<Run>[]): Entry[] => runs(xs).map((r) => ({ id: r.id, folder: `/jobs/${r.id}`, run: r }));

test("next: an Ask waits for Chris before anything else", () => {
  expect(nx([{ state: "passed" }], { ask: ASK }).step).toBe("ask");
  expect(nx([{ state: "waiting" }]).step).toBe("ask");
});

test("next: each run state gives its step", () => {
  const cases: [Partial<Run>[], record.Step["step"]][] = [
    [[{ state: "running" }], "run"],
    [[{ state: "returned", failed: "tests", next: "worker" }], "worker"],
    [[{ state: "returned", failed: "doc-claims", next: "recheck" }], "recheck"],
    [[{ state: "passed", next: "land" }], "land"],
    [[{ role: "land", state: "failed", next: "land" }], "land"],
    [[{ state: "passed" }], "wait"],
    [[{ state: "passed", next: "land" }, { role: "land", state: "failed", cause: "locked" }], "land"],
    [[{ state: "failed", reason: "no commit" }], "rescue"],
    [[{ state: "failed" }], "rescue"],
    [[{ role: "land", state: "landed", commit: "abc1234def" }], "none"],
    [[{ state: "dropped", reason: "dropped by Chris" }], "none"],
    [[{ state: "failed", reason: "no commit" }, { role: "director", state: "done" }], "rescue"],
    [[{ state: "passed", next: "land" }, { role: "director", state: "passed" }], "land"],
    [[{ state: "passed" }, { role: "review", state: "done" }], "wait"],
  ];
  for (const [xs, step] of cases) expect([xs, nx(xs).step]).toEqual([xs, step]);
  expect(nx([{ state: "failed", cause: "no-commit", reason: "no commit" }, { role: "director", state: "done" }]).sub).toBe("no-commit");
});

test("next: each case gives its step as event words", () => {
  expect(nx([{ state: "passed" }], { ask: ASK })).toEqual({ step: "ask", action: "waiting", to: "human" });
  expect(nx([{ state: "running" }])).toEqual({ step: "run", action: "running", on: ["job.1"] });
  expect(nx([{ state: "returned", failed: "check", cause: "check", next: "worker" }])).toEqual({ step: "worker", action: "returned", sub: "check", count: `1 / ${fixRounds()}` });
  expect(nx([{ role: "build", state: "returned", failed: "tests" }, { state: "returned", failed: "check", cause: "check", next: "worker" }]).count).toBe(`2 / ${fixRounds()}`);
  expect(nx([{ role: "land", state: "landed", commit: "4240d76abc9" }])).toEqual({ step: "none", action: "landed", on: ["4240d76"] });
  expect(nx([{ state: "failed", cause: "review" }])).toEqual({ step: "rescue", action: "failed", sub: "review" });
  expect(nx([])).toEqual({ step: "start", action: "starting" });
});

test("next: no step keeps the why sentence", () => {
  const cases: Partial<Run>[][] = [[], [{ state: "running" }], [{ state: "waiting" }], [{ state: "returned", cause: "check", next: "worker" }], [{ state: "passed", next: "land" }], [{ state: "passed" }], [{ state: "failed", cause: "review" }]];
  for (const xs of cases) expect("why" in nx(xs)).toBe(false);
});

test("next: a stuck run the factory asked Chris about waits", () => {
  expect(nx([{ state: "failed", asked: { at: AT, question: "q" } }]).step).toBe("wait");
});

test("next: a land asked about while it was live (a slow land) and failed later goes to the rescue", () => {
  const asked = { at: AT, question: "slow land" };
  expect(nx([{ role: "land", state: "failed", cause: "check", ended: "2026-11-04T10:30:00.000Z", asked }]).step).toBe("rescue");
  expect(nx([{ role: "land", state: "failed", cause: "check", ended: "2026-11-04T09:30:00.000Z", asked }]).step).toBe("wait");
});

test("next: an issue with no run starts", () => {
  expect(nx([]).step).toBe("start");
});

test("endRun writes the end and its next in one write: no reader sees the ended run with no next", () => {
  const { id } = record.makeJob({ role: "build", name: "issue.7", target: "issue.7" });
  const seen: string[] = [];
  const ended = record.endRun(id, { state: "returned", failed: "tests", ended: AT }, (r) => {
    seen.push(record.next(record.allRunRecords()).step);
    return r.state === "returned" ? "worker" : undefined;
  });
  seen.push(record.next(record.allRunRecords()).step);
  expect(seen).toEqual(["run", "worker"]);
  expect(ended).toMatchObject({ id, state: "returned", next: "worker", ended: AT });
});

test("endRun gives decide the work's land runs with the ended one in its ended state", () => {
  const a = record.makeJob({ role: "build", name: "w" });
  const l1 = record.makeJob({ role: "land", name: "w", prev: a.id, state: "failed", conflicts: ["a.ts"] });
  const l2 = record.makeJob({ role: "land", name: "w", prev: l1.id });
  record.makeJob({ role: "land", name: "x", state: "failed", conflicts: ["b.ts"] });
  let lands: Run[] = [];
  record.endRun(l2.id, { state: "failed", conflicts: ["a.ts"] }, (_, l) => { lands = l; return undefined; });
  expect(lands.map((x) => [x.job, x.state, x.conflicts])).toEqual([[a.id, "failed", ["a.ts"]], [a.id, "failed", ["a.ts"]]]);
  expect("next" in record.getRun(l2.id)!).toBe(false);
});

test("counting and next pick the same run: not a land that found the lock busy, not a director or review run", () => {
  const xs: Partial<Run>[] = [{ state: "waiting" }, { role: "land", state: "failed", cause: "locked" }];
  expect(record.counting(job(xs)).id).toBe("job.1");
  expect(nx(xs).on).toEqual(["job.1"]);
  expect(nx([...xs, { role: "director", state: "done" }, { role: "review", state: "done" }]).on).toEqual(["job.1"]);
  expect(record.counting(job([{ role: "director", state: "done" }])).id).toBe("job.1");
});

test("stepOf is next over the work's runs with the Ask of its target's issue state", () => {
  const a = seed({ role: "build", name: "issue.7", target: "issue.7", state: "passed" });
  record.setIssueAsk("issue.7", ASK);
  expect(record.stepOf([a])).toEqual({ step: "ask", action: "waiting", to: "human" });
  record.setIssueAsk("issue.7", null);
  expect(record.stepOf([a]).step).toBe("wait");
});

test("stepOf: a run whose cause is not rescuable, as credit, waits; the rescue never sees it", () => {
  const credit: Partial<Run> = { state: "failed", cause: "credit", reason: "API Error: 402 This request would exceed your available credits" };
  expect(record.stepOf(job([credit]))).toEqual({ step: "wait", action: "failed", sub: "credit" });
  expect(record.stepOf(job([{ state: "failed", cause: "no-commit" }])).step).toBe("rescue");
});
