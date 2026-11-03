// Archived goal tests from jobs/lib/acceptance.skip.test.ts: `bun run accept` runs them, `bun run test` does not.
// Acceptance of a done goal with no runnable Oracle command: a placeholder, a missing test file, no command, or no land on main.
import { expect, test } from "bun:test";
import { writeList } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { readRecord } from "../../../jobs/lib/status.ts";
import { acceptanceStep } from "../../../jobs/lib/factory.ts";
import { closeAgain, doneGoal, item, ran, runner, useAcceptanceFixture } from "../../../jobs/lib/acceptance.fixture.ts";

useAcceptanceFixture();

test("an Oracle with no runnable command is skipped and the goal stays done", async () => {
  const id = doneGoal("Open the page and look. `ls -la`");
  const lines = await acceptanceStep(runner(1));
  expect(ran).toEqual([]);
  expect(lines[0]).toContain("acceptance skipped");
  expect(issues.status(item(id))).toBe("done");
  expect(item(id).notes).toEqual([]);
  expect(readRecord("fac", id)?.result).toBe("skipped");
  expect(await acceptanceStep(runner(1))).toEqual([]);
});

test("a done goal whose only command names a missing test file is skipped and runs nothing", async () => {
  const id = doneGoal("`bun test ./jobs/lib/a.test.ts 2>&1`");
  const lines = await acceptanceStep(runner(1));
  expect(ran).toEqual([]);
  expect(lines[0]).toContain("acceptance skipped");
  expect(issues.status(item(id))).toBe("done");
  expect(readRecord("fac", id)?.result).toBe("skipped");
});

test("a goal closed with no landing on main is not accepted", async () => {
  const id = writeList({ key: "fac" }, "add", (doc) => { const i = issues.add(doc, "by hand", { spec: "## Oracle\n`bun run ok`" }); return i.id; }, true)!.value;
  closeAgain(id);
  expect(await acceptanceStep(runner(0))).toEqual([]);
});
