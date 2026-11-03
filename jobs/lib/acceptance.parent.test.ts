// A repeat in a test the goal did not touch: acceptance runs it at the goal's parent and at its newest commit.
import { expect, test } from "bun:test";
import * as issues from "../../todo/lib/todo.ts";
import type { Runner } from "./checks.ts";
import { acceptanceStep } from "./factory.ts";
import { doneGoal, flakeNotes, item, landFile, notes, parentOf, ran, repoDir, RERUN_FAIL, runner, sh, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

test("a repeat in an untouched file that passes at the goal's parent and fails at its newest commit reopens the goal", async () => {
  const id = doneGoal("`bun run test`");
  landFile(id, "c.ts");
  const parent = parentOf(id);
  const at: string[] = [];
  const r: Runner = async (_repo, sha, command) => { ran.push(command); at.push(sha); return command === "bun run test" || sha !== parent ? RERUN_FAIL : { code: 0, output: "" }; };
  await acceptanceStep(r);
  expect(at).toContain(parent);
  expect(issues.status(item(id))).toBe("open");
  expect(notes(id)).toContain("acceptance: fail at");
});

test("a repeat in an untouched file that also fails at the parent goes to the flake list, and the goal passes", async () => {
  const id = doneGoal("`bun run test`");
  landFile(id, "c.ts");
  const lines = await acceptanceStep(runner(1, RERUN_FAIL.output));
  expect(lines[0]).toContain("acceptance passed");
  expect(issues.status(item(id))).toBe("done");
  expect(flakeNotes()).toContain("jobs/lib/acceptance.test.ts > one: failed twice, in a test the goal did not touch, and also at the goal's parent");
});

test("a repeat in an untouched file that passes at the goal's newest commit goes to the flake list, and the goal passes", async () => {
  const id = doneGoal("`bun run test`");
  landFile(id, "c.ts");
  const newest = sh(repoDir(), "git", "rev-parse", "origin/main");
  sh(repoDir(), "git", "commit", "-q", "--allow-empty", "-m", "later");
  sh(repoDir(), "git", "push", "-q", "origin", "main");
  const r: Runner = async (_repo, sha, command) => { ran.push(command); return sha === newest ? { code: 0, output: "" } : RERUN_FAIL; };
  const lines = await acceptanceStep(r);
  expect(lines[0]).toContain("acceptance passed");
  expect(issues.status(item(id))).toBe("done");
  expect(flakeNotes()).toContain("and passed at the goal's newest commit");
});
