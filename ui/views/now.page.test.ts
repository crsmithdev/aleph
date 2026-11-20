import { afterEach, expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./now.js";
// @ts-ignore plain JS, shared with the page
import { empty, error } from "./lib/html.js";
import { setCodes } from "../../lib/naming.ts";
import { job, state } from "../fixtures/status-state.ts";
import { full, heraldOf, row, section } from "../now.testkit.ts";

afterEach(() => setCodes({}));

const WEEK = {
  window: "week", done: 7, kinds: { land: { count: 9 } },
  phases: { lead: { count: 7, p50: 1570, p90: 16560, hist: [], worst: 20000 } },
  buckets: [{ at: "2026-10-27T00:00:00", lead: 1000 }, { at: "2026-10-28T00:00:00", lead: null }],
  issues: { landed: 7, firstPass: 0.91, fixRounds: 0 }, lost: { hours: 6, share: 0.38 },
  classes: [
    { key: "landed", lost: false, hours: 8, causes: [{ name: "First run", hours: 8, runs: 8 }] }, { key: "returned", lost: false, hours: 2, causes: [{ name: "Checks failed", hours: 2, runs: 2 }] },
    { key: "failed", lost: true, hours: 2, causes: [{ name: "Issue had landed", hours: 2, runs: 3 }] },
    { key: "reran", lost: true, hours: 4, causes: [{ name: "Issue had landed", hours: 1, runs: 1 }, { name: "No commit", hours: 3, runs: 2 }] },
    { key: "dropped", lost: true, hours: 0, causes: [] },
  ],
  figures: { lost: 0.38, hours: 6, kept: 10, leadP50: 1570, leadP90: 16560, asks: null, landed: 7, firstPass: 0.91 },
  filed: { followups: 5, all: 12 }, dropped: 3, open: { open: 4, parked: 2 }, failures: [],
};

const BASE = { prev: { lost: 0.3, hours: 5, leadP50: 1200, leadP90: 9000, asks: 4, landed: 5, firstPass: 0.8 }, base: { lost: 0.25, hours: 4, leadP50: 1200, leadP90: 9000, asks: 4, landed: 5, firstPass: 0.8 }, basis: "the previous 7 days" };
const withBase = (d: any, asks = { count: 4, manual: 1 }) => ({ ...d, asks, figures: { ...d.figures, asks: asks.count }, baseline: BASE });

const USAGE = { now: { seven_day: 7, seven_day_resets_at: "2026-11-07T08:00:00Z" }, series: [] };

test("a card has no trend without a baseline or with a zero baseline of a count", () => {
  const h = view.renderTiles({ ...state, usage: USAGE }, WEEK, "week");
  expect(h).not.toContain('class="tr');
  const z = view.renderTiles({ ...state, usage: USAGE }, { ...withBase(WEEK), baseline: { ...BASE, base: { ...BASE.base, landed: 0 } } }, "week");
  expect(z).not.toContain("Previous 5;");
});

test("the scorecard before the data arrives: a spinner in the four flow cards, a count in Jobs, a dash for usage with no usage", () => {
  const h = view.renderTiles({ ...state, usage: undefined }, null);
  expect(h.match(/<i class="spin" role="status"/g)?.length).toBe(4);
  expect(h.match(/<b>–/g)?.length).toBe(1);
  expect(h).not.toContain('class="tr');
});

test("the Jobs card shows live runs, queued and errored with no trend, and there is no Asks card", () => {
  const s = { ...state, usage: USAGE, factory: { ...state.factory, liveRuns: 3 }, queued: [{}, {}, {}, {}, {}] };
  const h = view.renderTiles(s, { ...WEEK, baseline: BASE }, "week");
  expect(h).not.toContain("Asks");
  expect(h).toContain("<b>3<em> / 5</em><em> / 1</em></b>");
  expect(h).toContain('<span>running</span><span class="m"> / queued</span><span class="m"> / error</span>');
  expect(h).toContain('class="tr');
  expect(h.split('class="tile sc"').find((t: string) => t.includes(">Jobs<"))).not.toContain('class="tr');
  expect(view.renderTiles({ ...s, queued: [] }, null, "week")).toContain("<b>3<em> / 0</em><em> / 1</em></b>");
});

test("the Landed card shows the clean share, then the clean count, and trends on the clean share", () => {
  const firstPass = Math.round((38 / 49) * 1e4) / 1e4;
  const d = { ...WEEK, done: 49, issues: { ...WEEK.issues, landed: 49, firstPass }, figures: { ...WEEK.figures, landed: 49, firstPass }, baseline: BASE };
  const h = view.renderTiles({ ...state, usage: undefined }, d);
  expect(h).toContain("<b>78%<em> / 49</em></b>");
  expect(h).toContain("baseline 80%, the previous 7 days (change in percentage points)");
});

test("the scorecard is the tiles section Scorecard, with an Issues card", () => {
  const page = view.view.render({ ...state, usage: USAGE }, {}, new URLSearchParams());
  const at = page.indexOf('<section class="tiles" id="scorecard" aria-label="Scorecard">');
  expect(at).toBeGreaterThan(-1);
  expect(page.slice(at, page.indexOf('class="rail"'))).toContain('<span class="k">Issues</span>');
});

test("the Status page puts Pipeline and Issues in the main column and the Herald in the rail beside it", () => {
  const monitor = { day: "2026-11-04", findings: ["one"], stages: [], holds: [] };
  const page = view.view.render({ ...state, usage: USAGE, factory: { ...state.factory, monitor } }, {}, new URLSearchParams());
  const at = ['id="scorecard"', 'class="rail"', 'class="rail-main"', 'id="pipeline"', 'id="issues"', 'id="herald"'].map((x) => page.indexOf(x));
  expect(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true);
});

/** Memory data with a cut core line, a refused note, 11 unoffered reads and a note 31 days late; CALM has none over its threshold. */
const BUSY = { lint: { refuse: [{ rule: "schema", note: "N", detail: "d" }], warn: [] }, start: { aleph: { cut: 1 } }, misses: { unoffered_reads: 11 }, processes: { decay: { stale: [{ note: "N", over: 31, window: 30 }] } } };
const CALM = { lint: { refuse: [], warn: [] }, start: { aleph: { cut: 0 } }, misses: { unoffered_reads: 10 }, processes: { decay: { stale: [{ note: "N", over: 30, window: 30 }] } } };

/** The Status data after the view's `more`, with each request in `urls`: /api/flow answered by `body`, the memory ones by CALM. */
async function more(body: unknown, q = new URLSearchParams()) {
  const was = globalThis.fetch, urls: string[] = [];
  const answer = (u: string) => (u.startsWith("/api/flow") ? body : u === "/api/memory/processes" ? CALM.processes : CALM);
  globalThis.fetch = (async (u: string) => { urls.push(u); return { ok: true, json: async () => answer(u) }; }) as any;
  try { return { urls, s: await view.view.more({ ...state, usage: USAGE, now: "2026-11-01T08:00:00Z" }, q) }; } finally { globalThis.fetch = was; }
}

test("more fetches the week with its baseline, and the page fills the scorecard and the Pipeline from it", async () => {
  const { urls, s } = await more({ ...WEEK, baseline: BASE });
  expect(urls).toEqual(["/api/flow?window=week&baseline=1", "/api/memory", "/api/memory/processes"]);
  const page = view.view.render(s, {}, new URLSearchParams());
  expect(page).toContain("<b>38%<em> / 6.0h</em></b>");
  expect(page).toContain('class="seg-landed"');
  expect(page).not.toContain("Loading the pipeline");
});

test("an ask keeps its action buttons on the page", () => {
  const page = view.view.render(full);
  expect(page).toContain('data-act="pause"');
  expect(section(page, "needs")).toMatch(/data-act="/);
});

test("the sidebar links and the routes exist", async () => {
  for (const [f, path, old] of [["factory-jobs", "/factory/jobs", "#/status/performance"], ["factory-agents", "/factory/agents", "#/status/capacity"]]) {
    const m = await import(`./${f}.js`);
    expect(m.view.path).toBe(path);
    expect(m.redirect(old)).toBe(`#${path}`);
    expect(m.redirect(`#${path}`)).toBeNull();
  }
});

test("the Factory sidebar lists Status, Automation, Agents, Issues, Jobs in that order", async () => {
  const views = await Promise.all(["now", "gates", "factory-agents", "issues", "factory-jobs"].map((f) => import(`./${f}.js`)));
  const sorted = views.map((m) => m.view).sort((a, b) => a.order - b.order);
  expect(sorted.map((v) => v.title)).toEqual(["Status", "Automation", "Agents", "Issues", "Jobs"]);
});

test("more loads the window of the address", async () => {
  expect((await more(WEEK, new URLSearchParams("window=hour"))).urls[0]).toBe("/api/flow?window=hour&baseline=1");
});

test("the Pipeline loads after the scorecard, then legends Implement's outcome hours, each an Inspector target, and counts the window's issues beside its stages", async () => {
  const page = view.view.render({ ...state, usage: USAGE }, {}, new URLSearchParams());
  const at = ['id="scorecard"', 'id="pipeline"', 'id="issues"'].map((x) => page.indexOf(x));
  expect(at.every((i) => i >= 0) && [...at].sort((a, b) => a - b).join() === at.join()).toBe(true);
  expect(page).toContain("Loading the pipeline");
  const { s } = await more({ ...WEEK, classes: [...WEEK.classes, { key: "idle", lost: false, hours: 0, causes: [] }] }, new URLSearchParams("window=week"));
  const filled = view.view.render(s, {}, new URLSearchParams("window=week")), h = filled.slice(filled.indexOf('id="pipeline"'), filled.indexOf('id="issues"'));
  expect(filled).toContain('<section class="card duo" id="pipeline" aria-label="Pipeline"><div class="duo-main"><div class="sh"><h2>Pipeline</h2>');
  // The legend names each class with hours, as a button to the Inspector; a class with no hours is not drawn.
  expect([...h.matchAll(/<button type="button" class="lgo" data-inspect="class" data-target="([^"]*)"/g)].map((m) => m[1])).toEqual(["landed", "returned", "failed", "reran"]);
  expect(h).toContain('<i class="seg-landed"></i>landed 8.0h</button>');
  expect(h).not.toContain("seg-idle");
  expect(h).not.toContain("seg-dropped");
  // The side counts the window: filed, intake, landed, dropped, open with the parked, and the errored jobs now.
  const side = h.slice(h.indexOf('<dl class="sstats">'), h.indexOf("</dl>")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  expect(side).toBe(`Filed 12 Intake 0 Landed 7 Dropped 3 Open 4 +2 Errored ${state.errored.length} now`);
  expect(h).toContain('<div title="4 open issues, 2 parked issues"><dt>Open</dt>');
  expect(h).toContain('<b class="done">7</b>');
});

test("the Status page titles a sub-issue link, with no goal and no Part", () => {
  const part = { n: 2, m: 3, parent: "Issue 1", href: "#/issues/aleph/1.2" };
  const page = view.view.render({ ...full, usage: USAGE, errored: full.errored.map((j: any) => ({ ...j, part })) }, {}, new URLSearchParams()) as string;
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

test("a failed flow load shows error() in the Pipeline and Issues cards", () => {
  const page = view.view.render({ ...state, usage: USAGE }, {}, new URLSearchParams()), bad = view.view.render({ ...state, usage: USAGE, flow: { error: "x" } }, {}, new URLSearchParams());
  expect(page).not.toContain('role="alert"');
  expect(bad.slice(bad.indexOf('id="pipeline"'), bad.indexOf('id="issues"'))).toContain(error("x"));
  expect(bad.slice(bad.indexOf('id="issues"'), bad.indexOf('id="herald"'))).toContain(error("x"));
});

test("an errored job's fold reads Technical details, and its blocker is an idLink", () => {
  const h = view.renderHerald({ ...full, asks: [], errored: [job({ name: "aleph-30", state: "failed", blocker: { id: "aleph-7", href: "#/issues/aleph/7", title: "Open work" } })] });
  expect(h).toContain("<summary>Technical details</summary>");
  expect(h).not.toContain("<summary>Details</summary>");
  expect(h).toContain('Blocker <a class="idl" href="#/issues/aleph/7">aleph-7</a>: Open work');
});

test("the Issues card follows Pipeline: loading, error, and two bare charts split by a rule, the active issues and the phases' median times capped at 30 minutes", () => {
  const draw = (flow: unknown) => view.view.render({ ...state, usage: USAGE, flow } as any, {}, new URLSearchParams()) as string;
  const slice = (h: string) => h.slice(h.indexOf('id="issues"'), h.indexOf('id="herald"'));
  expect(slice(draw(undefined))).toContain("Loading the issues");
  expect(slice(draw({ error: "x" }))).toContain(error("x"));
  const ok = slice(draw({ ...WEEK, active: [{ at: "2026-10-27T00:00:00", intake: 1, queue: 2, running: 3, landed: 4 }], buckets: [{ at: "2026-10-27T00:00:00", intake: 60, queue: 5000, implement: 600, land: 30 }] }));
  expect(ok).toMatch(/<div class="duo-main">.*<aleph-chart key="status\/active" bare>.*<div class="duo-side"><h3 class="sub-head">Median Time by Phase<\/h3><aleph-chart key="status\/speed" bare>/);
  expect(ok).toContain('<li><i class="c-s6"></i>Intake</li><li><i class="c-s4"></i>Queue</li><li><i class="c-run"></i>Implement</li><li><i class="c-done"></i>Land</li>');
  const f = view.activeFrame({ ...WEEK, active: [] });
  expect(f.by.keys.map((k: any) => k.key)).toEqual(["intake", "queue", "running", "landed"]);
  expect(f.form).toBe("area");
  const sp = view.speedFrame({ ...WEEK, buckets: [{ at: "2026-10-27T00:00:00", intake: 60, queue: null, implement: 600, land: 30, lead: 900 }] });
  expect(sp).toMatchObject({ form: "columns", cap: 1800, legend: false, rows: [{ at: "2026-10-27T00:00:00", intake: 60, queue: null, implement: 600, land: 30 }] });
  expect(sp.by.keys.map((k: any) => k.color)).toEqual(f.by.keys.map((k: any) => k.color));
});

test("the Herald shows the rows of issues and of jobs together, with no toggles", () => {
  const events = [row({ at: "2026-11-15T13:00:00Z", by: "gate", subject: "aleph-5", action: "landed", on: ["aleph-5#1"] }), row({ at: "2026-11-15T13:05:00Z", by: "gate", subject: "housekeeper", action: "running", on: ["job.57"] })];
  const html = view.renderHerald({ ...state, now: "2026-11-15T14:00:00Z", herald: heraldOf(events) });
  expect(html).toContain('href="#/issues/aleph/5"');
  expect(html).toContain('href="#/jobs/job.57"');
  expect(html).not.toContain('name="show"');
});

test("the Memory panel lists each memory item that waits, linked to the Health tab; the empty mark when none waits; a loading line before the data", async () => {
  const draw = (memory: unknown) => { const h = view.view.render({ ...state, usage: USAGE, memory } as any, {}, new URLSearchParams()) as string; return h.slice(h.indexOf('id="memory"'), h.indexOf('id="herald"')); };
  const busy = draw(BUSY), links = [...busy.matchAll(/<a href="[^"]*"/g)].map((x) => x[0]);
  expect(links).toEqual(Array(4).fill('<a href="#/memory?tab=health"'));
  expect(busy).toContain("1 core line cut");
  expect(busy).not.toContain(empty());
  const calm = draw(CALM);
  expect(calm).toContain(empty());
  expect(calm).not.toContain("<a ");
  expect(draw(undefined)).toContain("Loading the memory");
  expect(draw({ error: "x" })).toContain(error("x"));
  const { s } = await more(WEEK);
  expect(s.memory).toEqual(CALM);
});
