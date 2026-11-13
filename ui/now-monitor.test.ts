import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { withFactory } from "./test-now.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heraldChats, heraldRuns } from "./state.ts";
import { withEnv } from "./test-server.ts";
import { allRuns } from "../jobs/lib/records/ledger.ts";
import { putRun } from "../jobs/lib/records/record.ts";

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
  expect(names).toEqual(["Intake", "Queue", "Build", "Review", "Recheck", "Land"]);
  // 2 of 9 build runs failed: 22%, amber; 0 of 3 intake runs: green.
  expect(h).toContain('<div class="pnode warning"><a class="pgo" href="#/factory/jobs?stage=implement&amp;role=worker" title="Build: 9 runs on 5 issues, 2 failed"><span class="ring">1.8</span><span class="pn">Build</span><span class="pt">13m 24s</span></a><a class="pf" href="#/factory/jobs?stage=implement&amp;role=worker&amp;unusable=1">22% failed</a>');
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
  expect(h).toContain('class="event-row');
  const red = view.renderHerald({ ...calm, asks: [ask], factory: { ...calm.factory, health: [{ text: "health: aleph main is red", kind: "alert", key: "red-main" }] } });
  expect(red).toContain('<span class="badge stuck">Not OK</span>');
});

test("the Herald lists each running job as a compact row between the alerts and the feed, and no section with none", () => {
  const ask = { id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "Please review" };
  const running = [{ id: "aleph-7#1", name: "intake-aleph-7", tier: "haiku", model: "deepseek-v4.1-flash", started: "2026-11-09T11:00:00Z", item: { title: "Fix the thing" } }];
  const h = view.renderHerald({ ...calm, asks: [ask], running, runningIssues: [{ id: "aleph-9", stage: "intake", title: "Sort it", at: "2026-11-09T11:30:00Z" }] });
  expect(h.match(/class="run-now"/g)).toHaveLength(2);
  expect(h).toContain('data-job="aleph-7#1"');
  // The row names the job and its tier; the model is in the label's title.
  expect(h).toMatch(/<a class="idl" href="#\/jobs\/aleph-7%231">aleph-7#1<\/a><span class="run-label" title="deepseek-v4.1-flash">worker · low<\/span>/);
  expect(h).not.toContain("intake-aleph-7");
  expect(h).toContain('data-job="aleph-9"');
  expect(h).toContain("Fix the thing");
  expect(h.indexOf('id="awaiting"')).toBeLessThan(h.indexOf('class="herald-running"'));
  expect(h.indexOf('class="herald-running"')).toBeLessThan(h.indexOf('class="herald-feed"'));
  expect(view.renderHerald({ ...calm, running: [], runningIssues: [] })).not.toContain("herald-running");
});

test("the Herald panel shows an OK badge with no alerts and no alert row", () => {
  const h = view.renderHerald(calm);
  expect(h).not.toContain("No active alerts");
  expect(h).not.toContain("herald-sticky");
  expect(h).toContain('<span class="badge done">OK</span>');
  expect(h).toContain('Everything is fine');
});

test("the Herald panel shows weekly usage and warning tone in event history when weekly usage is high", () => {
  const h = view.renderHerald({ ...calm, usage: { now: { seven_day: 93 } } });
  expect(h).toContain("weekly usage is at 93%");
  expect(h).not.toContain(">Warn<");
  expect(h).toContain('class="event-row warning"');
  expect(h).toContain('<span class="event-body"><span class="event-say">');
});

test("an error is not pinned: the newest event is marked live and carries the error lines its text lacks, and no row repeats its label or a health prefix", () => {
  const herald = { history: [{ at: "2026-11-01T00:00:00Z", tone: "alert", label: "Alert", text: "Alert: Health: aleph main is red", reason: "health: aleph main is red" }] };
  const h = view.renderHerald({ ...calm, herald, factory: { ...calm.factory, health: [{ text: "health: aleph main is red", kind: "alert", key: "red-main" }, { text: "health: koans main is red", kind: "warn" }] } });
  expect(h).not.toContain("ask-head");
  expect(h).not.toContain("No active alerts");
  expect(h).toContain('<span class="badge stuck">Not OK</span>');
  expect(h).toMatch(/class="event-row alert live"/);
  expect(h).not.toContain("Alert: Health:");
  // The status sentence sums up aleph's red main, so the live event lists that line; it already says koans's.
  expect(h).toMatch(/class="event-row alert live">.*?koans main is red\.<\/span><span class="reason" title="aleph main is red">aleph main is red<\/span>/);
  expect(h).not.toContain('<span class="reason">koans main is red</span>');
});

test("a server history entry for the attention status gives one event row; a different status gives two", () => {
  const ask = { id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "Please review" };
  const base = { ...calm, asks: [ask], stuck: [], running: [], runningIssues: [], done: [], queued: [] };
  const now = "2026-10-27T12:00:00Z", at = "2026-10-27T11:58:00Z";
  const same = view.renderHerald({ ...base, now, herald: { history: [{ at, tone: "ask", label: "Ask", text: "Your attention is needed." }] } });
  expect(same.match(/class="event-row/g)?.length).toBe(1);
  const other = view.renderHerald({ ...base, now, herald: { history: [{ at, tone: "alert", label: "Alert", text: "Alert: Health: aleph main is red" }] } });
  expect(other.match(/class="event-row/g)?.length).toBe(2);
});

test("the Herald merges the state's events and the streamed ones, each once, newest first, with the status rows", () => {
  const ev = (at: string, action: string, o: object = {}) => ({ at, by: "gate", subject: "aleph-5", action, on: ["aleph-5#1"], ...o });
  const s = { ...calm, now: "2026-11-09T12:00:00Z", herald: { history: [{ at: "2026-11-09T11:00:00Z", tone: "fine", label: "Fine", text: "Everything is fine" }], events: [ev("2026-11-09T11:30:00Z", "running")] } };
  const merged = view.heraldEvents(s, [ev("2026-11-09T11:30:00Z", "running"), ev("2026-11-09T11:45:00Z", "failed", { sub: "timeout", note: "timed out" })]);
  expect(merged.map((e: any) => e.action)).toEqual(["failed", "running"]);
  const h = view.renderHerald(s);
  const order = [...h.matchAll(/class="event-row (\w+)/g)].map((m) => m[1]);
  // The fixture's status now (12:00) is newest, then the event at 11:30, then the status at 11:00.
  expect(order).toEqual(["alert", "run", "fine"]);
  const row = view.eventRow(merged[0], { "aleph-5": "Fix the flaky land test" });
  // Two columns: the time, then the title, the sentence with its job linked, and the note.
  expect(row).toContain('<div class="event-row stuck" data-by="gate"><span class="event-time">');
  expect(row).toContain('<span class="event-say"><span class="badge stuck">failed</span> <a class="idl" href="#/jobs/aleph-5%231">aleph-5#1</a> · past its time box</span>');
  expect(row).toContain('<span class="event-title" title="Fix the flaky land test">Fix the flaky land test</span><span class="event-say">');
  expect(row).toContain("</span><span class=\"reason\" title=\"timed out\">timed out</span>");
  expect(row.indexOf("event-title")).toBeLessThan(row.indexOf("event-say"));
  // A row with no title keeps the sentence as its only line.
  const bare = view.eventRow(merged[0], {});
  expect(bare).not.toContain("event-title");
  expect(bare).toContain('<span class="event-say">');
  expect(row).not.toContain("event-tone");
});

// The stream path keeps its events in now.js for the page's life: each such test takes a copy of the module of its own.
let copies = 0;
const fresh = () => import(`./views/now.js?copy=${++copies}`);

test("an event from the stream goes into the Herald at once", async () => {
  const view = await fresh();
  const s = { ...calm, now: "2026-11-09T12:00:00Z", herald: { history: [], events: [] } };
  view.view.render(s, {}, new URLSearchParams());
  let html = "";
  const herald = { querySelectorAll: () => [], set outerHTML(v: string) { html = v; } };
  view.view.event({ querySelector: (q: string) => (q === "#herald" ? herald : null) }, { at: "2026-11-09T11:59:00Z", by: "gate", subject: "aleph-6", action: "landed", on: ["aleph-6#2"] });
  expect(html).toContain('<span class="event-say"><span class="badge done">landed</span> <a class="idl" href="#/jobs/aleph-6%232">aleph-6#2</a></span>');
});

test("a Herald group keeps its open or closed state when a newer event arrives and the rows move, through the stream path", async () => {
  const view = await fresh();
  const ev = (at: string, subject: string, n: number) => ({ at, by: "gate", subject, action: "done", on: [`${subject}#${n}`] });
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

test("the Herald shows one row per chat session titled by its latest message's first line, the earlier turns behind an expand control, and no kind or name tag", () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-herald-chat-")), restore = withEnv({ ALEPH_JOBS_DIR: base });
  try {
    // Three chat runs, each with a multi-line message; the first and the third are turns of one session.
    const said = ["  Fix the title \nwith more", "Other question\nhere", "\tThen the footer  \nand the rest"], sessions = ["s1", "s2", "s1"];
    said.forEach((text, i) => {
      const id = `20261109-10000${i}-chat-${i + 1}`;
      mkdirSync(join(base, id));
      putRun(id, { kind: "chat", job: id, name: "chat", condition: "done", started: "2026-11-09T10:00:00Z", n: i + 1, session: sessions[i] } as any);
      writeFileSync(join(base, id, "command.txt"), `chat: ${text}\n`);
    });
    const events = [1, 2, 3].map((n) => ({ at: `2026-11-09T1${n}:00:00Z`, by: "gate", subject: "chat", action: "done", on: [`chat#${n}`] }));
    const s = { ...calm, now: "2026-11-09T14:00:00Z", herald: { history: [], events, chats: heraldChats(events, allRuns()) } };
    const h = view.renderHerald(s);
    const titles = [...h.matchAll(/<span class="(?:event-say|brief-text)"(?: title="[^"]*")?>([^<]*)</g)].map((m) => m[1]).filter((x) => x && !x.startsWith("Alert:"));
    // Newest session first; its earlier turn is in the details, after the row of its latest turn.
    expect(titles).toEqual(["Then the footer", "Fix the title", "Other question"]);
    expect(h.match(/<details data-key="[^"]*" class="herald-group" data-fold="chat:s1">/g)).toHaveLength(1);
    expect(h).toMatch(/<details data-key="[^"]*" class="herald-group" data-fold="chat:s1"><summary>[^]*?Then the footer<span class="event-more">\+1<\/span>[^]*?<\/summary>[^]*?Fix the title/);
    expect(h).not.toContain("event-id");
    expect(h).not.toMatch(/>chat</);
    expect(h).not.toContain("chat#");
  } finally { restore(); rmSync(base, { recursive: true, force: true }); }
});

test("the Herald's older rows under an issue are labelled by their run's role with a mark, by the chip for an event with no run, and the top row keeps the issue's title", () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-herald-runs-")), restore = withEnv({ ALEPH_JOBS_DIR: base });
  try {
    const kinds = ["intake", "build"];
    kinds.forEach((kind, i) => {
      const id = `20261109-10000${i}-aleph-9-${i + 1}`;
      mkdirSync(join(base, id));
      putRun(id, { kind, job: id, name: "aleph-9", on: "aleph-9", condition: "done", started: "2026-11-09T10:00:00Z", n: i + 1 } as any);
    });
    const events = [
      { at: "2026-11-09T10:30:00Z", by: "gate", subject: "aleph-9", action: "started" },
      { at: "2026-11-09T11:00:00Z", by: "gate", subject: "aleph-9", action: "done", on: ["aleph-9#1"] },
      { at: "2026-11-09T12:00:00Z", by: "gate", subject: "aleph-9", action: "done", on: ["aleph-9#2"] },
      { at: "2026-11-09T13:00:00Z", by: "gate", subject: "aleph-9", action: "done", on: ["aleph-9#3"] },
    ];
    const runs = heraldRuns(events, allRuns());
    expect(runs).toEqual({ "aleph-9#1": "intake", "aleph-9#2": "build" });
    const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: { history: [], events, titles: { "aleph-9": "Fix the footer" }, chats: {}, runs } });
    const [top, older] = h.split('<div class="herald-older">');
    expect(top).toContain('<span class="event-title" title="Fix the footer">Fix the footer</span>');
    expect(top).toContain('<span class="badge done">closed</span>');
    const rows = older.split("</details>")[0].split('<div class="event-brief').slice(1);
    expect(rows).toHaveLength(3);
    // Newest first: the build run, the intake run, then the start, which has no run.
    expect(rows[0]).toContain('<span class="brief-label" title="worker">worker</span><span class="brief-text" title="#2 ✓">#2 <span class="brief-mark">✓</span></span>');
    expect(rows[1]).toContain('<span class="brief-label" title="intake">intake</span><span class="brief-text" title="#1 ✓">#1 <span class="brief-mark">✓</span></span>');
    expect(rows[2]).toContain('<span class="brief-label" title="started">started</span>');
    expect(rows.join("")).not.toContain("event-title");
  } finally { restore(); rmSync(base, { recursive: true, force: true }); }
});

test("the Herald draws a routing event with fields as the issue's row: its title, the tier, the worker model, p and the cost", () => {
  const events = [{ at: "2026-11-09T10:00:00Z", by: "rule", subject: "aleph-9", action: "routed", tier: "worker-medium", model: "sonnet", p: 0.99, cost: 0.00003, note: "classifier jev-1.13" }];
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: { history: [], events, titles: { "aleph-9": "Fix the thing" }, chats: {}, runs: {} } });
  expect(h).toContain("Fix the thing");
  expect(h).toContain("→ worker-medium · sonnet · p 0.99 · $0.00003");
  expect(h).toMatch(/badge[^>]*>routed</);
});

test("the Herald folds a job subject per run and an issue across its runs", () => {
  const e = (at: string, subject: string, action: string, job: string) => ({ at, by: "gate", subject, action, on: [job] });
  const events = [
    e("2026-11-09T09:00:00Z", "housekeeper", "running", "housekeeper#1"), e("2026-11-09T09:10:00Z", "housekeeper", "done", "housekeeper#1"),
    e("2026-11-09T10:00:00Z", "housekeeper", "running", "housekeeper#2"), e("2026-11-09T10:10:00Z", "housekeeper", "done", "housekeeper#2"),
    e("2026-11-09T11:00:00Z", "aleph-9", "done", "aleph-9#1"), e("2026-11-09T12:00:00Z", "aleph-9", "done", "aleph-9#2"),
  ];
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: { history: [], events, titles: {}, chats: {}, runs: {} } });
  expect(h).toContain('data-fold="issue:aleph-9"');
  expect(h).not.toContain('data-fold="issue:housekeeper"');
  // Each run is its own row: the two finished runs stay apart, and neither hides the other's events. A routine's run ends, quiet.
  expect(h.match(/<span class="badge quiet">ended<\/span>/g)).toHaveLength(2);
  expect(h.match(/<div [^>]*class="event-row quiet"[^>]*>(?:(?!<\/div>).)*idp">housekeeper/g)).toHaveLength(2);
});

test("the Herald hides an older start of a run with a newer event, leaves out the holds, and draws a routing event as tier, model and p", () => {
  const events = [
    { at: "2026-11-09T13:00:00Z", by: "gate", subject: "aleph-9", action: "passed", on: ["aleph-9#2"] },
    { at: "2026-11-09T12:00:00Z", by: "gate", subject: "aleph-9", action: "running", on: ["aleph-9#2"] },
    { at: "2026-11-09T11:30:00Z", by: "gate", subject: "aleph-9", action: "busy", on: ["aleph-8"], file: "ui/views/now.js" },
    { at: "2026-11-09T11:00:00Z", by: "gate", subject: "aleph-9", action: "after", on: ["aleph-7"] },
    { at: "2026-11-09T10:00:00Z", by: "rule", subject: "route", action: "routed", note: "cost 0.00004 model typesafe/jev-1.13-20260917 tier worker-medium p 0.83" },
  ];
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: { history: [], events, titles: {}, chats: {}, runs: { "aleph-9#2": "build" } } });
  expect(h).toMatch(/<span class="badge done">passed<\/span> worker <a[^>]*>aleph-9#2<\/a>/);
  expect(h).not.toContain("herald-older");
  expect(h).not.toContain("aleph-8");
  expect(h).toMatch(/<div data-key="[^"]*" class="event-row quiet sys" data-by="rule">/);
  expect(h).toContain("worker-medium · jev-1.13 · p 0.83");
});

test("the Herald draws a housekeeper's done event with its tally and the issues it changed linked", () => {
  const events = [{ at: "2026-11-09T10:00:00Z", by: "gate", subject: "housekeeper", action: "done", on: ["housekeeper#24", "aleph-7", "aleph-9"], cost: 0.33, tally: { reviewed: 6, unparked: 1, dropped: 2 } }];
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: { history: [], events, titles: {}, chats: {}, runs: {} } });
  expect(h).toContain("reviewed 6 · unparked 1 · dropped 2");
  expect(h).toMatch(/dropped 2 <a[^>]*>aleph-7<\/a> <a[^>]*>aleph-9<\/a>/);
});

test("the Herald folds a housekeeper's changes under its row, one sub-item per issue with its actions in order", () => {
  const events = [{ at: "2026-11-09T10:00:00Z", by: "gate", subject: "housekeeper", action: "done", on: ["housekeeper#24", "aleph-1978", "aleph-2125"], cost: 0.33, tally: { reviewed: 2, noted: 1, reprioritized: 1, closed: 1 },
    changes: [{ id: "aleph-1978", do: "note" }, { id: "aleph-2125", do: "close" }, { id: "aleph-1978", do: "reprioritize" }] }];
  const h = view.renderHerald({ ...calm, now: "2026-11-09T14:00:00Z", herald: { history: [], events, titles: {}, chats: {}, runs: {} } });
  expect(h).toContain("reviewed 2 · commented 1 · reprioritized 1 · closed 1");
  expect(h).toContain('event-more">+2<');
  const older = h.slice(h.indexOf('class="herald-older"'));
  expect(h.indexOf('class="herald-older"')).toBeGreaterThan(h.indexOf("</summary>"));
  expect(older.match(/event-change/g)).toHaveLength(2);
  expect(older).toMatch(/<a[^>]*href="[^"]*1978"[^>]*>aleph-1978<\/a><\/span><span class="brief-text">commented · reprioritized<\/span>/);
  expect(older).toMatch(/<a[^>]*href="[^"]*2125"[^>]*>aleph-2125<\/a><\/span><span class="brief-text">closed<\/span>/);
});
