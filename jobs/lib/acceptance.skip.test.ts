// Acceptance of a done goal with no runnable Oracle command: a placeholder, a missing test file, no command, or no land on main.
import { expect, test } from "bun:test";
import * as issues from "../../todo/lib/todo.ts";
import { oracleCommands } from "./acceptance.ts";
import { readRecord } from "./status.ts";
import { acceptanceStep } from "./factory.ts";
import { doneGoal, item, ran, repoDir, runner, sh, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

test("a command with an angle-bracket placeholder is not runnable; a redirection is", async () => {
  const body = "## Oracle\n`bun test <file>`\n`bun test jobs/<name>.test.ts`\n`bun test jobs/lib/a.test.ts 2>&1`";
  expect(oracleCommands(body)).toEqual(["bun test jobs/lib/a.test.ts 2>&1"]);
  const id = doneGoal("`bun test <file>`");
  const lines = await acceptanceStep(runner(2, "bash: syntax error near unexpected token `<'"));
  expect(ran).toEqual([]);
  expect(readRecord("fac", id)?.result).toBe("skipped");
  expect(lines[0]).toContain("acceptance skipped");
  expect(issues.status(item(id))).toBe("done");
});

test("a command that names a test file missing on main is dropped; the real file's command runs", async () => {
  const id = doneGoal("`bun test jobs/lib/a.test.ts 2>&1` `bun test jobs/lib/acceptance.test.ts`");
  const lines = await acceptanceStep(runner(0));
  expect(ran).toEqual(["bun test jobs/lib/acceptance.test.ts"]);
  expect(lines).toEqual([`fac-${id}: acceptance passed at ${sh(repoDir(), "git", "rev-parse", "--short=7", "origin/main")}`]);
  expect(readRecord("fac", id)?.result).toBe("pass");
});
