// Acceptance with the hidden scenarios of a goal, alone and with Oracle commands.
import { expect, test } from "bun:test";
import { writeHidden } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import type { ScenarioCheck } from "./acceptance.ts";
import { acceptanceStep } from "./factory.ts";
import { askOf } from "./ask.ts";
import { closeAgain, doneGoal, item, land, notes, runner, useAcceptanceFixture } from "./acceptance.fixture.ts";

useAcceptanceFixture();

const SCN = "1. the secret widget turns purple\n2. the hidden gizmo hums\n";
const seal = (id: number) => writeHidden({ key: "fac" }, `fac-${id}`, { "scenarios.md": SCN });
const scn = (output: string): ScenarioCheck => async () => ({ output });
const oneFail = scn("CHECK: pass scenario 1: ok\nCHECK: fail scenario 2: the gizmo hums not");

test("a failed scenario reopens by number only; a second fail asks Chris", async () => {
  const id = doneGoal("It works.");
  seal(id);
  await acceptanceStep(runner(0), undefined, oneFail);
  expect(issues.status(item(id))).toBe("open");
  expect(notes(id)).toContain("acceptance: fail at");
  expect(notes(id)).toContain("scenario 2");
  expect(notes(id)).not.toContain("gizmo");
  expect(notes(id)).not.toContain("widget");
  land(id);
  closeAgain(id);
  await acceptanceStep(runner(0), undefined, oneFail);
  expect(askOf(item(id))).toMatchObject({ kind: "input", reason: "acceptance-failed" });
  expect(notes(id)).not.toContain("gizmo");
});
