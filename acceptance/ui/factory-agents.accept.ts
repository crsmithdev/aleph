// Archived goal tests from ui/factory-agents.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore plain JS shared with the page
import { liveOption, renderFactoryAgents, roleRows, totals } from "../../ui/views/factory-agents.js";
// @ts-ignore plain JS shared with the page
import { pace, weekGone } from "../../ui/views/speed.js";

const S: any = { now: "2026-11-01T08:00:00Z", usage: { now: { seven_day: 7, seven_day_resets_at: "2026-11-07T08:00:00Z" } }, factory: { runsToday: 198, costToday: 71.94, dayCap: 999, liveRuns: 1, liveCap: 5 } };

test("a stale usage shows the figure and its age; a fresh one shows no age", () => {
  const at = "2026-11-01T07:20:00Z";
  const stale = { ...S, usage: { stale: true, now: { ...S.usage.now, at } } };
  expect(renderFactoryAgents(stale, null)).toContain("as of 40m ago");
  const fresh = { ...S, usage: { stale: false, now: { ...S.usage.now, at } } };
  expect(renderFactoryAgents(fresh, null)).not.toContain("as of");
});
