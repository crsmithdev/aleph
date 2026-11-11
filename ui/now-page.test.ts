import { afterEach, expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
// @ts-ignore plain JS, shared with the page
import { empty, error } from "./lib.js";
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
  expect(q).toContain('data-act="unblock" data-path="/api/issues/a964/unblock"');
  expect(q).toContain('data-annotate="a964"');
  expect(q).toContain(">Stop waiting on a963</button>");
});

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
  const firstPass = Math.round((38 / 49) * 1e4) / 1e4;
  const d = { ...WEEK, done: 49, issues: { ...WEEK.issues, landed: 49, firstPass }, figures: { ...WEEK.figures, landed: 49, firstPass }, baseline: BASE };
  const h = view.renderTiles({ ...state, usage: undefined }, d);
  expect(h).toContain("<b>78%<em> / 49</em></b>");
  expect(h).toContain("baseline 80%, the previous 7 days (change in percentage points)");
});

test("the Status page puts Agent Time, Pipeline and the lanes in the main column and the Herald in the rail beside it", () => {
  const monitor = { day: "2026-11-04", findings: ["one"], stages: [], holds: [] };
  const page = view.view.render({ ...state, usage: USAGE, factory: { ...state.factory, monitor } }, {}, new URLSearchParams());
  const at = ['id="scorecard"', 'class="rail"', 'class="rail-main"', 'id="outcome"', 'id="pipeline"', 'class="lanes"', 'id="herald"'].map((x) => page.indexOf(x));
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
  expect(page).toContain('class="obar"');
  expect(page).not.toContain("Loading the outcomes");
});

test("the lanes: Running shows live agent runs of the cap and lists every open run; Done lists every done item", () => {
  const mk = (n: number, kind: string) => job({ name: `${kind}-${n}`, run: { kind, started: "2026-10-30T09:00:00Z" } });
  const running = [...Array.from({ length: 12 }, (_, i) => mk(i, "agent")), mk(1, "land"), mk(2, "land")];
  const h = view.renderLanes({ ...full, running, factory: { ...full.factory, liveCap: 12, liveRuns: 12 }, done: [] });
  expect(h).toContain('<div class="sh"><h2 id="h-running">Running</h2><span class="count">12 of 12</span></div>');
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
  expect(h).toContain('class="obar"');
  expect(h).toContain("<h2 id=\"h-outcome\">Agent Time</h2>");
  expect(h).not.toContain("by outcome");
  const sep = h.indexOf('class="osep"');
  expect(h).not.toContain("Reached main");
  expect(sep).toBeGreaterThan(h.indexOf("seg-landed"));
  expect(h).toMatch(/<div class="olegend"><span><i class="seg-landed"><\/i>[^<]+ <em>[^<]+h \d+%<\/em><\/span>/);
  expect(h.slice(0, h.indexOf("olegend")).lastIndexOf("seg-returned")).toBeLessThan(sep);
  expect(h.indexOf("seg-failed")).toBeGreaterThan(sep);
  const needs = view.renderNeeds({ ...state, asks: [{ id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "x" }] });
  expect(needs).toContain('<h2 id="h-needs">Alerts</h2>');
  expect(needs).not.toContain("<h3>");
  expect(needs).not.toContain("Awaiting the user");
  expect(h.match(/<button /g)?.length).toBe(WEEK.classes.filter((c) => c.hours > 0).length);
});

test("the Status page titles a sub-issue link, with no goal and no Part", () => {
  const part = { n: 2, m: 3, parent: "Issue 1", href: "#/issues/aleph/1.2" };
  const page = view.view.render({ ...full, usage: USAGE, queued: [{ repo: "aleph", id: 9, title: "w", part, at: "2026-10-27T16:00:00Z", since: "2026-10-27T16:00:00Z" }] }, {}, new URLSearchParams()) as string;
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

test("a held Queued card ends its meta row with its hold event: the action word and the content, with no wait text and no status chip", () => {
  setCodes({ r: "r" });
  const w = { repo: "r", title: "t", stage: "held", at: "2026-11-02T11:00:00Z", since: "2026-11-02T11:00:00Z" };
  const html = view.renderLanes({ ...state, queued: [
    { ...w, id: 1, kind: "not-ready", ev: { action: "after", on: ["r-9"] }, waits: [{ id: "r-9", href: "#/issues/r/9", state: "working", dead: null }] },
    { ...w, id: 2, kind: "busy-file", ev: { action: "busy", on: ["r-7"], file: "a.ts" } },
  ] });
  expect(html).toMatch(/class="num dur">[^<]*<\/span><span class="blocked" title="after r9">after r9<\/span><\/div>/);
  expect(html).toMatch(/class="num dur">[^<]*<\/span><span class="blocked" title="busy r7 → a\.ts">busy r7 → a\.ts<\/span><\/div>/);
  expect(html).not.toContain("blocked: ");
  expect(html).not.toContain("Waits on");
  expect(html).not.toContain("waits for");
  expect(html).not.toContain('class="badge quiet">held');
  expect(html).not.toContain(">blocked</span>");
});

test("a land card has its own kind class, and the Done header shows the count of its window", () => {
  const run = (kind: string) => ({ name: "j", repo: "r", item: { title: "t" }, started: "2026-11-02T11:00:00Z", run: { kind, started: "2026-11-02T11:00:00Z" } });
  const html = view.renderLanes({ ...state, running: [run("land"), run("build")] });
  expect(html).toContain("run-row kind-land");
  expect(html).toContain('data-annotate="j"');
  expect(html).toContain("run-row kind-worker");
  const done = { ...state, done: [1, 2].map((n) => ({ id: `r-${n}`, title: "d", href: "#/x", jobs: [] })), doneCount: 4 };
  expect(view.renderLanes(done)).toContain('data-annotate="r-2"');
  expect(view.renderLanes(done)).toContain('<h2 id="h-done">Done</h2><span class="count">2 of 4</span>');
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

test("an empty Done, Queued or Running lane draws empty() with a hint", () => {
  const h = view.renderLanes({ ...state, done: [], queued: [], running: [], runningIssues: [] });
  expect(h).toContain(empty("Nothing is done yet.", "Landed work shows here."));
  expect(h).toContain(empty("Nothing is queued.", "Issues wait here for a worker."));
  expect(h).toContain(empty("Nothing is running.", "Started work shows here."));
  expect(h.match(/<p class="hint">/g)).toHaveLength(3);
});

test("a stuck job's fold reads Technical details, and its blocker is an idLink", () => {
  const h = view.renderHerald({ ...full, asks: [], stuck: [job({ name: "aleph-30", condition: "failed", blocker: { id: "aleph-7", href: "#/issues/aleph/7", title: "Open work" } })] });
  expect(h).toContain("<summary>Technical details</summary>");
  expect(h).not.toContain("<summary>Details</summary>");
  expect(h).toContain('Blocker <a class="idl" href="#/issues/aleph/7">aleph-7</a>: Open work');
});
