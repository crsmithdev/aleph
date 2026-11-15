import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterLand, askedQuestion, brief, claimStep, clearRerun, conflictStep, duplicateStep, earlierRounds, issueBrief,
  infraStep, killedStep, nextBrief, nextStep, questionOf, repeatedFailure, rerunStep, rescueCase, writeRerun, type Stuck,
} from "./continuation.ts";
import type { Entry, Repo, Run } from "../records/ledger.ts";
import { logTo } from "../records/run-files.ts";
import { seed } from "../../job.testkit.ts";

const dir = mkdtempSync(join(tmpdir(), "continuation-"));
const saved = { jobs: process.env.ALEPH_JOBS_DIR, factory: process.env.ALEPH_FACTORY_DIR, db: process.env.ALEPH_DB };
beforeAll(() => {
  process.env.ALEPH_JOBS_DIR = join(dir, "runs");
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
  process.env.ALEPH_DB = join(dir, "aleph.db");
});
afterAll(() => {
  for (const [k, v] of [["ALEPH_JOBS_DIR", saved.jobs], ["ALEPH_FACTORY_DIR", saved.factory], ["ALEPH_DB", saved.db]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

const run = (r: Partial<Run>): Run => ({ role: "build", job: "job.1", name: "issue.1", state: "failed", started: "2026-11-01T00:00:00Z", ...r } as Run);
const entry = (id: string, r: Partial<Run>): Entry => ({ id, folder: join(dir, "runs", id), run: run(r) });
/** A plain folder with `files`: for a function that reads a run's folder but not its row. */
const folder = (id: string, files: Record<string, string> = {}): string => {
  const f = join(dir, "runs", id);
  mkdirSync(f, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(f, name), text);
  return f;
};
/** A job row with `fields`; returns its key and folder. */
const jobWith = (fields: Partial<Run> = {}, files: Record<string, string> = {}): { id: string; folder: string } => {
  const made = seed({ role: "build", name: "issue.1", state: "failed", started: "2026-11-01T00:00:00Z", ...fields });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(made.folder, name), text);
  return made;
};
const repo = { key: "fac", path: "/nowhere", main: "main" } as Repo;
const stuck = (r: Partial<Run>, id = "r9"): Stuck => ({ last: entry(id, r), r: run(r), repo, reason: r.reason ?? "why" });

describe("next step after a build or recheck", () => {
  test("a pass lands when the run asked to land or the repo lands by itself, else nothing starts", () => {
    expect(nextStep(run({ state: "passed", land: true }), false)).toBe("land");
    expect(nextStep(run({ state: "passed" }), true)).toBe("land");
    expect(nextStep(run({ state: "passed" }), false)).toBeUndefined();
    expect(nextStep(run({ role: "recheck", state: "passed" }), true)).toBe("land");
    expect(nextStep(run({ state: "failed" }), true)).toBeUndefined();
  });

  test("a doc-claims fail is rechecked; the other failures go back to the worker", () => {
    expect(nextStep(run({ state: "returned", failed: "doc-claims" }), false)).toBe("recheck");
    for (const failed of ["keep-gate", "tests", "review"]) expect(nextStep(run({ state: "returned", failed }), false)).toBe("worker");
  });

  test("a check fail with no test record goes back to the worker with the check's log as its note", () => {
    const ended = run({ state: "returned", cause: "check", checkName: "types", reason: "types failed", failed: "types", round: 1 });
    expect(nextStep(ended, false)).toBe("worker");
    const f = folder("check-fail");
    logTo(f, "checks", "## lint: exit 0\nok\n## types: exit 1\n$ tsc\nerror TS2322\n");
    const { note, merge } = nextBrief(f, ended);
    expect(note).toContain("The check `types` failed on this branch. The last 80 lines of its log:");
    expect(note).toContain("error TS2322");
    expect(note).not.toContain("lint");
    expect(merge).toBe(false);
  });

  test("a check fail with failed tests in its record goes back with those tests, not the log", () => {
    const failures = [{ file: "a.test.ts", name: "s > one", message: "Error: boom\n  at a.test.ts:3" }];
    const tests = { ran: 3, passed: 2, failed: 1, skipped: 0, failures };
    const ended = run({ state: "returned", cause: "check", checkName: "tests", failed: "tests", round: 1, checks: [{ name: "tests", ok: false, seconds: 1, tests }] });
    const rec = folder("check-fail-rec");
    logTo(rec, "checks", "## tests: exit 1\nlog line\n");
    const { note } = nextBrief(rec, ended);
    expect(note).toBe("The check `tests` failed on this branch. Its failed tests:\n\n- a.test.ts > s > one\n    Error: boom\n      at a.test.ts:3\n\nFix the cause, run the tests, and commit.");
  });

  test("a stuck run with no fix round left starts nothing", () => {
    expect(nextStep(run({ state: "failed", reason: "tests failed after 2 fix rounds" }), true)).toBeUndefined();
  });

  test("a reviewer hold goes back to the worker with the reviewer's reason while rounds are left", () => {
    const ended = run({ state: "returned", cause: "review", reason: "reviewer: no test", failed: "review", round: 0 });
    expect(nextStep(ended, false)).toBe("worker");
    expect(nextBrief(folder("review-back"), ended).note).toBe("The reviewer sent this branch back: reviewer: no test\n\nFix what it names, run the tests, and commit.");
  });

  test("the same failing tests of a check on two runs in a row ask instead of a third round", () => {
    const checks = (...names: string[]) => [{ name: "tests", ok: false, seconds: 1, tests: {
      ran: 2, passed: 2 - names.length, failed: names.length, skipped: 0, failures: names.map((name) => ({ file: "s.test.ts", name, message: `boom ${name}` })),
    } }];
    const state = (...names: string[]) => jobWith({ failed: "tests", checks: checks(...names) }).folder;
    const prev = entry("fail-prev", { failed: "tests", checks: checks("suite > one") });
    const now = state("suite > one");
    const same = repeatedFailure(now, "tests", [prev]);
    expect(same?.names).toEqual(["s.test.ts > suite > one"]);
    expect(same?.question).toContain("The check `tests` failed the same way on two runs in a row");
    expect(same?.question).toContain("boom suite > one");
    expect(repeatedFailure(now, "tests", [entry("fail-prev", { failed: "lint" })])).toBeNull();
    const other = state("suite > two");
    expect(repeatedFailure(other, "tests", [prev])).toBeNull();
    const none = state();
    expect(repeatedFailure(none, "tests", [entry("fail-none-prev", { failed: "tests", checks: checks() })])).toBeNull();
  });

  test("the fix rounds are the job's other build runs that were sent back", () => {
    const job = [entry("a", { failed: "tests" }), entry("b", { role: "land", failed: "tests" }), entry("c", {}), entry("d", { failed: "review" })];
    expect(earlierRounds(job, "d").map((e) => e.id)).toEqual(["a"]);
  });
});

describe("next step after a land", () => {
  const lands = (n: number, r: Partial<Run>) => Array.from({ length: n }, () => run({ role: "land", state: "failed", ...r }));

  test("a conflict goes back to the worker as a merge run at most twice", () => {
    const fail = run({ role: "land", state: "failed", cause: "conflict", conflicts: ["a.ts"] });
    expect(nextStep(fail, false, lands(2, { conflicts: ["a.ts"] }))).toBe("worker");
    expect(afterLand(fail, lands(3, { conflicts: ["a.ts"] }))).toBeUndefined();
    const { note, merge } = nextBrief(folder("bounce"), fail);
    expect(merge).toBe(true);
    expect(note).toContain("The land conflicted with origin/main in: a.ts");
  });

  test("a branch that changes the list goes back with its own note, and not as a merge run", () => {
    const fail = run({ role: "land", state: "failed", cause: "other", conflicts: ["docs/todo.md"] });
    expect(afterLand(fail, [fail])).toBe("worker");
    const { note, merge } = nextBrief(folder("other"), fail);
    expect(merge).toBe(false);
    expect(note).toContain("Only aleph issue writes the list");
  });

  test("a land that lost a race lands again at most three times; a landed or check-failed land starts nothing", () => {
    const moved = run({ role: "land", state: "failed", cause: "moved" });
    expect(afterLand(moved, lands(3, { cause: "moved" }))).toBe("land");
    expect(afterLand(moved, lands(4, { cause: "moved" }))).toBeUndefined();
    expect(afterLand(run({ role: "land", state: "landed" }), [])).toBeUndefined();
    expect(afterLand(run({ role: "land", state: "failed", cause: "check" }), [])).toBeUndefined();
  });
});

describe("rescue of a stuck or failed run", () => {
  test("no commit and a question asks Chris and waits for a spec edit, whatever else holds", () => {
    const r = run({ state: "failed", cause: "no-commit" });
    expect(askedQuestion({ ...r, question: "which clause wins?" })).toBe("which clause wins?");
    expect(askedQuestion(r)).toBeNull();
    expect(askedQuestion(run({ cause: "check", question: "x" }))).toBeNull();
    expect(questionOf("  QUESTION: a\nQUESTION: b ")).toBe("b");
    expect(questionOf("QUESTION: a\n**QUESTION: b**\nquestion: c")).toBe("b");
  });

  test("already met: on main or done is a duplicate; a worker's claim is checked on main", () => {
    const r = run({ state: "failed", cause: "no-commit" });
    expect(rescueCase(r, true, "evidence")).toBe("duplicate");
    expect(rescueCase(r, false, "evidence")).toBe("claimed");
    expect(rescueCase(r, false, null)).toBe("no-commit");
    const s = stuck({ cause: "no-commit" });
    expect(duplicateStep(s, "abc1234")).toMatchObject({ action: "drop", done: true, fate: "met" });
    expect(duplicateStep(s, null)).toMatchObject({ action: "drop", done: false, fate: "met" });
    expect(claimStep(s, "foo.ts:3", null)).toMatchObject({ action: "drop", done: true, fate: "met" });
    const red = claimStep(s, "foo.ts:3", "tests fail");
    expect(red.rerun).toContain("but the checks do not pass on origin/main (tests fail)");
    expect(red.done).toBeUndefined();
  });

  test("the other safe cases, and none for the rest", () => {
    expect(rescueCase(run({ cause: "timeout" }), false, null)).toBe("timeout");
    expect(rescueCase(run({ role: "land", cause: "timeout" }), false, null)).toBeNull();
    expect(rescueCase(run({ cause: "infra" }), false, null)).toBe("infra");
    expect(rescueCase(run({ cause: "locked" }), false, null)).toBe("infra");
    expect(rescueCase(run({ role: "land", cause: "conflict" }), false, null)).toBe("land-conflict");
    expect(rescueCase(run({ role: "land", cause: "check" }), false, null)).toBe("land-checks");
    expect(rescueCase(run({ role: "land", cause: "check", conflicts: ["a"] }), false, null)).toBeNull();
    expect(rescueCase(run({ cause: "check" }), false, null)).toBeNull();
  });

  test("each step: a killed run, an infra failure, a land conflict, and a run with nothing to keep", () => {
    expect(killedStep(stuck({ role: "land" }), false).action).toBe("land again");
    expect(killedStep(stuck({ role: "build" }), true).action).toBe("recheck");
    expect(killedStep(stuck({ role: "build" }), false)).toMatchObject({ action: "drop" });
    expect(killedStep(stuck({ role: "build" }), false).rerun).toBeUndefined();
    expect(infraStep(stuck({ role: "land" }), false).action).toBe("land again");
    expect(infraStep(stuck({ role: "build" }), true).action).toBe("recheck");
    expect(infraStep(stuck({ role: "build", reason: "fetch failed" }), false).rerun).toBe("The last run failed before it made a branch: fetch failed.");
    expect(conflictStep(stuck({ role: "land", conflicts: ["a.ts"] }), "abc fix a").rerun).toContain("merge conflict in a.ts, last changed on main by abc fix a");
    folder("r-nc", { "result.md": "line 1\nline 2\n" });
    expect(rerunStep(stuck({ cause: "no-commit" }, "r-nc"), "no-commit").rerun).toBe("The last run made no commit. The last 20 lines of its result.md:\n\n```\nline 1\nline 2\n```");
    expect(rerunStep(stuck({ role: "land", cause: "check", reason: "tests" }, "r-none"), "land-checks").rerun).toContain("its checks log:\n\n```\n(empty)\n```");
  });
});

describe("the issue's brief", () => {
  test("the rerun note goes in once under its own heading; drops come newest first", () => {
    const item = { title: "Do it", spec: "The spec.\n", notes: ["- a note"] };
    const dropped = (reason: string): Entry[] => [entry(`d-${reason}`, { name: "issue.7", state: "dropped", reason })];
    expect(issueBrief(item, "issue.7", [])).toEqual({ spec: "# Do it\n\nThe spec.\n\n## Notes on the issue\n\n- a note\n", rerun: false });
    writeRerun("issue.7", "The last run made no commit.");
    const b = issueBrief(item, "issue.7", [dropped("first"), dropped("second")]);
    expect(b.rerun).toBe(true);
    expect(b.spec).toContain("## Reasons of the earlier drops, newest first\n\n- second\n- first\n");
    expect(b.spec).toEndWith("## Note on the last run\n\nThe last run made no commit.\n");
    clearRerun("issue.7");
    expect(issueBrief(item, "issue.7", []).rerun).toBe(false);
  });
});

describe("the worker brief", () => {
  test("a sandbox repo's brief carries the write-code method as text; the fixed brief does not", () => {
    const first = jobWith({}, { "spec.md": "# Spec\n" });
    const r = run({ job: first.id, worktree: "/w", branch: "factory/fac-1" });
    const sandboxed = brief(first.id, r, { ...repo, sandbox: true } as Repo);
    expect(sandboxed).toContain("follow the write-code method at the end of this brief");
    expect(sandboxed).toContain("link it from the repo's main checkout path");
    expect(sandboxed).toContain("do not run the full\nsuite again to get a clean run");
    expect(sandboxed).toContain("do not add a test for a helper that the\nexisting tests already reach");
    expect(sandboxed).toContain("## Code-change method\n\nAdapted from karpathy-guidelines");
    expect(sandboxed).not.toContain("name: write-code");
    expect(sandboxed).not.toContain("Skill tool");
    expect(sandboxed).toMatch(/\]\(\/[^)]*\/skills\/diagnosing-bugs\/SKILL\.md\)/);
    expect(sandboxed).not.toContain("](../");
    expect(brief(first.id, r, repo)).not.toContain("write-code");
  });

  test("an issue's brief has the worker search past work for its title; a spec with no title gets no search", () => {
    const jp = jobWith({}, { "spec.md": "# Retry the land push\n\n## Goal\n\nx\n" });
    const b = brief(jp.id, run({ job: jp.id }), repo);
    expect(b).toContain("## Past work\n\nBefore you plan, run `aleph memory recall --episodes 'Retry the land push'` as it stands, with no pipe.");
    const jq = jobWith({}, { "spec.md": "## Goal\n\nx\n" });
    expect(brief(jq.id, run({ job: jq.id }), repo)).not.toContain("## Past work");
  });

  test("a merge run's brief lets the worker update the branch's change where main moved what it cites", () => {
    const jm = jobWith();
    const r = run({ job: jm.id, merge: true, conflicts: ["a.ts"] });
    const b = brief(jm.id, r, { ...repo, path: dir });
    expect(b).toContain("Where a commit from origin/main that you merge moves or renames what this job's change cites or depends on, update this job's change to match.");
    expect(b).toContain("Your final message names each such update.");
    expect(b).toContain("Do not start other work.");
  });

  test("a merge run's brief lists a conflicted path with no last commit when git log fails", () => {
    const notGit = join(dir, "not-git");
    mkdirSync(notGit, { recursive: true });
    const jm = jobWith();
    const b = brief(jm.id, run({ job: jm.id, merge: true, conflicts: ["a.ts"] }), { ...repo, path: notGit });
    expect(b).toContain("Conflicted paths:\n- a.ts\n");
    expect(b).not.toContain("fatal");
    expect(b).not.toContain("last commit on");
  });

  test("a factory brief names the job's worktree and branch, and says Chrome runs there", () => {
    const jw = jobWith({}, { "spec.md": "# Spec\n\n## Edit surface\n\n- ui/views/issues.js\n" });
    const r = run({ job: jw.id, worktree: "/w", branch: "factory/fac-1" });
    const b = brief(jw.id, r, { ...repo, sandbox: true } as Repo);
    expect(b).toContain("in `/w`, branch `factory/fac-1`.\nWork only there.");
    expect(b).toContain("Chrome is at `/usr/bin/google-chrome`. The tests that start Chrome run only with `ALEPH_BROWSER_TESTS=1` (`bun run test:all` sets it); a plain `bun test` skips them, and the factory's checks set it.");
    expect(b).toContain("`google-chrome --headless=new --password-store=basic --window-size=1440,900 --screenshot=<out.png> <url>`");
    expect(b).not.toContain("`google-chrome --headless=new --window-size=1440,900 --screenshot=<out.png> <url>`");
    expect(b).not.toContain("sandbox");
  });

});
