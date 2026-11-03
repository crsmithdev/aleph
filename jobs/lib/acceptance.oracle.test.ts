// Acceptance of a done goal whose Oracle command runs: the pass, its note and archive, and a result reused on one commit.
import { expect, test } from "bun:test";
import { writeHidden } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { archiveOracle, unshown } from "./acceptance.ts";
import { loadRegistry } from "./ledger.ts";
import { resultLine } from "./status.ts";
import { acceptanceStep } from "./factory.ts";
import { doneGoal, item, notes, ran, repoDir, runner, sh, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

test("a run with exit 0 whose bun test summary reports failures fails; with 0 fail it passes", async () => {
  const id = doneGoal("`for i in 1 2; do bun test x & done; wait`");
  await acceptanceStep(runner(0, "bun test\n 3 pass\n 1 fail\nRan 4 tests"));
  expect(notes(id)).toContain("acceptance: fail at");
  expect(issues.status(item(id))).toBe("open");
  expect(resultLine("fac", id)).toContain("fail");
  const id2 = doneGoal("`bun test x`");
  await acceptanceStep(runner(0, "bun test\n 4 pass\n 0 fail\nRan 4 tests"));
  expect(notes(id2)).toContain("acceptance: pass at");
});

test("a done goal whose Oracle command passes gets the pass note and stays done", async () => {
  const id = doneGoal("`bun test jobs/lib/acceptance.test.ts`");
  const sha = sh(repoDir(), "git", "rev-parse", "--short=7", "origin/main");
  const lines = await acceptanceStep(runner(0));
  expect(ran).toEqual(["bun test jobs/lib/acceptance.test.ts"]);
  expect(lines).toEqual([`fac-${id}: acceptance passed at ${sha}`]);
  expect(notes(id)).toContain(`acceptance: pass at ${sha}`);
  expect(issues.status(item(id))).toBe("done");
  expect(resultLine("fac", id)).toBe(`acceptance: pass at ${sha}`);
  expect(unshown()).toEqual([`fac-${id} acceptance: pass at ${sha}`]);
  expect(unshown()).toEqual([]);
  // Once: a second step runs nothing.
  await acceptanceStep(runner(0));
  expect(ran.length).toBe(1);
});

test("a pass copies the goal's hidden tests to acceptance/<name>/ on main in a commit of its own, once", async () => {
  const id = doneGoal("`bun test jobs/lib/acceptance.test.ts`");
  writeHidden({ key: "fac" }, id, {
    "x.test.ts": 'import { a } from "../jobs/lib/a.ts";\nconst p = join(import.meta.dir, "..", "jobs");\n',
    "scenarios.md": "1. It works.\n",
  });
  const landed = sh(repoDir(), "git", "rev-parse", "origin/main");
  const lines = await acceptanceStep(runner(0), undefined, async () => ({ output: "CHECK: pass scenario 1: ok" }));
  const head = sh(repoDir(), "git", "rev-parse", "--short=7", "origin/main");
  expect(lines[0]).toContain(`acceptance passed at ${landed.slice(0, 7)}; oracle archived as ${head}`);
  expect(sh(repoDir(), "git", "rev-parse", "origin/main~1")).toBe(landed);
  expect(sh(repoDir(), "git", "ls-tree", "-r", "--name-only", "origin/main", "acceptance")).toBe(`acceptance/fac-${id}/x.accept.ts`);
  expect(sh(repoDir(), "git", "show", `origin/main:acceptance/fac-${id}/x.accept.ts`)).toBe(
    '// @ts-nocheck\nimport { a } from "../../jobs/lib/a.ts";\nconst p = join((import.meta.dir + "/.."), "..", "jobs");');
  expect(sh(repoDir(), "git", "log", "-1", "--format=%(trailers:key=Issue,valueonly)", "origin/main")).toBe("");
  // The main checkout follows.
  expect(sh(repoDir(), "git", "rev-parse", "--short=7", "HEAD")).toBe(head);
  expect(archiveOracle(loadRegistry().fac, `fac-${id}`)).toBeNull();
  expect(sh(repoDir(), "git", "rev-parse", "--short=7", "origin/main")).toBe(head);
});

test("a command that passed on a commit does not run again for another goal; a new commit runs it", async () => {
  const a = doneGoal("`bun test jobs/lib/acceptance.test.ts`");
  const b = doneGoal("`bun test jobs/lib/acceptance.test.ts`");
  const sha = sh(repoDir(), "git", "rev-parse", "--short=7", "origin/main");
  const lines = await acceptanceStep(runner(0));
  expect(ran).toEqual(["bun test jobs/lib/acceptance.test.ts"]);
  expect(lines).toEqual([`fac-${a}: acceptance passed at ${sha}`, `fac-${b}: acceptance passed at ${sha}`]);
  const c = doneGoal("`bun test jobs/lib/acceptance.test.ts`");
  sh(repoDir(), "git", "commit", "-q", "--allow-empty", "-m", "next");
  sh(repoDir(), "git", "push", "-q", "origin", "main");
  await acceptanceStep(runner(0));
  expect(ran.length).toBe(2);
  expect(issues.status(item(c))).toBe("done");
});

test("a failure is not reused: a second goal runs the command itself", async () => {
  doneGoal("`bun test jobs/lib/acceptance.test.ts`");
  doneGoal("`bun test jobs/lib/acceptance.test.ts`");
  process.env.ALEPH_QUIET_LOAD = "-1";
  await acceptanceStep(runner(3, "boom"));
  expect(ran.length).toBe(2);
});
