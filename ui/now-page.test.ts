import { afterEach, expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { setCodes } from "../lib/naming.ts";
import { job, state } from "./fixtures/status-state.ts";
import { full, section } from "./test-now.ts";

afterEach(() => setCodes({}));

test("a Queued card names a dead blocker and offers to remove only that wait", () => {
  setCodes({ aleph: "a" });
  const q = view.renderLanes({ ...state, queued: [{ repo: "aleph", id: 964, title: "t", kind: "waits_on", waits: [
    { id: "aleph-963", href: "#/issues/aleph/963", title: "Old <work>", state: "dropped", dead: "dropped" },
    { id: "aleph-970", href: "#/issues/aleph/970", title: "Live", state: "working", dead: null },
  ] }] });
  expect(q).toContain('<a href="#/issues/aleph/963">a963</a> <span>Old &lt;work&gt;</span> <span class="badge stuck">dropped</span>');
  expect(q).not.toContain("Live");
  expect(q).toContain("this wait never ends");
  expect(q).toContain('data-act="unblock" data-repo="aleph" data-id="964"');
  expect(q).toContain(">Stop waiting on a963</button>");
});

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

test("the Status page puts the Stages, Holds and Monitor panels in one row above the lanes", () => {
  const monitor = { day: "2026-11-04", findings: ["one"], stages: [], holds: [] };
  const page = view.view.render({ ...state, usage: USAGE, factory: { ...state.factory, monitor } }, {}, new URLSearchParams());
  const at = ['class="insights"', 'id="stages"', 'id="holds"', 'id="monitor"', 'class="lanes"'].map((x) => page.indexOf(x));
  expect(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true);
});

test("mountStatus fetches the week and fills the scorecard and the outcome bar, and no other panel from /api/speed", async () => {
  // @ts-ignore plain JS shared with the page
  const { resetSpeed } = await import("./views/speed.js");
  resetSpeed();
  const tiles = { innerHTML: "" }, outcome = { outerHTML: "" }, other = { innerHTML: "" };
  const urls: string[] = [];
  await view.mountStatus({ querySelector: (s: string) => (s === "#scorecard" ? tiles : s === "#outcome" ? outcome : s === ".ph" ? null : other) }, { ...state, usage: USAGE, now: "2026-11-01T08:00:00Z" }, async (u: string) => { urls.push(u); return { ok: true, json: async () => ({ ...WEEK, baseline: BASE }) }; });
  expect(urls).toEqual(["/api/speed?window=week&baseline=1"]);
  expect(tiles.innerHTML).toContain("<b>38%<em> / 6.0h</em></b>");
  expect(other.innerHTML).toBe("");
  resetSpeed();
});

test("the lanes: Running shows live agent runs of the cap and lists every open run; Done lists every done item", () => {
  const mk = (n: number, kind: string) => job({ name: `${kind}-${n}`, run: { kind, started: "2026-10-30T09:00:00Z" } });
  const running = [...Array.from({ length: 12 }, (_, i) => mk(i, "agent")), mk(1, "land"), mk(2, "land")];
  const h = view.renderLanes({ ...full, running, factory: { ...full.factory, liveCap: 12, liveRuns: 12 }, done: [] });
  expect(h).toContain('<div class="sh"><h2 id="h-running">Running</h2><span class="count">12 of 12</span></div>');
  expect(view.renderStages(full)).toContain('<div class="sh"><h2 id="h-stages">Stages</h2></div>');
  expect(view.renderHolds(full)).toContain('<div class="sh"><h2 id="h-holds">Holds</h2></div>');
  expect((h.match(/class="[^"]*run-row/g) ?? []).length).toBe(14);
  const d = (n: number) => ({ id: `aleph-${n}`, title: `D${n}`, href: "#/x", jobs: [] });
  const done = view.renderLanes({ ...full, done: Array.from({ length: 10 }, (_, i) => d(i)) });
  expect((done.match(/done-row/g) ?? []).length).toBe(10);
  expect(done).toContain('<h2 id="h-done">Done</h2><span class="count">10</span>');
  expect(done).not.toContain("Latest done");
});

test("lane cards show no why text and a worker tag reads its tier and model", () => {
  const run = (o: object) => view.renderLanes({ ...state, queued: [{ repo: "aleph", id: 1, title: "t", kind: "ready" }],
    running: [job({ name: "a", run: { kind: "build", started: "2026-10-27T15:00:00Z" }, ...o })] });
  const h = run({});
  expect(h).not.toContain('class="why"');
  expect(h).toContain(">worker</span>");
  expect(run({ tier: "haiku", model: "haiku" })).toContain(">worker · low · haiku</span>");
  expect(run({ tier: "haiku", model: "gpt-oss-20b" })).toContain(">worker · low · gpt-oss-20b</span>");
  expect(run({ model: "claude-opus-4-1" })).toContain(">worker · high · opus</span>");
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
  const outcome = { outerHTML: "" };
  const urls: string[] = [];
  await view.mountStatus({ querySelector: (s: string) => (s === "#outcome" ? outcome : null) }, { ...state, usage: USAGE }, async (u: string) => { urls.push(u); return { ok: true, json: async () => ({ ...WEEK, classes: [...WEEK.classes, { key: "idle", name: "Idle", hours: 0, causes: [] }] }) }; }, new URLSearchParams("window=week"));
  expect(outcome.outerHTML).toContain('class="obar"');
  const h = outcome.outerHTML;
  expect(h).toContain("<h2 id=\"h-outcome\">Agent Time</h2>");
  expect(h).not.toContain("by outcome");
  const sep = h.indexOf('class="osep"');
  expect(h.indexOf('<span class="obk">Reached main</span>')).toBeLessThan(h.indexOf("seg-landed"));
  expect(sep).toBeGreaterThan(h.indexOf("seg-landed"));
  expect(h.indexOf('<span class="obk">Did not reach main</span>')).toBeGreaterThan(sep);
  expect(h.lastIndexOf("seg-returned")).toBeLessThan(sep);
  expect(h.indexOf("seg-failed")).toBeGreaterThan(sep);
  const needs = view.renderNeeds({ ...state, asks: [{ id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "x" }] });
  expect(needs).toContain('<h2 id="h-needs">Alerts</h2>');
  expect(needs).not.toContain("<h3>");
  expect(needs).not.toContain("Awaiting you");
  expect(outcome.outerHTML.match(/<button /g)?.length).toBe(WEEK.classes.filter((c) => c.hours > 0).length);
  resetSpeed();
});

test("the Status view is at / in the Factory group", () => {
  expect(view.view.path).toBe("/");
  expect(view.view.group).toBe("factory");
});

test("a held Queued card ends its meta row with its hold event: the action word and the content, with no wait text and no status chip", () => {
  setCodes({ r: "r" });
  const w = { repo: "r", title: "t", stage: "held", at: "2026-11-02T11:00:00Z", since: "2026-11-02T11:00:00Z" };
  const html = view.renderLanes({ ...state, queued: [
    { ...w, id: 1, kind: "not-ready", ev: { action: "after", on: ["r-9"] }, waits: [{ id: "r-9", href: "#/issues/r/9", state: "working", dead: null }] },
    { ...w, id: 2, kind: "busy-file", ev: { action: "busy", on: ["r-7"], file: "a.ts" } },
  ] });
  expect(html).toMatch(/class="num dur">[^<]*<\/span><span class="blocked">after r9<\/span><\/div>/);
  expect(html).toMatch(/class="num dur">[^<]*<\/span><span class="blocked">busy r7 → a\.ts<\/span><\/div>/);
  expect(html).not.toContain("blocked: ");
  expect(html).not.toContain("Waits on");
  expect(html).not.toContain("waits for");
  expect(html).not.toContain('class="badge quiet">held');
  expect(html).not.toContain(">blocked</span>");
});

test("a land card has its own kind class, and the Done header counts the selected window", () => {
  const run = (kind: string) => ({ name: "j", repo: "r", item: { title: "t" }, started: "2026-11-02T11:00:00Z", run: { kind, started: "2026-11-02T11:00:00Z" } });
  const html = view.renderLanes({ ...state, running: [run("land"), run("build")] });
  expect(html).toContain("run-row kind-land");
  expect(html).toContain("run-row kind-worker");
  const day = Date.parse(state.now);
  const done = { ...state, done: [1, 2].map((n) => ({ id: `r-${n}`, title: "d", href: "#/x", jobs: [] })),
    doneStamps: [0, 1, 2, 3 * 86_400_000, 20 * 86_400_000].map((a, i) => ({ id: `r-${i}`, at: day - a })) };
  expect(view.renderLanes(done)).toContain('<h2 id="h-done">Done</h2><span class="count">2 of 4</span>');
  expect(view.renderLanes(done, "day")).toContain('<span class="count">2 of 3</span>');
  expect(view.renderLanes(done, "month")).toContain('<span class="count">2 of 5</span>');
});

test("the Status page scorecard is a tiles section with the id scorecard", () => {
  const page = view.view.render({ ...full, usage: undefined } as any, {}, new URLSearchParams()) as string;
  expect(page).toContain('<section class="tiles" id="scorecard" aria-label="Scorecard">');
});
