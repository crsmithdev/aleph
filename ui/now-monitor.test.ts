import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { withFactory } from "./test-now.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { heraldChats } from "./state.ts";
import { withEnv } from "./test-server.ts";
import { allRuns } from "../jobs/lib/records/ledger.ts";
import { putRun } from "../jobs/lib/records/record.ts";

const calm = { ...withFactory({}), asks: [], stuck: [] };
test("the Pipeline card shows the 6 stages of the window in order with runs per issue and p90, and no other role", () => {
  const rows = [
    { stage: "monitor", runs: 1, items: 1, unusable: 0, p90: 10 },
    { stage: "build", runs: 9, items: 5, unusable: 2, p90: 804 },
    { stage: "intake", runs: 3, items: 3, unusable: 0, p90: null },
  ];
  const h = view.renderPipeline({ window: "week", stages: { rows } });
  const names = [...h.matchAll(/<span class="pn">([^<]*)</g)].map((m) => m[1]);
  expect(names).toEqual(["intake", "spec-check", "build", "review", "recheck", "land"]);
  expect(h).toContain('<span class="pv">1.8<span class="pu"> / issue</span></span><span class="pt">13m 24s</span>');
  expect(h).toContain('<span class="pv">1.0<span class="pu"> / issue</span></span><span class="pt">–</span>');
  expect(h).toContain('title="Build: 9 runs on 5 issues, 2 failed"');
  expect(h.match(/class="pnode idle"/g)).toHaveLength(4);
  expect(h).not.toContain(">monitor<");
  expect(view.renderPipeline(null)).toContain("Loading the pipeline…");
});

test("the Herald shows its alerts under an N active badge in the worst alert's tone, then the events", () => {
  const ask = { id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "Please review" };
  const h = view.renderHerald({ ...calm, asks: [ask], stuck: [], running: [], runningIssues: [], done: [], queued: [] });
  expect(h).toContain('<h2 id="h-herald">Herald</h2>');
  expect(h).toContain('<span class="badge need">1 active</span>');
  expect(h).toContain('id="awaiting"');
  expect(h).not.toContain("Sticky Alerts");
  expect(h).not.toContain("data-herald-tab");
  expect(h).toContain('class="event-row');
  const red = view.renderHerald({ ...calm, asks: [ask], factory: { ...calm.factory, health: [{ text: "health: aleph main is red", kind: "alert", key: "red-main" }] } });
  expect(red).toContain('<span class="badge stuck">2 active</span>');
});

test("the Herald panel shows calm state with no alerts and no alert row", () => {
  const h = view.renderHerald(calm);
  expect(h).not.toContain("No active alerts");
  expect(h).not.toContain("herald-sticky");
  expect(h).toContain('Calm');
  expect(h).toContain('Everything is fine');
});

test("the Herald panel shows weekly usage and warning tone in event history when weekly usage is high", () => {
  const h = view.renderHerald({ ...calm, usage: { now: { seven_day: 93 } } });
  expect(h).toContain("weekly usage is at 93%");
  expect(h).toContain("Warn");
  expect(h).toContain('class="event-row warning"');
  expect(h).toContain('class="event-body warning"');
});

test("an error is not pinned: the newest event is marked live and carries the error lines its text lacks, and no row repeats its label or a health prefix", () => {
  const herald = { history: [{ at: "2026-11-01T00:00:00Z", tone: "alert", label: "Alert", text: "Alert: health: aleph main is red", reason: "health: aleph main is red" }] };
  const h = view.renderHerald({ ...calm, herald, factory: { ...calm.factory, health: [{ text: "health: aleph main is red", kind: "alert", key: "red-main" }, { text: "health: koans main is red", kind: "warn" }] } });
  expect(h).not.toContain("ask-head");
  expect(h).not.toContain("No active alerts");
  expect(h).toMatch(/<span class="badge stuck">\d+ active<\/span>/);
  expect(h).toMatch(/class="event-row alert live"/);
  expect(h).not.toContain("Alert: health:");
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
  const other = view.renderHerald({ ...base, now, herald: { history: [{ at, tone: "alert", label: "Alert", text: "Alert: health: aleph main is red" }] } });
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
  expect(row).toContain('<span class="event-tone stuck">failed</span>');
  expect(row).not.toContain("event-dot");
  expect(row).toContain('<span class="event-id"><a class="idl" title="Fix the flaky land test" href="#/issues/aleph/5">');
  expect(row).toContain('<span class="event-title" title="Fix the flaky land test">Fix the flaky land test</span>');
  expect(view.eventRow(merged[0])).toContain('<span class="event-what">timeout aleph-5#1</span><span class="reason">timed out</span>');
});

test("an event from the stream goes into the Herald at once", () => {
  const s = { ...calm, now: "2026-11-09T12:00:00Z", herald: { history: [], events: [] } };
  view.view.render(s, {}, new URLSearchParams());
  let html = "";
  const herald = { set outerHTML(v: string) { html = v; } };
  view.view.event({ querySelector: (q: string) => (q === "#herald" ? herald : null) }, { at: "2026-11-09T11:59:00Z", by: "gate", subject: "aleph-6", action: "landed", on: ["aleph-6#2"] });
  expect(html).toContain(">landed</span>");
  expect(html).toContain('href="#/issues/aleph/6">aleph-6</a></span>');
  expect(html).toContain('<span class="event-what">aleph-6#2</span>');
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
    const titles = [...h.matchAll(/<span class="event-title"[^>]*>([^<]*)</g)].map((m) => m[1]);
    // Newest session first; its earlier turn is in the details, after the row of its latest turn.
    expect(titles).toEqual(["Then the footer", "Fix the title", "Other question"]);
    expect(h.match(/<details class="herald-chat">/g)).toHaveLength(1);
    expect(h).toMatch(/<details class="herald-chat"><summary>[^]*?Then the footer[^]*?<\/summary>[^]*?Fix the title/);
    expect(h.match(/<span class="event-id"><\/span><span class="event-body"><span class="event-title"/g)).toHaveLength(3);
    expect(h).not.toMatch(/>chat</);
    expect(h).not.toContain("chat#");
  } finally { restore(); rmSync(base, { recursive: true, force: true }); }
});
