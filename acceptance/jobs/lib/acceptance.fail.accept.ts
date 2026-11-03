// Archived goal tests from jobs/lib/acceptance.fail.test.ts: `bun run accept` runs them, `bun run test` does not.
// Acceptance of a done goal that fails: the reopen, the Ask on a second fail, and an infra result.
import { expect, test } from "bun:test";
import { join } from "node:path";
import * as issues from "../../../todo/lib/todo.ts";
import { readRecord, resultLine } from "../../../jobs/lib/status.ts";
import { acceptanceStep, dispatchIssues } from "../../../jobs/lib/factory.ts";
import { askOf } from "../../../jobs/lib/ask.ts";
import { base, closeAgain, doneGoal, item, land, notes, runner, sh, useAcceptanceFixture } from "../../../jobs/lib/acceptance.fixture.ts";

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


