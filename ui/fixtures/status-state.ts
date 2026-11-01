// The hand-written Status state of ui/now.test.ts. ui/fixtures.test.ts holds its keys to what /api/state really sends. `needs` is the exception: the test maps it to `asks` through the real attend().
export const job = (o: object) => ({ repo: "aleph", item: null, condition: "running", started: "2026-10-27T16:00:00Z", defaults: [], followups: [], ...o });
export const state: any = {
  now: "2026-10-27T17:00:00Z",
  factory: { paused: false, dayCap: 12, runsToday: 5, costToday: 0.25, nextTick: "2026-10-27T17:12:00Z", probe: { at: "2026-10-27T14:35:00Z", ok: true, failed: [] }, health: ["judge is down"] },
  needs: [job({ name: "aleph-27", condition: "awaiting", needs: "held", reason: "Held path: hooks/lib/digest.ts", stat: " a.ts | 2 +-", defaults: ["Haiku tier per request"], item: { id: 27, title: "Digest head and tail" } })],
  stuck: [job({ name: "aleph-30", condition: "stuck", reason: "types failed" })],
  running: [job({ name: "aleph-36", phase: "worker", item: { id: 36, title: "Route tiers" } })],
  delivered: [job({ name: "aleph-28", condition: "landed", ended: "2026-10-27T16:30:00Z", commit: "50f301fabc", commitUrl: "https://github.com/o/r/commit/50f301fabc" })],
  queued: [],
};
