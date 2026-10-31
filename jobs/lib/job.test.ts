import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addNote, allJobs, batch, findJob, goal, hasFile, issue, jobById, lastReal, latestFile, jobsNamed, latestJob, markAsked, markRescued, asked, notes, openJob, readFile, rescued, stateOf, tailOf, view } from "./job.ts";
import { isOpen, writeRun, type Run } from "./ledger.ts";

let base: string;
let saved: string | undefined;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-job-"));
  saved = process.env.ALEPH_JOBS_DIR;
  process.env.ALEPH_JOBS_DIR = base;
});

afterEach(() => {
  if (saved === undefined) delete process.env.ALEPH_JOBS_DIR;
  else process.env.ALEPH_JOBS_DIR = saved;
  rmSync(base, { recursive: true, force: true });
});

/** A run folder `id` of job `job`, with `files` in it. Folder names sort in the order runs are made. */
function run(id: string, job: string, extra: Partial<Run> = {}, files: Record<string, string> = {}): string {
  const folder = join(base, id);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "build", job, name: job.replace(/^\d+-\d+-/, ""), repo: "fac", state: "passed", told: true, started: `2026-10-28T00:00:${id.slice(-2)}Z`, ...extra } as Run);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
  return folder;
}

describe("lookups", () => {
  test("by name: the open job, else the newest; by repo; by id", () => {
    run("20261028-000001-a01", "20261028-000001-a01", { name: "n1", state: "dropped" });
    run("20261028-000002-a02", "20261028-000002-a02", { name: "n1", state: "passed" });
    run("20261028-000003-a03", "20261028-000003-a03", { name: "n1", repo: "oth", state: "landed" });
    expect(openJob("n1")![0].id).toBe("20261028-000002-a02");
    expect(latestJob("n1")![0].id).toBe("20261028-000003-a03");
    expect(findJob("n1")![0].id).toBe("20261028-000002-a02");
    expect(latestJob("n1", "fac")![0].id).toBe("20261028-000002-a02");
    expect(jobsNamed("n1").map((j) => j[0].id)).toEqual(["20261028-000001-a01", "20261028-000002-a02", "20261028-000003-a03"]);
    expect(jobsNamed("n1", "oth").length).toBe(1);
    expect(openJob("n1", "oth")).toBeUndefined();
    expect(findJob("n1", "oth")![0].id).toBe("20261028-000003-a03");
    expect(findJob("nope")).toBeUndefined();
    expect(jobById("20261028-000001-a01")![0].run.state).toBe("dropped");
  });

  test("a job is known by its last run's name, and a closed one is not open", () => {
    run("20261028-000001-a01", "j", { name: "old", state: "awaiting" });
    run("20261028-000002-a02", "j", { name: "new", kind: "land", state: "landed" });
    expect(latestJob("old")).toBeUndefined();
    expect(openJob("new")).toBeUndefined();
    expect(latestJob("new")!.length).toBe(2);
  });
});

describe("the run that counts", () => {
  test("a land that found the job lock busy does not count; the issue is the latest named", () => {
    run("20261028-000001-a01", "j", { name: "n", repo: "fac", on: "fac-3" });
    run("20261028-000002-a02", "j", { name: "n", kind: "land", state: "failed", reason: "job lock busy" });
    const j = latestJob("n")!;
    expect(lastReal(j).id).toBe("20261028-000001-a01");
    expect(stateOf(j)).toBe("passed");
    expect(issue(j)).toBe(3);
    run("20261028-000003-a03", "j", { name: "n", kind: "land", state: "failed", reason: "not landed", repo: "fac", on: "fac-4" });
    const k = latestJob("n")!;
    expect(stateOf(k)).toBe("failed");
    expect(issue(k)).toBe(4);
  });
});

describe("isOpen", () => {
  test("a facts run does not reopen a landed job", () => {
    run("20261028-000001-a01", "j", { name: "n", kind: "land", state: "landed" });
    run("20261028-000002-a02", "j", { name: "n", kind: "facts", state: "running" });
    expect(isOpen(allJobs()[0])).toBe(false);
  });

  test("an open run stays open under a facts run; a job of only facts runs is not open", () => {
    run("20261028-000001-a01", "j", { name: "n", state: "passed" });
    run("20261028-000002-a02", "j", { name: "n", kind: "facts", state: "done" });
    expect(isOpen(allJobs()[0])).toBe(true);
    run("20261028-000003-a03", "k", { name: "k", kind: "facts", state: "running" });
    expect(isOpen(allJobs()[1])).toBe(false);
  });
});

describe("run-folder files", () => {
  test("reads, the latest run that has one, tails, marks, batch and notes", () => {
    run("20261028-000001-a01", "j", { name: "n" }, { "spec.md": "Do it\n\nmore", "result.md": "one", "checks.log": "a\nb\nc\n" });
    run("20261028-000002-a02", "j", { name: "n", kind: "land", state: "running" }, { "result.md": "land", "batch.json": JSON.stringify({ verdict: "landed", code: 0 }) });
    const j = latestJob("n")!;
    const [first, last] = j;
    expect(readFile(first, "result.md")).toBe("one");
    expect(readFile(first, "stderr.log")).toBeUndefined();
    expect(latestFile(j, "result.md")!.text).toBe("land");
    expect(latestFile(j, "result.md", (e) => e.run.kind === "build")!.entry.id).toBe(first.id);
    expect(latestFile(j, "review.md")).toBeUndefined();
    expect(tailOf(first, "checks.log", 2)).toBe("b\nc");
    expect(tailOf(first, "review.md", 2)).toBe("");
    expect(batch(last)).toEqual({ verdict: "landed", code: 0 });
    expect(batch(first)).toBeUndefined();
    expect(hasFile(last, "batch.json")).toBe(true);
    expect(goal(j)).toBe("Do it");

    expect(asked(first)).toBe(false);
    markAsked(first, "drop it?");
    expect(asked(first)).toBe(true);
    expect(readFileSync(join(first.folder, "asked"), "utf8")).toBe("drop it?\n");
    expect(rescued(first)).toBe("");
    markRescued(first, "infra");
    expect(rescued(first)).toBe("infra");

    expect(notes(j)).toEqual([]);
    addNote(j, "first note");
    addNote(j, "second note");
    expect(notes(j)).toEqual([{ name: "001", text: "first note" }, { name: "002", text: "second note" }]);
  });
});

describe("view", () => {
  test("run fields from the last run, the rest from the latest run that has them", () => {
    run("20261028-000001-a01", "j", {
      name: "n", on: "fac-7", state: "awaiting", ask: { kind: "approval", reason: "held-path", question: "", options: [], why: [] }, cost: 0.5, model: "m1", stat: " a | 1 +", defaults: ["q -> a"],
      checks: [{ name: "test", ok: true, seconds: 3 }, { name: "hidden", ok: true, seconds: 1, passed: 2, total: 3 }],
    }, { "result.md": "done\nFOLLOWUP: tidy\nFOLLOWUP:\n", "call.md": "PENDING\n" });
    run("20261028-000002-a02", "j", { name: "n", kind: "land", state: "landed", check: "open", commit: "abc", cost: 0.25, checks: [], ended: "2026-10-28T01:00:00Z" });
    const v = view(latestJob("n")!);
    expect(v).toMatchObject({
      job: "j", name: "n", repo: "fac", run: { id: "20261028-000002-a02", kind: "land", started: "2026-10-28T00:00:02Z" },
      state: "landed", started: "2026-10-28T00:00:01Z", ended: "2026-10-28T01:00:00Z", item: 7, cost: 0.75, model: "m1", commit: "abc",
      stat: " a | 1 +", defaults: ["q -> a"], followups: ["tidy"], hidden: { passed: 2, total: 3 }, check: "open",
    });
    expect(v.checks!.map((c) => c.name)).toEqual(["test", "hidden"]);
    expect(v.needs).toBeUndefined();
    expect(v.review).toBeUndefined();
    expect(v.lost).toBeUndefined();
  });

  test("a stuck job shows its last checks, even none; review and lost come from the last run", () => {
    run("20261028-000001-a01", "j", { name: "n", checks: [{ name: "test", ok: true, seconds: 3 }] });
    const f = run("20261028-000002-a02", "j", { name: "n", state: "stuck", checks: [] }, { "call.md": "PENDING\n", pid: "999999999" });
    const v = view(latestJob("n")!);
    expect(v.checks).toEqual([]);
    expect(v.review).toEqual({ call: "pending" });
    expect(v.lost).toBe(true);
    writeFileSync(join(f, "exit"), "0");
    expect(view(latestJob("n")!).lost).toBeUndefined();
  });

  test("allJobs groups runs by job", () => {
    run("20261028-000001-a01", "a", { name: "a" });
    run("20261028-000002-a02", "b", { name: "b" });
    run("20261028-000003-a03", "a", { name: "a", kind: "land", state: "landed" });
    expect(allJobs().map((j) => j.map((e) => e.id.slice(-3)))).toEqual([["a01", "a03"], ["a02"]]);
  });
});

describe("facts runs", () => {
  test("a landed job with an open check and a facts run is still landed under its name", () => {
    run("20261028-000001-a01", "j1", { name: "n1" });
    run("20261028-000002-a02", "j1", { name: "n1", kind: "land", state: "landed", commit: "abc1234", check: "open" });
    run("20261028-000003-a03", "j1", { name: "facts-n1", kind: "facts", state: "done" });
    expect(latestJob("n1")![0].run.job).toBe("j1");
    expect(jobsNamed("n1")).toHaveLength(1);
    expect(latestJob("facts-n1")).toBeUndefined();
    const j = latestJob("n1")!;
    expect(stateOf(j)).toBe("landed");
    expect(lastReal(j).run).toMatchObject({ kind: "land", check: "open" });
    expect(view(j).check).toBe("open");
  });
});
