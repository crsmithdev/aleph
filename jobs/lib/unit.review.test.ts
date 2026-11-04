// v6 phase 6: Verify as one station, the reviewer's list of files outside the Edit surface, and a merge run's review of the merge commit only.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Runner } from "./checks.ts";
import { nextBrief } from "./continuation.ts";
import { git } from "./git.ts";
import { outsideSurface } from "./goal-spec.ts";
import { readRun, type Repo, type Run } from "./ledger.ts";
import { branchPorts, reviewDiff, reviewPrompt, reviewRange } from "./unit.ts";
import { workerVerdict } from "./worker-verdict.ts";

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
  writeFileSync(join(folder, "state.json"), JSON.stringify(run));
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

/** The worker verdict on `work` with the checks passed, the Oracle on `runner` and a reviewer that passes. */
const verdict = (runner: Runner) => {
  const base = git(repo.path, "rev-parse", "main").out;
  const ports = { ...branchPorts("j1-run", folder, run, repo, root, base, "work", { changed: ["job.txt"], runner, review: async () => ({ reason: null }) }), checks: async () => ({ stop: null }) };
  return workerVerdict({ earlier: [], rounds: 2, facts: {}, checked: {} }, ports);
};

test("an Oracle failure is the Verify result: phase verify, one oracle result beside the checks, and the next brief has its log", async () => {
  const phases: (string | undefined)[] = [];
  const r = await verdict(async () => { phases.push(readRun(folder)!.phase); return { code: 1, output: "ORACLE-BOOM" }; });
  expect(phases).toEqual(["verify", "verify"]);
  expect(r.outcome).toMatchObject({ condition: "stuck", cause: "check", checkName: "oracle", failed: "oracle", round: 0 });
  expect(readRun(folder)!.checks).toEqual([{ name: "test", ok: true, seconds: 1 }, { name: "oracle", ok: false, seconds: expect.any(Number) }]);
  expect(readFileSync(join(folder, "checks.log"), "utf8")).toContain("## oracle: exit 1 (second run)\n$ bun test x.test.ts\nORACLE-BOOM");
  const note = nextBrief(folder, { ...run, ...r.outcome } as Run).note;
  expect(note).toContain("The check `oracle` failed on this branch.");
  expect(note).toContain("ORACLE-BOOM");
});

test("an Oracle that fails once and then passes is one passing oracle result with rerun", async () => {
  let n = 0;
  const r = await verdict(async () => ({ code: n++ === 0 ? 1 : 0, output: "" }));
  expect(r.outcome.condition).toBe("passed");
  expect(readRun(folder)!.checks!.at(-1)).toEqual({ name: "oracle", ok: true, seconds: expect.any(Number), rerun: true });
});

test("a checks failure is the Verify result too: the next brief names the check and quotes its section of checks.log", () => {
  writeFileSync(join(folder, "checks.log"), "## test: exit 1\nCHECK-BOOM\n\n## oracle: exit 0\n$ bun test x.test.ts\nfine\n\n");
  const note = nextBrief(folder, { ...run, condition: "stuck", cause: "check", checkName: "test", failed: "test" } as Run).note;
  expect(note).toContain("The check `test` failed on this branch.");
  expect(note).toContain("CHECK-BOOM");
  expect(note).not.toContain("fine");
});

test("outsideSurface lists the changed files the Edit surface does not name, and the reviewer prompt holds them", () => {
  const spec = "## Goal\nx\n\n## Edit surface\n- jobs/lib/unit.ts (the change)\n- ui/views/\n- docs\n\n## Oracle\nok\n";
  const files = ["jobs/lib/unit.ts", "ui/views/jobs.js", "docs/factory.md", "jobs/lib/gate.ts", "uix.ts"];
  expect(outsideSurface(spec, files)).toEqual(["jobs/lib/gate.ts", "uix.ts"]);
  expect(outsideSurface("## Goal\nno surface\n", files)).toEqual([]);
  const p = reviewPrompt("n", spec, "diff", [], "", { outside: outsideSurface(spec, files) });
  expect(p).toContain("## Changes outside the Edit surface");
  expect(p).toContain("- jobs/lib/gate.ts\n- uix.ts");
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
  expect(reviewPrompt("n", "goal", diff, [], "", { merge: true })).toContain("## The merge commit's conflict resolution");
  expect(reviewPrompt("n", "goal", diff, [])).toContain("## Diff from the merge base");
});

test("a merge run that made no merge commit reads the whole branch", () => {
  const base = git(repo.path, "rev-parse", "main").out;
  expect(reviewRange(repo.path, { ...run, merge: true }, base, "work")).toEqual({ from: base, to: "work", merge: false });
});
