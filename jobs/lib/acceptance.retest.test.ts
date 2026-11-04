// Acceptance reruns: the retest wait, a filter that matches no test, a failure that names no test, and an error on the rerun.
import { expect, test } from "bun:test";
import * as issues from "../../todo/lib/todo.ts";
import { readRecord } from "./status.ts";
import { acceptanceStep } from "./factory.ts";
import { answers, doneGoal, FAILED, flakeNotes, item, landFile, notes, ran, RERUN_FAIL, runner, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

test("a failure pinned to the wrong file files no follow-up when the original command passes", async () => {
  const id = doneGoal("`bun run test`");
  landFile(id, "jobs/lib/acceptance.test.ts");
  const none = { code: 1, output: 'bun test\nerror: regex "^one$" matched 0 tests. Searched 1 file\n' };
  await acceptanceStep(answers(RERUN_FAIL, none, { code: 0, output: " 1 pass\n 0 fail\n" }));
  expect(ran[1]).toContain("-t");
  expect(ran[2]).toBe("bun run test");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)?.result).toBe("pass");
  expect(notes(id)).not.toContain("acceptance: fail");
});

test("a failure that names no test files a follow-up only if the command fails again", async () => {
  const id = doneGoal("`bunx tsc`");
  await acceptanceStep(answers({ code: 2, output: "a.ts(1,1): error" }, { code: 0, output: "" }));
  expect(ran).toEqual(["bunx tsc", "bunx tsc"]);
  expect(issues.status(item(id))).toBe("done");
  expect(flakeNotes()).toContain("`bunx tsc`: failed under load");
  const id2 = doneGoal("`bunx tsc`");
  await acceptanceStep(runner(2, "a.ts(1,1): error"));
  expect(issues.status(item(id2))).toBe("done");
  expect(readRecord("fac", id2)?.followup).toMatch(/^fac-\d+$/);
});

test("an infra error on the rerun keeps the failure waiting and files nothing", async () => {
  const id = doneGoal("`bun run test`");
  const lines = await acceptanceStep(answers({ code: 1, output: FAILED }, { code: 1, output: "bun install: ConnectionRefused", infra: true }));
  expect(lines[0]).toContain("acceptance not run");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)?.retest?.command).toBe("bun run test");
  await acceptanceStep(answers({ code: 0, output: "" }));
  expect(readRecord("fac", id)?.result).toBe("pass");
});
