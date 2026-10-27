import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as r from "./views/now.js";

const job = (o: object) => ({ repo: "aleph", item: null, state: "running", started: "2026-10-27T16:00:00Z", defaults: [], followups: [], ...o });
const state: any = {
  now: "2026-10-27T17:00:00Z",
  factory: { paused: false, dayCap: 12, runsToday: 5, costToday: 0.25, nextTick: "2026-10-27T17:12:00Z", probe: { at: "2026-10-27T14:35:00Z", ok: true, failed: [] }, health: ["judge is down"] },
  needs: [job({ name: "aleph-27", state: "needs-you", reason: "Held path: hooks/lib/digest.ts", stat: " a.ts | 2 +-", defaults: ["Haiku tier per request"], item: { id: 27, title: "Digest head and tail" } })],
  stuck: [job({ name: "aleph-30", state: "stuck", reason: "types failed" })],
  running: [job({ name: "aleph-36", phase: "worker", item: { id: 36, title: "Route tiers" } })],
  delivered: [job({ name: "aleph-28", state: "landed", ended: "2026-10-27T16:30:00Z", commit: "50f301fabc", commitUrl: "https://github.com/o/r/commit/50f301fabc" })],
  waiting: [],
  ticks: [{ at: "2026-10-27T16:05:00Z", line: "started none" }],
};

test("needs shows name, reason, defaults and both commands", () => {
  const h = r.renderNeeds(state);
  for (const t of ["aleph-27", "Held path: hooks/lib/digest.ts", "Haiku tier per request", "a.ts | 2 +-", 'data-cmd="aleph land aleph-27"', 'data-cmd="aleph drop aleph-27"']) expect(h).toContain(t);
});

test("stuck, running and delivered show their jobs", () => {
  expect(r.renderStuck(state)).toContain("types failed");
  expect(r.renderStuck(state)).toContain("aleph-30");
  expect(r.renderRunning(state)).toContain("aleph-36");
  expect(r.renderRunning(state)).toContain("worker");
});

test("a commitUrl becomes a link", () => {
  expect(r.renderDelivered(state)).toContain('<a href="https://github.com/o/r/commit/50f301fabc"><code>50f301f</code></a>');
  const none = r.renderDelivered({ ...state, delivered: [{ ...state.delivered[0], commitUrl: undefined }] });
  expect(none).not.toContain("<a ");
});

test("an empty section shows its empty state", () => {
  expect(r.renderWaiting(state)).toContain("No goal waits to start.");
  expect(r.renderNeeds({ ...state, needs: [] })).toContain("Nothing needs you.");
  expect(r.renderStuck({ ...state, stuck: [] })).toContain("No run is stuck.");
  expect(r.renderRunning({ ...state, running: [] })).toContain("Nothing is running.");
  expect(r.renderDelivered({ ...state, delivered: [] })).toContain("Nothing has landed today.");
});

test("header and ticks render", () => {
  const h = r.renderHeader(state);
  expect(h).toContain("5 of 12");
  expect(h).toContain("$0.2500");
  expect(h).toContain("judge is down");
  expect(r.renderHeader({ ...state, factory: { ...state.factory, paused: true } })).toContain("Paused");
  expect(r.renderTicks(state)).toContain("started none");
});

test("text from the state is escaped", () => {
  const bad = { ...state, needs: [job({ name: "x", state: "needs-you", item: { id: 1, title: "<script>alert(1)</script>" } })], waiting: [{ repo: "a", id: 1, title: "<script>w</script>" }] };
  for (const h of [r.renderNeeds(bad), r.renderWaiting(bad)]) {
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  }
});
