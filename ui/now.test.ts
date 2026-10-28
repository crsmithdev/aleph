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
  expect(r.renderLands(state)).toContain('<a href="https://github.com/o/r/commit/50f301fabc"><code>50f301f</code></a>');
  const none = r.renderLands({ ...state, delivered: [{ ...state.delivered[0], commitUrl: undefined }] });
  expect(none).not.toContain("<a ");
});

test("an empty section shows its empty state", () => {
  expect(r.renderWaiting(state)).toContain("No goal waits to start.");
  expect(r.renderNeeds({ ...state, needs: [] })).toContain("Nothing needs you.");
  expect(r.renderStuck({ ...state, stuck: [] })).toContain("No run is stuck.");
  expect(r.renderRunning({ ...state, running: [] })).toContain("Nothing is running.");
  expect(r.renderLands({ ...state, delivered: [] })).toContain("Nothing has landed yet.");
  // One line only, with no hint under it.
  expect(r.renderNeeds({ ...state, needs: [] }).match(/<p/g)?.length).toBe(1);
});

test("the metric cards count running, waiting, stuck, needs, landing and new", () => {
  const h = r.renderMetrics({ ...state, landing: 2, newIssues: 3 });
  expect(h.match(/class="metric[ "]/g)?.length).toBe(6);
  for (const [k, n] of [["Running", 1], ["Waiting", 0], ["Stuck", 1], ["Need attention", 1], ["Landing", 2], ["New", 3]]) expect(h).toContain(`<span class="k">${k}</span><span class="v">${n}</span>`);
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
  expect(r.renderLands(open)).toContain('data-act="checked" data-name="aleph-28"');
  expect(r.renderLands(state)).not.toContain("data-act=");
  expect(r.renderLands(state)).not.toContain("data-cmd=");
});

test("a land from another day shows its date", () => {
  const old = { ...state, delivered: [{ ...state.delivered[0], ended: "2026-10-25T16:30:00Z" }] };
  expect(r.renderLands(old)).toMatch(/<dt>Landed<\/dt><dd>25 Oct \d\d:\d\d<\/dd>/);
  expect(r.renderLands(state)).toMatch(/<dt>Landed<\/dt><dd>\d\d:\d\d<\/dd>/);
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
  expect(h.match(/<details class="job-card big need-card need-fold" data-keep="need:[^"]*" open>/g)?.length).toBe(1);
  expect(h.match(/<details class="job-card big need-card need-fold" data-keep="need:[^"]*">/g)?.length).toBe(3);
  expect(h.match(/data-keep="need:/g)?.length).toBe(4);
  for (const i of [1, 2, 3, 4]) expect(h).toContain(`data-keep="need:aleph-${i}"`);
  expect(r.renderNeeds({ ...state, needs: needs.slice(0, 2) })).not.toContain("need-fold");
});

test("the lede names what is wrong first, with counts, and the page has no banner", () => {
  const h = r.renderLede(withFactory({}));
  expect(h).toContain("1 job needs you");
  expect(h).toContain("1 job is stuck or failed");
  expect(h.indexOf("needs you")).toBeLessThan(h.indexOf("stuck"));
  const cases: [object, string][] = [
    [{ runsToday: 12 }, "day cap is reached"],
    [{ paused: true }, "paused"],
    [{ hold: "Held: aleph-116 is stuck (merge conflict). No run starts or lands until it is cleared." }, "Held: aleph-116 is stuck (merge conflict)."],
    [{ health: ["health: aleph main is red"] }, "main is red"],
    [{ probe: { at: "2026-10-27T14:35:00Z", ok: false, failed: ["no network"] } }, "sandbox probe"],
  ];
  for (const [o, text] of cases) expect(r.renderLede(withFactory(o))).toContain(text);
  const page = r.view.render(withFactory({ health: ["health: aleph main is red"] }));
  expect(page).not.toContain('class="banner"');
  expect(page).toMatch(/<p class="lede">[^]*main is red/);
});

test("with nothing wrong the lede is one plain phrase with no digit; paused says paused", () => {
  const calm = { ...withFactory({}), needs: [], stuck: [] };
  const h = r.renderLede(calm);
  expect(h).not.toMatch(/\d/);
  expect(h).toContain("The factory is running.");
  expect(r.renderLede({ ...calm, factory: { ...calm.factory, paused: true } })).toContain("paused");
});

test("the as-of line says Updated … ago", () => {
  expect(r.renderAsOf(state)).toMatch(/^Updated .+ ago$/);
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
  expect(r.renderLands({ ...state, delivered: [{ ...state.delivered[0], checks }] })).toContain(both);
  expect(r.renderNeeds(state)).not.toContain(" s ✓");
  expect(r.renderLands(state)).not.toContain("checks");
});

test("the Pause or Resume button sits in the page head before the updated line; no Controls panel", () => {
  const on = r.renderControls(state);
  expect(on).toContain('data-act="pause"');
  expect(on).not.toContain('data-act="resume"');
  const off = r.renderControls({ ...state, factory: { ...state.factory, paused: true } });
  expect(off).toContain('data-act="resume"');
  expect(off).not.toContain('data-act="pause"');
  const page = r.view.render(state);
  expect(page).not.toContain('id="controls"');
  expect(page.indexOf('data-act="pause"')).toBeGreaterThan(page.indexOf('class="lede"'));
  expect(page.indexOf('data-act="pause"')).toBeLessThan(page.indexOf('class="asof"'));
});

test("trailers show on one line joined by ' · ', escaped, and only when there are some", () => {
  const trailers = [{ key: "Item", value: "aleph-27" }, { key: "Job", value: "<script>x</script>" }, { key: "Held-by", value: "Chris" }];
  const needs = { ...state, needs: [job({ name: "aleph-27", state: "needs-you", trailers })] };
  const del = { ...state, delivered: [job({ name: "aleph-28", state: "landed", trailers })] };
  for (const h of [r.renderNeeds(needs), r.renderLands(del)]) {
    expect(h).toContain("Item aleph-27 · Job &lt;script&gt;x&lt;/script&gt; · Held-by Chris");
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("pre.trailers");
    expect(h).not.toContain('<pre class="trailers"');
  }
  const bare = { ...state, needs: [job({ name: "aleph-27", state: "needs-you" })] };
  expect(r.renderNeeds(bare)).not.toContain("trailers");
  expect(r.renderLands(state)).not.toContain("trailers");
});

test("every section renders its jobs with the job-card class: big for needs, stuck and lands, small for running and waiting", () => {
  const w = { ...state, waiting: [{ repo: "aleph", id: 9, title: "w" }] };
  for (const [h, size] of [[r.renderNeeds(state), "big"], [r.renderStuck(state), "big"], [r.renderLands(state), "big"], [r.renderRunning(state), "small"], [r.renderWaiting(w), "small"]] as const) {
    expect(h).toMatch(new RegExp(`class="job-card ${size}[ "]`));
    expect(h).not.toContain(size === "big" ? "job-card small" : "job-card big");
  }
});

test("Lands lists a running land before landed ones, has no origin/main aside, and counts Running and Needs you against their caps", () => {
  const lands = { ...state, delivered: [job({ name: "land-1", state: "running" }), ...state.delivered] };
  const h = r.renderLands(lands);
  expect(h).toContain(">Lands</h2>");
  expect(h).not.toContain("origin/main");
  expect(h.indexOf("land-1")).toBeLessThan(h.indexOf("aleph-28"));
  const f = { ...state.factory, liveCap: 12, waitingCap: 5 };
  const run = Array.from({ length: 3 }, (_, i) => job({ name: `r${i}` }));
  const need = Array.from({ length: 2 }, (_, i) => job({ name: `n${i}`, state: "needs-you" }));
  expect(r.renderRunning({ ...state, factory: f, running: run })).toContain('<span class="count">3 / 12</span>');
  expect(r.renderNeeds({ ...state, factory: f, needs: need })).toContain('<span class="count">2 / 5</span>');
  expect(r.renderStuck(state)).toContain('<span class="count">1</span>');
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
