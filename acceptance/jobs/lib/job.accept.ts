// Archived goal tests from jobs/lib/job.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { allJobs, checkedBy, lookMinutes, sealed, findJob, issue, jobById, lastReal, jobsNamed, latestJob, openJob, stateOf, view } from "../../../jobs/lib/job.ts";
import { isOpen, writeRun, type Run } from "../../../jobs/lib/ledger.ts";

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
  writeRun(folder, { kind: "build", job, name: job.replace(/^\d+-\d+-/, ""), repo: "fac", condition: "passed", told: true, started: `2026-10-28T00:00:${id.slice(-2)}Z`, ...extra } as Run);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
  return folder;
}

describe("lookups", () => {
  test("by name: the open job, else the newest; by repo; by id", () => {
    run("20261028-000001-a01", "20261028-000001-a01", { name: "n1", condition: "dropped" });
    run("20261028-000002-a02", "20261028-000002-a02", { name: "n1", condition: "passed" });
    run("20261028-000003-a03", "20261028-000003-a03", { name: "n1", repo: "oth", condition: "landed" });
    expect(openJob("n1")![0].id).toBe("20261028-000002-a02");
    expect(latestJob("n1")![0].id).toBe("20261028-000003-a03");
    expect(findJob("n1")![0].id).toBe("20261028-000002-a02");
    expect(latestJob("n1", "fac")![0].id).toBe("20261028-000002-a02");
    expect(jobsNamed("n1").map((j) => j[0].id)).toEqual(["20261028-000001-a01", "20261028-000002-a02", "20261028-000003-a03"]);
    expect(jobsNamed("n1", "oth").length).toBe(1);
    expect(openJob("n1", "oth")).toBeUndefined();
    expect(findJob("n1", "oth")![0].id).toBe("20261028-000003-a03");
    expect(findJob("nope")).toBeUndefined();
    expect(jobById("20261028-000001-a01")![0].run.condition).toBe("dropped");
  });

  test("a job is known by its last run's name, and a closed one is not open", () => {
    run("20261028-000001-a01", "j", { name: "old", condition: "awaiting" });
    run("20261028-000002-a02", "j", { name: "new", kind: "land", condition: "landed" });
    expect(latestJob("old")).toBeUndefined();
    expect(openJob("new")).toBeUndefined();
    expect(latestJob("new")!.length).toBe(2);
  });
});

describe("the run that counts", () => {
  test("a land that found the job lock busy does not count; the issue is the latest named", () => {
    run("20261028-000001-a01", "j", { name: "n", repo: "fac", on: "fac-3" });
    run("20261028-000002-a02", "j", { name: "n", kind: "land", condition: "failed", reason: "job lock busy" });
    const j = latestJob("n")!;
    expect(lastReal(j).id).toBe("20261028-000001-a01");
    expect(stateOf(j)).toBe("passed");
    expect(issue(j)).toBe(3);
    run("20261028-000003-a03", "j", { name: "n", kind: "land", condition: "failed", reason: "not landed", repo: "fac", on: "fac-4" });
    const k = latestJob("n")!;
    expect(stateOf(k)).toBe("failed");
    expect(issue(k)).toBe(4);
  });
});

describe("isOpen", () => {
  test("an open run stays open under a facts run; a job of only facts runs is not open", () => {
    run("20261028-000001-a01", "j", { name: "n", condition: "passed" });
    run("20261028-000002-a02", "j", { name: "n", kind: "facts", condition: "done" });
    expect(isOpen(allJobs()[0])).toBe(true);
    run("20261028-000003-a03", "k", { name: "k", kind: "facts", condition: "running" });
    expect(isOpen(allJobs()[1])).toBe(false);
  });
});

describe("view", () => {
  test("run fields from the last run, the rest from the latest run that has them", () => {
    run("20261028-000001-a01", "j", {
      name: "n", on: "fac-7", condition: "awaiting", ask: { kind: "approval", reason: "held-path", question: "", options: [], why: [] }, cost: 0.5, model: "m1", stat: " a | 1 +", defaults: ["q -> a"],
      checks: [{ name: "test", ok: true, seconds: 3 }, { name: "hidden", ok: true, seconds: 1, passed: 2, total: 3 }],
    }, { "result.md": "done\nFOLLOWUP: tidy\nFOLLOWUP:\n", "call.md": "PENDING\n" });
    run("20261028-000002-a02", "j", { name: "n", kind: "land", condition: "landed", check: "open", commit: "abc", cost: 0.25, checks: [], ended: "2026-10-28T01:00:00Z" });
    const v = view(latestJob("n")!);
    expect(v).toMatchObject({
      job: "j", name: "n", repo: "fac", run: { id: "20261028-000002-a02", kind: "land", started: "2026-10-28T00:00:02Z" },
      condition: "landed", started: "2026-10-28T00:00:01Z", ended: "2026-10-28T01:00:00Z", item: 7, cost: 0.75, model: "m1", commit: "abc",
      stat: " a | 1 +", defaults: ["q -> a"], followups: ["tidy"], hidden: { passed: 2, total: 3 }, check: "open",
    });
    expect(v.checks!.map((c) => c.name)).toEqual(["test", "hidden"]);
    expect(v.needs).toBeUndefined();
    expect(v.review).toBeUndefined();
    expect(v.lost).toBeUndefined();
  });

  test("a stuck job shows its last checks, even none; review and lost come from the last run", () => {
    run("20261028-000001-a01", "j", { name: "n", checks: [{ name: "test", ok: true, seconds: 3 }] });
    const f = run("20261028-000002-a02", "j", { name: "n", condition: "stuck", checks: [] }, { "call.md": "PENDING\n", pid: "999999999" });
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
    run("20261028-000003-a03", "a", { name: "a", kind: "land", condition: "landed" });
    expect(allJobs().map((j) => j.map((e) => e.id.slice(-3)))).toEqual([["a01", "a03"], ["a02"]]);
  });
});

describe("facts runs", () => {
  test("a landed job with an open check and a facts run is still landed under its name", () => {
    run("20261028-000001-a01", "j1", { name: "n1" });
    run("20261028-000002-a02", "j1", { name: "n1", kind: "land", condition: "landed", commit: "abc1234", check: "open" });
    run("20261028-000003-a03", "j1", { name: "facts-n1", kind: "facts", condition: "done" });
    expect(latestJob("n1")![0].run.job).toBe("j1");
    expect(jobsNamed("n1")).toHaveLength(1);
    expect(latestJob("facts-n1")).toBeUndefined();
    const j = latestJob("n1")!;
    expect(stateOf(j)).toBe("landed");
    expect(lastReal(j).run).toMatchObject({ kind: "land", check: "open" });
    expect(view(j).check).toBe("open");
  });
});

describe("the evidence of a delivery", () => {
  test("a goal sealed with scenarios counts as sealed, and the reviewer is named with them", () => {
    run("20261101-000003-c", "20261101-000003-c", {}, { "review.md": "land", "review-prompt.md": "x\n## Sealed scenarios\n- s\n" });
    run("20261101-000004-d", "20261101-000004-d", {}, { "review.md": "land", "review-prompt.md": "x\n" });
    const [c, d] = allJobs();
    expect(sealed(c)).toBe(true);
    expect(checkedBy(c)).toEqual(["reviewer", "sealed scenarios"]);
    expect(sealed(d)).toBe(false);
    expect(checkedBy(d)).toEqual(["reviewer"]);
    expect(lookMinutes(0, sealed(c))).toBe(lookMinutes(0, sealed(d)) - 1);
  });
});
