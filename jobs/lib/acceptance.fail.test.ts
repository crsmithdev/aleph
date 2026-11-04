// Acceptance of a done goal that fails: an infra result, and a real failure that is final.
import { expect, test } from "bun:test";
import * as issues from "../../todo/lib/todo.ts";
import { accept } from "./acceptance.ts";
import { runOnCommit, type Runner } from "./checks.ts";
import { readRecord } from "./status.ts";
import { acceptanceStep } from "./factory.ts";
import { askOf } from "./ask.ts";
import { closeAgain, doneGoal, item, land, notes, repoDir, runner, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

const infra = (output: string): Runner => async () => ({ code: 1, output, infra: true });

test("an infra result leaves the issue done, writes no record and says acceptance not run", async () => {
  const id = doneGoal("`bun run ok`");
  const lines = await acceptanceStep(infra("the command did not start (exit 1): sandbox said hi"));
  expect(lines[0]).toContain("acceptance not run");
  expect(lines[0]).toContain("sandbox said hi");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)).toBeNull();
});

test("a real failure is final: a later step runs nothing, asks nothing and keeps the record", async () => {
  const id = doneGoal("`bun run ok`");
  await acceptanceStep(runner(1, "boom"));
  const before = readRecord("fac", id);
  expect(before?.fails).toBe(1);
  land(id);
  closeAgain(id);
  expect(await acceptanceStep(infra("bundle failed: x"))).toEqual([]);
  expect(askOf(item(id))).toBeNull();
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)).toEqual(before);
});

const withSetup = (setup: string[]) => ({ key: "fac", path: repoDir(), main: "main", setup }) as any;

test("accept through runOnCommit with a failing setup leaves the goal done, writes no record and adds no fail note", async () => {
  process.env.ALEPH_SANDBOX_CMD = "/usr/bin/env";
  const id = doneGoal("`bun run bad`");
  const line = await accept(withSetup(["false"]), item(id), runOnCommit);
  expect(line).toContain("acceptance not run");
  expect(line).toContain("setup failed");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)).toBeNull();
  expect(notes(id)).not.toContain("acceptance: fail");
  expect(askOf(item(id))).toBeNull();
});
