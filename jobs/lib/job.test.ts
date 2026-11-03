import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addNote, allJobs, batch, checkedBy, lookMinutes, goal, hasFile, latestFile, latestJob, notes, readFile, sealed, tailOf } from "./job.ts";
import { isOpen, writeRun, type Run } from "./ledger.ts";
import { asked, markAsked } from "./ask.ts";
import { markRescued, rescued } from "./continuation.ts";

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

describe("isOpen", () => {
  test("a facts run does not reopen a landed job", () => {
    run("20261028-000001-a01", "j", { name: "n", kind: "land", condition: "landed" });
    run("20261028-000002-a02", "j", { name: "n", kind: "facts", condition: "running" });
    expect(isOpen(allJobs()[0])).toBe(false);
  });
});

describe("run-folder files", () => {
  test("reads, the latest run that has one, tails, marks, batch and notes", () => {
    run("20261028-000001-a01", "j", { name: "n" }, { "spec.md": "Do it\n\nmore", "result.md": "one", "checks.log": "a\nb\nc\n" });
    run("20261028-000002-a02", "j", { name: "n", kind: "land", condition: "running" }, { "result.md": "land", "batch.json": JSON.stringify({ verdict: "landed", code: 0 }) });
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

describe("the evidence of a delivery", () => {
  test("checkedBy names the checks that passed, the hidden counts and the reviewers that left a file", () => {
    const f = run("20261101-000001-a", "20261101-000001-a", { checks: [{ name: "tests", ok: true, seconds: 1 }, { name: "hidden", ok: true, seconds: 1, passed: 2, total: 2 }, { name: "types", ok: false, seconds: 1 }] }, { "review.md": "land" });
    mkdirSync(join(f, "browser"));
    writeFileSync(join(f, "browser", "report.md"), "fine");
    expect(checkedBy(allJobs()[0])).toEqual(["tests", "hidden 2/2", "reviewer", "browser review"]);
  });
  test("a job with nothing recorded has no evidence", () => {
    run("20261101-000002-b", "20261101-000002-b");
    expect(checkedBy(allJobs()[0])).toEqual([]);
  });
  test("lookMinutes grows with the diff and drops one with a sealed check", () => {
    expect(lookMinutes(0, true)).toBe(1);
    expect(lookMinutes(1, true)).toBe(2);
    expect(lookMinutes(200, false)).toBe(3);
    expect(lookMinutes(201, false)).toBe(4);
  });
  test("a passed hidden check with a total alone is not sealed, so lookMinutes keeps its extra minute", () => {
    run("20261101-000005-e", "20261101-000005-e", { checks: [{ name: "hidden", ok: true, seconds: 1, passed: 3, total: 3 }] });
    const j = allJobs()[0];
    expect(sealed(j)).toBe(false);
    expect(checkedBy(j)).toEqual(["hidden 3/3"]);
    expect(lookMinutes(0, sealed(j))).toBe(lookMinutes(0, false));
  });
});
