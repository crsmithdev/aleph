import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { job, state } from "./fixtures/status-state.ts";
import { withAttn, full, section } from "./test-now.ts";

test("needs shows name, reason and stat, and no copy commands", () => {
  const h = withAttn(state);
  for (const t of ["aleph-27", "Held path: hooks/lib/digest.ts", "a.ts | 2 +-"]) expect(h).toContain(t);
  expect(h).not.toContain("data-cmd=");
});

test("stuck, running and delivered show their jobs", () => {
  expect(withAttn(state)).toContain("types failed");
  expect(withAttn(state)).toContain("aleph-30");
  expect(withAttn(state)).toContain("aleph-36");
  expect(withAttn(state)).toContain("worker");
});

test("an empty lane shows one quiet line; the Needs-you section is absent when nothing is wrong", () => {
  const calm = { ...state, asks: [], stuck: [], running: [], queued: [], issues: [], done: [], factory: { ...state.factory, health: [] } };
  const lanes = view.renderLanes(calm);
  for (const t of ["Nothing is queued.", "Nothing is done yet.", "Nothing is running."]) expect(lanes).toContain(t);
  expect(lanes.match(/<p/g)?.length).toBe(3);
  expect(view.renderNeeds(calm)).toBe("");
  expect(view.view.render(calm)).not.toContain('id="needs"');
});

test("Status has no Standing permissions section", () => {
  const s = full;
  expect(view.view.render(s)).not.toContain("Standing permissions");
  expect(view.view.render(s)).not.toContain('data-act="revoke"');
});

const done = (n: number) => ({ id: `aleph-${n}`, title: `Done ${n}`, href: `#/issues/aleph/${n}`, finished: "2026-10-27T16:30:00Z",
  jobs: [job({ name: `triage-aleph-${n}`, condition: "done", outcome: "goal", run: { kind: "triage", started: "2026-10-27T10:00:00Z" } }),
    job({ name: `aleph-${n}`, condition: "landed", commit: "50f301fabc", commitUrl: "https://github.com/o/r/commit/50f301fabc", run: { kind: "land", started: "2026-10-27T15:00:00Z" } })] });

test("Latest done lists the issue as head with its triage, work and land jobs and commit as links", () => {
  const h = view.renderLanes({ ...state, done: [done(5), done(4)] }).match(/<section id="lane-done"[^]*?<\/section>/)![0];
  expect(h).toContain('<h2 id="h-done">Latest done</h2></div>');
  expect(h).toContain('<a href="#/issues/aleph/5" class="t">Done 5</a>');
  expect(h).toContain('href="#/jobs/aleph-5">land</a>');
  expect(h).toContain('href="#/jobs/triage-aleph-5">triage</a> (goal)');
  expect(h).toContain('<a href="https://github.com/o/r/commit/50f301fabc"><code>50f301f</code></a>');
  expect(h.indexOf("Done 5")).toBeLessThan(h.indexOf("Done 4"));
});

test("a Queued card names a dead blocker and offers to remove only that wait", () => {
  const q = view.renderLanes({ ...state, queued: [{ repo: "aleph", id: 964, title: "t", why: "x", kind: "waits_on", waits: [
    { id: "aleph-963", href: "#/issues/aleph/963", title: "Old <work>", state: "dropped", dead: "dropped" },
    { id: "aleph-970", href: "#/issues/aleph/970", title: "Live", state: "building", dead: null },
  ] }] });
  expect(q).toContain('<a href="#/issues/aleph/963">963</a> <span>Old &lt;work&gt;</span> <span class="badge stuck">dropped</span>');
  expect(q).toContain('<span class="badge quiet">building</span>');
  expect(q).toContain("this wait never ends");
  expect(q).toContain('data-act="unblock" data-repo="aleph" data-id="964"');
  expect(q).toContain(">Stop waiting on 963</button>");
});

test("Queued cards show why each goal waits", () => {
  const w = (id: number, why: string, kind: string, more: any = {}) => ({ repo: "aleph", id, title: `t${id}`, why, kind, ...more });
  const lanes = view.renderLanes({ ...state, queued: [
    w(1, "Waits on aleph-630", "waits_on", { waits: [{ id: "aleph-630", href: "#/issues/aleph/630", state: "building" }] }),
    w(3, "Starts at the next dispatch", "ready"),
    w(4, "Waiting for a slot (12 of 12 running)", "gate"),
  ] });
  const q = lanes.match(/<section id="lane-queued"[^]*?<\/section>/)![0];
  expect(q).toContain('Blocked by</div><div class="blocker"><a href="#/issues/aleph/630">630</a> <span class="badge quiet">building</span>');
  expect(q).not.toContain('data-act="unblock"');
  expect(q).toContain("Starts at the next dispatch");
  expect(q).toContain("Waiting for a slot (12 of 12 running)");
  expect(q.match(/Waiting for a slot/g)?.length).toBe(1);
  expect(q).toContain('href="#/issues/aleph/1"');
  expect(view.renderLanes({ ...state, queued: [{ repo: "aleph", id: 5, title: "x" }] })).toContain(">Queued</div>");
});

const WEEK = {
  window: "week", done: 7, flaky: 2, kinds: { land: { count: 9 } },
  phases: { lead: { count: 7, p50: 1570, p90: 16560, hist: [], worst: 20000 } },
  buckets: [{ at: "2026-10-27T00:00:00", lead: 1000 }, { at: "2026-10-28T00:00:00", lead: null }],
  issues: { landed: 7, firstPass: 0.91, fixRounds: 0, week: 0.02 }, lost: { hours: 6, share: 0.38 },
  classes: [
    { key: "landed", name: "Landed", hours: 8, causes: [{ name: "First run", hours: 8, runs: 8 }] }, { key: "fixed", name: "Fixed", hours: 2, causes: [{ name: "Checks failed", hours: 2, runs: 2 }] },
    { key: "nothing", name: "Late", hours: 2, causes: [{ name: "Issue had landed", hours: 2, runs: 3 }] },
    { key: "restarted", name: "Restarted", hours: 4, causes: [{ name: "Issue had landed", hours: 1, runs: 1 }, { name: "No commit", hours: 3, runs: 2 }] },
    { key: "dropped", name: "Dropped", hours: 0, causes: [] },
  ],
};

const DAY = { ...WEEK, window: "day", done: 3, phases: { lead: { count: 2, p50: 900, p90: 1000 } }, issues: { ...WEEK.issues, firstPass: 0.8 }, lost: { hours: 1, share: 0.15 } };

const USAGE = { now: { seven_day: 7, five_hour: 2, seven_day_resets_at: "2026-11-07T08:00:00Z" }, series: [] };

test("the page order is the status line, Awaiting you, the scorecard, the lanes, the causes; the window picker, no flow strip", () => {
  const page = view.view.render(full);
  const order = ['class="lede"', 'class="asof"', 'class="say', 'data-act="pause"', 'id="needs"', 'id="scorecard"', 'id="lane-running"', 'id="lane-queued"', 'id="lane-done"', 'id="causes"'];
  const at = order.map((t) => page.indexOf(t));
  expect(at.every((v) => v >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  for (const t of ["wpick", 'id="flow"', 'id="lane-incoming"', 'id="speed"', 'id="efficiency"']) expect(page).not.toContain(t);
});

test("the scorecard has five tiles with values from the data and 24 h comparisons", () => {
  const h = view.renderTiles({ ...state, now: "2026-11-01T08:00:00Z", usage: USAGE }, WEEK, DAY, "week", DAY);
  expect([...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1])).toEqual(["Lost time", "Lead time p50", "First pass", "Lands", "Weekly usage"]);
  expect([...h.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1])).toEqual(["38%", "26m", "91%", "7", "7%"]);
  expect(h).toContain('<span class="warn">▲ 23% vs 30-day average</span>');
  expect(h).toContain('<span class="good">▲ 11% vs 30-day average</span>');
  expect(h).toContain("9 land runs");
  expect(h).toContain("3 in the last 24 h, 1 a day on average");
  for (const t of ["#/factory/efficiency", "#/factory/jobs", "#/factory/agents"]) expect(h).toContain(`href="${t}"`);
  expect(h).toContain("under pace: 14.3% of the week gone");
});

test("the scorecard before the data arrives: dashes, and usage unknown with no usage", () => {
  const h = view.renderTiles({ ...state, usage: undefined }, null, null);
  expect(h.match(/<b>–<\/b>/g)?.length).toBe(5);
  expect(h).toContain("usage unknown");
});

test("the causes merge across the lost classes, largest first, and leave out the classes that reached main", () => {
  const h = view.renderCauses(WEEK);
  expect([...h.matchAll(/efficiency">([^<]+)</g)].map((m) => m[1])).toEqual(["Issue had landed", "No commit"]);
  expect(h).toContain("3.0 h · 4 runs");
  expect(h).toContain("The first cause is 50% of the loss: Issue had landed, 4 runs.");
  expect(h.match(/class="barrow top"/g)?.length).toBe(1);
  expect(view.renderCauses(null)).toContain("Loading");
  expect(view.renderCauses({ error: "no <data>" })).toContain("no &lt;data&gt;");
  expect(view.renderCauses({ classes: [] })).toContain("No agent time was lost");
});

test("mountStatus fetches the week and the day and fills the scorecard and the causes", async () => {
  // @ts-ignore plain JS shared with the page
  const { resetSpeed } = await import("./views/speed.js");
  resetSpeed();
  const tiles = { innerHTML: "" }, causes = { innerHTML: "" };
  const urls: string[] = [];
  await view.mountStatus({ querySelector: (s: string) => (s === "#scorecard" ? tiles : s === "#causes" ? causes : null) }, { ...state, usage: USAGE, now: "2026-11-01T08:00:00Z" }, async (u: string) => { urls.push(u); return { ok: true, json: async () => (u.includes("day") ? DAY : WEEK) }; });
  expect(urls.sort()).toEqual(["/api/speed?window=day", "/api/speed?window=month", "/api/speed?window=week"]);
  expect(tiles.innerHTML).toContain("<b>38%</b>");
  expect(causes.innerHTML).toContain("Issue had landed");
  resetSpeed();
});

test("the lanes: Running shows live agent runs of the cap and lists every open run; Latest done has two at most", () => {
  const mk = (n: number, kind: string) => job({ name: `${kind}-${n}`, run: { kind, started: "2026-10-30T09:00:00Z" } });
  const running = [...Array.from({ length: 12 }, (_, i) => mk(i, "agent")), mk(1, "land"), mk(2, "land")];
  const h = view.renderLanes({ ...full, running, factory: { ...full.factory, liveCap: 12, liveRuns: 12 }, done: [] });
  expect(h).toContain('<h2 id="h-running">Running</h2><span class="count">12 of 12</span>');
  expect((h.match(/class="[^"]*run-row/g) ?? []).length).toBe(14);
  const d = (n: number) => ({ id: `aleph-${n}`, title: `D${n}`, href: "#/x", jobs: [] });
  expect((view.renderLanes({ ...full, done: [d(1), d(2), d(3)] }).match(/done-row/g) ?? []).length).toBe(2);
});

test("an ask keeps its action buttons on the page", () => {
  const page = view.view.render(full);
  expect(page).toContain('data-act="pause"');
  expect(section(page, "needs")).toMatch(/data-act="/);
});

test("the sidebar links and the routes exist", async () => {
  for (const [f, path, old] of [["factory-jobs", "/factory/jobs", "#/status/performance"], ["efficiency", "/factory/efficiency", "#/status/efficiency"], ["factory-agents", "/factory/agents", "#/status/capacity"]]) {
    const m = await import(`./views/${f}.js`);
    expect(m.view.path).toBe(path);
    expect(m.redirect(old)).toBe(`#${path}`);
    expect(m.redirect(`#${path}`)).toBeNull();
  }
});

test("the Weekly usage tile shows the snapshot's age only while stale", () => {
  const now = { seven_day: 25, five_hour: 1, at: "2026-11-01T07:20:00Z", seven_day_resets_at: "2026-11-07T08:00:00Z" };
  const st = { ...state, now: "2026-11-01T08:00:00Z" };
  expect(view.renderTiles({ ...st, usage: { now, stale: true } }, WEEK, DAY)).toContain("as of 40m ago");
  expect(view.renderTiles({ ...st, usage: { now, stale: false } }, WEEK, DAY)).not.toContain("as of");
});

const pressedIn = (h: string) => [...(h.match(/data-name="window">(.*?)<\/div>/)?.[1] ?? "").matchAll(/data-value="(\w+)" aria-pressed="(\w+)"/g)];

test("the page head holds the Hour, Day, Week, Month picker with the chosen window pressed", () => {
  const page = view.view.render(full, {}, new URLSearchParams("window=month"));
  const head = page.match(/<header class="ph">.*?<\/header>/)![0];
  expect(head).toContain("<h1>Status</h1>");
  expect(head).toContain('class="aside"');
  expect(pressedIn(head).map((m) => m[1])).toEqual(["hour", "day", "week", "month"]);
  expect(pressedIn(head).filter((m) => m[2] === "true").map((m) => m[1])).toEqual(["month"]);
  for (const t of [">Hour<", ">Day<", ">Week<", ">Month<"]) expect(head).toContain(t);
  expect(pressedIn(view.view.render(full, {}, new URLSearchParams())).filter((m) => m[2] === "true").map((m) => m[1])).toEqual(["week"]);
});

test("the speed tiles follow the window: values, captions, 24 h trend and links", () => {
  const MONTH = { ...WEEK, window: "month", done: 30, issues: { ...WEEK.issues, firstPass: 0.6 } };
  const HOUR = { ...WEEK, window: "hour", done: 2, issues: { ...WEEK.issues, firstPass: 0.4 } };
  const m = view.renderTiles({ ...state, usage: USAGE }, MONTH, DAY, "month");
  expect(m).toContain("<b>60%</b>");
  expect(m).toContain("issues landed, 30 days");
  expect(m).toContain("30 days");
  expect(m).not.toContain("7 days");
  expect(m).toContain('href="#/factory/efficiency?window=month"');
  expect(m).toContain('href="#/factory/jobs?window=month"');
  expect(m).toContain("in the last 24 h");
  expect(m).not.toContain("30-day average");
  const h = view.renderTiles({ ...state, usage: USAGE }, HOUR, DAY, "hour", MONTH);
  expect(h).toContain("30-day average");
  expect(h).toContain("<b>40%</b>");
  expect(h).toContain("issues landed, hour");
  expect(h).not.toContain("in the last 24 h");
  expect(h).toContain('href="#/factory/jobs?window=hour"');
  expect(h).toContain("Weekly usage");
  expect(h).toContain('href="#/factory/agents"');
});

test("mountStatus loads the window of the address", async () => {
  const g: any = globalThis;
  g.localStorage = { getItem: () => null, setItem: () => {} };
  g.location = { hash: "#/?window=hour" };
  g.history = { replaceState: () => {} };
  // @ts-ignore plain JS shared with the page
  const { resetSpeed } = await import("./views/speed.js");
  resetSpeed();
  const urls: string[] = [];
  await view.mountStatus({ querySelector: () => null }, { ...state, usage: USAGE }, async (u: string) => { urls.push(u); return { ok: true, json: async () => WEEK }; }, new URLSearchParams("window=hour"));
  expect(urls.sort()).toEqual(["/api/speed?window=day", "/api/speed?window=hour", "/api/speed?window=month"]);
  resetSpeed();
  delete g.localStorage; delete g.location; delete g.history;
});
