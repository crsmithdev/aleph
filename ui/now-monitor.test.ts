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
  ];
  const h = view.renderPipeline({ window: "week", stages: { rows }, phases: { queue: { count: 4, p90: 79 } } });
  const names = [...h.matchAll(/<span class="pn">([^<]*)</g)].map((m) => m[1]);
  expect(names).toEqual(["Intake", "Queue", "Build", "Review", "Recheck", "Land"]);
  // 2 of 9 build runs failed: 22%, amber; 0 of 3 intake runs: green.
  expect(h).toContain('<div class="pnode warning" title="Build: 9 runs on 5 issues, 2 failed"><span class="ring">1.8</span><span class="pn">Build</span><span class="pt">13m 24s</span><span class="pf">22% failed</span>');
  expect(h).toContain('<div class="pnode fine" title="Intake: 3 runs on 3 issues"><span class="ring">1.0</span>');
  expect(h).toContain('<span class="pn">Queue</span><span class="pt">1m 19s</span>');
  expect(h.match(/class="pnode idle"/g)).toHaveLength(3);
  // "p90" is said once, in the aside, not under each stage.
  expect(h.match(/p90/g)).toHaveLength(1);
  expect(h).not.toContain(">monitor<");
  expect(view.renderPipeline(null)).toContain("Loading the pipeline…");
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
  expect(h).toContain('class="event-body warning"');
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
  expect(h).toMatch(/class="event-row alert live">.*?koans main is red\.<span class="reason">aleph main is red<\/span>/);
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
  expect(row).toContain('<span class="event-say"><a class="idl" href="#/jobs/aleph-5%231">aleph-5#1</a> failed: past its time box</span>');
  expect(row).toContain('<span class="event-title" title="Fix the flaky land test">Fix the flaky land test</span><span class="event-say">');
  expect(row).toContain("</span><span class=\"reason\">timed out</span>");
  expect(row.indexOf("event-title")).toBeLessThan(row.indexOf("event-say"));
  // A row with no title keeps the sentence as its only line.
  const bare = view.eventRow(merged[0], {});
  expect(bare).not.toContain("event-title");
  expect(bare).toContain('<span class="event-say">');
  expect(row).not.toContain("event-tone");
});

test("an event from the stream goes into the Herald at once", () => {
  const s = { ...calm, now: "2026-11-09T12:00:00Z", herald: { history: [], events: [] } };
  view.view.render(s, {}, new URLSearchParams());
  let html = "";
  const herald = { set outerHTML(v: string) { html = v; } };
  view.view.event({ querySelector: (q: string) => (q === "#herald" ? herald : null) }, { at: "2026-11-09T11:59:00Z", by: "gate", subject: "aleph-6", action: "landed", on: ["aleph-6#2"] });
  expect(html).toContain('<span class="event-say"><a class="idl" href="#/jobs/aleph-6%232">aleph-6#2</a> landed</span>');
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
    const titles = [...h.matchAll(/<span class="event-say">([^<]*)</g)].map((m) => m[1]).filter(Boolean);
    // Newest session first; its earlier turn is in the details, after the row of its latest turn.
    expect(titles).toEqual(["Then the footer", "Fix the title", "Other question"]);
    expect(h.match(/<details class="herald-group">/g)).toHaveLength(1);
    expect(h).toMatch(/<details class="herald-group"><summary>[^]*?Then the footer<span class="event-more">\+1<\/span>[^]*?<\/summary>[^]*?Fix the title/);
    expect(h).not.toContain("event-id");
    expect(h).not.toMatch(/>chat</);
    expect(h).not.toContain("chat#");
  } finally { restore(); rmSync(base, { recursive: true, force: true }); }
});

test("the Herald's older rows under an issue show their run's kind after the sentence, none for an event with no run, and the top row keeps the issue's title", () => {
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
    expect(top).not.toContain("event-run");
    const rows = older.split("</details>")[0].split('<div class="event-row').slice(1);
    expect(rows).toHaveLength(3);
    // Newest first: the build run, the intake run, then the "picked up" event, which has no run.
    expect(rows[0]).toMatch(/<\/a> done <span class="event-run" title="build">build<\/span><\/span>/);
    expect(rows[1]).toMatch(/<\/a> done <span class="event-run" title="intake">intake<\/span><\/span>/);
    expect(rows[2]).not.toContain("event-run");
    expect(rows.join("")).not.toContain("event-title");
  } finally { restore(); rmSync(base, { recursive: true, force: true }); }
});
