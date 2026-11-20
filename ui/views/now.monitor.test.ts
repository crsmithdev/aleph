import { expect, setSystemTime, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./now.js";
import { heraldOf, row, withFactory } from "../now.testkit.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heraldReviewed, heraldRuns } from "../state.ts";
import { withEnv } from "../server.testkit.ts";
import { allRuns } from "../../jobs/lib/records/record.ts";
import { seed } from "../../jobs/job.testkit.ts";
import { setCodes } from "../../lib/naming.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { clock } from "./lib/format.js";

const calm = { ...withFactory({}), asks: [], errored: [] };
/** The text of each body row of the Pipeline table, its cells joined by " | ". */
const rowsOf = (h: string) => [...h.matchAll(/<tr>(.*?)<\/tr>/g)].slice(1).map((m) => [...m[1].matchAll(/<td[^>]*>(.*?)<\/td>/g)].map((c) => c[1].replace(/<[^>]*>/g, "")).join(" | "));
const FIG = { kept: 3, hours: 1 }, CLASSES = [{ key: "landed", lost: false, hours: 3 }, { key: "reran", lost: true, hours: 1 }];

test("the Pipeline card shows the 6 stages in order, each a row of runs per issue, p90, failed share and agent hours, and no other role", () => {
  const rows = [
    { stage: "monitor", runs: 1, items: 1, unusable: 0, p90: 10, minutes: 1 },
    { stage: "build", runs: 9, items: 5, unusable: 2, p90: 804, minutes: 20 },
    { stage: "intake", runs: 3, items: 3, unusable: 0, p90: null, minutes: 2 },
    { stage: "land", runs: 400, items: 100, unusable: 1, p90: 5, minutes: 0.3 },
  ];
  const h = view.renderPipeline({ window: "week", stages: { rows }, phases: { queue: { count: 4, p90: 79 } }, figures: FIG, classes: CLASSES });
  // A stage with no run and the queue show a "–" with its reason, not words; Implement's hours are its classes' (3h + 1h).
  expect(rowsOf(h)).toEqual([
    "Intake | 1.0 | – | 0.0% |  | 0.1h",
    "Queue | – | 1m 19s | – |  | –",
    "Implement | 1.8 | 13m 24s | 22% |  | 4.0h",
    "Review | – | – | – |  | –",
    "Recheck | – | – | – |  | –",
    "Land | 4.0 | 5s | 0.3% |  | 2.0h",
  ]);
  // 2 of 9 build runs failed: 22%, amber; 1 of 400 land runs is 0.3%, under 10%, so no tone.
  expect(h).toContain('<a class="pf need" href="#/factory/jobs?stage=implement&amp;role=worker&amp;unusable=1">22%</a>');
  expect(h).toContain('<a class="pf" href="#/factory/jobs?stage=land&amp;unusable=1">0.3%</a>');
  // Implement's bar is its outcome classes, on the scale of the largest stage; the others are one fill.
  expect(h).toContain('<span class="meter" role="img" aria-label="landed 3.0h, reran 1.0h" title="landed 3.0h, reran 1.0h"><i class="seg-landed" style="width:75.0%"></i><i class="seg-reran" style="width:25.0%"></i></span>');
  expect(h).toContain('<span class="meter" aria-hidden="true"><i style="width:50.0%"></i></span>');
  expect(view.renderPipeline({ window: "week", stages: { rows }, phases: {}, figures: FIG, classes: CLASSES })).toContain('<span title="Nothing waited in this window">–</span>');
  expect(h).not.toContain(">monitor<");
  expect(view.renderPipeline(null)).toContain("Loading the pipeline…");
});

test("each Pipeline stage name and each outcome in its legend is an Inspector target that names its stage or class", () => {
  const rows = [{ stage: "review", runs: 4, items: 4, unusable: 0, p90: 60, minutes: 1 }, { stage: "recheck", runs: 2, items: 2, unusable: 1, p90: 30, minutes: 1 }];
  const classes = [{ key: "landed", lost: false, hours: 2 }, { key: "returned", lost: true, hours: 1 }, { key: "dropped", lost: true, hours: 0 }];
  const h = view.renderPipeline({ window: "day", stages: { rows }, phases: { queue: { count: 1, p90: 5 } }, figures: { kept: 2, hours: 1 }, classes }, new URLSearchParams("window=day&project=aleph"));
  expect([...h.matchAll(/data-inspect="stage" data-target="([^"]*)"/g)].map((m) => m[1])).toEqual(["intake", "queue", "build", "review", "recheck", "land"]);
  expect([...h.matchAll(/data-inspect="class" data-target="([^"]*)"/g)].map((m) => m[1])).toEqual(["landed", "returned"]);
});

/** The flow data of the Inspector tests: two build issues, the failed one first, and the returned class's issues, most hours first, as /api/flow sorts them. */
const issue = (n: number, title: string, x: object) => ({ issue: `aleph-${n}`, title, href: `#/issues/aleph/${n}`, ...x });
const flow = {
  window: "day",
  stages: { rows: [], issues: { intake: [], queue: [], build: [issue(8, "Fix the gate", { runs: 2, secs: 300, failed: true }), issue(7, "Add a tab", { runs: 1, secs: 900, failed: false })], review: [], recheck: [], land: [] } },
  classes: [{ key: "returned", lost: true, hours: 3, top: [issue(9, "Split the store", { hours: 2.5 }), issue(3, "Trim a test", { hours: 0.5 })] }],
  failures: [issue(4, "Drop a flag", { stage: "recheck", at: "2026-11-20T12:05:00" }), issue(8, "Fix the gate", { stage: "build", at: "2026-11-20T09:30:00" })],
};
/** The Herald drawn with `at` as the kept tab and target, in the day window of the aleph project; `d` is its /api/flow. */
const inspected = (at: object | null, d: object = flow) => {
  (globalThis as any).localStorage = { getItem: (k: string) => (k === "aleph.herald.inspect" && at ? JSON.stringify(at) : null), setItem() {} };
  try { return view.renderHerald({ ...calm, flow: d }, { stale: false, live: null, loaded: null }, new URLSearchParams("window=day&project=aleph")); }
  finally { delete (globalThis as any).localStorage; }
};
/** The issue IDs of an Inspector list, in order. */
const listed = (h: string) => [...h.slice(h.indexOf('data-pane="inspector"')).matchAll(/class="idl" href="[^"]*">([^<]*)</g)].map((m) => m[1]);

test("the Herald's tabs read Events, Active, Inspector, and it opens on Events, with the feed shown and the failed issues in the Inspector, newest failure first", () => {
  // when() gives the month and day of a time in the year of now.
  setSystemTime(new Date(2026, 10, 20, 15));
  const h = inspected(null);
  setSystemTime();
  expect([...h.matchAll(/data-tab="\w+" aria-pressed="\w+">(\w+)</g)].map((m) => m[1])).toEqual(["Events", "Active", "Inspector"]);
  expect(h).toContain('<button type="button" data-tab="events" aria-pressed="true">Events</button>');
  expect(h).toMatch(/<section data-pane="events">.*class="herald-feed"/);
  expect(h).toContain('<section data-pane="inspector" hidden><div class="inspect-head"><h3 class="sub-head">Failures</h3></div>');
  expect(listed(h)).toEqual(["aleph-4", "aleph-8"]);
  expect(h).toContain('<td class="wide" title="Drop a flag">Drop a flag</td><td>Recheck</td><td class="num">11/20 12:05</td>');
  expect(h).toContain('<td class="wide" title="Fix the gate">Fix the gate</td><td>Implement</td><td class="num">11/20 09:30</td>');
});

test("with no failure in the window, the Inspector is empty", () => {
  const h = inspected(null, { ...flow, failures: [] });
  expect(h).toContain('<h3 class="sub-head">Failures</h3></div><div class="empty">');
  expect(listed(h)).toEqual([]);
});

test("the Active pane lists the running and queued issues, or the running jobs with a kept jobs toggle, each row linked to its page", () => {
  const s = { ...calm, runningIssues: [{ id: "aleph-9", title: "Sort it", href: "#/issues/aleph/9" }], running: [{ id: "job.0", name: "aleph-7", item: { title: "Fix it" } }], queued: [{ repo: "aleph", id: 12, title: "Wait" }] };
  /** Each section of the Active pane with the hrefs of its rows, drawn with `mode` as the kept toggle. */
  const active = (mode: string | null) => {
    (globalThis as any).localStorage = { getItem: (k: string) => (k === "aleph.herald.active" && mode ? JSON.stringify(mode) : null), setItem() {} };
    try {
      const h = view.renderHerald(s);
      const pane = h.slice(h.indexOf('data-pane="active"'), h.indexOf('data-pane="inspector"'));
      return [...pane.matchAll(/<section aria-label="(\w+)">(.*?)<\/section>/g)].map((m) => [m[1], [...m[2].matchAll(/href="([^"]*)"/g)].map((x) => x[1])]);
    } finally { delete (globalThis as any).localStorage; }
  };
  expect(active(null)).toEqual([["Running", ["#/issues/aleph/9"]], ["Queued", ["#/issues/aleph/12"]]]);
  expect(active("jobs")).toEqual([["Running", ["#/jobs/job.0"]], ["Queued", ["#/issues/aleph/12"]]]);
});

test("a kept Inspector tab on the build stage lists its issues, failed first, under an All jobs link to the stage's Jobs in the window and project", () => {
  const h = inspected({ tab: "inspector", kind: "stage", target: "build" });
  expect(h).toContain('<section data-pane="events" hidden>');
  expect(h).toContain('<h3 class="sub-head">Implement</h3><span><button type="button" class="pgo" data-inspect="failures">Failures</button> <a href="#/factory/jobs?stage=implement&amp;role=worker&amp;window=day&amp;project=aleph">All jobs</a></span>');
  expect(listed(h)).toEqual(["aleph-8", "aleph-7"]);
  expect(h).toContain('<td class="wide" title="Fix the gate">Fix the gate</td><td class="num">2</td><td class="num">5m 00s</td><td><span class="badge error">failed</span></td>');
  expect(h).toContain('<td class="num">15m 00s</td><td></td>');
});

test("a kept Inspector tab on the returned class lists its issues with their hours, most hours first", () => {
  const h = inspected({ tab: "inspector", kind: "class", target: "returned" });
  expect(h).toContain('<h3 class="sub-head">returned</h3><button type="button" class="pgo" data-inspect="failures">Failures</button></div>');
  expect(listed(h)).toEqual(["aleph-9", "aleph-3"]);
  expect(h).toContain('<td class="wide" title="Split the store">Split the store</td><td class="num">2.5h</td>');
  expect(h).not.toContain("All jobs");
});

test("a Pipeline stage with an unusable run links its failed share to the unusable runs of the page's window and project; one with none keeps plain text", () => {
  const rows = [{ stage: "build", runs: 9, items: 5, unusable: 2, p90: 804, minutes: 20 }, { stage: "intake", runs: 3, items: 3, unusable: 0, p90: null, minutes: 2 }];
  const h = view.renderPipeline({ window: "day", stages: { rows }, phases: {}, figures: FIG, classes: CLASSES }, new URLSearchParams("window=day&project=aleph"));
  expect(h).toContain('<a class="pf need" href="#/factory/jobs?stage=implement&amp;role=worker&amp;unusable=1&amp;window=day&amp;project=aleph">22%</a>');
  expect(h).toContain('<td class="num">0.0%</td>');
  expect(h.match(/class="pf/g)).toHaveLength(1);
});

test("the Herald shows its alerts under a Not OK badge in the worst alert's tone, then the events", () => {
  const ask = { id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "Please review" };
  const h = view.renderHerald({ ...calm, asks: [ask], errored: [], running: [], runningIssues: [], done: [], queued: [] });
  expect(h).toContain('<h2 id="h-herald">Herald</h2>');
  expect(h).toContain('<span class="badge need">Not OK</span>');
  expect(h).toContain('id="awaiting"');
  expect(h).not.toContain("Sticky Alerts");
  expect(h).not.toContain("data-herald-tab");
  expect(h).toContain('class="herald-feed"');
  const red = view.renderHerald({ ...calm, asks: [ask], factory: { ...calm.factory, health: [{ text: "health: aleph main is red", kind: "alert", key: "red-main" }] } });
  expect(red).toContain('<span class="badge error">Not OK</span>');
});

test("the Herald lists each running job as a row on the feed grid between the alerts and the feed, and no section with none", () => {
  const ask = { id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "Please review" };
  const running = [{ id: "job.0", name: "intake-aleph-7", size: "small", model: "deepseek-v4.1-flash", started: "2026-11-09T11:00:00Z", item: { title: "Fix the thing" } }];
  const h = view.renderHerald({ ...calm, asks: [ask], running, runningIssues: [{ id: "aleph-9", stage: "intake", title: "Sort it", at: "2026-11-09T11:30:00Z" }] });
  expect(h.match(/class="event-row run run-now"/g)).toHaveLength(2);
  // The start time, the action word in the run tone, the job's ID, its title, then the size after the breathing dot; the model is in the size's title.
  expect(h).toContain('<div class="event-row run run-now" data-job="job.0" id="h-job-job.0"><span class="event-time">' + clock("2026-11-09T11:00:00Z") + '</span><span class="event-body"><span class="event-line"><span class="badge run">implement</span><a class="idl" href="#/jobs/job.0">j0</a><span class="event-title run-title" title="Fix the thing">Fix the thing</span><span class="run-size" title="deepseek-v4.1-flash"><span class="run-dot"></span>small</span></span></span></div>');
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
  expect(h).toContain('<span class="badge error">Not OK</span>');
  expect(h).not.toContain("Alert: Health:");
  expect(h).not.toContain("aleph main is red");
});

// The stream path keeps its rows in now.js for the page's life: each such test takes a copy of the module of its own.
let copies = 0;
const fresh = () => import(`./now.js?copy=${++copies}`);

test("the Herald draws the state's rows and the streamed ones when they are newer, newest first, with the status rows", async () => {
  const ev = (at: string, action: string, o: object = {}) => (row({ at, by: "gate", subject: "aleph-5", action, on: ["aleph-5#1"], ...o }));
  const s = { ...calm, now: "2026-11-09T12:00:00Z", herald: { ...heraldOf([ev("2026-11-09T11:30:00Z", "running")], { history: [{ at: "2026-11-09T11:00:00Z", tone: "warning", label: "Wait", text: "The factory is paused" }] }), seq: 5 } };
  const v = await fresh();
  v.renderHerald({ ...calm, now: "2026-11-09T10:00:00Z" });
  const loaded = { at: "2026-11-09T10:00:00Z", text: "x" };
  const order = (h: string) => [...h.slice(h.indexOf("herald-feed")).matchAll(/class="event-row (\w+)/g)].map((m) => m[1]);
  // The fixture's status now (12:00) is newest, then the event at 11:30, then the status at 11:00.
  expect(order(v.renderHerald(s))).toEqual(["alert", "run", "warning"]);
  // Rows of the stream with an older seq change nothing; a newer seq replaces the state's rows.
  const live = (seq: number) => ({ ...heraldOf([ev("2026-11-09T11:30:00Z", "running"), ev("2026-11-09T11:45:00Z", "failed", { note: "past its time box" })]), seq });
  expect(order(v.renderHerald(s, { stale: false, live: live(4), loaded }))).toEqual(order(v.renderHerald(s)));
  const h = v.renderHerald(s, { stale: false, live: live(6), loaded });
  expect(order(h)).toEqual(["alert", "error", "warning"]);
  // Two columns: the time, then one line: the chip, the issue linked, the text the sentence adds.
  expect(h).toContain('<span class="event-line"><span class="badge error">failed</span><a class="idl" href="#/issues/aleph/5">aleph-5</a><span class="event-title" title="past its time box">past its time box</span><span class="event-more">+2</span></span>');
  expect(h).not.toContain("event-tone");
});

test("an event from the stream goes into the Herald at once", async () => {
  const view = await fresh();
  const s = { ...calm, now: "2026-11-09T12:00:00Z", herald: heraldOf([]) };
  view.view.render(s, {}, new URLSearchParams());
  let html = "";
  const herald = { querySelectorAll: () => [], set outerHTML(v: string) { html = v; } };
  const rows = heraldOf([row({ at: "2026-11-09T11:59:00Z", by: "gate", subject: "aleph-6", action: "landed", on: ["aleph-6#2"] })], { titles: { "aleph-6": "Fix six" } }).rows;
  view.view.event({ querySelector: (q: string) => (q === "#herald" ? herald : null) }, { seq: 1, rows });
  expect(html).toContain('<span class="badge done">landed</span><a class="idl" href="#/issues/aleph/6">aleph-6</a><span class="event-title" title="Fix six">Fix six</span>');
});

test("a Herald group keeps its open or closed state when a newer event arrives and the rows move, through the stream path", async () => {
  const view = await fresh();
  const ev = (at: string, subject: string, n: number) => (row({ at, by: "gate", subject, action: "done", on: [`${subject}#${n}`] }));
  const old = [ev("2026-11-09T10:00:00Z", "aleph-1", 1), ev("2026-11-09T10:01:00Z", "aleph-1", 2), ev("2026-11-09T10:02:00Z", "aleph-2", 1), ev("2026-11-09T10:03:00Z", "aleph-2", 2)];
  const s = { ...calm, now: "2026-11-09T12:00:00Z", herald: heraldOf(old) };
  view.view.render(s, {}, new URLSearchParams());
  // A fake page: `html` is the Herald as drawn, its details are rebuilt from it at each swap, closed unless the markup says open.
  let html = view.renderHerald(s), details: any[] = [];
  const build = () => { details = [...html.matchAll(/<details[^>]*data-fold="([^"]*)"[^>]*>/g)].map((m) => ({ id: m[1], open: false, dataset: { fold: m[1] }, querySelector: () => null, querySelectorAll: () => [] })); };
  const herald = () => ({ querySelectorAll: (q: string) => (q === "details" ? details : []), set outerHTML(v: string) { html = v; build(); } });
  const root = { querySelector: (q: string) => (q === "#herald" ? herald() : null) };
  build();
  expect(details.map((d) => d.id)).toEqual(["issue:aleph-2", "issue:aleph-1"]);
  details[1].open = true; // aleph-1 open, aleph-2 closed.
  // A newer event for aleph-1 (its summary and +N change), then one for aleph-3 that moves the rows: the stream sends all rows each time.
  const more = [...old, ev("2026-11-09T11:00:00Z", "aleph-1", 3)];
  view.view.event(root, { seq: 1, rows: heraldOf(more).rows });
  view.view.event(root, { seq: 2, rows: heraldOf([...more, ev("2026-11-09T11:30:00Z", "aleph-3", 1)]).rows });
  expect(details.map((d) => [d.id, d.open])).toEqual([["issue:aleph-1", true], ["issue:aleph-2", false]]);
  expect(html).toContain('<span class="event-more">+2</span>');
});

test("the Herald's older rows under an issue are labelled by their run's kind with the linked job and a mark, by the chip for an event with no run, and the top row keeps the issue's title", () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-herald-runs-")), restore = withEnv({ ALEPH_JOBS_DIR: base, ALEPH_DB: join(base, "aleph.db") });
  try {
    const shown = (k: string) => `j${k.slice(4)}`;
    const [j1, j2] = (["intake", "build"] as const).map((role) => seed({ role, name: "issue.9", target: "issue.9", state: "done", started: "2026-11-09T10:00:00Z" }).id);
    const events = [
      row({ at: "2026-11-09T10:30:00Z", by: "gate", subject: "aleph-9", action: "started" }),
      row({ at: "2026-11-09T11:00:00Z", by: "gate", subject: "aleph-9", action: "done", on: [j1] }),
      row({ at: "2026-11-09T12:00:00Z", by: "gate", subject: "aleph-9", action: "done", on: [j2] }),
      row({ at: "2026-11-09T13:00:00Z", by: "gate", subject: "aleph-9", action: "done", on: ["job.99999"] }),
    ];
    const runs = heraldRuns(events, allRuns());
    expect(runs).toEqual({ [j1]: "intake", [j2]: "build" });
    const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: heraldOf(events, { titles: { "aleph-9": "Fix the footer" }, runs }) });
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
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: heraldOf(events, { titles: { "aleph-9": "Fix the thing" } }) });
  expect(h).toContain("worker-medium by classifier jev-1.13");
  expect(h).not.toContain("Fix the thing");
  expect(h).toMatch(/class="event-row quiet sys" data-by="rule"/);
});

test("the Herald folds an issue across its runs, and draws a row for a routine run that ended with no change", () => {
  const e = (at: string, subject: string, action: string, job: string) => (row({ at, by: "gate", subject, action, on: [job] }));
  const events = [
    e("2026-11-09T09:00:00Z", "housekeeper", "running", "job.91"), e("2026-11-09T09:10:00Z", "housekeeper", "done", "job.91"),
    e("2026-11-09T10:00:00Z", "housekeeper", "running", "job.92"), e("2026-11-09T10:10:00Z", "housekeeper", "done", "job.92"),
    e("2026-11-09T11:00:00Z", "aleph-9", "done", "job.93"), e("2026-11-09T12:00:00Z", "aleph-9", "done", "job.94"),
  ];
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: heraldOf(events) });
  expect(h).toContain('data-fold="issue:aleph-9"');
  expect(h).not.toContain('data-fold="issue:housekeeper"');
  expect(h).toContain('<span class="badge quiet">ended</span><a class="idl" href="#/jobs/job.91">j91</a>');
  expect(h).toContain('<span class="badge quiet">ended</span><a class="idl" href="#/jobs/job.92">j92</a>');
});

test("a routine run's row draws its kind and job as one cell of the line's grid", () => {
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: heraldOf([row({ at: "2026-11-09T13:00:00Z", by: "gate", subject: "housekeeper", action: "running", on: ["job.56"] })], { runs: { "job.56": "housekeeper" } }) });
  expect(h).toContain('<span class="badge run">started</span><span>housekeeper <a class="idl" href="#/jobs/job.56">j56</a></span><span></span>');
});

test("the Herald hides an older start of a run with a newer event, draws the holds as lines, and draws a routing event as its note", () => {
  const events = [
    row({ at: "2026-11-09T13:00:00Z", by: "gate", subject: "aleph-9", action: "passed", on: ["job.94"] }),
    row({ at: "2026-11-09T12:00:00Z", by: "gate", subject: "aleph-9", action: "running", on: ["job.94"] }),
    row({ at: "2026-11-09T11:30:00Z", by: "gate", subject: "aleph-9", action: "busy", on: ["aleph-8"], file: "ui/views/now.js" }),
    row({ at: "2026-11-09T11:00:00Z", by: "gate", subject: "aleph-9", action: "after", on: ["aleph-7"] }),
    row({ at: "2026-11-09T10:00:00Z", by: "rule", subject: "route", action: "routed", note: "worker-medium by classifier jev-1.13" }),
  ];
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: heraldOf(events, { runs: { "job.94": "build" } }) });
  expect(h).toMatch(/<span class="badge done">passed<\/span><a[^>]*>aleph-9<\/a>/);
  // The fold has the build's line and the two holds: the build's start is hidden by its result, and the routing is drawn as the build's facts.
  expect(h.match(/<div class="event-brief/g)).toHaveLength(3);
  expect(h).toContain("aleph-8");
  expect(h).toMatch(/<div data-key="[^"]*" id="[^"]*" class="event-row quiet sys" data-by="rule">/);
  expect(h).toContain("worker-medium by classifier jev-1.13");
});

// aleph-2136's events on 2026-11-13, newest first: filed, intake, routed, started, implement, closed, land.
const a2136 = [
  row({ at: "2026-11-13T19:55:05.677Z", by: "gate", subject: "aleph-2136", action: "landed", on: ["job.3"], commit: "08127b81a8a6a9780253d799d82b1c38bd4b5f58" }),
  row({ at: "2026-11-13T19:54:46.016Z", by: "gate", subject: "aleph-2136", action: "running", on: ["job.3"] }),
  row({ at: "2026-11-13T19:54:42.483Z", by: "gate", subject: "aleph-2136", action: "passed", on: ["job.2"], cost: 0.16095063369608836 }),
  row({ at: "2026-11-13T19:53:20.008Z", by: "claude", subject: "aleph-2136", action: "done" }),
  row({ at: "2026-11-13T19:51:00.787Z", by: "gate", subject: "aleph-2136", action: "running", on: ["job.2"] }),
  row({ at: "2026-11-13T19:50:59.573Z", by: "rule", subject: "aleph-2136", action: "started", note: "model: haiku", size: "small" }),
  row({ at: "2026-11-13T19:50:59.497Z", by: "rule", subject: "aleph-2136", action: "routed", note: "small by classifier jev-1.13-20260917" }),
  row({ at: "2026-11-13T19:50:53.298Z", by: "gate", subject: "aleph-2136", action: "done", on: ["job.1"], cost: 0.2916336 }),
  row({ at: "2026-11-13T19:50:19.563Z", by: "gate", subject: "aleph-2136", action: "running", on: ["job.1"] }),
  row({ at: "2026-11-13T19:50:13.738Z", by: "claude", subject: "aleph-2136", action: "filed" }),
];
const a2136Runs = { "job.1": "intake", "job.2": "build", "job.3": "land" };
const olderText = (events: object[]) => {
  const h = view.renderHerald({ ...calm, now: "2026-11-13T20:00:00Z", herald: heraldOf(events, { runs: a2136Runs }) });
  return h.split('<div class="herald-older">')[1].split("</details>")[0].split('<div class="event-brief').slice(1)
    .map((r: string) => r.match(/title="([^"]*)">[^<]*<\/span><span class="brief-text" title="([^"]*)"/)!.slice(1).join(" | "));
};


test("the Herald's older rows give each job its facts and fold the routing and the start into the implement row", () => {
  expect(olderText(a2136)).toEqual([
    "land | j3 ✓ 08127b8 · 20s",
    "implement | j2 ✓ small · haiku · 3m 42s · $0.16",
    "closed | by Claude Code",
    "intake | j1 ✓ 34s · $0.29",
    "filed | by Claude Code",
  ]);
});

// An issue's two builds as the writer stores them: each start's own size, then the job's running and passed events.
const twoBuilds = (sizes: (string | undefined)[]) => sizes.flatMap((size, i) => {
  const at = (m: number) => `2026-11-13T${10 + i}:${m < 10 ? "0" : ""}${m}:00Z`;
  return [
    row({ at: at(10), by: "gate", subject: "aleph-7", action: "passed", on: [`job.7${i + 1}`], cost: 0.5 }),
    row({ at: at(5), by: "gate", subject: "aleph-7", action: "running", on: [`job.7${i + 1}`] }),
    row({ at: at(1), by: "rule", subject: "aleph-7", action: "started", note: `model: ${i ? "opus" : "haiku"}`, size }),
  ];
}).reverse();
const seven = (sizes: (string | undefined)[]) => view.renderHerald({ ...calm, now: "2026-11-13T14:00:00Z", herald: heraldOf(twoBuilds(sizes), { runs: { "job.71": "build", "job.72": "build" } }) });

test("the Herald gives each build of an issue the size of its own start", () => {
  const h = seven(["small", "large"]);
  expect(h).toContain("small · haiku · 5m 00s · $0.50");
  expect(h).toContain("large · opus · 5m 00s · $0.50");
  expect(h).not.toContain("small · opus");
  expect(h).not.toContain("large · haiku");
});

test("the Herald's build facts have no size when its start routed none, not the size of the issue's earlier build, and keep the model, commit, time and cost", () => {
  const events = twoBuilds(["small", undefined]).map((e: any) => e.action === "passed" && e.time.startsWith("2026-11-13T11") ? { ...e, commit_sha: "0123456789abcdef" } : e);
  const h = view.renderHerald({ ...calm, now: "2026-11-13T14:00:00Z", herald: heraldOf(events, { runs: { "job.71": "build", "job.72": "build" } }) });
  expect(h).toContain("j71 ✓ small · haiku · 5m 00s · $0.50");
  expect(h).toContain("j72 ✓ opus · 0123456 · 5m 00s · $0.50");
});

test("the Herald's job row takes its time from the job's first start, not one the gate logs after its result", () => {
  const again = [row({ at: "2026-11-13T19:54:50.000Z", by: "gate", subject: "aleph-2136", action: "running", on: ["job.2"] }), ...a2136];
  expect(olderText(again)[1]).toBe("implement | j2 ✓ small · haiku · 3m 42s · $0.16");
});

test("the Herald's row of an attempt holds no size, model, cost or commit in its head, and its fold holds them", () => {
  const attempts = { "job.1": "job.1", "job.2": "job.1", "job.3": "job.1", "job.4": "job.1" };
  const events = [
    row({ at: "2026-11-13T10:50:00Z", by: "gate", subject: "aleph-7", action: "landed", on: ["job.4"], commit: "0123456789abcdef" }),
    row({ at: "2026-11-13T10:40:00Z", by: "gate", subject: "aleph-7", action: "passed", on: ["job.3"], cost: 0.1 }),
    row({ at: "2026-11-13T10:20:00Z", by: "gate", subject: "aleph-7", action: "passed", on: ["job.2"], cost: 0.5 }),
    row({ at: "2026-11-13T10:10:00Z", by: "gate", subject: "aleph-7", action: "running", on: ["job.2"] }),
    row({ at: "2026-11-13T10:09:00Z", by: "rule", subject: "aleph-7", action: "started", note: "model: haiku", size: "small" }),
    row({ at: "2026-11-13T10:05:00Z", by: "gate", subject: "aleph-7", action: "done", on: ["job.1"], cost: 0.2 }),
    row({ at: "2026-11-13T10:00:00Z", by: "gate", subject: "aleph-7", action: "running", on: ["job.1"] }),
  ];
  const h = view.renderHerald({ ...calm, now: "2026-11-13T11:00:00Z", herald: heraldOf(events, { titles: { "aleph-7": "Fix it" }, runs: { "job.1": "intake", "job.2": "build", "job.3": "review", "job.4": "land" }, attempts }) });
  // One row for the attempt: its four runs are one group.
  expect(h.match(/<details/g)).toHaveLength(1);
  const [head, fold] = h.split('<div class="herald-older">');
  const line = head.slice(head.lastIndexOf('<div class="event-row'));
  expect(line).toContain('<span class="event-line"><span class="badge done">landed</span><a class="idl" href="#/issues/aleph/7">aleph-7</a><span class="event-title" title="Fix it">Fix it</span><span class="event-more">+4</span></span>');
  for (const fact of ["small", "haiku", "$0.50", "0123456"]) { expect(line).not.toContain(fact); expect(fold).toContain(fact); }
});

test("an attempt whose newest event is its routed start, with a size or without, keeps the size, model and cost out of the head and draws the start in its fold", () => {
  const routed = [
    [{ note: "model: haiku", size: "small", cost: 0.5 }, ["small", "haiku", "0.50"], "model: haiku → small · $0.50"],
    [{ note: "model: default" }, ["model: default"], "model: default"],
  ] as const;
  for (const [start, facts, line] of routed) {
    const events = [
      row({ at: "2026-11-15T12:02:00Z", by: "rule", subject: "aleph-72", action: "started", ...start }),
      row({ at: "2026-11-15T12:01:00Z", by: "gate", subject: "aleph-72", action: "done", on: ["job.1"] }),
      row({ at: "2026-11-15T12:00:00Z", by: "gate", subject: "aleph-72", action: "running", on: ["job.1"] }),
    ];
    const h = view.renderHerald({ ...calm, now: "2026-11-15T13:00:00Z", herald: heraldOf(events, { runs: { "job.1": "intake" }, attempts: { "job.1": "job.1" } }) });
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
  const h = view.renderHerald({ ...calm, now: "2026-11-13T13:00:00Z", herald: heraldOf(events, { runs: { "job.1": "intake", "job.9": "intake" }, attempts: { "job.1": "job.1", "job.9": "job.9" } }) });
  expect(h.match(/<details/g)).toHaveLength(2);
  // An event with no job, the filing, goes with the first attempt.
  const [newer, older] = h.split("</details>");
  expect(newer).not.toContain(">filed<");
  expect(older).toContain(">filed<");
});

const hk = (at: string, action: string, on?: string[]) => row({ at, by: "gate", subject: "housekeeper", action, on: on ?? ["job.57"] });
const changed = (at: string, issue: string, why: string) => row({ at, by: "job.57", subject: issue, action: "changed", note: why });
const feed = (events: object[], extra: object = {}) => view.renderHerald({ ...calm, now: "2026-11-15T14:00:00Z", herald: heraldOf(events, extra) });

test("a housekeeper run with 2 changes is one row reading 2 changes, with a line for each in its fold, in the order they ran; an ended run with none has a row", () => {
  const h = feed([
    hk("2026-11-15T13:10:00Z", "done"), changed("2026-11-15T13:06:00Z", "aleph-8", "later"), changed("2026-11-15T13:05:00Z", "aleph-5", "the land did it"), hk("2026-11-15T13:00:00Z", "running"),
    hk("2026-11-15T12:10:00Z", "done", ["job.56"]), hk("2026-11-15T12:00:00Z", "running", ["job.56"]),
  ]);
  expect(h.match(/class="event-row[^"]*" data-by=/g)).toHaveLength(2);
  expect(h).toContain('<span class="badge quiet">ended</span><a class="idl" href="#/jobs/job.56">j56</a>');
  expect(h).toContain('<span class="badge quiet">ended</span><a class="idl" href="#/jobs/job.57">j57</a><span class="event-title" title="2 changes">2 changes</span><span class="event-more">+2</span>');
  const lines = h.split('<div class="herald-older">')[1].split('<div class="event-brief').slice(1);
  expect(lines).toHaveLength(2);
  expect(lines[0]).toContain("aleph-5");
  expect(lines[0]).toContain("the land did it");
  expect(lines[1]).toContain("aleph-8");
  // A run that changed nothing draws no text, even with a reviewed count.
  expect(feed([hk("2026-11-15T12:10:00Z", "done", ["job.56"]), hk("2026-11-15T12:00:00Z", "running", ["job.56"])], { reviewed: { "job.56": 4 } })).toContain('j56</a><span></span>');
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
  expect(h).toContain('<span class="badge run">started</span><a class="idl" href="#/jobs/job.57">j57</a>');
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
    expect(h).toContain('<span class="badge run">started</span><a class="idl" href="#/issues/aleph/2072">a2072</a>');
    expect(h.split('<div class="herald-older">')[1]).toContain('>stalled a2072 · intake</span>');
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

test("a new event for an issue keeps its grouped row's key and id, and each Herald row has its own id", () => {
  const e = (at: string, action: string, job: string) => row({ at, by: "gate", subject: "aleph-9", action, on: [job] });
  const old = [e("2026-11-09T11:00:00Z", "done", "aleph-9#1"), e("2026-11-09T12:00:00Z", "done", "aleph-9#2")], newer = [e("2026-11-09T13:00:00Z", "done", "aleph-9#3"), ...old];
  const draw = (events: any[]) => view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", running: [{ id: "a1#1", name: "a1", started: "2026-11-09T13:30:00Z", item: { title: "Run" } }], herald: heraldOf(events) });
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
