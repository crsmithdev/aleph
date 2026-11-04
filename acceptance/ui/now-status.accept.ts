// Archived goal tests from ui/now-status.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "../../ui/views/now.js";
import { withAttn, withFactory } from "../../ui/test-now.ts";

const calmState = { ...withFactory({}), asks: [], stuck: [] };

const said = (o: object, top: object = {}) => view.renderLede({ ...calmState, ...top, factory: { ...calmState.factory, ...o } }).replace(/<[^>]*>/g, "");

const weekAt = (seven_day: number) => ({ usage: { now: { seven_day } } });

test("a weekly usage of 90% or more is said after the other parts, in the warning colour", () => {
  expect(said({}, weekAt(90))).toBe("Everything is running smoothly; weekly usage is at 90%.");
  expect(view.renderLede({ ...calmState, ...weekAt(90) })).toContain('class="say warning"');
  expect(said({}, weekAt(89.6))).toBe("Everything is running smoothly.");
  expect(view.renderLede({ ...calmState, ...weekAt(89.6) })).toContain('class="say fine"');
  expect(said({}, { usage: undefined })).toBe("Everything is running smoothly.");
  expect(said({}, weekAt(93.4))).toContain("weekly usage is at 93%");
  expect(said({ runsToday: 12 }, weekAt(95))).toBe("Everything is running smoothly; weekly usage is at 95%.");
});

test("a paused factory with weekly usage at 90% says so", () => {
  expect(said({ paused: true }, weekAt(90))).toBe("The factory is paused; weekly usage is at 90%.");
});

test("a flake line is not shown on the Status page", () => {
  const calm = { ...withFactory({ health: ["health: aleph check tests passed on rerun 4 times in 7 days"] }), asks: [], stuck: [] };
  const h = view.renderLede(calm);
  expect(h).toContain('class="say fine"');
  expect(h).not.toContain("Awaiting");
  expect(h).not.toContain("rerun");
  expect(view.view.render(calm)).not.toContain("rerun");
  expect(withAttn(calm)).not.toContain("rerun");
});

test("a long unbroken word in the status sentence (a URL) breaks: .shead .say sets overflow-wrap: anywhere", async () => {
  const html = await Bun.file(new URL("../../ui/app.css", import.meta.url)).text();
  const say = [...html.matchAll(/\.shead \.say[^{}]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  expect(say).toContain("overflow-wrap: anywhere");
});

test("without the out-of-date input the sentence is unchanged", () => {
  expect(view.renderLede(calmState, false)).toBe(view.renderLede(calmState));
  expect(said({})).toBe("Everything is running smoothly.");
});
