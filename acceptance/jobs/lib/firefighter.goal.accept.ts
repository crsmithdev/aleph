// Archived goal tests from jobs/lib/firefighter.goal.test.ts: `bun run accept` runs them, `bun run test` does not.
// The firefighter's edit of a goal and its drop with after. The spec-check Ask is the director's (director.accept.ts).
import { expect, test } from "bun:test";
import { firefighterStep } from "../../../jobs/lib/factory.ts";
import { applyActions } from "../../../jobs/lib/firefighter.ts";
import { addGoal, dropped, fresh, item, key, ports, reply, run, useFirefighterFixture } from "../../../jobs/lib/firefighter.fixture.ts";

useFirefighterFixture();

test("a drop with after drops the job, and the goal waits after that goal, with the note saying so", async () => {
  fresh([{ title: "waiter", goal: true }, { title: "blocker" }]);
  addGoal(2);
  run({ name: `${key}-1`, condition: "stuck", reason: "time box", on: `${key}-1` });
  reply([{ do: "drop", job: `${key}-1`, reason: "needs the blocker", after: [`${key}-2.1`] }]);
  const f = await firefighterStep(ports());
  expect(f?.refused).toEqual([]);
  expect(dropped.map((d) => d.name)).toEqual([`${key}-1`]);
  expect(item(1).fm.after).toEqual([`${key}-2.1`]);
  expect(item(1).notes.at(-1)).toContain(`after ${key}-2.1`);
});

test("an edit-goal with only after sets it and leaves the body unchanged", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true }, { title: "blocker" }]);
  addGoal(2);
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, after: [`${key}-2.1`] }], ports());
  expect(r.refused).toEqual([]);
  expect(item(1).fm.after).toEqual([`${key}-2.1`]);
  expect(item(1).spec.trim()).toBe("Ship the thing.");
});
