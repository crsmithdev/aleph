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

test("the Pipeline card shows the 8 stages in order with jobs per issue and p90, and no other monitor role", () => {
  const stages = [
    { stage: "monitor", costPerItem: P(1, 1), runsPerItem: P(1, 1), unusable: P(0, 0) },
    { stage: "build", costPerItem: P(1.5, 2), runsPerItem: P(1.8, 1.4), unusable: P(0.25, null), p90: P(804, 700) },
    { stage: "intake", costPerItem: P(1, 1), runsPerItem: P(1, 1), unusable: P(0, 0) },
  ];
  const h = view.renderPipeline({ ...calm, factory: { monitor: { ...monitor, stages } } });
  const names = [...h.matchAll(/<span class="pn">([^<]*)</g)].map((m) => m[1]);
  expect(names).toEqual(["intake", "triage", "plan", "spec-check", "build", "review", "recheck", "land"]);
  expect(h).toContain('<span class="pv">1.8<span class="pu"> / issue</span></span><span class="pt">13m 24s</span>');
  expect(h).toContain('<span class="pv">1.0<span class="pu"> / issue</span></span><span class="pt">–</span>');
  expect(h).toContain('title="build: trailing 7 days 1.4"');
  expect(h.match(/class="pnode idle"/g)).toHaveLength(6);
  expect(h).not.toContain(">monitor<");
});

test("Slowest work lists the work in flight, longest since first pickup first, at most 5", () => {
  const now = "2026-11-07T12:00:00Z";
  const q = (id: number, since: string) => ({ repo: "aleph", id, title: `q${id}`, stage: "queued", at: since, since });
  const queued = [q(1, "2026-11-07T11:00:00Z"), q(2, "2026-11-07T06:00:00Z"), q(3, "2026-11-07T10:00:00Z"), q(4, "2026-11-07T09:00:00Z"), q(5, "2026-11-07T08:00:00Z"), q(6, "2026-11-07T07:00:00Z")];
  const h = view.renderPipeline({ ...calm, now, queued, running: [], runningIssues: [], factory: { monitor } });
  expect([...h.matchAll(/class="t" title="([^"]*)"/g)].map((m) => m[1])).toEqual(["q2", "q6", "q5", "q4", "q3"]);
  expect(h).toContain('<span class="num">6h 00m</span>');
  expect(view.renderPipeline({ ...calm, running: [], runningIssues: [], factory: { monitor } })).toContain("Nothing is in flight.");
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

test("the Herald shows its alerts under an N active badge in the worst alert's tone, then the Events and Issues tabs", () => {
  const ask = { id: "a1", kind: "input", at: "2026-11-01T00:00:00Z", text: "Please review" };
  const h = view.renderHerald({ ...calm, asks: [ask], stuck: [], running: [], runningIssues: [], done: [], queued: [] });
  expect(h).toContain('<h2 id="h-herald">Herald</h2>');
  expect(h).toContain('<span class="badge need">1 active</span>');
  expect(h).toContain('id="awaiting"');
  expect(h).not.toContain("Sticky Alerts");
  expect(h).toMatch(/data-herald-tab="events" aria-selected="true">Events <span class="count">\d+<\/span>/);
  expect(h).toContain('data-herald-tab="issues" aria-selected="false">Issues <span class="count">0</span>');
  expect(h).toContain('class="event-row');
  const red = view.renderHerald({ ...calm, asks: [ask], factory: { ...calm.factory, health: ["health: aleph main is red"] } });
  expect(red).toContain('<span class="badge stuck">2 active</span>');
});

test("the Herald panel shows calm state with no alerts", () => {
  const h = view.renderHerald(calm);
  expect(h).toContain('No active alerts');
  expect(h).toContain('Calm');
  expect(h).toContain('Everything is running smoothly');
});

test("the Herald panel shows weekly usage and warning tone in event history when weekly usage is high", () => {
  const h = view.renderHerald({ ...calm, usage: { now: { seven_day: 93 } } });
  expect(h).toContain("weekly usage is at 93%");
  expect(h).toContain("Warn");
  expect(h).toContain('class="event-row warning"');
  expect(h).toContain('class="event-body warning"');
});
