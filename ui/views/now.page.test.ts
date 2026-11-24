import { afterEach, expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./now.js";
// @ts-ignore plain JS, shared with the page
import { chips, empty, error } from "./lib/html.js";
import { setCodes } from "../../lib/naming.ts";
import { job, state } from "../fixtures/status-state.ts";
import { full } from "../now.testkit.ts";

afterEach(() => setCodes({}));

const NOW = "2026-11-01T08:00:00Z";
const WEEK = {
  window: "week", done: 7,
  phases: { intake: { count: 3, p50: 60, p90: 120 }, queue: { count: 4, p50: 300, p90: 900 }, implement: { count: 7, p50: 600, p90: 1800 }, land: { count: 7, p50: 30, p90: 90 } },
  buckets: [{ at: "2026-10-31T00:00:00Z" }, { at: "2026-11-01T00:00:00Z" }],
  times: [{ filed: "2026-10-31T01:00:00Z", lead: 3600, outcome: "landed" }, { filed: "2026-10-31T23:00:00Z", lead: 7200, outcome: "landed" }, { filed: "2026-10-31T02:00:00Z", lead: 60, outcome: "dropped" }],
  issues: { landed: 7, firstPass: 0.91 },
  classes: [
    { key: "landed", lost: false, hours: 8, causes: [{ name: "First run", hours: 8 }] },
    { key: "failed", lost: true, hours: 2, causes: [{ name: "Issue had landed", hours: 2 }] },
    { key: "reran", lost: true, hours: 4, causes: [{ name: "Issue had landed", hours: 1 }, { name: "No commit", hours: 3 }] },
    { key: "dropped", lost: true, hours: 0, causes: [] },
  ],
  stages: { rows: [{ stage: "build", runs: 20, unusable: 4, items: 9 }, { stage: "land", runs: 9, unusable: 1, items: 9 }, { stage: "monitor", runs: 3, unusable: 3, items: 0 }] },
  figures: { lost: 0.38, hours: 6, kept: 10, leadP50: 1570, leadP90: 16560, landed: 7, dropped: 3, filed: 12 },
  open: { open: 4, parked: 2 }, asks: { count: 5, manual: 2 },
};
const BASE = { prev: { lost: 0.3, leadP50: 1200 }, base: { lost: 0.25, leadP50: 1200 }, basis: "the previous 7 days" };
const USAGE = { now: { seven_day: 7, seven_day_resets_at: "2026-11-07T08:00:00Z" }, series: [] };
const notes = [{ read: NOW, history: [...Array(29).fill(0), 3] }, { read: null, history: Array(30).fill(0) }];
const MEMORY = { total: 2, notes, start: { aleph: { bytes: 3000, budget: 6000, core: ["a", "b"] } }, lint: { refuse: [], warn: [] }, misses: { unoffered_reads: 4 }, processes: { decay: { stale: [{ note: "N", over: 31 }] } } };
const LOG = { total: 51, rows: [{ seq: 9, at: NOW, action: "landed", issue: { id: "a5", to: "#/issues/aleph/5" }, job: { id: "j7", to: "#/jobs/j7" }, title: "Fix it", by: "land", took: 65 }] };

const page = (s: object, q = "") => view.view.render({ ...state, usage: USAGE, now: NOW, ...s }, {}, new URLSearchParams(q)) as string;
/** The HTML of the card with `id`. */
const cardOf = (h: string, id: string) => h.match(new RegExp(`<section class="card[^"]*" id="${id}"[^]*?</section>`))![0];

test("the Status view is at / in the Factory group", () => {
  expect(view.view.path).toBe("/");
  expect(view.view.group).toBe("factory");
});

test("the Factory sidebar lists Status, Automation, Agents, Issues, Jobs in that order", async () => {
  const views = await Promise.all(["now", "gates", "factory-agents", "issues", "factory-jobs"].map((f) => import(`./${f}.js`)));
  expect(views.map((m) => m.view).sort((a, b) => a.order - b.order).map((v) => v.title)).toEqual(["Status", "Automation", "Agents", "Issues", "Jobs"]);
});

test("the page is the scorecard, then the work, the events and Memory in the main column, and Problems, Efficiency and Flow in the rail", () => {
  const h = page({});
  const at = ['id="scorecard"', 'class="rail-main"', 'id="motion"', 'id="events"', 'id="memory"', 'class="stack"', 'id="problems"', 'id="efficiency"', 'id="flow"'].map((x) => h.indexOf(x));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect([...at].sort((a, b) => a - b)).toEqual(at);
});

test("the scorecard has Working, Efficiency, Lead Time, Usage and Memory, with a spinner on each card whose data loads", () => {
  const h = page({}), cards = h.slice(h.indexOf('id="scorecard"'), h.indexOf('class="rail"'));
  expect([...cards.matchAll(/<span class="k">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(["Working", "Efficiency", "Lead Time", "Usage", "Memory"]);
  expect(cards.match(/<i class="spin" role="status"/g)?.length).toBe(3);
});

test("Working counts the issues with a live job, the issues that wait on something but their own job, and the errored jobs", () => {
  const running = [job({ name: "a1", repo: "aleph", item: { id: 1, title: "x" } }), job({ name: "a1b", repo: "aleph", item: { id: 1, title: "x" } }), job({ name: "a2", repo: "aleph", item: { id: 2, title: "y" } })];
  const h = page({ running, queued: [{ kind: "file" }, { kind: "after" }, { kind: "job" }], errored: [job({ name: "a3", state: "failed" })] });
  expect(h).toContain("<b>2<em> / 2</em><em> / 1</em></b>");
});

test("Efficiency and Lead Time read the window's figures and trend them against the baseline; Memory reads the start context", () => {
  const h = page({ flow: { ...WEEK, baseline: BASE }, memory: MEMORY });
  expect(h).toContain("<b>62%<em> / 6.0h</em></b>");
  expect(h).toContain("baseline 75%, the previous 7 days (change in percentage points)");
  expect(h).toContain("<b>26m<em> / 5h</em></b>");
  expect(h).toContain('<span class="k">Memory</span></span><b>50%</b>');
});

/** The Status data after the view's `more`, with each request in `urls`, each answered from `answers` by its path. */
async function more(q = "", answers: Record<string, unknown> = {}) {
  const was = globalThis.fetch, urls: string[] = [];
  globalThis.fetch = (async (u: string) => { urls.push(u); return { ok: true, json: async () => answers[u.split("?")[0]] ?? {} }; }) as any;
  try { return { urls, s: await view.view.more({ ...state, usage: USAGE, now: NOW }, new URLSearchParams(q)) }; } finally { globalThis.fetch = was; }
}

test("more loads the flow and the event log for the address's window, the memory, and the last hour's runs", async () => {
  expect((await more()).urls).toEqual(["/api/flow?window=week&baseline=1", "/api/memory", "/api/memory/processes", "/api/jobs?window=hour&limit=500", "/api/log?window=week"]);
  expect((await more("window=day&kind=landed&q=pager&page=2")).urls.at(-1)).toBe("/api/log?window=day&kind=landed&q=pager&page=2");
  const { s } = await more("", { "/api/jobs": { jobs: [{ id: "job.1" }] }, "/api/memory": { total: 3 }, "/api/memory/processes": { steps: [] } });
  expect(s.jobs).toEqual([{ id: "job.1" }]);
  expect(s.memory).toEqual({ total: 3, processes: { steps: [] } });
});

test("a failed load shows error() in its own card only", () => {
  const h = page({ flow: { error: "x" }, memory: { error: "y" }, jobs: { error: "z" }, log: { error: "w" } });
  expect(cardOf(h, "efficiency")).toContain(error("x"));
  expect(cardOf(h, "flow")).toContain(error("x"));
  expect(h.slice(h.indexOf('id="memory"'))).toContain(error("y"));
  expect(cardOf(h, "motion")).toContain(error("z"));
  expect(cardOf(h, "events")).toContain(error("w"));
});

const run = (id: string, issue: string, state: string, started: string, ended: string | null, kind = "build") => ({ id, repo: "aleph", issue, title: `Title ${issue}`, kind, state, started, ended });

test("Issues in Motion draws a lane for each issue with a live run, with its runs of the hour, from the first of them to now", () => {
  setCodes({ aleph: "a" });
  const jobs = [run("job.2", "issue.5", "running", "2026-11-01T07:50:00Z", null, "land"), run("job.1", "issue.5", "passed", "2026-11-01T07:30:00Z", "2026-11-01T07:45:00Z"), run("job.3", "issue.6", "landed", "2026-11-01T07:40:00Z", "2026-11-01T07:41:00Z", "land")];
  const h = cardOf(page({ jobs }), "motion");
  expect(h.match(/class="dp-row"/g)?.length).toBe(1);
  expect(h).toContain('href="#/issues/aleph/5">a5</a> Title issue.5');
  expect(h).toContain('href="#/jobs/job.1"');
  expect(h).toContain('style="left:0.000%;width:50.000%"');
  expect(h).toContain('<span class="count">1</span>');
  expect(cardOf(page({ jobs: [] }), "motion")).toContain(empty());
  expect(cardOf(page({}), "motion")).toContain("Loading the runs");
});

test("Waiting groups the issues that wait by their hold, and gives how long the oldest has waited", () => {
  const ev = { action: "held", detail: "file: ui/a.ts: job.4" };
  const queued = [{ repo: "aleph", id: 7, title: "One", kind: "file", ev, heldAt: "2026-11-01T07:00:00Z" }, { repo: "aleph", id: 8, title: "Two", kind: "file", ev, heldAt: "2026-11-01T07:30:00Z" }, { repo: "aleph", id: 9, title: "Mine", kind: "job" }];
  const h = cardOf(page({ jobs: [], queued }), "motion");
  expect(h).toContain("Waiting");
  expect(h.match(/<tr>/g)?.length).toBe(2); // the head and one hold
  expect(h).toContain("ui/a.ts: job.4");
  expect(h).toContain('<td class="num">1h 00m</td>');
  expect(h).not.toContain("Mine");
  expect(cardOf(page({ jobs: [], queued: [] }), "motion")).not.toContain("Waiting");
});

test("Events folds a run of one job with no issue into one row, its keys as chips before its title", () => {
  const ev = (seq: number, action: string) => ({ ...LOG.rows[0], seq, action, issue: null, job: { id: "j7", to: "#/jobs/j7" }, keys: ["dedupe", "dry"], title: "5 resolved" });
  const h = cardOf(page({ log: { total: 2, rows: [ev(2, "done"), ev(1, "started")] } }), "events");
  expect(h.match(/<tr>/g)).toHaveLength(2);
  expect(h).toContain(`<summary><span>${chips(["dedupe", "dry"])}5 resolved</span>1</summary>`);
});

test("Events folds the older events of a run of one issue under its newest, and merges no row without an issue", () => {
  const ev = (seq: number, issue: string | null, action: string) => ({ ...LOG.rows[0], seq, action, at: `2026-11-01T07:0${seq}:00Z`, issue: issue && { id: issue, to: `#/issues/aleph/${issue}` }, job: null, title: issue ? `T${issue}` : "" });
  const h = cardOf(page({ log: { total: 6, rows: [ev(6, "a5", "landed"), ev(5, "a5", "failed"), ev(4, "a5", "started"), ev(3, "a6", "landed"), ev(2, null, "held"), ev(1, null, "held")] } }), "events");
  expect(h.match(/<tr>/g)).toHaveLength(5);
  expect(h.match(/<details/g)).toHaveLength(1);
  expect(h.match(/<td class="time lead">07:06/g)).toHaveLength(1);
  const [, inFold] = h.split("<details");
  expect(inFold).toContain("<summary><span>Ta5</span>2</summary>");
  expect(inFold).toContain("07:05");
  expect(inFold).toContain("07:04");
  expect(inFold).not.toContain("07:06");
});

test("Events is a log: each row has its time, word, issue, title, job, by and took, with a filter and a pager", () => {
  const h = cardOf(page({ log: LOG }, "kind=landed&q=fix"), "events");
  expect(h).toContain('value="fix"');
  expect(h).toContain('data-value="landed" aria-pressed="true"');
  expect(h).toContain('title="Time"');
  expect(h).toContain('href="#/issues/aleph/5">a5</a>');
  expect(h).toContain('<td class="num">1m 05s</td>');
  expect(h).toContain("Next 25");
  expect(cardOf(page({ log: { total: 0, rows: [] } }), "events")).toContain(empty());
  expect(cardOf(page({}), "events")).toContain("Loading the events");
});

test("Memory shows the start context against its budget, the offers per day and the six counts", () => {
  const h = page({ memory: MEMORY }), m = h.slice(h.indexOf('id="memory"'), h.indexOf('class="stack"'));
  expect(m).toContain("3,000 / 6,000 B");
  expect(m).toContain('<aleph-chart key="status/offers" bare>');
  const side = m.slice(m.indexOf('<dl class="sstats">'), m.indexOf("</dl>")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  expect(side).toBe("Notes 2 Offered 1 Never offered 1 Unoffered reads 4 Refused 0 Stale 1 1 late");
  expect(view.offersFrame(MEMORY, Date.parse(NOW)).rows.map((r: any) => r.offers)).toEqual([0, 0, 0, 0, 0, 0, 3]);
});

test("Efficiency shows the hours by outcome, the lost hours by cause and the failed runs by stage", () => {
  const h = cardOf(page({ flow: WEEK }), "efficiency");
  expect(h).toContain("10h of 16h reached main");
  expect(h).not.toContain("seg-dropped");
  expect([...h.matchAll(/<span class="bl">([^<]+)<\/span>/g)].map((m) => m[1]).slice(0, 2)).toEqual(["Issue had landed", "No commit"]);
  expect(h).toContain("4 of 20");
  expect(h).not.toContain("3 of 3");
});

test("Flow shows the window's counts, each phase's p90 with the issues in it now, and the issues landed per bucket", () => {
  const h = cardOf(page({ flow: WEEK, running: [job({ name: "a1", run: { kind: "land" } })], queued: [{ kind: "file" }] }), "flow");
  const side = h.slice(h.indexOf('<dl class="sstats">'), h.indexOf("</dl>")).replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  expect(side).toBe("Filed 12 Landed 7 Dropped 3 First Pass 91% Open 4 +2 Asks 5 2 yours");
  expect(h).toContain("Time by Phase, p90");
  expect(h).toContain('<aleph-chart key="status/landed" bare>');
  expect(h).toContain("Landed per Day");
  expect(view.landedFrame(WEEK).rows.map((r: any) => r.landed)).toEqual([1, 1]);
});

test("an ask keeps its action buttons on the page, with Pause in the head", () => {
  const h = view.view.render(full, {}, new URLSearchParams()) as string;
  expect(h).toContain('data-act="pause"');
  expect(cardOf(h, "problems")).toMatch(/data-act="/);
});
