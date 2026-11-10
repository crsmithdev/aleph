import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { withFactory } from "./test-now.ts";

const calm = { ...withFactory({}), asks: [], stuck: [] };
const P = (day: number | null, trailing: number | null) => ({ day, trailing });
const monitor = {
  day: "2026-10-20",
  findings: ["Build runs <b>rose</b> to 38% from 20%, **no usable result** is 3.", "Plans rose."],
  stages: [{ stage: "build", costPerItem: P(1.5, 2), runsPerItem: P(2, 1.4), unusable: P(0.25, null) }],
  holds: [{ kind: "stops", goals: P(2, 1.5), hours: P(5, 2) }],
};
const render = (m: any) => view.view.render({ ...calm, factory: { ...calm.factory, monitor: m } });

test("the Pipeline card shows the 8 stages of the window in order with runs per issue and p90, and no other role", () => {
  const rows = [
    { stage: "monitor", runs: 1, items: 1, unusable: 0, p90: 10 },
    { stage: "build", runs: 9, items: 5, unusable: 2, p90: 804 },
    { stage: "intake", runs: 3, items: 3, unusable: 0, p90: null },
  ];
  const h = view.renderPipeline({ window: "week", stages: { rows } });
  const names = [...h.matchAll(/<span class="pn">([^<]*)</g)].map((m) => m[1]);
  expect(names).toEqual(["intake", "triage", "plan", "spec-check", "build", "review", "recheck", "land"]);
  expect(h).toContain('<span class="pv">1.8<span class="pu"> / issue</span></span><span class="pt">13m 24s</span>');
  expect(h).toContain('<span class="pv">1.0<span class="pu"> / issue</span></span><span class="pt">–</span>');
  expect(h).toContain('title="Build: 9 runs on 5 issues, 2 failed"');
  expect(h.match(/class="pnode idle"/g)).toHaveLength(6);
  expect(h).not.toContain(">monitor<");
  expect(view.renderPipeline(null)).toContain("Loading the pipeline…");
});

test("the Monitor panel shows the findings with numbers and **text** in bold, other HTML escaped, and no table", () => {
  const html = view.renderMonitor({ factory: { monitor } });
  expect(html).toContain('<h2 id="h-monitor">Monitor</h2><span class="aside"><span class="asof">2026-10-20</span></span>');
  expect(html).not.toContain("Monitor,");
  expect(html).toContain("<li>Build runs &lt;b&gt;rose&lt;/b&gt; to <b>38%</b> from <b>20%</b>, <b>no usable result</b> is <b>3</b>.</li>");
  expect(html).toContain("<li>Plans rose.</li>");
  expect(html).not.toContain("<summary>Table</summary>");
  expect(html).not.toContain("monitor-table");
});

test("a report with no reading says why; one with no findings says nothing looks off; no report shows no panel", () => {
  expect(view.renderMonitor({ factory: { monitor: { ...monitor, findings: [], error: "the monitor reader timed out" } } })).toMatch(/<div class="error" role="alert"><p>No reading: the monitor reader timed out<\/p>/);
  expect(view.renderMonitor({ factory: { monitor: { ...monitor, findings: [] } } })).toContain('<div class="empty"><p>Nothing looks off.</p>');
  expect(view.renderMonitor({ factory: { monitor: null } })).toBe("");
  expect(render(null)).not.toContain('id="monitor"');
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
  expect(row).toContain('<span class="event-tone warning">failed</span>');
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
