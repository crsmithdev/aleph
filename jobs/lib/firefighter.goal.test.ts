// The firefighter's edit of a goal: its after, its spec, and the spec-check Ask it may answer at most MAX_SPEC_EDITS times.
import { expect, test } from "bun:test";
import { applyActions, snapshot } from "./firefighter.ts";
import { alwaysFile, asked, FIREFIGHTER, fresh, item, key, plain, ports, useFirefighterFixture } from "./firefighter.fixture.ts";

useFirefighterFixture();

test("an after naming no goal is refused", async () => {
  fresh([{ title: "goal", goal: true }]);
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, after: [`${key}-9.1`] }], ports());
  expect(r.refused).toEqual([expect.stringContaining("names no issue")]);
});

test("a handed spec-check Ask is an event with handed set, and the firefighter's edit-goal clears it and stores the spec", async () => {
  fresh([{ title: "goal", body: "Ship the thing.\n", goal: true, ask: { ...plain(), reason: "spec-check" } }]);
  alwaysFile({ "spec-check": FIREFIGHTER });
  expect(snapshot().find((x) => x.kind === "ask")).toMatchObject({ reason: "spec-check", handed: true });
  const r = await applyActions([{ do: "edit-goal", repo: key, n: 1, body: "## Goal\nShip.\n## Edit surface\na.ts\n## Oracle\nIt ships.\n" }], ports());
  expect(r.refused).toEqual([]);
  expect(item(1).spec).toContain("## Oracle");
  expect(asked(1)).toBeFalsy();
});
