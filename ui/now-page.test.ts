import { afterEach, expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
// @ts-ignore plain JS, shared with the page
import { error } from "./lib.js";
import { setCodes } from "../lib/naming.ts";
import { job, state } from "./fixtures/status-state.ts";
import { full, section } from "./test-now.ts";

afterEach(() => setCodes({}));

const WEEK = {
  window: "week", done: 7, flaky: 2, kinds: { land: { count: 9 } },
  phases: { lead: { count: 7, p50: 1570, p90: 16560, hist: [], worst: 20000 } },
  buckets: [{ at: "2026-10-27T00:00:00", lead: 1000 }, { at: "2026-10-28T00:00:00", lead: null }],
  issues: { landed: 7, firstPass: 0.91, fixRounds: 0, week: 0.02 }, lost: { hours: 6, share: 0.38 },
  classes: [
    { key: "landed", lost: false, hours: 8, causes: [{ name: "First run", hours: 8, runs: 8 }] }, { key: "returned", lost: false, hours: 2, causes: [{ name: "Checks failed", hours: 2, runs: 2 }] },
    { key: "failed", lost: true, hours: 2, causes: [{ name: "Issue had landed", hours: 2, runs: 3 }] },
    { key: "reran", lost: true, hours: 4, causes: [{ name: "Issue had landed", hours: 1, runs: 1 }, { name: "No commit", hours: 3, runs: 2 }] },
    { key: "dropped", lost: true, hours: 0, causes: [] },
  ],
  figures: { lost: 0.38, hours: 6, leadP50: 1570, leadP90: 16560, asks: null, landed: 7, firstPass: 0.91 },
};

const BASE = { prev: { lost: 0.3, hours: 5, leadP50: 1200, leadP90: 9000, asks: 4, landed: 5, firstPass: 0.8 }, base: { lost: 0.25, hours: 4, leadP50: 1200, leadP90: 9000, asks: 4, landed: 5, firstPass: 0.8 }, basis: "the previous 7 days" };
const withBase = (d: any, asks = { count: 4, manual: 1 }) => ({ ...d, asks, figures: { ...d.figures, asks: asks.count }, baseline: BASE });

const USAGE = { now: { seven_day: 7, five_hour: 2, seven_day_resets_at: "2026-11-07T08:00:00Z" }, series: [] };

test("a card has no trend without a baseline or with a zero baseline of a count", () => {
  const h = view.renderTiles({ ...state, usage: USAGE }, WEEK, "week");
  expect(h).not.toContain('class="tr');
  const z = view.renderTiles({ ...state, usage: USAGE }, { ...withBase(WEEK), baseline: { ...BASE, base: { ...BASE.base, landed: 0 } } }, "week");
  expect(z).not.toContain("Previous 5;");
});

test("the scorecard before the data arrives: dashes, and usage unknown with no usage", () => {
  const h = view.renderTiles({ ...state, usage: undefined }, null);
  expect(h.match(/<b>–/g)?.length).toBe(4);
  expect(h).not.toContain('class="tr');
});

test("the Jobs card shows live runs and queued, trends the runs against the baseline's mean live runs with no tone, and there is no Asks card", () => {
  const s = { ...state, usage: USAGE, factory: { ...state.factory, liveRuns: 3 }, queued: [{}, {}, {}, {}, {}] };
  const d = { ...WEEK, figures: { ...WEEK.figures, live: 2 }, baseline: { ...BASE, base: { ...BASE.base, live: 2 } } };
  const h = view.renderTiles(s, d, "week");
  expect(h).not.toContain("Asks");
  expect(h).toContain("<b>3<em> / 5</em></b>");
  expect(h).toContain('<span>running</span><span class="m"> / queued</span>');
  expect(h).toMatch(/<span class="tr" title="[^"]*baseline 2, the previous 7 days">▲ 50%<\/span>/);
  expect(view.renderTiles({ ...s, queued: [] }, null, "week")).toContain("<b>3<em> / 0</em></b>");
});

test("the Landed card shows the clean share, then the clean count, and trends on the clean share", () => {
  const firstPass = Math.round((38 / 49) * 1e4) / 1e4;
  const d = { ...WEEK, done: 49, issues: { ...WEEK.issues, landed: 49, firstPass }, figures: { ...WEEK.figures, landed: 49, firstPass }, baseline: BASE };
  const h = view.renderTiles({ ...state, usage: undefined }, d);
  expect(h).toContain("<b>78%<em> / 49</em></b>");
  expect(h).toContain("baseline 80%, the previous 7 days (change in percentage points)");
});

test("the Status page puts Agent Time, Pipeline and Active Issues in the main column and the Herald in the rail beside it", () => {
  const monitor = { day: "2026-11-04", findings: ["one"], stages: [], holds: [] };
  const page = view.view.render({ ...state, usage: USAGE, factory: { ...state.factory, monitor } }, {}, new URLSearchParams());
  const at = ['id="scorecard"', 'class="rail"', 'class="rail-main"', 'id="outcome"', 'id="pipeline"', 'id="active-issues"', 'id="herald"'].map((x) => page.indexOf(x));
  expect(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true);
});

/** The Status data after the view's `more`, with each /api/flow request in `urls` answered by `body`. */
async function more(body: unknown, q = new URLSearchParams()) {
  const was = globalThis.fetch, urls: string[] = [];
  globalThis.fetch = (async (u: string) => { urls.push(u); return { ok: true, json: async () => body }; }) as any;
  try { return { urls, s: await view.view.more({ ...state, usage: USAGE, now: "2026-11-01T08:00:00Z" }, q) }; } finally { globalThis.fetch = was; }
}

test("more fetches the week with its baseline, and the page fills the scorecard, the outcome bar and the Pipeline from it", async () => {
  const { urls, s } = await more({ ...WEEK, baseline: BASE });
  expect(urls).toEqual(["/api/flow?window=week&baseline=1"]);
  const page = view.view.render(s, {}, new URLSearchParams());
  expect(page).toContain("<b>38%<em> / 6.0h</em></b>");
  expect(page).toContain('class="obar thin"');
  expect(page).not.toContain("Loading the outcomes");
});

test("an ask keeps its action buttons on the page", () => {
  const page = view.view.render(full);
  expect(page).toContain('data-act="pause"');
  expect(section(page, "needs")).toMatch(/data-act="/);
});

test("the sidebar links and the routes exist", async () => {
  for (const [f, path, old] of [["factory-jobs", "/factory/jobs", "#/status/performance"], ["efficiency", "/flow", "#/status/efficiency"], ["factory-agents", "/factory/agents", "#/status/capacity"]]) {
    const m = await import(`./views/${f}.js`);
    expect(m.view.path).toBe(path);
    expect(m.redirect(old)).toBe(`#${path}`);
    expect(m.redirect(`#${path}`)).toBeNull();
  }
});

test("more loads the window of the address", async () => {
  expect((await more(WEEK, new URLSearchParams("window=hour"))).urls).toEqual(["/api/flow?window=hour&baseline=1"]);
});

test("the outcome bar sits between the scorecard and the panels and fills once more brings /api/flow", async () => {
  const page = view.view.render({ ...state, usage: USAGE }, {}, new URLSearchParams());
  const at = ['id="scorecard"', 'id="outcome"', 'id="pipeline"'].map((x) => page.indexOf(x));
  expect(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true);
  expect(page).toContain("Loading the outcomes");
  const { s } = await more({ ...WEEK, classes: [...WEEK.classes, { key: "idle", lost: false, hours: 0, causes: [] }] }, new URLSearchParams("window=week"));
  const filled = view.view.render(s, {}, new URLSearchParams("window=week")), h = filled.slice(filled.indexOf('id="outcome"'), filled.indexOf('id="pipeline"'));
  expect(h).toContain('class="obar thin"');
  expect(h).toContain("<h2 id=\"h-outcome\">Agent Time</h2>");
  expect(h).not.toContain("by outcome");
  // The kept share heads the card: 10h of 16h reached main. Kept classes sit left of the gap, lost ones right of it, in the bar and in the legend's two columns.
  expect(h).toContain('<span class="aside">10h of 16h</span>');
  expect(h).toContain('<div class="ohead"><b class="num">63%</b><span>reached main</span></div>');
  const bar = h.slice(h.indexOf('class="obar thin"'), h.indexOf('class="oledger')), gap = bar.indexOf('class="ogap"');
  expect(bar.indexOf("seg-returned")).toBeLessThan(gap);
  expect(bar.indexOf("seg-failed")).toBeGreaterThan(gap);
  expect(h).toContain('<div class="oledger num"><div><span><i class="seg-landed"></i>landed</span><span>8.0h</span><span class="m">50%</span>');
  expect(h).not.toContain("seg-idle");
  const needs = view.renderNeeds({ ...state, asks: [{ id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "x" }] });
  expect(needs).toContain('<h2 id="h-needs">Alerts</h2>');
  expect(needs).not.toContain("<h3>");
  expect(needs).not.toContain("Awaiting the user");
  expect(h.match(/<i class="seg-[a-z]+" style=/g)?.length).toBe(WEEK.classes.filter((c) => c.hours > 0).length);
});

test("the Status page titles a sub-issue link, with no goal and no Part", () => {
  const part = { n: 2, m: 3, parent: "Issue 1", href: "#/issues/aleph/1.2" };
  const page = view.view.render({ ...full, usage: USAGE, stuck: full.stuck.map((j: any) => ({ ...j, part })) }, {}, new URLSearchParams()) as string;
  expect(page).toContain('title="Sub-issue 2 of 3 of Issue 1"');
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

test("a failed flow load shows error() in the Agent Time card", () => {
  const page = view.view.render({ ...state, usage: USAGE }, {}, new URLSearchParams()), bad = view.view.render({ ...state, usage: USAGE, flow: { error: "x" } }, {}, new URLSearchParams());
  expect(page).not.toContain('role="alert"');
  expect(bad.slice(bad.indexOf('id="outcome"'), bad.indexOf('id="pipeline"'))).toContain(error("x"));
});

test("a stuck job's fold reads Technical details, and its blocker is an idLink", () => {
  const h = view.renderHerald({ ...full, asks: [], stuck: [job({ name: "aleph-30", condition: "failed", blocker: { id: "aleph-7", href: "#/issues/aleph/7", title: "Open work" } })] });
  expect(h).toContain("<summary>Technical details</summary>");
  expect(h).not.toContain("<summary>Details</summary>");
  expect(h).toContain('Blocker <a class="idl" href="#/issues/aleph/7">aleph-7</a>: Open work');
});

test("the Active Issues chart follows Pipeline: loading, error, and a chart panel with the stage keys", () => {
  const draw = (flow: unknown) => view.view.render({ ...state, usage: USAGE, flow } as any, {}, new URLSearchParams()) as string;
  const slice = (h: string) => h.slice(h.indexOf('id="pipeline"'));
  expect(slice(draw(undefined))).toContain("Loading the active issues");
  expect(slice(draw({ error: "x" }))).toContain(error("x"));
  const ok = slice(draw({ ...WEEK, active: [{ at: "2026-10-27T00:00:00", intake: 1, queue: 2, running: 3, landed: 4 }] }));
  expect(ok).toContain('<aleph-chart key="status/active"');
  const f = view.activeFrame({ ...WEEK, active: [] });
  expect(f.by.keys.map((k: any) => k.key)).toEqual(["intake", "queue", "running", "landed"]);
  expect(f.form).toBe("area");
});
