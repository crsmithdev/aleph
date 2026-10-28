import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as r from "./views/now.js";
// @ts-ignore
import { actMessages, openDiffs } from "./lib.js";

const job = (o: object) => ({ repo: "aleph", item: null, state: "running", started: "2026-10-27T16:00:00Z", defaults: [], followups: [], ...o });
const state: any = {
  now: "2026-10-27T17:00:00Z",
  factory: { paused: false, dayCap: 12, runsToday: 5, costToday: 0.25, nextTick: "2026-10-27T17:12:00Z", probe: { at: "2026-10-27T14:35:00Z", ok: true, failed: [] }, health: ["judge is down"] },
  needs: [job({ name: "aleph-27", state: "needs-you", reason: "Held path: hooks/lib/digest.ts", stat: " a.ts | 2 +-", defaults: ["Haiku tier per request"], item: { id: 27, title: "Digest head and tail" } })],
  stuck: [job({ name: "aleph-30", state: "stuck", reason: "types failed" })],
  running: [job({ name: "aleph-36", phase: "worker", item: { id: 36, title: "Route tiers" } })],
  delivered: [job({ name: "aleph-28", state: "landed", ended: "2026-10-27T16:30:00Z", commit: "50f301fabc", commitUrl: "https://github.com/o/r/commit/50f301fabc" })],
  waiting: [],
};

test("needs shows name, reason and defaults, and no copy commands", () => {
  const h = r.renderNeeds(state);
  for (const t of ["aleph-27", "Held path: hooks/lib/digest.ts", "Haiku tier per request", "a.ts | 2 +-"]) expect(h).toContain(t);
  expect(h).not.toContain("data-cmd=");
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
  expect(r.renderDelivered({ ...state, delivered: [] })).toContain("Nothing has landed yet.");
  // One line only, with no hint under it.
  expect(r.renderNeeds({ ...state, needs: [] }).match(/<p/g)?.length).toBe(1);
});

test("the metric cards count running, waiting, stuck and needs", () => {
  const h = r.renderMetrics(state);
  for (const [k, n] of [["Running", 1], ["Waiting", 0], ["Stuck", 1], ["Need attention", 1]]) expect(h).toContain(`<span class="k">${k}</span><span class="v">${n}</span>`);
  expect(h).toContain('class="metric need" href="#needs"');
  expect(r.renderMetrics({ ...state, needs: [] })).toContain('class="metric" href="#needs"');
  const page = r.view.render(state);
  for (const t of ["Next tick", "Cost today", "Runs today", 'id="ticks"', 'class="strip"']) expect(page).not.toContain(t);
});

test("text from the state is escaped", () => {
  const bad = { ...state, needs: [job({ name: "x", state: "needs-you", item: { id: 1, title: "<script>alert(1)</script>" } })], waiting: [{ repo: "a", id: 1, title: "<script>w</script>" }] };
  for (const h of [r.renderNeeds(bad), r.renderWaiting(bad)]) {
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  }
});

test("a needs-you entry has Diff, Land and Drop buttons; a landed one with an open check has Checked", () => {
  const h = r.renderNeeds(state);
  for (const v of ["diff", "land", "drop"]) expect(h).toContain(`data-act="${v}" data-name="aleph-27"`);
  expect(h).toContain("diff-panel");
  const open = { ...state, delivered: [{ ...state.delivered[0], check: "open" }] };
  expect(r.renderDelivered(open)).toContain('data-act="checked" data-name="aleph-28"');
  expect(r.renderDelivered(state)).not.toContain("data-act=");
  expect(r.renderDelivered(state)).not.toContain("data-cmd=");
});

test("a land from another day shows its date", () => {
  const old = { ...state, delivered: [{ ...state.delivered[0], ended: "2026-10-25T16:30:00Z" }] };
  expect(r.renderDelivered(old)).toMatch(/<dt>Landed<\/dt><dd>25 Oct \d\d:\d\d<\/dd>/);
  expect(r.renderDelivered(state)).toMatch(/<dt>Landed<\/dt><dd>\d\d:\d\d<\/dd>/);
});

const withFactory = (o: object) => ({ ...state, factory: { ...state.factory, health: [], ...o } });

test("a stuck job shows its reason, the failed check and its seconds, and Re-check and Drop buttons", () => {
  const h = r.renderStuck({ ...state, stuck: [job({ name: "aleph-30", state: "stuck", reason: "types failed", checks: [{ name: "lint", ok: true, seconds: 3 }, { name: "tsc", ok: false, seconds: 41 }] })] });
  for (const t of ["types failed", "tsc", "41 s", 'data-act="recheck" data-name="aleph-30"', 'data-act="drop" data-name="aleph-30"']) expect(h).toContain(t);
  expect(h).not.toContain("data-cmd");
});

test("four needs-you jobs render one expanded and three collapsed", () => {
  const needs = [1, 2, 3, 4].map((i) => job({ name: `aleph-${i}`, state: "needs-you", reason: "Held path", item: { id: i, title: `t${i}` } }));
  const h = r.renderNeeds({ ...state, needs });
  expect(h.match(/<details class="need-card need-fold" data-keep="need:[^"]*" open>/g)?.length).toBe(1);
  expect(h.match(/<details class="need-card need-fold" data-keep="need:[^"]*">/g)?.length).toBe(3);
  expect(h.match(/data-keep="need:/g)?.length).toBe(4);
  for (const i of [1, 2, 3, 4]) expect(h).toContain(`data-keep="need:aleph-${i}"`);
  expect(r.renderNeeds({ ...state, needs: needs.slice(0, 2) })).not.toContain("need-fold");
});

test("each factory condition renders the banner with its text", () => {
  expect(r.renderBanner(state)).toContain("judge is down");
  const cases: [object, string][] = [
    [{ runsToday: 12 }, "day cap is reached"],
    [{ paused: true }, "paused"],
    [{ hold: "Held: aleph-116 is stuck (merge conflict). No run starts or lands until it is cleared." }, "Held: aleph-116 is stuck (merge conflict). No run starts or lands until it is cleared."],
    [{ health: ["health: 3 runs wait for Chris; no new run starts"] }, "3 runs wait for Chris"],
    [{ health: ["health: aleph main is red"] }, "main is red"],
    [{ probe: { at: "2026-10-27T14:35:00Z", ok: false, failed: ["no network"] } }, "sandbox probe"],
  ];
  for (const [o, text] of cases) {
    const h = r.renderBanner(withFactory(o));
    expect(h).toContain('class="banner"');
    expect(h).toContain(text);
  }
  expect(r.renderBanner(withFactory({}))).toBe("");
  expect(r.view.render(withFactory({ paused: true }))).toContain('class="banner"');
});

test("a running job past 40 minutes says so", () => {
  const late = r.renderRunning({ ...state, running: [job({ name: "a", started: "2026-10-27T16:19:00Z" })] });
  expect(late).toContain("past the time box");
  expect(r.renderRunning({ ...state, running: [job({ name: "a", started: "2026-10-27T16:30:00Z" })] })).not.toContain("past the time box");
});

test("a 30-file stat shows 12 lines and +18 more files", () => {
  const stat = Array.from({ length: 30 }, (_, i) => ` f${i}.ts | 2 +-`).join("\n") + "\n 30 files changed, 30 insertions(+), 30 deletions(-)";
  const h = r.renderNeeds({ ...state, needs: [job({ name: "x", state: "needs-you", stat })] });
  expect(h.match(/ f\d+\.ts \| 2/g)?.length).toBe(12);
  expect(h).toContain("+18 more files");
});

test("a job with checks shows them as facts; one without shows none", () => {
  const checks = [{ name: "tests", ok: true, seconds: 71 }, { name: "types", ok: false, seconds: 9 }];
  const both = "<div><dt>Tests</dt><dd>71 s ✓</dd></div><div><dt>Types</dt><dd>9 s ✗</dd></div></dl>";
  expect(r.renderNeeds({ ...state, needs: [{ ...state.needs[0], checks }] })).toContain(both);
  expect(r.renderDelivered({ ...state, delivered: [{ ...state.delivered[0], checks }] })).toContain(both);
  expect(r.renderNeeds(state)).not.toContain(" s ✓");
  expect(r.renderDelivered(state)).not.toContain("checks");
});

test("the Controls panel shows Resume when paused and Pause when not, and nothing else", () => {
  const f = { ...state.factory, judge: "jev", liveCap: 10, waitingCap: 5 };
  const on = r.renderControls({ ...state, factory: f });
  expect(on).toContain('data-act="pause"');
  expect(on).not.toContain('data-act="resume"');
  const off = r.renderControls({ ...state, factory: { ...f, paused: true, judge: "haiku" } });
  expect(off).toContain('data-act="resume"');
  expect(off).not.toContain('data-act="pause"');
  for (const h of [on, off]) for (const t of ["judge", "Judge", "cap", "<dl"]) expect(h).not.toContain(t);
  expect(r.view.render(state)).toContain('id="controls"');
});

test("trailers show in a pre.trailers block with each key in <b>, escaped, and only when there are some", () => {
  const trailers = [{ key: "Item", value: "aleph-27" }, { key: "Job", value: "<script>x</script>" }];
  const needs = { ...state, needs: [job({ name: "aleph-27", state: "needs-you", trailers })] };
  const del = { ...state, delivered: [job({ name: "aleph-28", state: "landed", trailers })] };
  for (const h of [r.renderNeeds(needs), r.renderDelivered(del)]) {
    expect(h).toContain("<b>Item:</b> aleph-27");
    expect(h).toContain("&lt;script&gt;");
    expect(h).not.toContain("<script>");
  }
  const bare = { ...state, needs: [job({ name: "aleph-27", state: "needs-you" })] };
  expect(r.renderNeeds(bare)).not.toContain("trailers");
  expect(r.renderDelivered(state)).not.toContain("trailers");
});

const two: any = { ...state, needs: [job({ name: "job-a", state: "needs-you", defaults: [] }), job({ name: "job-b", state: "needs-you", defaults: [] })] };
const panel = (h: string, n: string) => h.match(new RegExp(`<div class="diff-panel" data-diff-for="${n}"[^>]*>`))![0];

test("an open diff survives a render; other panels stay hidden", () => {
  openDiffs.set("job-a", "@@ -1 +1 @@\n-old\n+new");
  try {
    const h = r.renderNeeds(two);
    expect(panel(h, "job-a")).not.toContain("hidden");
    expect(panel(h, "job-b")).toContain("hidden");
    expect(h).toContain("+new");
    expect(h).toContain("-old");
  } finally { openDiffs.clear(); }
});

test("an action message survives a render; none when empty", () => {
  actMessages.set("job-a", "land failed: conflict");
  try {
    const h = r.renderNeeds(two);
    expect(h).toContain('<span class="act-msg" role="alert">land failed: conflict</span>');
    expect(h.match(/act-msg/g)!.length).toBe(1);
  } finally { actMessages.clear(); }
  expect(r.renderNeeds(two)).not.toContain("act-msg");
});

test("message and diff text are escaped", () => {
  actMessages.set("job-a", "<b>x</b>");
  openDiffs.set("job-a", "+<script>alert(1)</script>");
  try {
    const h = r.renderNeeds(two);
    expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(h).toContain("&lt;script&gt;");
    expect(h).not.toContain("<script>");
  } finally { actMessages.clear(); openDiffs.clear(); }
});
