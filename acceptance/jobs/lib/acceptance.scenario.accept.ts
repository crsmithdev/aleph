// Archived goal tests from jobs/lib/acceptance.scenario.test.ts: `bun run accept` runs them, `bun run test` does not.
// Acceptance with the hidden scenarios of a goal, alone and with Oracle commands.
import { expect, test } from "bun:test";
import { writeHidden } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import type { ScenarioCheck } from "../../../jobs/lib/acceptance.ts";
import { readRecord } from "../../../jobs/lib/status.ts";
import { acceptanceStep } from "../../../jobs/lib/factory.ts";
import { doneGoal, item, ran, runner, useAcceptanceFixture } from "../../../jobs/lib/acceptance.fixture.ts";

useAcceptanceFixture();

const SCN = "1. the secret widget turns purple\n2. the hidden gizmo hums\n";
const seal = (id: number) => writeHidden({ key: "fac" }, `fac-${id}`, { "scenarios.md": SCN });
const scn = (output: string): ScenarioCheck => async () => ({ output });
const allPass = scn("CHECK: pass scenario 1: ok\nCHECK: pass scenario 2: ok");
const oneFail = scn("CHECK: pass scenario 1: ok\nCHECK: fail scenario 2: the gizmo hums not");

test("scenarios only: all pass writes pass", async () => {
  const id = doneGoal("It works.");
  seal(id);
  const lines = await acceptanceStep(runner(0), undefined, allPass);
  expect(lines[0]).toContain("acceptance passed");
  expect(readRecord("fac", id)?.result).toBe("pass");
  expect(ran).toEqual([]);
});

test("no command and no scenarios is still skipped", async () => {
  const id = doneGoal("It works.");
  await acceptanceStep(runner(0), undefined, allPass);
  expect(readRecord("fac", id)?.result).toBe("skipped");
});

test("commands and scenarios: pass only when both pass", async () => {
  const id = doneGoal("`bun run ok`");
  seal(id);
  await acceptanceStep(runner(0), undefined, oneFail);
  expect(readRecord("fac", id)?.result).toBe("fail");
  const id2 = doneGoal("`bun run ok2`");
  seal(id2);
  await acceptanceStep(runner(0), undefined, allPass);
  expect(readRecord("fac", id2)?.result).toBe("pass");
  const id3 = doneGoal("`bun run bad`");
  seal(id3);
  let asked = false;
  await acceptanceStep(runner(3, "boom"), undefined, async () => { asked = true; return { output: "CHECK: pass scenario 1: ok\nCHECK: pass scenario 2: ok" }; });
  expect(readRecord("fac", id3)?.result).toBe("fail");
  expect(asked).toBe(false);
});

test("a scenario with no CHECK line writes no new final record", async () => {
  const id = doneGoal("It works.");
  seal(id);
  const lines = await acceptanceStep(runner(0), undefined, scn("CHECK: pass scenario 1: ok"));
  expect(lines[0]).toContain("acceptance not run");
  expect(readRecord("fac", id)).toBeNull();
  expect(issues.status(item(id))).toBe("done");
});
