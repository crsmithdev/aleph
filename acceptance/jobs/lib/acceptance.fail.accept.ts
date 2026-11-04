// Archived goal tests from jobs/lib/acceptance.fail.test.ts: `bun run accept` runs them, `bun run test` does not.
// Acceptance of a done goal that fails: the follow-up issue, and a record that is final.
import { expect, test } from "bun:test";
import { readList } from "../../../todo/lib/store.ts";
import * as issues from "../../../todo/lib/todo.ts";
import { readRecord, resultLine } from "../../../jobs/lib/status.ts";
import { acceptanceStep } from "../../../jobs/lib/factory.ts";
import { askOf } from "../../../jobs/lib/ask.ts";
import { closeAgain, doneGoal, item, land, notes, ran, runner, useAcceptanceFixture } from "../../../jobs/lib/acceptance.fixture.ts";

useAcceptanceFixture();

const followup = () => readList({ key: "fac" })!.items.find((i) => i.fm.kind === "acceptance")!;

test("a failing command files a follow-up with the last 40 lines and leaves the goal done", async () => {
  const id = doneGoal("`bun run bad`");
  const output = Array.from({ length: 60 }, (_, i) => `line ${i + 1}`).join("\n");
  await acceptanceStep(runner(3, output));
  expect(issues.status(item(id))).toBe("done");
  expect(askOf(item(id))).toBeNull();
  expect(notes(id)).toContain("acceptance: fail at");
  expect(notes(id)).toContain("`bun run bad` exited 3");
  const f = followup();
  expect(f.request).toContain("line 60");
  expect(f.request).toContain("line 21\n");
  expect(f.request).not.toContain("line 20\n");
  expect(issues.status(f)).toBe("open");
});

test("after a failure the record is final: a later land runs nothing and files nothing", async () => {
  const id = doneGoal("`bun run bad` `bun run ok`");
  await acceptanceStep(runner(3, "boom"));
  const f = followup();
  land(id);
  closeAgain(id);
  ran.length = 0;
  expect(await acceptanceStep(runner(0))).toEqual([]);
  expect(ran).toEqual([]);
  expect(readList({ key: "fac" })!.items.filter((i) => i.fm.kind === "acceptance")).toHaveLength(1);
  expect(readRecord("fac", id)?.fails).toBe(1);
  expect(resultLine("fac", id)).toBe(`acceptance: fail: bun run bad; follow-up fac-${f.id}`);
});
