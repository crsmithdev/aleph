// Archived goal tests from ui/now-page.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "../../ui/views/now.js";
import { job, state } from "../../ui/fixtures/status-state.ts";

test("an empty lane shows one quiet line; the Needs-you section is absent when nothing is wrong", () => {
  const calm = { ...state, asks: [], stuck: [], running: [], queued: [], issues: [], done: [], factory: { ...state.factory, health: [] } };
  const lanes = view.renderLanes(calm);
  for (const t of ["Nothing is queued.", "Nothing is done yet.", "Nothing is running."]) expect(lanes).toContain(t);
  expect(lanes.match(/<p/g)?.length).toBe(3);
  expect(view.renderNeeds(calm)).toBe("");
  expect(view.view.render(calm)).not.toContain('id="needs"');
});

const done = (n: number) => ({ id: `aleph-${n}`, title: `Done ${n}`, href: `#/issues/aleph/${n}`, finished: "2026-10-27T16:30:00Z",
  jobs: [job({ name: `triage-aleph-${n}`, condition: "done", outcome: "goal", run: { kind: "triage", started: "2026-10-27T10:00:00Z" } }),
    job({ name: `aleph-${n}`, condition: "landed", commit: "50f301fabc", commitUrl: "https://github.com/o/r/commit/50f301fabc", run: { kind: "land", started: "2026-10-27T15:00:00Z" } })] });

const WEEK = {
  window: "week", done: 7, flaky: 2, kinds: { land: { count: 9 } },
  phases: { lead: { count: 7, p50: 1570, p90: 16560, hist: [], worst: 20000 } },
  buckets: [{ at: "2026-10-27T00:00:00", lead: 1000 }, { at: "2026-10-28T00:00:00", lead: null }],
  issues: { landed: 7, firstPass: 0.91, fixRounds: 0, week: 0.02 }, lost: { hours: 6, share: 0.38 },
  classes: [
    { key: "landed", name: "Landed", hours: 8, causes: [{ name: "First run", hours: 8, runs: 8 }] }, { key: "fixed", name: "Fixed", hours: 2, causes: [{ name: "Checks failed", hours: 2, runs: 2 }] },
    { key: "nothing", name: "Late", hours: 2, causes: [{ name: "Issue had landed", hours: 2, runs: 3 }] },
    { key: "restarted", name: "Restarted", hours: 4, causes: [{ name: "Issue had landed", hours: 1, runs: 1 }, { name: "No commit", hours: 3, runs: 2 }] },
    { key: "dropped", name: "Dropped", hours: 0, causes: [] },
  ],
};

const BASE = { prev: { lost: 0.3, hours: 5, leadP50: 1200, leadP90: 9000, queueP50: 60, queueP90: 300, landed: 5, firstPass: 0.8 }, base: { lost: 0.25, hours: 4, leadP50: 1200, leadP90: 9000, queueP50: 60, queueP90: 300, landed: 5, firstPass: 0.8 }, basis: "the previous 7 days" };
const withBase = (d: any, queue = { count: 4, p50: 90, p90: 400 }) => ({ ...d, phases: { ...d.phases, queue }, baseline: BASE });

const USAGE = { now: { seven_day: 7, five_hour: 2, seven_day_resets_at: "2026-11-07T08:00:00Z" }, series: [] };

test("the scorecard has five cards: Lost time, Completion, Landed, Queue wait, Usage", () => {
  const h = view.renderTiles({ ...state, now: "2026-11-01T08:00:00Z", usage: USAGE }, withBase(WEEK), "week");
  expect([...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1])).toEqual(["Lost time", "Completion", "Landed", "Queue wait", "Usage"]);
  expect([...h.matchAll(/<b>(.*?)<\/b>/g)].map((m) => m[1])).toEqual(["38%<em> / 6.0h</em>", "26m<em> / 4h 36m</em>", "7<em> / 91%</em>", "1m<em> / 6m</em>", "7%"]);
  expect([...h.matchAll(/<span class="q"><span>([^<]*)<\/span><span class="m"> \/ ([^<]*)</g)].map((m) => `${m[1]} / ${m[2]}`)).toEqual(["p50 / p90", "issues / clean", "p50 / p90"]);
  // Lost time: percentage points (38 - 25 = 13), bad when up; Completion: relative (1570 vs 1200 = +31%), bad when up; Landed: relative (7 vs 5 = +40%), good when up.
  expect(h).toContain('class="tr warn" title="Previous 30%; baseline 25%, the previous 7 days (change in percentage points)">▲ 13%');
  expect(h).toContain('class="tr warn" title="Previous 20m; baseline 20m, the previous 7 days">▲ 31%');
  expect(h).toContain('class="tr good" title="Previous 5; baseline 5, the previous 7 days">▲ 40%');
  expect(h).toContain('class="tr warn" title="Previous 1m; baseline 1m, the previous 7 days">▲ 50%');
  for (const t of ["#/factory/efficiency", "#/factory/jobs", "#/factory/agents"]) expect(h).toContain(`href="${t}"`);
  expect(h).not.toContain("pace");
  expect(h).not.toContain("resets");
  expect(h).toContain('title="14% of the week gone"');
});

test("the cards follow the window: links keep it, and a trend reads the window's baseline", () => {
  const h = view.renderTiles({ ...state, usage: USAGE }, withBase({ ...WEEK, window: "hour" }), "hour");
  expect(h).toContain('href="#/factory/efficiency?window=hour"');
  expect(h).toContain('href="#/factory/jobs?window=hour"');
  expect(h).toContain('href="#/factory/agents"');
});

test("a critical item shows the priority badge in Queued, Running and Latest done", () => {
  const badge = '<span class="badge stuck">critical</span>';
  const lanes = view.renderLanes({ ...state,
    queued: [{ repo: "aleph", id: 9, title: "q", why: "", kind: "ready", priority: "critical" }],
    runningIssues: [{ id: "aleph-8", title: "r", href: "#/issues/aleph/8", stage: "working", priority: "critical", of: { n: 1, m: 1 }, since: "", at: "" }],
    running: [],
    done: [{ ...done(5), priority: "critical" }] });
  expect(lanes.match(/<section id="lane-queued"[^]*?<\/section>/)![0]).toContain(badge);
  const run = lanes.match(/<section id="lane-running"[^]*?<\/section>/)![0];
  expect(run.split(badge).length - 1).toBe(1);
  expect(lanes.match(/<section id="lane-done"[^]*?<\/section>/)![0]).toContain(badge);
});

test("an ask card starts its meta row with the id, then the priority, the date and the duration, and keeps the title and the choices below it", () => {
  const row = view.askRow({ key: "issue:aleph-7", reason: "question", kind: "input", id: "aleph-7", href: "#/issues/aleph/7", title: "Which?", problem: "p", situation: "s", escalated: true, repo: "aleph", priority: "high",
    at: "2026-10-27T10:05:00", since: "2026-10-27T09:00:00", part: { n: 1, m: 2, parent: "aleph-6", href: "#/issues/aleph/6" },
    actions: [{ act: "answer", label: "Answer", hint: "h", primary: true, args: {}, recommended: false }], details: {} } as any, "2026-10-27T11:05:00");
  const head = row.match(/<div class="ih">[^]*?<\/div>/)![0];
  const order = ["idl", "badge need\">high", 'class="part"', "num date\">10/27 10:05", "num dur\">2h 05m"].map((x) => head.indexOf(x));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(head).not.toContain("kind-tag");
  expect(row.indexOf('class="t"')).toBeGreaterThan(row.indexOf("</div>"));
  expect(row.indexOf('class="actions choices"')).toBeGreaterThan(row.indexOf('class="t"'));
});
