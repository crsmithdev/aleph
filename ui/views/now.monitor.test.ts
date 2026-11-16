import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./now.js";
// @ts-ignore feed.js is plain JS, shared with the page
import { eventRow } from "./lib/feed.js";
import { row, withFactory } from "../now.testkit.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heraldReviewed, heraldRuns } from "../state.ts";
import { withEnv } from "../server.testkit.ts";
import { allRuns } from "../../jobs/lib/records/ledger.ts";
import { seed } from "../../jobs/job.testkit.ts";
import { setCodes } from "../../lib/naming.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { clock } from "./lib/format.js";

const calm = { ...withFactory({}), asks: [], stuck: [] };
test("the Pipeline card shows the 6 stages in order, each a ring of runs per issue in its health tone with its p90 time, and no other role", () => {
  const rows = [
    { stage: "monitor", runs: 1, items: 1, unusable: 0, p90: 10 },
    { stage: "build", runs: 9, items: 5, unusable: 2, p90: 804 },
    { stage: "intake", runs: 3, items: 3, unusable: 0, p90: null },
    { stage: "land", runs: 400, items: 100, unusable: 1, p90: 5 },
  ];
  const h = view.renderPipeline({ window: "week", stages: { rows }, phases: { queue: { count: 4, p90: 79 } } });
  const names = [...h.matchAll(/<span class="pn">([^<]*)</g)].map((m) => m[1]);
  expect(names).toEqual(["Intake", "Queue", "Implement", "Review", "Recheck", "Land"]);
  // 2 of 9 build runs failed: 22%, amber; 0 of 3 intake runs: green.
  expect(h).toContain('<div class="pnode warning"><a class="pgo" href="#/factory/jobs?stage=implement&amp;role=worker" title="Implement: 9 runs on 5 issues, 2 failed"><span class="ring">1.8</span><span class="pn">Implement</span><span class="pt">13m 24s</span></a><a class="pf" href="#/factory/jobs?stage=implement&amp;role=worker&amp;unusable=1">22% failed</a>');
  expect(h).toContain('<div class="pnode fine"><a class="pgo" href="#/factory/jobs?stage=intake&amp;role=intake" title="Intake: 3 runs on 3 issues"><span class="ring">1.0</span>');
  expect(h).toContain('<span class="pn">Queue</span><span class="pt">1m 19s</span>');
  // The failed share is pct()'s text: 1 of 400 is 0.3%, not a rounded 0%.
  expect(h).toContain('>0.3% failed</a>');
  expect(h.match(/class="pnode idle"/g)).toHaveLength(2);
  // A stage with no run shows a "–" with its reason, not words; so does an empty queue.
  expect(h).toContain('<span class="pt"><span title="Nothing ran in this window">–</span></span>');
  expect(view.renderPipeline({ window: "week", stages: { rows }, phases: {} })).toContain('<span class="pt"><span title="Nothing waited in this window">–</span></span>');
  expect(h).not.toMatch(/no run|no wait/);
  // "p90" is said once, in the aside, not under each stage.
  expect(h.match(/p90/g)).toHaveLength(1);
  expect(h).not.toContain(">monitor<");
  expect(view.renderPipeline(null)).toContain("Loading the pipeline…");
});

test("each Pipeline ring links to Jobs with its stage and role, in the window and project of the page; an idle stage has no link", () => {
  const rows = [{ stage: "review", runs: 4, items: 4, unusable: 0, p90: 60 }, { stage: "recheck", runs: 2, items: 2, unusable: 1, p90: 30 }];
  const h = view.renderPipeline({ window: "day", stages: { rows }, phases: { queue: { count: 1, p90: 5 } } }, new URLSearchParams("window=day&project=aleph"));
  const hrefs = [...h.matchAll(/href="([^"]*)"/g)].map((m) => m[1].replaceAll("&amp;", "&"));
  expect(hrefs).toEqual([
    "#/factory/jobs?stage=queue&window=day&project=aleph",
    "#/factory/jobs?role=reviewer&window=day&project=aleph",
    "#/factory/jobs?role=worker&window=day&project=aleph",
    "#/factory/jobs?role=worker&unusable=1&window=day&project=aleph",
  ]);
  expect(h.match(/class="pnode idle"/g)).toHaveLength(3);
});

test("a Pipeline stage with an unusable run links its failed share to the unusable runs of the page's window and project; one with none keeps plain text", () => {
  const rows = [{ stage: "build", runs: 9, items: 5, unusable: 2, p90: 804 }, { stage: "intake", runs: 3, items: 3, unusable: 0, p90: null }];
  const h = view.renderPipeline({ window: "day", stages: { rows }, phases: {} }, new URLSearchParams("window=day&project=aleph"));
  expect(h).toContain('<a class="pf" href="#/factory/jobs?stage=implement&amp;role=worker&amp;unusable=1&amp;window=day&amp;project=aleph">22% failed</a>');
  expect(h).toContain('<span class="pf">0.0% failed</span>');
  expect(h.match(/class="pf"/g)).toHaveLength(2);
});

test("the Herald shows its alerts under a Not OK badge in the worst alert's tone, then the events", () => {
  const ask = { id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "Please review" };
  const h = view.renderHerald({ ...calm, asks: [ask], stuck: [], running: [], runningIssues: [], done: [], queued: [] });
  expect(h).toContain('<h2 id="h-herald">Herald</h2>');
  expect(h).toContain('<span class="badge need">Not OK</span>');
  expect(h).toContain('id="awaiting"');
  expect(h).not.toContain("Sticky Alerts");
  expect(h).not.toContain("data-herald-tab");
  expect(h).toContain('class="herald-feed"');
  const red = view.renderHerald({ ...calm, asks: [ask], factory: { ...calm.factory, health: [{ text: "health: aleph main is red", kind: "alert", key: "red-main" }] } });
  expect(red).toContain('<span class="badge stuck">Not OK</span>');
});

test("the Herald lists each running job as a row on the feed grid between the alerts and the feed, and no section with none", () => {
  const ask = { id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "Please review" };
  const running = [{ id: "job.0", name: "intake-aleph-7", size: "small", model: "deepseek-v4.1-flash", started: "2026-11-09T11:00:00Z", item: { title: "Fix the thing" } }];
  const h = view.renderHerald({ ...calm, asks: [ask], running, runningIssues: [{ id: "aleph-9", stage: "intake", title: "Sort it", at: "2026-11-09T11:30:00Z" }] });
  expect(h.match(/class="event-row run run-now"/g)).toHaveLength(2);
  // The start time, the action word in the run tone, the job's ID, its title, then the size after the breathing dot; the model is in the size's title.
  expect(h).toContain('<div class="event-row run run-now" data-job="job.0" id="h-job-job.0"><span class="event-time">' + clock("2026-11-09T11:00:00Z") + '</span><span class="event-body"><span class="event-line"><span class="badge run">implement</span><a class="idl" href="#/jobs/job.0">j-00000</a><span class="event-title run-title" title="Fix the thing">Fix the thing</span><span class="run-size" title="deepseek-v4.1-flash"><span class="run-dot"></span>small</span></span></span></div>');
  expect(h).not.toContain("intake-aleph-7");
  expect(h).toContain('data-job="aleph-9"');
  expect(h).toContain('<span class="badge run">intake</span>');
  expect(h.indexOf('id="awaiting"')).toBeLessThan(h.indexOf('class="herald-running"'));
  expect(h.indexOf('class="herald-running"')).toBeLessThan(h.indexOf('class="herald-feed"'));
  expect(view.renderHerald({ ...calm, running: [], runningIssues: [] })).not.toContain("herald-running");
});

test("a running job's row names its run's kind, and shows the size of a build only", () => {
  const job = { id: "job.1", name: "aleph-7", size: "small", started: "2026-11-09T11:00:00Z", item: { title: "Fix it" } };
  const h = view.renderHerald({ ...calm, running: [{ ...job, run: { kind: "build" } }], runningIssues: [] });
  expect(h).toContain('<span class="badge run">implement</span>');
  expect(h).toContain('<span class="run-dot"></span>small</span>');
  const r = view.renderHerald({ ...calm, running: [{ ...job, run: { kind: "review" } }], runningIssues: [] });
  expect(r).toContain('<span class="badge run">review</span>');
  expect(r).toContain('<span class="run-size"><span class="run-dot"></span></span>');
});

test("the Herald panel shows an OK badge with no alerts and no alert row", () => {
  const h = view.renderHerald(calm);
  expect(h).not.toContain("No active alerts");
  expect(h).not.toContain("herald-sticky");
  expect(h).toContain('<span class="badge done">OK</span>');
});

test("high weekly usage draws a warning status row after the page loaded, with its text only", async () => {
  const v = await fresh();
  v.renderHerald(calm);
  const h = v.renderHerald({ ...calm, usage: { now: { seven_day: 93 } } });
  expect(h).toContain("weekly usage is at 93%");
  expect(h).not.toContain(">Warn<");
  expect(h).toContain('class="event-row warning"');
  expect(h).toContain('<span class="event-body"><span class="event-say">');
});

test("an error is not pinned: the badge says Not OK, and no row repeats the error lines or a health prefix", async () => {
  const v = await fresh();
  const herald = { history: [{ at: "2026-10-01T00:00:00Z", tone: "alert", label: "Alert", text: "Alert: Health: aleph main is red", reason: "health: aleph main is red" }] };
  const h = v.renderHerald({ ...calm, herald, factory: { ...calm.factory, health: [{ text: "health: aleph main is red", kind: "alert", key: "red-main" }, { text: "health: koans main is red", kind: "warn" }] } });
  expect(h).not.toContain("ask-head");
  expect(h).not.toContain("No active alerts");
  expect(h).toContain('<span class="badge stuck">Not OK</span>');
  expect(h).not.toContain("Alert: Health:");
  expect(h).not.toContain("aleph main is red");
});

test("the Herald merges the state's events and the streamed ones, each once, newest first, with the status rows", async () => {
  const ev = (at: string, action: string, o: object = {}) => (row({ at, by: "gate", subject: "aleph-5", action, on: ["aleph-5#1"], ...o }));
  const s = { ...calm, now: "2026-11-09T12:00:00Z", herald: { history: [{ at: "2026-11-09T11:00:00Z", tone: "warning", label: "Wait", text: "The factory is paused" }], events: [ev("2026-11-09T11:30:00Z", "running")] } };
  const v = await fresh();
  v.renderHerald({ ...calm, now: "2026-11-09T10:00:00Z" });
  const merged = view.heraldEvents(s, [ev("2026-11-09T11:30:00Z", "running"), ev("2026-11-09T11:45:00Z", "failed", { note: "past its time box" })]);
  expect(merged.map((e: any) => e.action)).toEqual(["failed", "running"]);
  const h = v.renderHerald(s);
  const order = [...h.slice(h.indexOf("herald-feed")).matchAll(/class="event-row (\w+)/g)].map((m) => m[1]);
  // The fixture's status now (12:00) is newest, then the event at 11:30, then the status at 11:00.
  expect(order).toEqual(["alert", "run", "warning"]);
  const line = eventRow(merged[0], { "aleph-5": "Fix the flaky land test" });
  // Two columns: the time, then one line: the chip, the issue linked, the title.
  expect(line).toContain('<div class="event-row stuck" data-by="gate"><span class="event-time">');
  expect(line).toContain('<span class="event-line"><span class="badge stuck">failed</span><a class="idl" href="#/issues/aleph/5">aleph-5</a><span class="event-title" title="Fix the flaky land test">Fix the flaky land test</span></span>');
  // A row with no title takes what its sentence adds in the title's place.
  expect(eventRow(merged[0], {})).toContain('<span class="event-title" title="past its time box">past its time box</span>');
  expect(line).not.toContain("event-tone");
});

// The stream path keeps its events in now.js for the page's life: each such test takes a copy of the module of its own.
let copies = 0;
const fresh = () => import(`./now.js?copy=${++copies}`);

test("an event from the stream goes into the Herald at once", async () => {
  const view = await fresh();
  const s = { ...calm, now: "2026-11-09T12:00:00Z", herald: { history: [], events: [] } };
  view.view.render(s, {}, new URLSearchParams());
  let html = "";
  const herald = { querySelectorAll: () => [], set outerHTML(v: string) { html = v; } };
  view.view.event({ querySelector: (q: string) => (q === "#herald" ? herald : null) }, row({ at: "2026-11-09T11:59:00Z", by: "gate", subject: "aleph-6", action: "landed", on: ["aleph-6#2"] }));
  expect(html).toContain('<span class="badge done">landed</span><a class="idl" href="#/issues/aleph/6">aleph-6</a>');
});

test("a Herald group keeps its open or closed state when a newer event arrives and the rows move, through the stream path", async () => {
  const view = await fresh();
  const ev = (at: string, subject: string, n: number) => (row({ at, by: "gate", subject, action: "done", on: [`${subject}#${n}`] }));
  const s = { ...calm, now: "2026-11-09T12:00:00Z", herald: { history: [], events: [ev("2026-11-09T10:00:00Z", "aleph-1", 1), ev("2026-11-09T10:01:00Z", "aleph-1", 2), ev("2026-11-09T10:02:00Z", "aleph-2", 1), ev("2026-11-09T10:03:00Z", "aleph-2", 2)] } };
  view.view.render(s, {}, new URLSearchParams());
  // A fake page: `html` is the Herald as drawn, its details are rebuilt from it at each swap, closed unless the markup says open.
  let html = view.renderHerald(s), details: any[] = [];
  const build = () => { details = [...html.matchAll(/<details[^>]*data-fold="([^"]*)"[^>]*>/g)].map((m) => ({ id: m[1], open: false, dataset: { fold: m[1] }, querySelector: () => null, querySelectorAll: () => [] })); };
  const herald = () => ({ querySelectorAll: (q: string) => (q === "details" ? details : []), set outerHTML(v: string) { html = v; build(); } });
  const root = { querySelector: (q: string) => (q === "#herald" ? herald() : null) };
  build();
  expect(details.map((d) => d.id)).toEqual(["issue:aleph-2", "issue:aleph-1"]);
  details[1].open = true; // aleph-1 open, aleph-2 closed.
  // A newer event for aleph-1 (its summary and +N change), then one for aleph-3 that moves the rows.
  view.view.event(root, ev("2026-11-09T11:00:00Z", "aleph-1", 3));
  view.view.event(root, ev("2026-11-09T11:30:00Z", "aleph-3", 1));
  expect(details.map((d) => [d.id, d.open])).toEqual([["issue:aleph-1", true], ["issue:aleph-2", false]]);
  expect(html).toContain('<span class="event-more">+2</span>');
});

test("the Herald's older rows under an issue are labelled by their run's kind with the linked job and a mark, by the chip for an event with no run, and the top row keeps the issue's title", () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-herald-runs-")), restore = withEnv({ ALEPH_JOBS_DIR: base, ALEPH_DB: join(base, "aleph.db") });
  try {
    const shown = (k: string) => `j-${k.slice(4).padStart(5, "0")}`;
    const [j1, j2] = (["intake", "build"] as const).map((role) => seed({ role, name: "issue.9", target: "issue.9", state: "done", started: "2026-11-09T10:00:00Z" }).id);
    const events = [
      row({ at: "2026-11-09T10:30:00Z", by: "gate", subject: "aleph-9", action: "started" }),
      row({ at: "2026-11-09T11:00:00Z", by: "gate", subject: "aleph-9", action: "done", on: [j1] }),
      row({ at: "2026-11-09T12:00:00Z", by: "gate", subject: "aleph-9", action: "done", on: [j2] }),
      row({ at: "2026-11-09T13:00:00Z", by: "gate", subject: "aleph-9", action: "done", on: ["job.99999"] }),
    ];
    const runs = heraldRuns(events, allRuns());
    expect(runs).toEqual({ [j1]: "intake", [j2]: "build" });
    const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: { history: [], events, titles: { "aleph-9": "Fix the footer" }, chats: [], runs } });
    const [top, older] = h.split('<div class="herald-older">');
    expect(top).toContain('<span class="event-title" title="Fix the footer">Fix the footer</span>');
    expect(top).toContain('<span class="badge done">closed</span>');
    const rows = older.split("</details>")[0].split('<div class="event-brief').slice(1);
    expect(rows).toHaveLength(3);
    // Newest first: the build run, the intake run, then the start, which has no run.
    expect(rows[0]).toContain(`<span class="brief-label" title="implement">implement</span><span class="brief-text" title="${shown(j2)} ✓"><a class="idl" href="#/jobs/${j2}">${shown(j2)}</a> <span class="brief-mark">✓</span></span>`);
    expect(rows[1]).toContain(`<span class="brief-label" title="intake">intake</span><span class="brief-text" title="${shown(j1)} ✓"><a class="idl" href="#/jobs/${j1}">${shown(j1)}</a> <span class="brief-mark">✓</span></span>`);
    expect(rows[2]).toContain('<span class="brief-label" title="started">started</span>');
    expect(rows.join("")).not.toContain("event-title");
  } finally { restore(); rmSync(base, { recursive: true, force: true }); }
});

test("the Herald draws a routing event as a system row: its choice, with no title", () => {
  const events = [row({ at: "2026-11-09T10:00:00Z", by: "rule", subject: "aleph-9", action: "routed", note: "worker-medium by classifier jev-1.13" })];
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: { history: [], events, titles: { "aleph-9": "Fix the thing" }, chats: [], runs: {} } });
  expect(h).toContain("worker-medium by classifier jev-1.13");
  expect(h).not.toContain("Fix the thing");
  expect(h).toMatch(/class="event-row quiet sys" data-by="rule"/);
});

test("the Herald folds an issue across its runs, and draws no row for a routine run that ended with no change", () => {
  const e = (at: string, subject: string, action: string, job: string) => (row({ at, by: "gate", subject, action, on: [job] }));
  const events = [
    e("2026-11-09T09:00:00Z", "housekeeper", "running", "housekeeper#1"), e("2026-11-09T09:10:00Z", "housekeeper", "done", "housekeeper#1"),
    e("2026-11-09T10:00:00Z", "housekeeper", "running", "housekeeper#2"), e("2026-11-09T10:10:00Z", "housekeeper", "done", "housekeeper#2"),
    e("2026-11-09T11:00:00Z", "aleph-9", "done", "aleph-9#1"), e("2026-11-09T12:00:00Z", "aleph-9", "done", "aleph-9#2"),
  ];
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: { history: [], events, titles: {}, chats: [], runs: {} } });
  expect(h).toContain('data-fold="issue:aleph-9"');
  expect(h).not.toContain('data-fold="issue:housekeeper"');
  // A routine's run that ended with no change draws no row.
  expect(h).not.toContain("housekeeper#");
});

test("the Herald hides an older start of a run with a newer event, leaves out the holds, and draws a routing event as tier, model and p", () => {
  const events = [
    row({ at: "2026-11-09T13:00:00Z", by: "gate", subject: "aleph-9", action: "passed", on: ["aleph-9#2"] }),
    row({ at: "2026-11-09T12:00:00Z", by: "gate", subject: "aleph-9", action: "running", on: ["aleph-9#2"] }),
    row({ at: "2026-11-09T11:30:00Z", by: "gate", subject: "aleph-9", action: "busy", on: ["aleph-8"], file: "ui/views/now.js" }),
    row({ at: "2026-11-09T11:00:00Z", by: "gate", subject: "aleph-9", action: "after", on: ["aleph-7"] }),
    row({ at: "2026-11-09T10:00:00Z", by: "rule", subject: "route", action: "routed", note: "cost 0.00004 model typesafe/jev-1.13-20260917 tier worker-medium p 0.83" }),
  ];
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: { history: [], events, titles: {}, chats: [], runs: { "aleph-9#2": "build" } } });
  expect(h).toMatch(/<span class="badge done">passed<\/span><a[^>]*>aleph-9<\/a>/);
  // The fold has the build's line only: its start is hidden by its result, and the routing is drawn as the build's facts.
  expect(h.match(/<div class="event-brief/g)).toHaveLength(1);
  expect(h).not.toContain("aleph-8");
  expect(h).toMatch(/<div data-key="[^"]*" id="[^"]*" class="event-row quiet sys" data-by="rule">/);
  expect(h).toContain("worker-medium · jev-1.13 · p 0.83");
});

// aleph-2136's events on 2026-11-13, newest first: filed, intake, routed, started, implement, closed, land.
const a2136 = [
  row({ at: "2026-11-13T19:55:05.677Z", by: "gate", subject: "aleph-2136", action: "landed", on: ["a2136#3"], commit: "08127b81a8a6a9780253d799d82b1c38bd4b5f58" }),
  row({ at: "2026-11-13T19:54:46.016Z", by: "gate", subject: "aleph-2136", action: "running", on: ["a2136#3"] }),
  row({ at: "2026-11-13T19:54:42.483Z", by: "gate", subject: "aleph-2136", action: "passed", on: ["a2136#2"], cost: 0.16095063369608836 }),
  row({ at: "2026-11-13T19:53:20.008Z", by: "claude", subject: "aleph-2136", action: "done" }),
  row({ at: "2026-11-13T19:51:00.787Z", by: "gate", subject: "aleph-2136", action: "running", on: ["a2136#2"] }),
  row({ at: "2026-11-13T19:50:59.573Z", by: "rule", subject: "aleph-2136", action: "started", note: "model haiku", size: "small" }),
  row({ at: "2026-11-13T19:50:59.497Z", by: "rule", subject: "aleph-2136", action: "routed", note: "small by classifier jev-1.13-20260917" }),
  row({ at: "2026-11-13T19:50:53.298Z", by: "gate", subject: "aleph-2136", action: "done", on: ["a2136#1"], cost: 0.2916336 }),
  row({ at: "2026-11-13T19:50:19.563Z", by: "gate", subject: "aleph-2136", action: "running", on: ["a2136#1"] }),
  row({ at: "2026-11-13T19:50:13.738Z", by: "claude", subject: "aleph-2136", action: "filed" }),
];
const a2136Runs = { "a2136#1": "intake", "a2136#2": "build", "a2136#3": "land" };
const olderText = (events: object[]) => {
  const h = view.renderHerald({ ...calm, now: "2026-11-13T20:00:00Z", herald: { history: [], events, titles: {}, chats: [], runs: a2136Runs } });
  return h.split('<div class="herald-older">')[1].split("</details>")[0].split('<div class="event-brief').slice(1)
    .map((r: string) => r.match(/title="([^"]*)">[^<]*<\/span><span class="brief-text" title="([^"]*)"/)!.slice(1).join(" | "));
};


test("the Herald's older rows give each job its facts and fold the routing and the start into the implement row", () => {
  expect(olderText(a2136)).toEqual([
    "land | a2136#3 ✓ 08127b8 · 20s",
    "implement | a2136#2 ✓ small · haiku · 3m 42s · $0.16",
    "closed | by Claude Code",
    "intake | a2136#1 ✓ 34s · $0.29",
    "filed | by Claude Code",
  ]);
});

// An issue's two builds as the writer stores them: each start's own size, then the job's running and passed events.
const twoBuilds = (sizes: (string | undefined)[]) => sizes.flatMap((size, i) => {
  const at = (m: number) => `2026-11-13T${10 + i}:${m < 10 ? "0" : ""}${m}:00Z`;
  return [
    row({ at: at(10), by: "gate", subject: "aleph-7", action: "passed", on: [`a7#${i + 1}`], cost: 0.5 }),
    row({ at: at(5), by: "gate", subject: "aleph-7", action: "running", on: [`a7#${i + 1}`] }),
    row({ at: at(1), by: "rule", subject: "aleph-7", action: "started", note: `model ${i ? "opus" : "haiku"}`, size }),
  ];
}).reverse();
const seven = (sizes: (string | undefined)[]) => view.renderHerald({ ...calm, now: "2026-11-13T14:00:00Z", herald: { history: [], events: twoBuilds(sizes), titles: {}, chats: [], runs: { "a7#1": "build", "a7#2": "build" } } });

test("the Herald gives each build of an issue the size of its own start", () => {
  const h = seven(["small", "large"]);
  expect(h).toContain("small · haiku · 5m 00s · $0.50");
  expect(h).toContain("large · opus · 5m 00s · $0.50");
  expect(h).not.toContain("small · opus");
  expect(h).not.toContain("large · haiku");
});

test("the Herald's build facts have no size when its start routed none, not the size of the issue's earlier build, and keep the model, commit, time and cost", () => {
  const events = twoBuilds(["small", undefined]).map((e: any) => e.action === "passed" && e.time.startsWith("2026-11-13T11") ? { ...e, commit_sha: "0123456789abcdef" } : e);
  const h = view.renderHerald({ ...calm, now: "2026-11-13T14:00:00Z", herald: { history: [], events, titles: {}, chats: [], runs: { "a7#1": "build", "a7#2": "build" } } });
  expect(h).toContain("a7#1 ✓ small · haiku · 5m 00s · $0.50");
  expect(h).toContain("a7#2 ✓ opus · 0123456 · 5m 00s · $0.50");
});

test("the Herald's job row takes its time from the job's first start, not one the gate logs after its result", () => {
  const again = [row({ at: "2026-11-13T19:54:50.000Z", by: "gate", subject: "aleph-2136", action: "running", on: ["a2136#2"] }), ...a2136];
  expect(olderText(again)[1]).toBe("implement | a2136#2 ✓ small · haiku · 3m 42s · $0.16");
});

test("the Herald's row of an attempt holds no size, model, cost or commit in its head, and its fold holds them", () => {
  const attempts = { "job.1": "job.1", "job.2": "job.1", "job.3": "job.1", "job.4": "job.1" };
  const events = [
    row({ at: "2026-11-13T10:50:00Z", by: "gate", subject: "aleph-7", action: "landed", on: ["job.4"], commit: "0123456789abcdef" }),
    row({ at: "2026-11-13T10:40:00Z", by: "gate", subject: "aleph-7", action: "passed", on: ["job.3"], cost: 0.1 }),
    row({ at: "2026-11-13T10:20:00Z", by: "gate", subject: "aleph-7", action: "passed", on: ["job.2"], cost: 0.5 }),
    row({ at: "2026-11-13T10:10:00Z", by: "gate", subject: "aleph-7", action: "running", on: ["job.2"] }),
    row({ at: "2026-11-13T10:09:00Z", by: "rule", subject: "aleph-7", action: "started", note: "model haiku", size: "small" }),
    row({ at: "2026-11-13T10:05:00Z", by: "gate", subject: "aleph-7", action: "done", on: ["job.1"], cost: 0.2 }),
    row({ at: "2026-11-13T10:00:00Z", by: "gate", subject: "aleph-7", action: "running", on: ["job.1"] }),
  ];
  const h = view.renderHerald({ ...calm, now: "2026-11-13T11:00:00Z", herald: { history: [], events, titles: { "aleph-7": "Fix it" }, chats: [], runs: { "job.1": "intake", "job.2": "build", "job.3": "review", "job.4": "land" }, attempts } });
  // One row for the attempt: its four runs are one group.
  expect(h.match(/<details/g)).toHaveLength(1);
  const [head, fold] = h.split('<div class="herald-older">');
  const line = head.slice(head.lastIndexOf('<div class="event-row'));
  expect(line).toContain('<span class="event-line"><span class="badge done">landed</span><a class="idl" href="#/issues/aleph/7">aleph-7</a><span class="event-title" title="Fix it">Fix it</span><span class="event-more">+4</span></span>');
  for (const fact of ["small", "haiku", "$0.50", "0123456"]) { expect(line).not.toContain(fact); expect(fold).toContain(fact); }
});

test("an attempt whose newest event is its routed start, with a size or without, keeps the size, model and cost out of the head and draws the start in its fold", () => {
  const routed = [
    [{ note: "model haiku", size: "small", cost: 0.001 }, ["small", "haiku", "0.001"], "model haiku → small · $0.001"],
    [{ note: "model default" }, ["model default"], "model default"],
  ] as const;
  for (const [start, facts, line] of routed) {
    const events = [
      row({ at: "2026-11-15T12:02:00Z", by: "rule", subject: "aleph-72", action: "started", ...start }),
      row({ at: "2026-11-15T12:01:00Z", by: "gate", subject: "aleph-72", action: "done", on: ["job.1"] }),
      row({ at: "2026-11-15T12:00:00Z", by: "gate", subject: "aleph-72", action: "running", on: ["job.1"] }),
    ];
    const h = view.renderHerald({ ...calm, now: "2026-11-15T13:00:00Z", herald: { history: [], events, titles: {}, chats: [], runs: { "job.1": "intake" }, attempts: { "job.1": "job.1" } } });
    const [head, fold] = h.split('<div class="herald-older">');
    expect(head).toContain('<span class="badge run">started</span>');
    for (const fact of facts) expect(head).not.toContain(fact);
    expect(fold).toContain(line);
  }
});

test("a second attempt of an issue, a job whose chain starts elsewhere, is a row of its own", () => {
  const events = [
    row({ at: "2026-11-13T12:00:00Z", by: "gate", subject: "aleph-7", action: "done", on: ["job.9"] }),
    row({ at: "2026-11-13T10:00:00Z", by: "gate", subject: "aleph-7", action: "done", on: ["job.1"] }),
    row({ at: "2026-11-13T09:00:00Z", by: "claude", subject: "aleph-7", action: "filed" }),
  ];
  const h = view.renderHerald({ ...calm, now: "2026-11-13T13:00:00Z", herald: { history: [], events, titles: {}, chats: [], runs: { "job.1": "intake", "job.9": "intake" }, attempts: { "job.1": "job.1", "job.9": "job.9" } } });
  expect(h.match(/<details/g)).toHaveLength(2);
  // An event with no job, the filing, goes with the first attempt.
  const [newer, older] = h.split("</details>");
  expect(newer).not.toContain(">filed<");
  expect(older).toContain(">filed<");
});

const hk = (at: string, action: string, on?: string[]) => row({ at, by: "gate", subject: "housekeeper", action, on: on ?? ["job.57"] });
const changed = (at: string, issue: string, why: string) => row({ at, by: "job.57", subject: issue, action: "changed", note: why });
const feed = (events: object[], extra: object = {}) => view.renderHerald({ ...calm, now: "2026-11-15T14:00:00Z", herald: { history: [], events, titles: {}, chats: [], runs: {}, ...extra } });

test("a housekeeper run with 2 changes is one row reading 2 changes, with a line for each in its fold, in the order they ran; an ended run with none has no row", () => {
  const h = feed([
    hk("2026-11-15T13:10:00Z", "done"), changed("2026-11-15T13:06:00Z", "aleph-8", "later"), changed("2026-11-15T13:05:00Z", "aleph-5", "the land did it"), hk("2026-11-15T13:00:00Z", "running"),
    hk("2026-11-15T12:10:00Z", "done", ["job.56"]), hk("2026-11-15T12:00:00Z", "running", ["job.56"]),
  ]);
  expect(h.match(/class="event-row[^"]*" data-by=/g)).toHaveLength(1);
  expect(h).toContain('<span class="badge quiet">ended</span><a class="idl" href="#/jobs/job.57">j-00057</a><span class="event-title" title="2 changes">2 changes</span><span class="event-more">+2</span>');
  const lines = h.split('<div class="herald-older">')[1].split('<div class="event-brief').slice(1);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("aleph-5");
  expect(lines[0]).toContain("the land did it");
  expect(lines[1]).toContain("aleph-8");
  expect(h).not.toContain("j-00056");
  // A reviewed count alone does not draw a row for a run that changed nothing.
  expect(feed([hk("2026-11-15T12:10:00Z", "done", ["job.56"]), hk("2026-11-15T12:00:00Z", "running", ["job.56"])], { reviewed: { "job.56": 4 } })).not.toContain("j-00056");
});

test("the Herald state's reviewed count of a housekeeper job is its tally's reviewed", () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-herald-reviewed-")), restore = withEnv({ ALEPH_JOBS_DIR: base, ALEPH_DB: join(base, "aleph.db") });
  try {
    const { id } = seed({ role: "housekeeper", name: "housekeeper", state: "done", tally: { reviewed: 3, retitled: 1, noted: 2 } });
    expect(heraldReviewed([row({ at: "2026-11-15T13:10:00Z", by: "gate", subject: "housekeeper", action: "done", on: [id] })], allRuns())).toEqual({ [id]: 3 });
  } finally { restore(); rmSync(base, { recursive: true, force: true }); }
});

test("a housekeeper run with a reviewed count says it before its verb counts, and its fold has a line for each change", () => {
  const h = feed([
    hk("2026-11-15T13:10:00Z", "done"), changed("2026-11-15T13:07:00Z", "aleph-9", "note: second look"), changed("2026-11-15T13:06:00Z", "aleph-8", "note: first look"),
    changed("2026-11-15T13:05:00Z", "aleph-5", "retitle: New title"), hk("2026-11-15T13:00:00Z", "running"),
  ], { reviewed: { "job.57": 3 } });
  expect(h.match(/class="event-row[^"]*" data-by=/g)).toHaveLength(1);
  expect(h).toContain('<span class="event-title" title="reviewed 3 · retitled 1 · commented 2">reviewed 3 · retitled 1 · commented 2</span>');
  expect(h.split('<div class="herald-older">')[1].split('<div class="event-brief').slice(1)).toHaveLength(3);
});

test("a housekeeper run whose changes all have a verb counts each verb, and each line is labelled with the verb's past word", () => {
  const h = feed([
    hk("2026-11-15T13:10:00Z", "done"), changed("2026-11-15T13:07:00Z", "aleph-9", "note: second look"), changed("2026-11-15T13:06:00Z", "aleph-8", "note: first look"),
    changed("2026-11-15T13:05:00Z", "aleph-5", "retitle: New title"), hk("2026-11-15T13:00:00Z", "running"),
  ]);
  expect(h).toContain('<span class="event-title" title="retitled 1 · commented 2">retitled 1 · commented 2</span>');
  const lines = h.split('<div class="herald-older">')[1].split('<div class="event-brief').slice(1);
  expect(lines[0]).toContain('<span class="brief-label" title="retitled">retitled</span>');
  expect(lines[0]).toContain("aleph-5");
  expect(lines[0]).toContain("New title");
  expect(lines[0]).not.toContain("retitle:");
  expect(lines[1]).toContain('<span class="brief-label" title="commented">commented</span>');
  expect(lines[1]).toContain("first look");
  expect(lines[2]).toContain("second look");
});

test("a housekeeper job whose only event is running draws one row that links its job", () => {
  const h = feed([hk("2026-11-15T13:00:00Z", "running")]);
  expect(h.match(/class="event-row[^"]*" data-by=/g)).toHaveLength(1);
  expect(h).toContain('<span class="badge run">started</span><a class="idl" href="#/jobs/job.57">j-00057</a>');
  expect(h).not.toContain("<details");
});

test("a stalled event on an intake job of an issue folds into the issue's row as stalled and the issue and the run, not a row of its own", () => {
  setCodes({ aleph: "a" });
  try {
    const at = (m: number) => `2026-11-15T13:${m}:00Z`;
    const events = [
      { ...row({ at: at(30), by: "rule", subject: "issue.2072", action: "stalled", on: ["job.9"] }), project: "aleph" },
      { ...row({ at: at(10), by: "gate", subject: "issue.2072", action: "running", on: ["job.9"] }), project: "aleph" },
    ];
    const h = feed(events, { runs: { "job.9": "intake" }, titles: { "issue.2072": "Fix ingest" } });
    expect(h.match(/class="event-row[^"]*" data-by=/g)).toHaveLength(1);
    // The head is the start; the stall is in the fold.
    expect(h).toContain('<span class="badge run">started</span><a class="idl" href="#/issues/aleph/2072">a-02072</a>');
    expect(h.split('<div class="herald-older">')[1]).toContain('>stalled a-02072 · intake</span>');
  } finally { setCodes({}); }
});

test("a head with a note keeps its line in the fold under its titled row; a head with none has no brief row", () => {
  setCodes({ aleph: "a" });
  try {
    const done = (note?: string) => [{ ...row({ at: "2026-11-15T13:00:00Z", by: "gate", subject: "issue.2072", action: "done", note }), project: "aleph" }];
    const h = feed(done("the land did it"), { titles: { "issue.2072": "Fix ingest" } });
    expect(h).toContain('<span class="event-title" title="Fix ingest">Fix ingest</span>');
    expect(h.split('<div class="herald-older">')[1]).toContain(">the land did it</span>");
    expect(feed(done(), { titles: { "issue.2072": "Fix ingest" } })).not.toContain("herald-older");
  } finally { setCodes({}); }
});

test("two chat turns of one session are one feed row, titled by its first prompt", () => {
  const chat = { id: "5a5a4e9b-88d1-476f-aeb2-e20af1a9fae6", start: "2026-11-15T12:00:00Z", last: "2026-11-15T12:30:00Z", title: "why is the build red" };
  const h = feed([], { chats: [chat] });
  expect(h.match(/class="event-row[^"]*" data-by=/g)).toHaveLength(1);
  expect(h).toContain('<span class="badge quiet">chat</span><span class="idp">5a5a4e9b</span><span class="event-title" title="why is the build red">why is the build red</span>');
});

test("a new event for an issue keeps its grouped row's key and id, and each Herald row has its own id", () => {
  const e = (at: string, action: string, job: string) => row({ at, by: "gate", subject: "aleph-9", action, on: [job] });
  const old = [e("2026-11-09T11:00:00Z", "done", "aleph-9#1"), e("2026-11-09T12:00:00Z", "done", "aleph-9#2")], newer = [e("2026-11-09T13:00:00Z", "done", "aleph-9#3"), ...old];
  const draw = (events: any[]) => view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", running: [{ id: "a1#1", name: "a1", started: "2026-11-09T13:30:00Z", item: { title: "Run" } }], herald: { history: [], events, titles: {}, chats: [{ id: "chat-1", last: "2026-11-09T09:00:00Z", title: "Chat" }], runs: {} } });
  const [a, b] = [draw(old), draw(newer)];
  const ids = (h: string) => [...h.matchAll(/<(?:div|details) data-key="([^"]*)" id="([^"]*)"/g)].map((m) => m.slice(1));
  const group = (h: string) => ids(h).find(([k]) => k.startsWith("issue:aleph-9"));
  expect(group(a)).toBeTruthy();
  expect(group(b)).toEqual(group(a));
  for (const h of [a, b]) {
    const all = [...h.matchAll(/ id="([^"]*)"/g)].map((m) => m[1]);
    expect(all.length).toBeGreaterThan(2);
    expect(new Set(all).size).toBe(all.length);
    expect(h).toMatch(/class="event-row run run-now" data-job="a1#1" id="[^"]+"/);
  }
});
