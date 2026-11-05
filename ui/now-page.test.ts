import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { job, state } from "./fixtures/status-state.ts";
import { full, section } from "./test-now.ts";

test("a Queued card names a dead blocker and offers to remove only that wait", () => {
  const q = view.renderLanes({ ...state, queued: [{ repo: "aleph", id: 964, title: "t", why: "x", kind: "waits_on", waits: [
    { id: "aleph-963", href: "#/issues/aleph/963", title: "Old <work>", state: "dropped", dead: "dropped" },
    { id: "aleph-970", href: "#/issues/aleph/970", title: "Live", state: "working", dead: null },
  ] }] });
  expect(q).toContain('<a href="#/issues/aleph/963">963</a> <span>Old &lt;work&gt;</span> <span class="badge stuck">dropped</span>');
  expect(q).not.toContain("Live");
  expect(q).toContain("this wait never ends");
  expect(q).toContain('data-act="unblock" data-repo="aleph" data-id="964"');
  expect(q).toContain(">Stop waiting on 963</button>");
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

const BASE = { prev: { lost: 0.3, hours: 5, leadP50: 1200, leadP90: 9000, asks: 4, askP50: 60, landed: 5, firstPass: 0.8 }, base: { lost: 0.25, hours: 4, leadP50: 1200, leadP90: 9000, asks: 4, askP50: 60, landed: 5, firstPass: 0.8 }, basis: "the previous 7 days" };
const withBase = (d: any, asks = { count: 4, wait: { count: 3, p50: 90, p90: 400 } }) => ({ ...d, asks, baseline: BASE });

const USAGE = { now: { seven_day: 7, five_hour: 2, seven_day_resets_at: "2026-11-07T08:00:00Z" }, series: [] };

test("a card has no trend without a baseline or with a zero baseline of a count", () => {
  const h = view.renderTiles({ ...state, usage: USAGE }, WEEK, "week");
  expect(h).not.toContain('class="tr');
  const z = view.renderTiles({ ...state, usage: USAGE }, { ...withBase(WEEK), baseline: { ...BASE, base: { ...BASE.base, landed: 0 } } }, "week");
  expect(z).not.toContain("Previous 5;");
});

test("the scorecard before the data arrives: dashes, and usage unknown with no usage", () => {
  const h = view.renderTiles({ ...state, usage: undefined }, null);
  expect(h.match(/<b>–/g)?.length).toBe(5);
  expect(h).not.toContain('class="tr');
});

test("the Asks to Chris card shows the count and the p50 wait, dashes with no Ask, and no Queue wait card", () => {
  const h = view.renderTiles({ ...state, usage: USAGE }, withBase(WEEK), "week");
  expect(h).toContain("Asks to Chris");
  expect(h).toContain("<b>4<em> / 1m</em></b>");
  expect(h).not.toContain("Queue wait");
  expect(view.renderTiles({ ...state, usage: USAGE }, withBase(WEEK, { count: 0, wait: { count: 0, p50: 0, p90: 0 } }), "week")).toContain("<b>–<em> / –</em></b>");
});

test("the Landed card shows the clean share, then the clean count, and trends on the clean share", () => {
  const d = { ...WEEK, done: 49, issues: { ...WEEK.issues, landed: 49, firstPass: Math.round((38 / 49) * 1e4) / 1e4 }, baseline: BASE };
  const h = view.renderTiles({ ...state, usage: undefined }, d);
  expect(h).toContain("<b>78%<em> / 38 of 49</em></b>");
  expect(h).toContain("baseline 80%, the previous 7 days (change in percentage points)");
});

test("the causes merge across the lost classes, largest first, and leave out the classes that reached main", () => {
  const h = view.renderCauses(WEEK);
  expect([...h.matchAll(/efficiency">([^<]+)</g)].map((m) => m[1])).toEqual(["Issue had landed", "No commit"]);
  expect(h).toContain("3.0h · 4 runs");
  expect(h).toContain("The first cause is 50% of the loss: Issue had landed, 4 runs.");
  expect(h.match(/class="barrow top"/g)?.length).toBe(1);
  expect(view.renderCauses(null)).toContain(`<p class="quiet" role="status">Loading the causes…</p>`);
  expect(view.renderCauses({ error: "no <data>" })).toContain("no &lt;data&gt;");
  expect(view.renderCauses({ classes: [] })).toContain("No agent time was lost");
});

test("mountStatus fetches the week and the day and fills the scorecard and the causes", async () => {
  // @ts-ignore plain JS shared with the page
  const { resetSpeed } = await import("./views/speed.js");
  resetSpeed();
  const tiles = { innerHTML: "" }, causes = { innerHTML: "" };
  const urls: string[] = [];
  await view.mountStatus({ querySelector: (s: string) => (s === "#scorecard" ? tiles : s === "#causes" ? causes : null) }, { ...state, usage: USAGE, now: "2026-11-01T08:00:00Z" }, async (u: string) => { urls.push(u); return { ok: true, json: async () => ({ ...WEEK, baseline: BASE }) }; });
  expect(urls).toEqual(["/api/speed?window=week&baseline=1"]);
  expect(tiles.innerHTML).toContain("<b>38%<em> / 6.0h</em></b>");
  expect(causes.innerHTML).toContain("Issue had landed");
  resetSpeed();
});

test("the slowness panel ranks the phases by p90, and the Status page puts the row above the lanes", async () => {
  const P = (p90: number) => ({ count: 3, p50: 1, p90 });
  const h = view.renderSlowness({ phases: { intake: P(258), queue: P(1716), implement: P(272), land: P(100) } });
  const order = ["queue", "implement", "intake", "land"].map((n) => h.indexOf(`<span class="bl">${n}</span>`));
  expect(order.every((i) => i >= 0) && [...order].sort((a, b) => a - b).join() === order.join()).toBe(true);
  expect(view.renderSlowness(null)).toContain("Loading the phases");
  expect(view.renderSlowness({ error: "no <data>" })).toContain("no &lt;data&gt;");
  expect(view.renderSlowness({ phases: {} })).toContain("No work ended in the window");
  const monitor = { day: "2026-11-04", findings: ["one"], table: "t" };
  const page = view.view.render({ ...state, usage: USAGE, factory: { ...state.factory, monitor } }, {}, new URLSearchParams());
  const at = ['class="insights"', 'id="causes"', 'id="slowness"', 'id="monitor"', 'class="lanes"'].map((x) => page.indexOf(x));
  expect(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true);
  const row = page.slice(at[0], at[4]);
  expect(row.includes('id="causes"') && row.includes('id="slowness"') && row.includes('id="monitor"')).toBe(true);
  // @ts-ignore plain JS shared with the page
  const { resetSpeed } = await import("./views/speed.js");
  resetSpeed();
  const slow = { innerHTML: "" };
  await view.mountStatus({ querySelector: (s: string) => (s === "#slowness" ? slow : null) }, { ...state, usage: USAGE }, async () => ({ ok: true, json: async () => ({ ...WEEK, phases: { queue: P(1716), land: P(100) } }) }));
  expect(slow.innerHTML.indexOf('<span class="bl">queue</span>')).toBeGreaterThanOrEqual(0);
  expect(slow.innerHTML.indexOf('<span class="bl">queue</span>')).toBeLessThan(slow.innerHTML.indexOf('<span class="bl">land</span>'));
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
  expect(urls).toEqual(["/api/speed?window=hour&baseline=1"]);
  resetSpeed();
  delete g.localStorage; delete g.location; delete g.history;
});

test("the outcome bar sits between the scorecard and the panels and mountStatus fills it", async () => {
  // @ts-ignore plain JS shared with the page
  const { resetSpeed } = await import("./views/speed.js");
  resetSpeed();
  const page = view.view.render({ ...state, usage: USAGE }, {}, new URLSearchParams());
  const at = ['id="scorecard"', 'id="outcome"', 'class="insights"'].map((x) => page.indexOf(x));
  expect(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true);
  expect(page).toContain("Loading the outcomes");
  const outcome = { innerHTML: "" };
  const urls: string[] = [];
  await view.mountStatus({ querySelector: (s: string) => (s === "#outcome" ? outcome : null) }, { ...state, usage: USAGE }, async (u: string) => { urls.push(u); return { ok: true, json: async () => ({ ...WEEK, classes: [...WEEK.classes, { key: "idle", name: "Idle", hours: 0, causes: [] }] }) }; }, new URLSearchParams("window=week"));
  expect(outcome.innerHTML).toContain('class="obar"');
  expect(outcome.innerHTML.match(/<button /g)?.length).toBe(WEEK.classes.filter((c) => c.hours > 0).length);
  resetSpeed();
});
