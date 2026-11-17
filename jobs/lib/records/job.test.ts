import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addNote, checkedBy, lookMinutes, issueTitle, hasFile, latestFile, latestJob, notes, openJobOfIssue, readFile, tailOf, view } from "./job.ts";
import { allJobs, type Run } from "./ledger.ts";
import { seed, type Seed } from "../../job.testkit.ts";
import { logTo } from "./run-files.ts";
import { asked, markAsked, waitsForSpecEdit } from "../asks/ask.ts";
import { markRescued, rescued } from "../transitions/continuation.ts";

let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-job-"));
  saved = { ALEPH_JOBS_DIR: process.env.ALEPH_JOBS_DIR, ALEPH_DB: process.env.ALEPH_DB };
  process.env.ALEPH_JOBS_DIR = base;
  process.env.ALEPH_DB = join(base, "aleph.db");
  last.clear();
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

const last = new Map<string, string>();
/** A job of the work `work` (it follows the work's last job), with `files` in its folder. Returns its folder. */
function run(work: string, extra: Partial<Run> = {}, files: Record<string, string> = {}): string {
  const { folder, id } = seed({ role: "build", name: work, repo: "fac", state: "passed", prev: last.get(work), ...extra } as Seed);
  last.set(work, id);
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
  return folder;
}

describe("run-folder files", () => {
  test("reads, the latest run that has one, tails, marks, batch and notes", () => {
    const first = run("n", {}, { "spec.md": "Do it\n\nmore", "result.md": "one" }), last2 = run("n", { role: "land", state: "running" }, { "result.md": "land", "batch.json": JSON.stringify({ verdict: "landed", code: 0 }) });
    logTo(first, "checks", "a\nb\nc\n");
    const j = latestJob("n")!;
    const [one, two] = j;
    expect(one.folder).toBe(first);
    expect(readFile(one, "result.md")).toBe("one");
    expect(readFile(one, "stderr")).toBeUndefined();
    expect(latestFile(j, "result.md")!.text).toBe("land");
    expect(latestFile(j, "result.md", (e) => e.run.role === "build")!.entry.id).toBe(j[0].id);
    expect(latestFile(j, "review.json")).toBeUndefined();
    expect(tailOf(one, "checks", 2)).toBe("b\nc");
    expect(tailOf(one, "review.json", 2)).toBe("");
    expect(hasFile(two, "batch.json")).toBe(true);
    expect(two.folder).toBe(last2);
    expect(issueTitle(j)).toBe("Do it");

    expect(asked(one)).toBe(false);
    markAsked(one, "drop it?");
    expect(asked(one)).toBe(true);
    expect(waitsForSpecEdit(one)).toBeNull();
    expect(rescued(one)).toBe("");
    markRescued(one, "infra");
    expect(rescued(allJobs()[0][0])).toBe("infra");

    expect(notes(j)).toEqual([]);
    addNote(j, "first note");
    addNote(j, "second note");
    expect(notes(j)).toEqual([{ name: "001", text: "first note" }, { name: "002", text: "second note" }]);
  });
});

describe("the evidence of a delivery", () => {
  test("checkedBy names the checks that passed and the reviewers that left a job", () => {
    run("a", { checks: [{ name: "tests", ok: true, seconds: 1 }, { name: "types", ok: false, seconds: 1 }] });
    run("a", { role: "review", state: "done" });
    expect(checkedBy(allJobs()[0])).toEqual(["tests", "reviewer"]);
  });
  test("a job with nothing recorded has no evidence", () => {
    run("b");
    expect(checkedBy(allJobs()[0])).toEqual([]);
  });
  test("lookMinutes grows with the diff", () => {
    expect(lookMinutes(0)).toBe(2);
    expect(lookMinutes(1)).toBe(3);
    expect(lookMinutes(200)).toBe(3);
    expect(lookMinutes(201)).toBe(4);
  });
});

describe("view", () => {
  test("returns the job's cost over its runs, the cause and check of a stopped one, and the ask of a waiting one", () => {
    run("c", { cost: 1.5 });
    run("c", { state: "failed", cost: 0.5, cause: "check", checkName: "tests", limit: 30 });
    expect(view(allJobs()[0])).toMatchObject({ cost: 2, cause: "check", checkName: "tests", limit: 30 });
    run("w", { state: "waiting", ask: { reason: "question", question: "Which?", options: [], why: [] } });
    run("p", { state: "waiting" });
    expect(view(allJobs()[1]).ask).toMatchObject({ reason: "question", question: "Which?" });
    expect(view(allJobs()[2]).ask).toMatchObject({ reason: "question", question: "" });
    expect(view(allJobs()[1])).not.toHaveProperty("cause");
  });
});

describe("the open job of an issue", () => {
  test("is the open job on the issue in the repo, not a closed one or another issue's", () => {
    run("b", { target: "issue.7", state: "landed" });
    run("a", { target: "issue.7", state: "running" });
    run("c", { target: "issue.8", state: "running" });
    expect(openJobOfIssue("fac", 7)![0].run.name).toBe("a");
    expect(openJobOfIssue("fac", 9)).toBeUndefined();
  });
});
