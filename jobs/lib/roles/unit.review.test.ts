// v6 phase 6: Verify as one station, the reviewer's list of files outside the Edit surface, and a merge run's review of the merge commit only.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../gates/checks.ts";
import { nextBrief } from "../transitions/continuation.ts";
import { git } from "../infra/git.ts";
import { outsideSurface } from "./issue-spec.ts";
import { readRun, type Repo, type Run, writeRun } from "../records/ledger.ts";
import { branchPorts, reviewDiff, reviewPrompt, reviewRange } from "./unit.ts";
import { workerVerdict } from "../gates/worker-verdict.ts";

let root = "";
let repo: Repo;
let folder = "";
const run = { kind: "build", job: "j1", name: "j1", condition: "running", checks: [{ name: "test", ok: true, seconds: 1 }] } as Run;
const commit = (path: string, file: string, text: string, msg: string) => {
  mkdirSync(join(path, file, ".."), { recursive: true });
  writeFileSync(join(path, file), text);
  git(path, "add", "."); git(path, "commit", "-qm", msg);
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "unit-review-"));
  const path = join(root, "repo");
  mkdirSync(path);
  git(path, "init", "-q", "-b", "main");
  git(path, "config", "user.email", "a@b.c");
  git(path, "config", "user.name", "a");
  commit(path, "a.txt", "1\n", "one");
  git(path, "switch", "-q", "-c", "work");
  commit(path, "job.txt", "the job's change\n", "job");
  git(path, "switch", "-q", "main");
  repo = { key: "r", path, main: "main", setup: [], checks: [{ name: "test", run: "bun run test" }], manual: [], autoland: true, sandbox: true, held: [] } as unknown as Repo;
  mkdirSync(join(root, "j1"));
  folder = join(root, "j1-run");
  mkdirSync(folder);
  writeFileSync(join(root, "j1", "spec.md"), "## Oracle\n- `bun test x.test.ts` passes.\n");
  writeRun(join(folder), run as any);
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** The worker verdict on `work` with the checks passed, the Oracle on `runner` and a reviewer that passes. */
const verdict = (runner: Runner) => {
  const base = git(repo.path, "rev-parse", "main").out;
  const ports = { ...branchPorts(folder, run, repo, base, "work", { changed: ["job.txt"], runner, review: async () => ({ reason: null }) }), checks: async () => ({ stop: null }) };
  return workerVerdict({ earlier: [], done: 0, rounds: 2, facts: {}, checked: {} }, ports);
};

/** A fake `bun test` run: it writes `cases` (`<testcase>` elements of x.test.ts) as the JUnit report the command names. */
const report = (command: string, cases: string) =>
  writeFileSync(command.match(/--reporter-outfile='([^']+)'/)![1], `<testsuites><testsuite name="x.test.ts" file="x.test.ts">${cases}</testsuite></testsuites>`);
const PASS = `<testcase name="ok" file="x.test.ts" />`;
const FAIL = `<testcase name="bad" file="x.test.ts"><failure type="Error">Error: ORACLE-BOOM&#10;  at x.test.ts:1</failure></testcase>`;

test("an Oracle failure is the Verify result: phase verify, one oracle result with its test record beside the checks, and the next brief has its failed tests", async () => {
  const phases: (string | undefined)[] = [];
  const r = await verdict(async (_r, _s, command) => { phases.push(readRun(folder)!.phase); report(command, PASS + FAIL); return { code: 1, output: "ORACLE-LOG" }; });
  expect(phases).toEqual(["verify", "verify"]);
  expect(r.outcome).toMatchObject({ condition: "stuck", cause: "check", checkName: "oracle", failed: "oracle", round: 0 });
  const tests = { ran: 2, passed: 1, failed: 1, skipped: 0, failures: [{ file: "x.test.ts", name: "bad", message: "Error: ORACLE-BOOM\n  at x.test.ts:1" }] };
  expect(readRun(folder)!.checks).toEqual([{ name: "test", ok: true, seconds: 1 }, { name: "oracle", ok: false, seconds: expect.any(Number), tests }]);
  expect(readFileSync(join(folder, "checks.log"), "utf8")).toContain("## oracle: exit 1 (second run)\n$ bun test x.test.ts\nORACLE-LOG");
  const note = nextBrief(folder, { ...readRun(folder)!, ...r.outcome } as Run).note;
  expect(note).toContain("The check `oracle` failed on this branch. Its failed tests:\n\n- x.test.ts > bad\n    Error: ORACLE-BOOM");
  expect(note).not.toContain("ORACLE-LOG");
});

test("an Oracle that fails once and then passes is one passing oracle result with rerun", async () => {
  let n = 0;
  const r = await verdict(async (_r, _s, command) => { report(command, PASS); return { code: n++ === 0 ? 1 : 0, output: "" }; });
  expect(r.outcome.condition).toBe("passed");
  expect(readRun(folder)!.checks!.at(-1)).toEqual({ name: "oracle", ok: true, seconds: expect.any(Number), rerun: true, tests: { ran: 1, passed: 1, failed: 0, skipped: 0, failures: [] } });
});

test("an Oracle command with no verdict (timed out) is an infra stop with a noVerdict oracle result, not a pass", async () => {
  const r = await verdict(async () => ({ code: 124, output: "timed out after 1200 s", infra: true }));
  expect(r.outcome).toMatchObject({ condition: "stuck", cause: "infra", checkName: "oracle", reason: "no verdict: oracle: bun test x.test.ts" });
  expect(r.outcome.failed).toBeUndefined();
  expect(readRun(folder)!.checks!.at(-1)).toEqual({ name: "oracle", ok: false, seconds: expect.any(Number), noVerdict: true });
  expect(readFileSync(join(folder, "checks.log"), "utf8")).toContain("## oracle: no verdict\n$ bun test x.test.ts\ntimed out after 1200 s");
});

test("an Oracle `bun test` that runs 0 tests fails", async () => {
  const r = await verdict(async () => ({ code: 0, output: "" }));
  expect(r.outcome).toMatchObject({ condition: "stuck", checkName: "oracle", reason: "oracle ran 0 tests: bun test x.test.ts" });
});

test("a checks failure is the Verify result too: the next brief names the check and quotes its section of checks.log", () => {
  writeFileSync(join(folder, "checks.log"), "## test: exit 1\nCHECK-BOOM\n\n## oracle: exit 0\n$ bun test x.test.ts\nfine\n\n");
  const note = nextBrief(folder, { ...run, condition: "stuck", cause: "check", checkName: "test", failed: "test" } as Run).note;
  expect(note).toContain("The check `test` failed on this branch.");
  expect(note).toContain("CHECK-BOOM");
  expect(note).not.toContain("fine");
});

test("outsideSurface lists the changed files the Edit surface does not name, and the reviewer prompt holds them", () => {
  const spec = "## Goal\nx\n\n## Edit surface\n- jobs/lib/roles/unit.ts (the change)\n- ui/views/\n- docs\n\n## Oracle\nok\n";
  const files = ["jobs/lib/roles/unit.ts", "ui/views/jobs.js", "docs/factory.md", "jobs/lib/gates/gate.ts", "uix.ts"];
  expect(outsideSurface(spec, files)).toEqual(["jobs/lib/gates/gate.ts", "uix.ts"]);
  expect(outsideSurface("## Goal\nno surface\n", files)).toEqual([]);
  const p = reviewPrompt("n", spec, "diff", [], { outside: outsideSurface(spec, files) });
  expect(p).toContain("## Changes outside the Edit surface");
  expect(p).toContain("- jobs/lib/gates/gate.ts\n- uix.ts");
  expect(reviewPrompt("n", spec, "diff", [])).not.toContain("## Changes outside the Edit surface");
});

test("a merge run's reviewer reads only how the merge commit resolved its conflict; another run reads the whole branch", () => {
  const path = repo.path;
  commit(path, "main.txt", "main's change\n", "main moves");
  commit(path, "shared.txt", "main's line\n", "main edits shared");
  git(path, "switch", "-q", "work");
  commit(path, "shared.txt", "the job's line\n", "work edits shared");
  git(path, "merge", "-q", "--no-edit", "main");
  writeFileSync(join(path, "shared.txt"), "both lines, resolved\n");
  git(path, "add", "shared.txt");
  git(path, "commit", "-q", "--no-edit");
  git(path, "switch", "-q", "main");
  const base = git(path, "merge-base", "main", "work").out;
  const merge = reviewRange(path, { ...run, merge: true }, base, "work");
  expect(merge.merge).toBe(true);
  const diff = reviewDiff(path, merge, 1e6);
  expect(diff).toContain("+both lines, resolved");
  expect(diff).not.toContain("main's change");
  const whole = reviewRange(path, run, base, "work");
  expect(whole).toEqual({ from: base, to: "work", merge: false });
  expect(reviewDiff(path, whole, 1e6)).toContain("+the job's change");
  expect(reviewPrompt("n", "goal", diff, [], { merge: true })).toContain("## The merge commit's conflict resolution");
  expect(reviewPrompt("n", "goal", diff, [])).toContain("## Diff from the merge base");
});

test("a merge run that made no merge commit reads the whole branch", () => {
  const base = git(repo.path, "rev-parse", "main").out;
  expect(reviewRange(repo.path, { ...run, merge: true }, base, "work")).toEqual({ from: base, to: "work", merge: false });
});
