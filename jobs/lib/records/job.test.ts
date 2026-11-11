import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { addNote, allJobs, checkedBy, lookMinutes, issueTitle, hasFile, latestFile, latestJob, notes, openJobOfIssue, readFile, tailOf } from "./job.ts";
import { type Run } from "./ledger.ts";
import { putRun } from "./record.ts";
import { asked, markAsked, waitsForSpecEdit } from "../asks/ask.ts";
import { markRescued, rescued } from "../transitions/continuation.ts";

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
  putRun(basename(folder), { n: 1, kind: "build", job, name: job.replace(/^\d+-\d+-/, ""), repo: "fac", condition: "passed", told: true, started: `2026-10-28T00:00:${id.slice(-2)}Z`, ...extra } as Run);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
  return folder;
}

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
    expect(hasFile(last, "batch.json")).toBe(true);
    expect(issueTitle(j)).toBe("Do it");

    expect(asked(first)).toBe(false);
    markAsked(first, "drop it?");
    expect(asked(first)).toBe(true);
    expect(waitsForSpecEdit(first)).toBeNull();
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
  test("checkedBy names the checks that passed and the reviewers that left a file", () => {
    run("20261101-000001-a", "20261101-000001-a", { checks: [{ name: "tests", ok: true, seconds: 1 }, { name: "types", ok: false, seconds: 1 }] }, { "review.md": "land" });
    expect(checkedBy(allJobs()[0])).toEqual(["tests", "reviewer"]);
  });
  test("a job with nothing recorded has no evidence", () => {
    run("20261101-000002-b", "20261101-000002-b");
    expect(checkedBy(allJobs()[0])).toEqual([]);
  });
  test("lookMinutes grows with the diff", () => {
    expect(lookMinutes(0)).toBe(2);
    expect(lookMinutes(1)).toBe(3);
    expect(lookMinutes(200)).toBe(3);
    expect(lookMinutes(201)).toBe(4);
  });
});

describe("the open job of an issue", () => {
  test("is the open job on the issue in the repo, not a closed one or another issue's", () => {
    run("20261101-000003-b", "b", { name: "b", on: "fac-7", condition: "landed" });
    run("20261101-000004-a", "a", { name: "a", on: "fac-7", condition: "running" });
    run("20261101-000005-c", "c", { name: "c", on: "fac-8", condition: "running" });
    expect(openJobOfIssue("fac", 7)![0].run.name).toBe("a");
    expect(openJobOfIssue("fac", 9)).toBeUndefined();
  });
});
