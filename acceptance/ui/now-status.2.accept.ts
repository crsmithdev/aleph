// Archived goal tests from ui/now-status.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "../../ui/views/now.js";
import { withAttn, withFactory } from "../../ui/test-now.ts";

const calmState = { ...withFactory({}), asks: [], stuck: [] };

const said = (o: object, top: object = {}) => view.renderLede({ ...calmState, ...top, factory: { ...calmState.factory, ...o } }).replace(/<[^>]*>/g, "");

const OOD = "Alert: this status is out of date.";

const strip = (h: string) => h.replace(/<[^>]*>/g, "");

test("out-of-date data says so, in place of the fine and the paused sentence", () => {
  const h = view.renderLede(calmState, true);
  expect(strip(h)).toBe(OOD);
  expect(h).toContain('class="say error"');
  const p = view.renderLede({ ...calmState, factory: { ...calmState.factory, paused: true } }, true);
  expect(strip(p)).toBe(OOD);
});

test("the tick alert ranks after the probe and before the queued-jobs alert, and reads as a Check row", () => {
  const o = { nextTick: null, probe: { at: "x", ok: false, failed: ["no network"] }, health: ["health: 2 goals can start, but no run started in 15 minutes"] };
  expect(said(o)).toBe("Alert: the sandbox is broken; the factory tick has stopped; queued jobs are not starting.");
  expect(withAttn(withFactory({ nextTick: null }))).toContain("Check: the factory tick has stopped: aleph-tick.timer has no next run");
});
