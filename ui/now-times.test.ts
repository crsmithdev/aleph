import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { awaitingHeld, job, state } from "./fixtures/status-state.ts";
// @ts-ignore
import { actMessages, openDiffs } from "./lib.js";
import { asksOf, withAttn, trailerLine } from "./test-now.ts";

test("the as-of line is h:mm am or pm, no date", () => {
  expect(view.renderAsOf({ now: new Date(2026, 9, 28, 9, 5).toISOString() })).toBe("9:05 am");
  expect(view.renderAsOf({ now: new Date(2026, 9, 28, 21, 5).toISOString() })).toBe("9:05 pm");
  expect(view.renderAsOf(state)).toMatch(/^\d{1,2}:\d{2} (am|pm)$/);
});

test("a running job past 40 minutes says so", () => {
  const late = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:19:00Z", run: { kind: "build", started: "2026-10-27T16:19:00Z" } })] });
  expect(late).toContain("past the time box");
  expect(withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:30:00Z", run: { kind: "build", started: "2026-10-27T16:30:00Z" } })] })).not.toContain("past the time box");
});

test("a land run is measured from its own start and never past the time box", () => {
  const h = withAttn({ ...state, now: "2026-10-27T16:55:00Z", running: [job({ name: "a", started: "2026-10-27T16:00:00Z", run: { kind: "land", started: "2026-10-27T16:50:00Z" } })] });
  expect(h).toContain("land");
  expect(h).toContain('<span class="elapsed" data-since="2026-10-27T16:50:00Z">5:00</span> elapsed');
  expect(h).not.toContain("past the time box");
});

test("a worker run older than 40 minutes is past the time box", () => {
  const h = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T15:00:00Z", run: { kind: "build", started: "2026-10-27T16:00:00Z" } })] });
  expect(h).toContain("past the time box");
  expect(h).toContain("worker");
});

test("a build run is a worker and is past the time box after 40 minutes", () => {
  const h = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T15:00:00Z", run: { kind: "build", started: "2026-10-27T16:00:00Z" } })] });
  expect(h).toContain("worker");
  expect(h).toContain("past the time box");
  expect(withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:30:00Z", run: { kind: "build", started: "2026-10-27T16:30:00Z" } })] })).not.toContain("past the time box");
});

test("a 30-file stat shows 12 lines and +18 more files", () => {
  const stat = Array.from({ length: 30 }, (_, i) => ` f${i}.ts | 2 +-`).join("\n") + "\n 30 files changed, 30 insertions(+), 30 deletions(-)";
  const h = withAttn({ ...state, asks: asksOf([awaitingHeld({ name: "x", stat })]) });
  expect(h.match(/ f\d+\.ts \| 2/g)?.length).toBe(12);
  expect(h).toContain("+18 more files");
});

test("an awaiting row does not show checks as facts", () => {
  expect(withAttn(state)).not.toContain(" s ✓");
});

test("the Pause or Resume button sits in the page head beside the time; no Controls panel", () => {
  const on = view.renderControls(state);
  expect(on).toContain('data-act="pause"');
  expect(on).not.toContain('data-act="resume"');
  const off = view.renderControls({ ...state, factory: { ...state.factory, paused: true } });
  expect(off).toContain('data-act="resume"');
  expect(off).not.toContain('data-act="pause"');
  const page = view.view.render(state);
  expect(page).not.toContain('id="controls"');
  expect(page.indexOf('data-act="pause"')).toBeGreaterThan(page.indexOf('class="lede"'));
  expect(page.indexOf('data-act="pause"')).toBeGreaterThan(page.indexOf('class="asof"'));
  expect(page.indexOf('data-act="pause"')).toBeLessThan(page.indexOf('id="scorecard"'));
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
  expect(h).toContain(`<p class="trailers-line">aleph-240 \u00b7 <a href="#/jobs/aleph-240" title="${id}">agent run, Oct 28 04:28</a></p>`);
  expect(h.replace(/title="[^"]*"/, "")).not.toContain(id);
  expect(trailerLine({ ...land, trailers: [{ key: "Job", value: id.replace("agent", "land").replace("042822", "134500") }] }, state.now)).toContain(">land, Oct 28 13:45<");
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
  const run = (started: string) => withAttn({ ...state, now: "2027-01-05T12:00:00Z", running: [job({ name: "a", started, run: { kind: "land", started } })] });
  expect(run("2026-10-27T16:50:00Z")).toContain(">2026-10-27</span>");
  expect(run("2027-01-05T11:00:00Z")).toMatch(/>[A-Z][a-z]{2} \d\d \d\d:\d\d<\/span>/);
  const page = withAttn({ ...state, now: "2027-01-05T12:00:00Z", asks: asksOf([awaitingHeld({ name: "aleph-27", started: "2026-10-27T16:50:00Z", trailers: [{ key: "Job", value: "20261028-042822-aleph-aleph-240-agent" }] })]) });
  expect(page).toContain("Started</dt><dd>2026-10-27");
  expect(page).not.toMatch(/\d\d? ?[AP]M/i);
});

test("a planner run shows as planner in the running lane", async () => {
  const plan = { name: "plan-aleph-5", item: { title: "Big" }, condition: "running", run: { kind: "plan", started: "2026-10-27T16:50:00Z" }, started: "2026-10-27T16:50:00Z" };
  expect(withAttn({ ...state, running: [job({ name: "plan-aleph-5", run: plan.run })] })).toContain('<span class="badge run">planner');
});

test("a running firefighter run shows its role as the kind", () => {
  const s = { ...state, running: [job({ name: "firefighter", phase: "firefighter", run: { kind: "firefighter", started: "2026-10-27T16:55:00Z" } })] };
  expect(withAttn(s)).toContain('<span class="badge run">firefighter</span>');
});
