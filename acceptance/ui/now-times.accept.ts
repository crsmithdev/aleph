// Archived goal tests from ui/now-times.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "../../ui/views/now.js";
import { awaitingHeld, job, state } from "../../ui/fixtures/status-state.ts";
// @ts-ignore
import { actMessages, openDiffs } from "../../ui/lib.js";
import { asksOf, withAttn, trailerLine } from "../../ui/test-now.ts";

test("the as-of line is mm/dd hh:mm", () => {
  expect(view.renderAsOf({ now: new Date(2026, 9, 28, 9, 5).toISOString() })).toBe("10/28 09:05");
  expect(view.renderAsOf({ now: new Date(2026, 9, 28, 21, 5).toISOString() })).toBe("10/28 21:05");
  expect(view.renderAsOf(state)).toMatch(/^\d{2}\/\d{2} \d{2}:\d{2}$/);
});

test("a running job past 40 minutes says so", () => {
  const late = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:19:00Z", run: { kind: "build", started: "2026-10-27T16:19:00Z" } })] });
  expect(late).toContain("past the time box");
  expect(withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:30:00Z", run: { kind: "build", started: "2026-10-27T16:30:00Z" } })] })).not.toContain("past the time box");
});

test("a land run is measured from its own start and never past the time box", () => {
  const h = withAttn({ ...state, now: "2026-10-27T16:55:00Z", running: [job({ name: "a", started: "2026-10-27T16:00:00Z", run: { kind: "land", started: "2026-10-27T16:50:00Z" } })] });
  expect(h).toContain("land");
  expect(h).toMatch(/<span class="num date">\d\d\/\d\d \d\d:\d\d<\/span><span class="num dur">55m<\/span>/);
  expect(h).not.toContain("past the time box");
});

test("a worker run older than 40 minutes is past the time box", () => {
  const h = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T15:00:00Z", run: { kind: "build", started: "2026-10-27T16:00:00Z" } })] });
  expect(h).toContain("past the time box");
  expect(h).toContain("worker");
});

test("a 30-file stat shows 12 lines and +18 more files", () => {
  const stat = Array.from({ length: 30 }, (_, i) => ` f${i}.ts | 2 +-`).join("\n") + "\n 30 files changed, 30 insertions(+), 30 deletions(-)";
  const h = withAttn({ ...state, asks: asksOf([awaitingHeld({ name: "x", stat })]) });
  expect(h.match(/ f\d+\.ts \| 2/g)?.length).toBe(12);
  expect(h).toContain("+18 more files");
});

test("trailers show on one line joined by ' · ', escaped, and only when there are some", () => {
  const trailers = [{ key: "Item", value: "aleph-27" }, { key: "Job", value: "<script>x</script>" }, { key: "Held-by", value: "Chris" }];
  const h = trailerLine(job({ name: "aleph-28", condition: "landed", trailers }), state.now);
  expect(h).toContain("aleph-27 · Job &lt;script&gt;x&lt;/script&gt; · Held-by Chris");
  expect(h).not.toContain("Item aleph-27");
  expect(h).not.toContain("<script>");
  expect(h).not.toContain('<pre class="trailers"');
  expect(trailerLine(state.delivered[0], state.now)).toBe("");
});

test("the Job trailer is parsed into run kind and start, linked to the job page with the raw id in the title", () => {
  const id = "20261028-042822-aleph-aleph-240-agent";
  const land = job({ name: "aleph-240", condition: "landed", trailers: [{ key: "Item", value: "aleph-240" }, { key: "Job", value: id }] });
  const h = trailerLine(land, state.now);
  expect(h).toContain(`<p class="trailers-line">aleph-240 \u00b7 <a href="#/jobs/aleph-240" title="${id}">agent run, 10/28 04:28</a></p>`);
  expect(h.replace(/title="[^"]*"/, "")).not.toContain(id);
  expect(trailerLine({ ...land, trailers: [{ key: "Job", value: id.replace("agent", "land").replace("042822", "134500") }] }, state.now)).toContain(">land, 10/28 13:45<");
});

const two: any = { ...state, asks: asksOf([awaitingHeld({ name: "job-a" }), awaitingHeld({ name: "job-b" })]) };

const panel = (h: string, n: string) => h.match(new RegExp(`<div class="diff-panel" data-diff-for="${n}"[^>]*>`))![0];

test("an open diff survives a render; other panels stay hidden", () => {
  openDiffs.set("job-a", "@@ -1 +1 @@\n-old\n+new");
  try {
    const h = withAttn(two);
    expect(panel(h, "job-a")).not.toContain("hidden");
    expect(panel(h, "job-b")).toContain("hidden");
    expect(h).toContain("+new");
    expect(h).toContain("-old");
  } finally { openDiffs.clear(); }
});

test("an action message survives a render; none when empty", () => {
  actMessages.set("job-a", "land failed: conflict");
  try {
    const h = withAttn(two);
    expect(h).toContain('<span class="act-msg" role="alert">land failed: conflict</span>');
    expect(h.match(/act-msg/g)!.length).toBe(1);
  } finally { actMessages.clear(); }
  expect(withAttn(two)).not.toContain("act-msg");
});

test("a running firefighter run shows its role as the kind", () => {
  const s = { ...state, running: [job({ name: "firefighter", phase: "firefighter", run: { kind: "firefighter", started: "2026-10-27T16:55:00Z" } })] };
  expect(withAttn(s)).toContain('<span class="badge run" title="firefighter">firefighter</span>');
});
