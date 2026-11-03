import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ChecksStop } from "./checks.ts";
import {
  afterLand, askedQuestion, backCheck, checkBack, claimStep, clearRerun, conflictStep, duplicateStep, earlierRounds, goalBrief,
  infraStep, killedStep, nextBrief, nextStep, questionOf, repeatedHidden, rerunStep, rescueCase, reviewHold, writeRerun, type Stuck,
} from "./continuation.ts";
import type { Entry, Repo, Run } from "./ledger.ts";

const dir = mkdtempSync(join(tmpdir(), "continuation-"));
const saved = { jobs: process.env.ALEPH_JOBS_DIR, factory: process.env.ALEPH_FACTORY_DIR };
beforeAll(() => {
  process.env.ALEPH_JOBS_DIR = join(dir, "runs");
  process.env.ALEPH_FACTORY_DIR = join(dir, "factory");
});
afterAll(() => {
  for (const [k, v] of [["ALEPH_JOBS_DIR", saved.jobs], ["ALEPH_FACTORY_DIR", saved.factory]] as const) {
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

const run = (r: Partial<Run>): Run => ({ kind: "build", job: "j1", name: "fac-1", condition: "stuck", started: "2026-11-01T00:00:00Z", ...r } as Run);
const entry = (id: string, r: Partial<Run>): Entry => ({ id, folder: join(dir, "runs", id), run: run(r) });
const folder = (id: string, files: Record<string, string> = {}): string => {
  const f = join(dir, "runs", id);
  mkdirSync(f, { recursive: true });
  for (const [name, text] of Object.entries(files)) writeFileSync(join(f, name), text);
  return f;
};
const repo = { key: "fac", path: "/nowhere", main: "main" } as Repo;
const stuck = (r: Partial<Run>, id = "r9"): Stuck => ({ last: entry(id, r), r: run(r), repo, reason: r.reason ?? "why" });

describe("next step after a build or recheck", () => {
  test("a pass lands when the run asked to land or the repo lands by itself, else nothing starts", () => {
    expect(nextStep(run({ condition: "passed", land: true }), false)).toBe("land");
    expect(nextStep(run({ condition: "passed" }), true)).toBe("land");
    expect(nextStep(run({ condition: "passed" }), false)).toBeUndefined();
    expect(nextStep(run({ kind: "recheck", condition: "passed" }), true)).toBe("land");
    expect(nextStep(run({ condition: "stuck" }), true)).toBeUndefined();
  });

  test("a check fail under the fix-round cap goes back to the worker with the check's log as its note", () => {
    const stop: ChecksStop = { cause: "check", checkName: "tests", reason: "tests failed" };
    const check = backCheck(stop, "tests")!;
    expect(check).toBe("tests");
    const fields = checkBack([run({ failed: "tests" })], check, stop.reason, 2);
    expect(fields).toEqual({ failed: "tests", round: 1 });
    const ended = run({ condition: "stuck", ...stop, ...fields });
    expect(nextStep(ended, false)).toBe("worker");
    const f = folder("check-fail", { "checks.log": "## lint: exit 0\nok\n## tests: exit 1\n$ bun test\n(fail) a > b\n" });
    const { note, merge } = nextBrief(f, ended);
    expect(note).toContain("The check `tests` failed on this branch");
    expect(note).toContain("(fail) a > b");
    expect(note).not.toContain("lint");
    expect(merge).toBe(false);
  });

  test("the cap reached: the run stays stuck, its reason counts the rounds; a cap of 0 adds nothing; a recheck has no rounds", () => {
    const fields = checkBack([run({ failed: "tests" }), run({ failed: "tests" })], "tests", "tests failed", 2);
    expect(fields).toEqual({ reason: "tests failed after 2 fix rounds" });
    expect(nextStep(run({ condition: "stuck", ...fields }), true)).toBeUndefined();
    expect(checkBack([], "tests", "tests failed", 0)).toEqual({});
    expect(checkBack(undefined, "oracle", "oracle failed: x", 2)).toEqual({});
  });

  test("only the failed check's own stop goes back: a time-out or another check's stop does not", () => {
    expect(backCheck({ cause: "check", checkName: "tests", reason: "x", timedOut: true }, "tests")).toBeNull();
    expect(backCheck({ cause: "check", checkName: "lint", reason: "x" }, "tests")).toBeNull();
    expect(backCheck({ cause: "check", checkName: "tests", reason: "x" }, undefined)).toBeNull();
    expect(backCheck({ cause: "hidden-check", reason: "x" }, "hidden")).toBe("hidden");
    expect(backCheck({ cause: "infra", reason: "x" }, "hidden")).toBeNull();
  });

  test("a reviewer hold goes back to the worker with the reviewer's reason while rounds are left", () => {
    expect(reviewHold([], "reviewer: no test", 2)).toEqual({ round: 0 });
    const ended = run({ condition: "stuck", cause: "reviewer", reason: "reviewer: no test", failed: "review", round: 0 });
    expect(nextStep(ended, false)).toBe("worker");
    expect(nextBrief(folder("review-back"), ended).note).toBe("The reviewer sent this branch back: reviewer: no test\n\nFix what it names, run the tests, and commit.");
  });

  test("a reviewer hold after the last round waits for Chris, and says how often it went back", () => {
    const earlier = [run({ failed: "review" }), run({ failed: "tests" })];
    expect(reviewHold(earlier, "reviewer: still no test", 2)).toEqual({ reason: "the reviewer sent it back once: still no test", back: 1 });
    expect(reviewHold([run({ failed: "tests" }), run({ failed: "tests" })], "reviewer: x", 2)).toEqual({ reason: "reviewer: x", back: 0 });
    expect(reviewHold(undefined, "reviewer: x", 2)).toEqual({ reason: "reviewer: x", back: 0 });
  });

  test("a failed hidden check's note names the failing tests and never their source", () => {
    const f = folder("hidden-1", { "hidden.log": "SECRET source line\n(fail) suite > one [3.00ms]\n(pass) suite > two\n" });
    const note = nextBrief(f, run({ failed: "hidden", reason: "hidden: 1 of 2 failed" })).note;
    expect(note).toContain("hidden: 1 of 2 failed");
    expect(note).toContain("- suite > one");
    expect(note).not.toContain("SECRET");
  });

  test("the same hidden failure on two runs in a row asks instead of a third round", () => {
    folder("hidden-prev", { "hidden.log": "boom\n(fail) suite > one\n" });
    const now = folder("hidden-now", { "hidden.log": "boom again\n(fail) suite > one\n" });
    const same = repeatedHidden(now, [entry("hidden-prev", { failed: "hidden" })]);
    expect(same?.names).toEqual(["suite > one"]);
    expect(same?.question).toContain("failed the same way on two runs in a row");
    expect(repeatedHidden(now, [entry("hidden-prev", { failed: "tests" })])).toBeNull();
    const other = folder("hidden-other", { "hidden.log": "(fail) suite > two\n" });
    expect(repeatedHidden(other, [entry("hidden-prev", { failed: "hidden" })])).toBeNull();
  });

  test("the fix rounds are the job's other build runs that were sent back", () => {
    const job = [entry("a", { failed: "tests" }), entry("b", { kind: "land", failed: "tests" }), entry("c", {}), entry("d", { failed: "review" })];
    expect(earlierRounds(job, "d").map((e) => e.id)).toEqual(["a"]);
  });
});

describe("next step after a land", () => {
  const lands = (n: number, r: Partial<Run>) => Array.from({ length: n }, () => run({ kind: "land", condition: "failed", ...r }));

  test("a conflict goes back to the worker as a merge run at most twice", () => {
    const fail = run({ kind: "land", condition: "failed", cause: "conflict", conflicts: ["a.ts"] });
    expect(nextStep(fail, false, lands(2, { conflicts: ["a.ts"] }))).toBe("worker");
    expect(afterLand(fail, lands(3, { conflicts: ["a.ts"] }))).toBeUndefined();
    const { note, merge } = nextBrief(folder("bounce"), fail);
    expect(merge).toBe(true);
    expect(note).toContain("The land conflicted with origin/main in: a.ts");
  });

  test("a branch that changes the list goes back with its own note, and not as a merge run", () => {
    const fail = run({ kind: "land", condition: "failed", cause: "own-list", conflicts: ["docs/todo.md"] });
    expect(afterLand(fail, [fail])).toBe("worker");
    const { note, merge } = nextBrief(folder("own-list"), fail);
    expect(merge).toBe(false);
    expect(note).toContain("Only aleph issue writes the list");
  });

  test("a land that lost a race lands again at most three times; a landed or check-failed land starts nothing", () => {
    const moved = run({ kind: "land", condition: "failed", cause: "moved" });
    expect(afterLand(moved, lands(3, { cause: "moved" }))).toBe("land");
    expect(afterLand(moved, lands(4, { cause: "moved" }))).toBeUndefined();
    expect(afterLand(run({ kind: "land", condition: "landed" }), [])).toBeUndefined();
    expect(afterLand(run({ kind: "land", condition: "failed", cause: "check" }), [])).toBeUndefined();
  });
});

describe("rescue of a stuck or failed run", () => {
  test("no commit and a QUESTION asks Chris and waits for a spec edit, whatever else holds", () => {
    const r = run({ condition: "stuck", cause: "no-commit" });
    expect(askedQuestion(r, "did things\nQUESTION: which clause wins?\n")).toBe("which clause wins?");
    expect(askedQuestion({ ...r, question: "from the run" }, "QUESTION: from the log")).toBe("from the run");
    expect(askedQuestion(r, "QUESTION:")).toBe("");
    expect(askedQuestion(r, "no question here")).toBeNull();
    expect(askedQuestion(run({ cause: "check" }), "QUESTION: x")).toBeNull();
    expect(questionOf("  QUESTION: a\nQUESTION: b ")).toBe("b");
  });

  test("already met: on main or done is a duplicate; a worker's claim is checked on main", () => {
    const r = run({ condition: "stuck", cause: "no-commit" });
    expect(rescueCase(r, true, "evidence")).toBe("duplicate");
    expect(rescueCase(r, false, "evidence")).toBe("claimed");
    expect(rescueCase(r, false, null)).toBe("no-commit");
    const s = stuck({ cause: "no-commit" });
    expect(duplicateStep(s, "abc1234")).toMatchObject({ action: "drop", done: true, fate: "already-met" });
    expect(duplicateStep(s, null)).toMatchObject({ action: "drop", done: false, fate: "already-met" });
    expect(claimStep(s, "foo.ts:3", null)).toMatchObject({ action: "drop", done: true, fate: "already-met" });
    const red = claimStep(s, "foo.ts:3", "tests fail");
    expect(red.rerun).toContain("but the checks do not pass on origin/main (tests fail)");
    expect(red.done).toBeUndefined();
  });

  test("the other safe cases, and none for the rest", () => {
    expect(rescueCase(run({ cause: "time-box" }), false, null)).toBe("time-box");
    expect(rescueCase(run({ kind: "land", cause: "time-box" }), false, null)).toBeNull();
    expect(rescueCase(run({ cause: "infra" }), false, null)).toBe("infra");
    expect(rescueCase(run({ cause: "lock-busy" }), false, null)).toBe("infra");
    expect(rescueCase(run({ kind: "land", cause: "conflict" }), false, null)).toBe("land-conflict");
    expect(rescueCase(run({ kind: "land", cause: "check" }), false, null)).toBe("land-checks");
    expect(rescueCase(run({ kind: "land", cause: "check", conflicts: ["a"] }), false, null)).toBeNull();
    expect(rescueCase(run({ cause: "check" }), false, null)).toBeNull();
  });

  test("each step: a killed run, an infra failure, a land conflict, and a run with nothing to keep", () => {
    expect(killedStep(stuck({ kind: "land" }), false).action).toBe("land again");
    expect(killedStep(stuck({ kind: "build" }), true).action).toBe("recheck");
    expect(killedStep(stuck({ kind: "build" }), false)).toMatchObject({ action: "drop" });
    expect(killedStep(stuck({ kind: "build" }), false).rerun).toBeUndefined();
    expect(infraStep(stuck({ kind: "land" }), false).action).toBe("land again");
    expect(infraStep(stuck({ kind: "build" }), true).action).toBe("recheck");
    expect(infraStep(stuck({ kind: "build", reason: "fetch failed" }), false).rerun).toBe("The last run failed before it made a branch: fetch failed.");
    expect(conflictStep(stuck({ kind: "land", conflicts: ["a.ts"] }), "abc fix a").rerun).toContain("merge conflict in a.ts, last changed on main by abc fix a");
    folder("r-nc", { "result.md": "line 1\nline 2\n" });
    expect(rerunStep(stuck({ cause: "no-commit" }, "r-nc"), "no-commit").rerun).toBe("The last run made no commit. The last 20 lines of its result.md:\n\n```\nline 1\nline 2\n```");
    expect(rerunStep(stuck({ kind: "land", cause: "check", reason: "tests" }, "r-none"), "land-checks").rerun).toContain("its checks.log:\n\n```\n(empty)\n```");
  });
});

describe("the goal's brief", () => {
  test("the rerun note goes in once under its own heading; drops come newest first", () => {
    const item = { title: "Do it", spec: "The spec.\n", notes: ["- a note"] };
    const dropped = (reason: string): Entry[] => [entry(`d-${reason}`, { name: "fac-7", condition: "dropped", reason })];
    expect(goalBrief(item, "fac-7", [])).toEqual({ spec: "# Do it\n\nThe spec.\n\n## Notes on the issue\n\n- a note\n", rerun: false });
    writeRerun("fac-7", "The last run made no commit.");
    const b = goalBrief(item, "fac-7", [dropped("first"), dropped("second")]);
    expect(b.rerun).toBe(true);
    expect(b.spec).toContain("## Reasons of the earlier drops, newest first\n\n- second\n- first\n");
    expect(b.spec).toEndWith("## Note on the last run\n\nThe last run made no commit.\n");
    clearRerun("fac-7");
    expect(goalBrief(item, "fac-7", []).rerun).toBe(false);
  });
});
