// Archived goal tests from jobs/lib/acceptance.rerun.test.ts: `bun run accept` runs them, `bun run test` does not.
// Acceptance reruns a failed test: a pass on the rerun is a flake; a repeat in a test the goal touched reopens the goal.
import { expect, test } from "bun:test";
import * as issues from "../../../todo/lib/todo.ts";
import { acceptanceStep } from "../../../jobs/lib/factory.ts";
import { answers, doneGoal, flakeNotes, item, landFile, ran, RERUN_FAIL, useAcceptanceFixture } from "../../../jobs/lib/acceptance.fixture.ts";

useAcceptanceFixture();

test("a touched test that fails on the second rerun is a repeat; one that passes every rerun is a flake", async () => {
  const pass = { code: 0, output: " 1 pass\n 0 fail\n" };
  const a = doneGoal("`bun run test`");
  landFile(a, "jobs/lib/acceptance.test.ts");
  await acceptanceStep(answers(RERUN_FAIL, pass, RERUN_FAIL));
  expect(ran.length).toBe(3);
  expect(issues.status(item(a))).toBe("open");
  ran.length = 0;
  const b = doneGoal("`bun run test`");
  landFile(b, "jobs/lib/acceptance.test.ts");
  const lines = await acceptanceStep(answers(RERUN_FAIL, pass));
  expect(ran.length).toBe(4);
  expect(lines.find((l) => l.startsWith(`fac-${b}:`))).toContain("acceptance passed");
  expect(issues.status(item(b))).toBe("done");
  expect(flakeNotes()).toContain("jobs/lib/acceptance.test.ts > one: failed under load");
});
