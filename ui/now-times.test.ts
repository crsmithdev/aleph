import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { awaitingHeld, job, state } from "./fixtures/status-state.ts";
// @ts-ignore
import { actMessages, openDiffs } from "./lib.js";
import { asksOf, withAttn } from "./test-now.ts";

test("a build run is a worker and is past the time box after 40 minutes", () => {
  const h = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T15:00:00Z", run: { kind: "build", started: "2026-10-27T16:00:00Z" } })] });
  expect(h).toContain("worker");
  expect(h).toContain("past the time box");
  expect(withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:30:00Z", run: { kind: "build", started: "2026-10-27T16:30:00Z" } })] })).not.toContain("past the time box");
});

test("an awaiting row does not show checks as facts", () => {
  expect(withAttn(state)).not.toContain("s ✓");
});

test("the Pause or Resume button sits in the page head beside the time; no Controls panel", () => {
  const on = view.renderControls(state);
  expect(on).toContain('data-act="pause"');
  expect(on).not.toContain('data-act="resume"');
  const off = view.renderControls({ ...state, factory: { ...state.factory, paused: true } });
  expect(off).toContain('data-act="resume"');
  expect(off).not.toContain('data-act="pause"');
  expect(on).toContain('class="act"');
  expect(off).toContain('class="act"');
  expect(off).not.toContain("primary");
  const page = view.view.render(state);
  expect(page).not.toContain('id="controls"');
  expect(page.indexOf('data-act="pause"')).toBeGreaterThan(page.indexOf('class="shead'));
  expect(page.indexOf('data-act="pause"')).toBeGreaterThan(page.indexOf('class="asof"'));
  expect(page.indexOf('data-act="pause"')).toBeLessThan(page.indexOf('id="scorecard"'));
});

const two: any = { ...state, asks: asksOf([awaitingHeld({ name: "job-a" }), awaitingHeld({ name: "job-b" })]) };

test("message and diff text are escaped", () => {
  actMessages.set("job-a", "<b>x</b>");
  openDiffs.set("job-a", "+<script>alert(1)</script>");
  try {
    const h = withAttn(two);
    expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(h).toContain("&lt;script&gt;");
    expect(h).not.toContain("<script>");
  } finally { actMessages.clear(); openDiffs.clear(); }
});

test("Status times use the state's own now for the year check", () => {
  const page = withAttn({ ...state, now: "2027-01-05T12:00:00Z", asks: asksOf([awaitingHeld({ name: "aleph-27", started: "2026-10-27T16:50:00Z", trailers: [{ key: "Job", value: "20261028-042822-aleph-aleph-240-agent" }] })]) });
  expect(page).toContain("Started</dt><dd>2026-10-27");
  expect(page).not.toMatch(/\d\d? ?[AP]M/i);
});

test("a planner run shows as planner in the running lane", async () => {
  const plan = { name: "plan-aleph-5", item: { title: "Big" }, condition: "running", run: { kind: "plan", started: "2026-10-27T16:50:00Z" }, started: "2026-10-27T16:50:00Z" };
  expect(withAttn({ ...state, running: [job({ name: "plan-aleph-5", run: plan.run })] })).toContain('<span class="badge run" title="planner">planner');
});
