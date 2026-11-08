import { afterEach, expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { setCodes } from "../lib/naming.ts";
import { state } from "./fixtures/status-state.ts";
import { full, section } from "./test-now.ts";

afterEach(() => setCodes({}));

const WEEK = {
  window: "week", done: 7, flaky: 2, kinds: { land: { count: 9 } },
  phases: { lead: { count: 7, p50: 1570, p90: 16560, hist: [], worst: 20000 } },
  buckets: [{ at: "2026-10-27T00:00:00", lead: 1000 }, { at: "2026-10-28T00:00:00", lead: null }],
  issues: { landed: 7, firstPass: 0.91, fixRounds: 0, week: 0.02 }, lost: { hours: 6, share: 0.38 },
  classes: [
    { key: "landed", name: "landed", hours: 8, causes: [{ name: "First run", hours: 8, runs: 8 }] }, { key: "returned", name: "returned", hours: 2, causes: [{ name: "Checks failed", hours: 2, runs: 2 }] },
    { key: "failed", name: "failed", hours: 2, causes: [{ name: "Issue had landed", hours: 2, runs: 3 }] },
    { key: "reran", name: "reran", hours: 4, causes: [{ name: "Issue had landed", hours: 1, runs: 1 }, { name: "No commit", hours: 3, runs: 2 }] },
    { key: "dropped", name: "dropped", hours: 0, causes: [] },
  ],
};

const BASE = { prev: { lost: 0.3, hours: 5, leadP50: 1200, leadP90: 9000, asks: 4, landed: 5, firstPass: 0.8 }, base: { lost: 0.25, hours: 4, leadP50: 1200, leadP90: 9000, asks: 4, landed: 5, firstPass: 0.8 }, basis: "the previous 7 days" };
const withBase = (d: any, asks = { count: 4, manual: 1 }) => ({ ...d, asks, baseline: BASE });

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

test("the Asks card shows all and manual counts, zeros with no Ask, and no p50 wait or Queue wait", () => {
  const h = view.renderTiles({ ...state, usage: USAGE }, withBase(WEEK), "week");
  expect(h).toContain("Asks");
  expect(h).not.toContain("Asks to Chris");
  expect(h).not.toContain("p50 wait");
  expect(h).toContain("<b>4<em> / 1</em></b>");
  expect(h).not.toContain("Queue wait");
  expect(view.renderTiles({ ...state, usage: USAGE }, withBase(WEEK, { count: 0, manual: 0 }), "week")).toContain("<b>0<em> / 0</em></b>");
});

test("the Landed card shows the clean share, then the clean count, and trends on the clean share", () => {
  const d = { ...WEEK, done: 49, issues: { ...WEEK.issues, landed: 49, firstPass: Math.round((38 / 49) * 1e4) / 1e4 }, baseline: BASE };
  const h = view.renderTiles({ ...state, usage: undefined }, d);
  expect(h).toContain("<b>78%<em> / 49</em></b>");
  expect(h).toContain("baseline 80%, the previous 7 days (change in percentage points)");
});

test("the Status page puts Agent Time and Pipeline in the main column, the Herald in the rail beside it, and no lanes", () => {
  const monitor = { day: "2026-11-04", findings: ["one"], stages: [], holds: [] };
  const page = view.view.render({ ...state, usage: USAGE, factory: { ...state.factory, monitor } }, {}, new URLSearchParams());
  const at = ['id="scorecard"', 'class="rail"', 'class="rail-main"', 'id="outcome"', 'id="pipeline"', 'id="herald"'].map((x) => page.indexOf(x));
  expect(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true);
  expect(page).not.toContain('class="lanes"');
});

test("mountStatus fetches the week and fills the scorecard, the outcome bar and the Pipeline, and no other panel from /api/speed", async () => {
  // @ts-ignore plain JS shared with the page
  const { resetSpeed } = await import("./views/speed.js");
  resetSpeed();
  const tiles = { innerHTML: "" }, outcome = { outerHTML: "" }, pipe = { outerHTML: "" }, other = { innerHTML: "" };
  const urls: string[] = [];
  await view.mountStatus({ querySelector: (s: string) => (s === "#scorecard" ? tiles : s === "#outcome" ? outcome : s === "#pipeline" ? pipe : s === ".ph" ? null : other) }, { ...state, usage: USAGE, now: "2026-11-01T08:00:00Z" }, async (u: string) => { urls.push(u); return { ok: true, json: async () => ({ ...WEEK, baseline: BASE }) }; });
  expect(urls).toEqual(["/api/speed?window=week&baseline=1"]);
  expect(tiles.innerHTML).toContain("<b>38%<em> / 6.0h</em></b>");
  expect(pipe.outerHTML).toContain('id="pipeline"');
  expect(other.innerHTML).toBe("");
  resetSpeed();
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
  const at = ['id="scorecard"', 'id="outcome"', 'id="pipeline"'].map((x) => page.indexOf(x));
  expect(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true);
  expect(page).toContain("Loading the outcomes");
  const outcome = { outerHTML: "" };
  const urls: string[] = [];
  await view.mountStatus({ querySelector: (s: string) => (s === "#outcome" ? outcome : null) }, { ...state, usage: USAGE }, async (u: string) => { urls.push(u); return { ok: true, json: async () => ({ ...WEEK, classes: [...WEEK.classes, { key: "idle", name: "Idle", hours: 0, causes: [] }] }) }; }, new URLSearchParams("window=week"));
  expect(outcome.outerHTML).toContain('class="obar"');
  const h = outcome.outerHTML;
  expect(h).toContain("<h2 id=\"h-outcome\">Agent Time</h2>");
  expect(h).not.toContain("by outcome");
  const sep = h.indexOf('class="osep"');
  expect(h).not.toContain("Reached main");
  expect(sep).toBeGreaterThan(h.indexOf("seg-landed"));
  expect(h).toMatch(/<div class="olegend"><span><i class="seg-landed"><\/i>[^<]+ <em>\([^)]+h \d+%\)<\/em><\/span>/);
  expect(h.slice(0, h.indexOf("olegend")).lastIndexOf("seg-returned")).toBeLessThan(sep);
  expect(h.indexOf("seg-failed")).toBeGreaterThan(sep);
  const needs = view.renderNeeds({ ...state, asks: [{ id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "x" }] });
  expect(needs).toContain('<h2 id="h-needs">Alerts</h2>');
  expect(needs).not.toContain("<h3>");
  expect(needs).not.toContain("Awaiting you");
  expect(outcome.outerHTML.match(/<button /g)?.length).toBe(WEEK.classes.filter((c) => c.hours > 0).length);
  resetSpeed();
});

test("the Status page says no goal and no Part", () => {
  const page = view.view.render({ ...full, usage: USAGE, queued: [{ repo: "aleph", id: 9, title: "w", at: "2026-10-27T16:00:00Z", since: "2026-10-27T16:00:00Z" }] }, {}, new URLSearchParams()) as string;
  expect(page).toContain("Discards the job&#39;s branch; the issue stays open.");
  const text = page.replace(/<[^>]*>/g, "");
  expect(text).not.toMatch(/goal/i);
  expect(text).not.toContain("Part");
});

test("the Status view is at / in the Factory group", () => {
  expect(view.view.path).toBe("/");
  expect(view.view.group).toBe("factory");
});

test("the Status page scorecard is a tiles section with the id scorecard", () => {
  const page = view.view.render({ ...full, usage: undefined } as any, {}, new URLSearchParams()) as string;
  expect(page).toContain('<section class="tiles" id="scorecard" aria-label="Scorecard">');
});
