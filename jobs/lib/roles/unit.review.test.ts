// v6 phase 6: Verify as one station, and the reviewer's list of files outside the Edit surface.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "../gates/checks.ts";
import { nextBrief } from "../transitions/continuation.ts";
import { git } from "../../../lib/git.ts";
import { outsideSurface } from "./issue-spec.ts";
import { type Repo, type Run } from "../records/ledger.ts";
import { getRun } from "../records/record.ts";
import { logTo, readSection, runFile } from "../records/run-files.ts";
import { seed } from "../../job.testkit.ts";
import { branchPorts, reviewPrompt, workerVerdict } from "../gates/worker-verdict.ts";

let root = "";
let repo: Repo;
let folder = "", id = "", run: Run;
const saved = { ALEPH_JOBS_DIR: process.env.ALEPH_JOBS_DIR, ALEPH_DB: process.env.ALEPH_DB };
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
  process.env.ALEPH_JOBS_DIR = join(root, "jobs");
  process.env.ALEPH_DB = join(root, "aleph.db");
  const made = seed({ role: "build", name: "j1", state: "running", checks: [{ name: "test", ok: true, seconds: 1 }] });
  ({ folder, id, run } = made);
  writeFileSync(runFile(folder, "spec.md"), "## Oracle\n- `bun test x.test.ts` passes.\n");
});
afterEach(() => {
  rmSync(root, { recursive: true, force: true });
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
});

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
  const r = await verdict(async (_r, _s, command) => { phases.push(getRun(id)!.phase); report(command, PASS + FAIL); return { code: 1, output: "ORACLE-LOG" }; });
  expect(phases).toEqual(["verify", "verify"]);
  expect(r.outcome).toMatchObject({ state: "returned", cause: "check", checkName: "oracle", failed: "oracle", round: 0 });
  const tests = { ran: 2, passed: 1, failed: 1, skipped: 0, failures: [{ file: "x.test.ts", name: "bad", message: "Error: ORACLE-BOOM\n  at x.test.ts:1" }] };
  expect(getRun(id)!.checks).toEqual([{ name: "test", ok: true, seconds: 1 }, { name: "oracle", ok: false, seconds: expect.any(Number), tests }]);
  expect(readSection(folder, "checks")).toContain("## oracle: exit 1 (second run)\n$ bun test x.test.ts\nORACLE-LOG");
  const note = nextBrief(folder, { ...getRun(id)!, ...r.outcome } as Run).note;
  expect(note).toContain("The check `oracle` failed on this branch. Its failed tests:\n\n- x.test.ts > bad\n    Error: ORACLE-BOOM");
  expect(note).not.toContain("ORACLE-LOG");
});

test("an Oracle that fails once and then passes is one passing oracle result with rerun", async () => {
  let n = 0;
  const r = await verdict(async (_r, _s, command) => { report(command, PASS); return { code: n++ === 0 ? 1 : 0, output: "" }; });
  expect(r.outcome.state).toBe("passed");
  expect(getRun(id)!.checks!.at(-1)).toEqual({ name: "oracle", ok: true, seconds: expect.any(Number), rerun: true, tests: { ran: 1, passed: 1, failed: 0, skipped: 0, failures: [] } });
});

test("an Oracle command with no verdict (timed out) is an infra stop with a noVerdict oracle result, not a pass", async () => {
  const r = await verdict(async () => ({ code: 124, output: "timed out after 1200 s", infra: true }));
  expect(r.outcome).toMatchObject({ state: "failed", cause: "infra", checkName: "oracle", reason: "no verdict: oracle: bun test x.test.ts" });
  expect(r.outcome.failed).toBeUndefined();
  expect(getRun(id)!.checks!.at(-1)).toEqual({ name: "oracle", ok: false, seconds: expect.any(Number), noVerdict: true });
  expect(readSection(folder, "checks")).toContain("## oracle: no verdict\n$ bun test x.test.ts\ntimed out after 1200 s");
});

test("an Oracle `bun test` that runs 0 tests fails", async () => {
  const r = await verdict(async () => ({ code: 0, output: "" }));
  expect(r.outcome).toMatchObject({ state: "returned", checkName: "oracle", reason: "oracle ran 0 tests: bun test x.test.ts" });
});

test("a checks failure is the Verify result too: the next brief names the check and quotes its block of the checks section", () => {
  logTo(folder, "checks", "## test: exit 1\nCHECK-BOOM\n\n## oracle: exit 0\n$ bun test x.test.ts\nfine\n\n");
  const note = nextBrief(folder, { ...run, state: "returned", cause: "check", checkName: "test", failed: "test" } as Run).note;
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

/** Main gets `x.test.ts`; `work` edits it. The spec's Edit surface is `surface`. Returns the verdict with a runner that passes. */
const pinVerdict = (surface: string) => {
  git(repo.path, "switch", "-q", "main");
  commit(repo.path, "x.test.ts", "1\n", "test on main");
  git(repo.path, "switch", "-q", "work");
  git(repo.path, "rebase", "-q", "main");
  commit(repo.path, "x.test.ts", "2\n", "weaken");
  git(repo.path, "switch", "-q", "main");
  writeFileSync(runFile(folder, "spec.md"), `## Edit surface\n- ${surface}\n\n## Oracle\n- \`bun test ./x.test.ts\` passes.\n`);
  const base = git(repo.path, "rev-parse", "main").out;
  const ports = { ...branchPorts(folder, run, repo, base, "work", { changed: ["x.test.ts"], runner: async (_r, _s, c) => { report(c, PASS); return { code: 0, output: "" }; }, review: async () => ({ reason: null }) }), checks: async () => ({ stop: null }) };
  return workerVerdict({ earlier: [], done: 0, rounds: 2, facts: {}, checked: {} }, ports);
};

test("a branch that edits an Oracle file on main outside the Edit surface fails oracle-pin and names the file", async () => {
  git(repo.path, "branch", "-f", "work", "main");
  const r = await pinVerdict("job.txt");
  expect(r.outcome).toMatchObject({ state: "returned", checkName: "oracle", reason: expect.stringContaining("oracle-pin: the branch edits a file the Oracle runs, outside the Edit surface: x.test.ts") });
  expect(getRun(id)!.checks!.at(-1)).toEqual({ name: "oracle-pin", ok: false, seconds: 0 });
});

test("an edit of an Oracle file that the Edit surface names passes the pin", async () => {
  git(repo.path, "branch", "-f", "work", "main");
  const r = await pinVerdict("x.test.ts");
  expect(r.outcome.state).not.toBe("returned");
  expect(getRun(id)!.checks!.map((c) => c.name)).not.toContain("oracle-pin");
});

test("the reviewer call carries the new tests that pass on the base, and the run is not stopped by them", async () => {
  git(repo.path, "switch", "-q", "work");
  commit(repo.path, "x.test.ts", `test("adds", () => {});\n`, "a new test");
  git(repo.path, "switch", "-q", "main");
  const cases = `<testsuites><testsuite name="x.test.ts" file="x.test.ts"><testcase name="adds" file="x.test.ts" /></testsuite></testsuites>`;
  const runner: Runner = async (_r, _s, command) => {
    if (!command.includes(".keep-gate.xml")) { report(command, PASS); return { code: 0, output: "" }; }
    return { code: 0, output: cases };
  };
  let keep: string[] | null | undefined;
  const base = git(repo.path, "rev-parse", "main").out;
  const review = async (...args: unknown[]) => { keep = args[8] as string[] | null; return { reason: null }; };
  const ports = { ...branchPorts(folder, run, repo, base, "work", { changed: ["x.test.ts"], runner, review }), checks: async () => ({ stop: null }) };
  const r = await workerVerdict({ earlier: [], done: 0, rounds: 2, facts: {}, checked: {} }, ports);
  expect(keep).toEqual(["x.test.ts > adds"]);
  expect(r.outcome.state).toBe("passed");
  expect(readSection(folder, "checks")).toContain("## keep-gate: new tests that pass on the base commit\n- x.test.ts > adds");
});
