// Acceptance of a done goal that fails: the reopen, the Ask on a second fail, and an infra result.
import { expect, test } from "bun:test";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { accept } from "./acceptance.ts";
import { runOnCommit, type Runner } from "./checks.ts";
import { readRecord, resultLine } from "./status.ts";
import { acceptanceStep, dispatchIssues } from "./factory.ts";
import { askOf } from "./ask.ts";
import { base, closeAgain, doneGoal, item, land, notes, repoDir, runner, sh, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

test("a failing command reopens the goal with the last 40 lines and it is dispatched once", async () => {
  const id = doneGoal("`bun run bad`");
  const output = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
  await acceptanceStep(runner(3, output));
  expect(issues.status(item(id))).toBe("open");
  expect(notes(id)).toContain("acceptance: fail at");
  expect(notes(id)).toContain("`bun run bad` exited 3");
  expect(notes(id)).toContain("line 60");
  expect(notes(id)).toContain("line 21");
  expect(notes(id)).not.toContain("line 20 ");
  expect(notes(id)).not.toContain("line 1 ");
  const specs: string[] = [];
  const out = await dispatchIssues(async (_r, _name, _id, spec) => { specs.push(spec); return null; }, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
  expect(out.started).toEqual([`fac-${id}`]);
  expect(specs).toHaveLength(1);
  expect(specs[0]).toContain("acceptance: fail at");
  expect(specs[0]).toContain("line 60");
  expect(askOf(item(id))).toBeNull();
  // The goal is not done again until a later commit names it.
  expect(await acceptanceStep(runner(0))).toEqual([]);
});

test("a second failure sets an Ask, names the command, and dispatches nothing", async () => {
  const id = doneGoal("`bun run bad` `bun run ok`");
  await acceptanceStep(runner(3, "boom"));
  land(id);
  closeAgain(id);
  const commitsBefore = Number(sh(join(base, "items.git"), "git", "rev-list", "--count", "main"));
  const lines = await acceptanceStep(runner(3, "boom again"));
  expect(lines[0]).toContain("asks Chris");
  expect(Number(sh(join(base, "items.git"), "git", "rev-list", "--count", "main")) - commitsBefore).toBe(1);
  expect(askOf(item(id))).toMatchObject({ kind: "input", reason: "acceptance-failed" });
  expect(notes(id)).toMatch(/the Oracle command `bun run bad` still fails/);
  expect(issues.status(item(id))).toBe("open");
  expect(readRecord("fac", id)?.fails).toBe(2);
  const started: string[] = [];
  const out = await dispatchIssues(async (_r, name) => { started.push(name); return null; }, async () => null, undefined, undefined, undefined, undefined, undefined, () => {});
  expect(out.started).toEqual([]);
  expect(started).toEqual([]);
  expect(await acceptanceStep(runner(3))).toEqual([]);
  expect(resultLine("fac", id)).toBe("acceptance: fail twice: bun run bad");
});

test("a rerun that passes the Oracle ends with the pass note", async () => {
  const id = doneGoal("`bun run ok`");
  await acceptanceStep(runner(1, "x"));
  land(id);
  closeAgain(id);
  await acceptanceStep(runner(0));
  expect(notes(id)).toContain("acceptance: pass at");
  expect(readRecord("fac", id)?.result).toBe("pass");
});

const infra = (output: string): Runner => async () => ({ code: 1, output, infra: true });

test("an infra result leaves the issue done, writes no record and says acceptance not run", async () => {
  const id = doneGoal("`bun run ok`");
  const lines = await acceptanceStep(infra("the command did not start (exit 1): sandbox said hi"));
  expect(lines[0]).toContain("acceptance not run");
  expect(lines[0]).toContain("sandbox said hi");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)).toBeNull();
});

test("an infra result after one real failure does not ask Chris or change the record", async () => {
  const id = doneGoal("`bun run ok`");
  await acceptanceStep(runner(1, "boom"));
  const before = readRecord("fac", id);
  expect(before?.fails).toBe(1);
  land(id);
  closeAgain(id);
  const lines = await acceptanceStep(infra("bundle failed: x"));
  expect(lines[0]).toContain("acceptance not run");
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
