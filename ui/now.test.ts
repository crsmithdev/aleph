import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { attend } from "./attention.ts";
// @ts-ignore
import { actMessages, openDiffs } from "./lib.js";

// The server derives `attention` from needs, needsIssues and proposals; a fixture without it gets the same derivation.
const att = (s: any) => (s.attention ? s : { ...s, attention: attend({ needs: s.needs ?? [], needsIssues: s.needsIssues ?? [] }, {}, s.proposals ?? []).items });
const r: any = { ...view, renderJobs: (s: any) => view.renderNeeds(att(s)) + view.renderLanes(att(s)), renderLede: (s: any) => view.renderLede(att(s)), view: { ...view.view, render: (s: any, p?: any, q?: any) => view.view.render(att(s), p, q) } };

// @ts-ignore
import { landCard } from "./views/cards.js";
// The land cards of `delivered`: the Status page no longer lists them, Done links to them, but the card still renders.
const landList = (s: any) => `<div class="cards one">${s.delivered.map((j: any) => landCard(j, "full", s.now)).join("")}</div>`;

const job = (o: object) => ({ repo: "aleph", item: null, state: "running", started: "2026-10-27T16:00:00Z", defaults: [], followups: [], ...o });
const state: any = {
  now: "2026-10-27T17:00:00Z",
  factory: { paused: false, dayCap: 12, runsToday: 5, costToday: 0.25, nextTick: "2026-10-27T17:12:00Z", probe: { at: "2026-10-27T14:35:00Z", ok: true, failed: [] }, health: ["judge is down"] },
  needs: [job({ name: "aleph-27", state: "needs-you", needs: "held", reason: "Held path: hooks/lib/digest.ts", stat: " a.ts | 2 +-", defaults: ["Haiku tier per request"], item: { id: 27, title: "Digest head and tail" } })],
  stuck: [job({ name: "aleph-30", state: "stuck", reason: "types failed" })],
  running: [job({ name: "aleph-36", phase: "worker", item: { id: 36, title: "Route tiers" } })],
  delivered: [job({ name: "aleph-28", state: "landed", ended: "2026-10-27T16:30:00Z", commit: "50f301fabc", commitUrl: "https://github.com/o/r/commit/50f301fabc" })],
  waiting: [],
};

test("needs shows name, reason and stat, and no copy commands", () => {
  const h = withAttn(state);
  for (const t of ["aleph-27", "Held path: hooks/lib/digest.ts", "a.ts | 2 +-"]) expect(h).toContain(t);
  expect(h).not.toContain("data-cmd=");
});

test("stuck, running and delivered show their jobs", () => {
  expect(withAttn(state)).toContain("types failed");
  expect(withAttn(state)).toContain("aleph-30");
  expect(withAttn(state)).toContain("aleph-36");
  expect(withAttn(state)).toContain("worker");
});

test("a commitUrl becomes a link", () => {
  expect(landList(state)).toContain('<a href="https://github.com/o/r/commit/50f301fabc"><code>50f301f</code></a>');
  const none = landList({ ...state, delivered: [{ ...state.delivered[0], commitUrl: undefined }] });
  expect(none).not.toContain("commit/");
});

test("an empty lane shows one quiet line; the Needs-you section is absent when nothing is wrong", () => {
  const calm = { ...state, needs: [], stuck: [], running: [], waiting: [], issues: [], done: [], attention: [], factory: { ...state.factory, health: [] } };
  const lanes = r.renderLanes(calm);
  for (const t of ["Nothing is waiting.", "No untriaged issues.", "Nothing is done yet.", "Nothing is running."]) expect(lanes).toContain(t);
  expect(lanes.match(/<p/g)?.length).toBe(4);
  expect(r.renderNeeds(calm)).toBe("");
  expect(r.view.render(calm)).not.toContain('id="needs"');
});

const issue = (n: number) => ({ id: `aleph-${n}`, title: `Issue ${n}`, status: "open", href: `#/issues/aleph/${n}`, labels: [], notes: 0, created: "2026-10-27", updated: "2026-10-27" });
const full: any = { ...state, issues: [issue(1), issue(2)], waiting: [{ repo: "aleph", id: 9, title: "w" }] };
const withAttn = (s: any) => r.renderJobs(s);
const section = (h: string, id: string) => h.match(new RegExp(`<section id="${id}"[^]*?</section>`))![0];

test("the page order is status line, flow strip, Performance, then four lanes; no metric cards", () => {
  const page = r.view.render(full);
  expect([...page.matchAll(/<(?:section|div)[^>]* id="([^"]+)"/g)].map((m) => m[1]).filter((id) => ["needs", "flow", "speed", "efficiency"].includes(id) || id.startsWith("lane-"))).toEqual(["needs", "flow", "speed", "efficiency", "lane-running", "lane-queued", "lane-done", "lane-incoming"]);
  const at = (t: string) => page.indexOf(t);
  const order = ['class="lede"', 'class="asof"', 'class="say', 'class="seg wpick"', 'data-act="pause"', 'id="needs"', 'id="flow"', 'id="speed"', 'id="efficiency"', 'id="lane-running"', 'id="lane-queued"', 'id="lane-done"', 'id="lane-incoming"'];
  expect(order.map(at)).toEqual([...order.map(at)].sort((a, b) => a - b));
  expect(order.every((t) => at(t) >= 0)).toBe(true);
  for (const t of ['class="metrics"', "Agent runs by model", "Median run", 'id="issues"', 'id="jobs"', 'id="agents"', 'id="queued"', "Incoming: 10 newest", 'class="banner"']) expect(page).not.toContain(t);
});

test("the Needs-you section sits between the status line and the flow strip, only when something is wrong", () => {
  const page = r.view.render(full);
  expect(page.indexOf('class="lede"')).toBeLessThan(page.indexOf('id="needs"'));
  expect(page.indexOf('id="needs"')).toBeLessThan(page.indexOf('id="flow"'));
  const calm = r.view.render({ ...full, needs: [], stuck: [], attention: [], factory: { ...full.factory, health: [] } });
  expect(calm).not.toContain('id="needs"');
});

test("the status line: am/pm time, the sentence, the Hour/Day/Week/Month picker and Pause; no counts", () => {
  const h = r.view.render(att(full), {}, new URLSearchParams("window=day"));
  const line = h.match(/<p class="lede">[^]*?<\/p>/)![0];
  expect(line).toMatch(/<span class="asof">\d{1,2}:\d\d (am|pm)<\/span>/);
  expect(r.renderAsOf({ now: new Date(2026, 9, 29, 12, 49).toISOString() })).toBe("12:49 pm");
  expect(r.renderAsOf({ now: new Date(2026, 9, 29, 0, 5).toISOString() })).toBe("12:05 am");
  expect(r.renderAsOf({ now: new Date(2026, 9, 29, 9, 7).toISOString() })).toBe("9:07 am");
  expect(line.replace(/<[^>]+>/g, "")).toMatch(/Hour\s*Day\s*Week\s*Month\s*Pause$/);
  expect(line).toMatch(/aria-pressed="true">Day</);
  for (const t of ["Needs you 3", "Stuck", "Week 4", "5-hour", 'class="counts"']) expect(line).not.toContain(t);
  expect(r.view.render(att(full))).toMatch(/aria-pressed="true">Week</);
});

test("the flow strip: Incoming, Queued, Running of cap, Done, then the Context card; no agent lines", () => {
  const stuck = [job({ name: "aleph-30", state: "stuck", reason: "x" }), job({ name: "aleph-31", state: "failed", reason: "y" }), job({ name: "aleph-32", state: "failed", reason: "z" })];
  const s = { ...att({ ...full, stuck }), usage: { now: { seven_day: 41.2, five_hour: 7, seven_day_resets_at: "2026-10-30T09:00:00Z" }, series: [] }, issues: [issue(1)], newIssues: 1, factory: { ...full.factory, liveCap: 3, liveRuns: 1, waitingCap: 5, firefighter: [] } };
  const h = r.renderFlow(s, { done: 4 });
  const stages = [...h.matchAll(/<a class="stage-main" href="#lane-(\w+)"><span class="k">([^<]+)<\/span><span class="v"[^>]*>(\d+)(?:<span class="of"> of (\d+)<\/span>)?<\/span><\/a>/g)].map((m) => m.slice(1));
  expect(stages).toEqual([["incoming", "Incoming", "1", undefined], ["queued", "Queued", "1", undefined], ["running", "Running", "1", "3"], ["done", "Done", "4", undefined]]);
  expect(h).not.toContain("arrow");
  for (const t of ["agentline", "avg", "Done today", "Triage", "Workers", "Planner", "Firefighter"]) expect(h).not.toContain(t);
  const ctx = h.slice(h.indexOf('id="context"'));
  expect(h.indexOf('id="done-n"')).toBeLessThan(h.indexOf('id="context"'));
  expect(ctx.replace(/<[^>]+>/g, "")).toMatch(/Context\s*41% weekly\s*\/\s*7% 5 hours/);
  for (const t of ["Needs you", "Stuck", "Failed", "<a "]) expect(ctx).not.toContain(t);
  const gained = r.renderContext({ ...s, usage: { ...s.usage, last5h: 3.4 } });
  expect(gained.replace(/<[^>]+>/g, "")).toMatch(/41% weekly \(\+3%\)\s*\/\s*7% 5 hours/);
  expect(r.renderContext({ ...s, usage: { ...s.usage, last5h: 0 } }).replace(/<[^>]+>/g, "")).toContain("41% weekly (+0%)");
  expect(r.renderFlow({ ...s, usage: undefined })).toContain("usage unknown");
  expect(r.renderFlow(s, null)).toContain('id="done-n">\u2013');
});

test("the Running stage counts the live agent runs the cap checks; the lane still lists every open run", () => {
  const mk = (n: number, kind: string) => job({ name: `${kind}-${n}`, run: { kind, started: "2026-10-30T09:00:00Z" } });
  const running = [...Array.from({ length: 12 }, (_, i) => mk(i, "agent")), mk(1, "land"), mk(2, "land")];
  const s = { ...full, running, factory: { ...full.factory, liveCap: 12, liveRuns: 12 } };
  expect(r.renderFlow(s)).toMatch(/Running<\/span><span class="v">12<span class="of"> of 12</);
  expect((r.renderLanes(s).match(/class="[^"]*run-row/g) ?? []).length).toBe(14);
});

test("Speed is one section under the flow strip, with Efficiency directly below it", () => {
  const h = r.view.render(full);
  expect(h.match(/<section id="speed"/g)?.length).toBe(1);
  expect(h.match(/<section id="efficiency"/g)?.length).toBe(1);
  expect(h.indexOf('id="speed"')).toBeLessThan(h.indexOf('id="efficiency"'));
  expect(h.indexOf('id="efficiency"')).toBeLessThan(h.indexOf('id="lane-incoming"'));
  expect(h.match(/class="speedrow"/g)?.length).toBe(1);
  expect(h.indexOf('id="flow"')).toBeLessThan(h.indexOf('class="speedrow"'));
  expect(h.indexOf('class="speedrow"')).toBeLessThan(h.indexOf('id="speed"'));
});

test("every lane header has a count, in one style", () => {
  const lanes = r.renderLanes(full);
  expect(lanes.match(/<div class="sh"><h2 id="h-[a-z]+">[A-Za-z]+<\/h2><span class="count">\d+<\/span><\/div>/g)?.length).toBe(4);
  expect(lanes).toContain('<h2 id="h-incoming">Incoming</h2><span class="count">2</span>');
  expect(lanes).toContain("Issue 1");
});

test("Needs you groups needs you, then stuck or failed; the lanes hold running and queued; every card is compact", () => {
  const h = r.renderNeeds(att(full));
  const at = (id: string) => h.indexOf(`id="jobs-${id}"`);
  expect(at("needs")).toBeGreaterThan(-1);
  expect(at("needs")).toBeLessThan(at("stuck"));
  expect(h).not.toContain("jobs-running");
  const q = r.renderLanes(full);
  expect(q).toMatch(/<h2 id="h-queued">Queued<\/h2><span class="count">1<\/span>/);
  expect(h).not.toContain("job-card big");
  expect(h.match(/class="job-card small[ "]/g)?.length).toBe(h.match(/<article /g)?.length);
  expect(q.match(/class="job-card small lane-card/g)?.length).toBe(2 + 1 + 1); // 2 incoming, 1 queued, 1 running
});

const rows = (h: string) => h.split('<article class="job-card small issue-row ').slice(1);
const problem = (row: string) => row.match(/<p class="problem">([^<]*)<\/p>/)![1];

test("a held run, a stuck run, a needs-chris issue and a red main are one row each, with the id, title, Problem and buttons", () => {
  const needsIssues = [{ ...issue(7), labels: ["needs-chris"], title: "Which tier?", question: "Haiku or Sonnet for the digest?" }];
  const s = { ...full, needs: [{ ...state.needs[0], review2: { verdict: "chris", reason: "touches hooks" } }], stuck: [job({ name: "aleph-30", state: "stuck", reason: "no commit", item: { id: 30, title: "Fix it" } })], needsIssues, issues: [], factory: { ...full.factory, health: ["health: aleph main is red at abc1234: tests"], hold: "Held: aleph-30 is stuck (no commit). No run starts or lands until it is cleared." } };
  const page = r.view.render(s);
  const top = section(page, "needs");
  const rs = rows(top);
  expect(rs.length).toBe(4);
  expect(rs.map((x) => x.match(/^(\w+)/)![1])).toEqual(["held", "decision", "error", "stuck"]);
  expect(problem(rs[0])).toContain("changes a path the repo holds");
  expect(rs[0]).toContain("Reviewer: chris: touches hooks");
  expect(problem(rs[3])).toBe("Stuck with no commit.");
  expect(problem(rs[1])).toBe("Haiku or Sonnet for the digest?");
  expect(problem(rs[2])).toBe("Fix: aleph main is red at abc1234: tests");
  expect(rs[2]).not.toContain("<button");
  expect(rs[2]).not.toContain("always");
  // The id comes first, then the title and the Problem, then the buttons.
  for (const [row, id, title, btns] of [[rs[0], "aleph-27", "Digest head and tail", ["land", "drop"]], [rs[3], "aleph-30", "Fix it", ["recheck", "drop"]], [rs[1], "aleph-7", "Which tier?", ["decide", "deny"]]] as const) {
    expect(row.indexOf(id)).toBeLessThan(row.indexOf(title));
    expect(row.indexOf(title)).toBeLessThan(row.indexOf("problem"));
    expect(row.match(/<details class="more"/g)?.length ?? 0).toBeLessThanOrEqual(1);
    for (const b of btns) expect(row).toContain(`data-act="${b}"`);
  }
  expect(rs[0]).toMatch(/<details class="more"[^]*data-act="diff"/);
  expect(rs[1]).toContain('href="#/issues/aleph/7"');
  expect(top.match(/main is red/g)?.length).toBe(1);
  expect(top).not.toContain("Held: aleph-30");
  expect(section(page, "lane-running")).toContain("aleph-36");
  expect(section(page, "lane-incoming")).not.toContain("aleph-27");
});

test("a held run's details carry the hold note and the reviewer's verdict", () => {
  const why = (review2: any) => rows(r.renderJobs({ ...state, stuck: [], factory: { ...state.factory, health: [] }, needs: [{ ...state.needs[0], review2 }] }))[0];
  expect(why({ verdict: "back", reason: "lost an assertion" })).toContain("Reviewer: back: lost an assertion");
  expect(why({ verdict: "error" })).toContain("Reviewer: error");
  expect(why(undefined)).not.toContain("Reviewer:");
  expect(why(undefined)).toContain("Held path: hooks/lib/digest.ts");
});

test("issues that wait for triage are not rows and not in the status line: triage is the factory's", () => {
  const s = { ...full, needs: [], stuck: [], needsIssues: [], factory: { ...full.factory, health: [], hold: undefined, paused: false } };
  expect(rows(r.renderJobs(s)).length).toBe(0);
  expect(r.renderLede(s)).not.toContain("attention");
  expect(r.renderLede(s)).not.toContain("triage");
});

test("with no untriaged issue the Incoming lane says so; the page still has it", () => {
  const calm = { ...full, needs: [], stuck: [], issues: [], newIssues: 0, needsIssues: [], factory: { ...full.factory, health: [] } };
  expect(r.renderLanes(calm)).toContain("No untriaged issues.");
  expect(r.view.render(calm)).toContain('id="lane-incoming"');
});

test("Issues holds the held runs before the stuck and failed ones, and none says whether an agent works", () => {
  const s = { ...state, running: [], stuck: [job({ name: "aleph-30", state: "failed", agent: true }), job({ name: "aleph-31", state: "stuck" })], needs: [{ ...state.needs[0], agent: false }] };
  const h = withAttn(s);
  expect(h).toContain(">Needs you<");
  expect(h.indexOf("aleph-27")).toBeLessThan(h.indexOf("aleph-30"));
  expect(h.indexOf("aleph-30")).toBeLessThan(h.indexOf("aleph-31"));
  expect(h).toContain('<p class="problem">Failed.</p>');
  // A job with a live run says so, on its own card only.
  expect(h.match(/Agent working/g)?.length).toBe(1);
  expect(h.indexOf("Agent working")).toBeGreaterThan(h.indexOf("aleph-30"));
  expect(h.indexOf("Agent working")).toBeLessThan(h.indexOf("aleph-31"));
  expect(h).not.toContain("aleph drop");
  expect(h).not.toContain("data-cmd");
});

test("text from the state is escaped", () => {
  const bad = { ...state, needs: [job({ name: "x", state: "needs-you", needs: "held", item: { id: 1, title: "<script>alert(1)</script>" } })], waiting: [{ repo: "a", id: 1, title: "<script>w</script>" }] };
  for (const h of [withAttn(bad), withAttn(bad)]) {
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  }
});

test("a needs-you entry has Diff, Land and Drop buttons; a landed one with an open check has Checked", () => {
  const h = withAttn(state);
  for (const v of ["diff", "land", "drop"]) expect(h).toContain(`data-act="${v}" data-name="aleph-27"`);
  expect(h).toContain("diff-panel");
  const open = { ...state, delivered: [{ ...state.delivered[0], check: "open" }] };
  expect(landList(open)).toContain('data-act="checked" data-name="aleph-28"');
  expect(landList(state)).not.toContain("data-act=");
  expect(landList(state)).not.toContain("data-cmd=");
});

test("a land from another day shows its date", () => {
  const old = { ...state, delivered: [{ ...state.delivered[0], ended: "2026-10-25T16:30:00Z" }] };
  expect(landList(old)).toMatch(/<dt>Landed<\/dt><dd>Oct 25 \d\d:\d\d<\/dd>/);
  expect(landList(state)).toMatch(/<dt>Landed<\/dt><dd>Oct 27 \d\d:\d\d<\/dd>/);
});

const withFactory = (o: object) => ({ ...state, factory: { ...state.factory, health: [], ...o } });

test("a stuck job shows its reason, the failed check and its seconds, and Re-check and Drop buttons", () => {
  const h = withAttn({ ...state, needs: [], stuck: [job({ name: "aleph-30", state: "stuck", reason: "types failed", checks: [{ name: "lint", ok: true, seconds: 3 }, { name: "tsc", ok: false, seconds: 41 }] })] });
  for (const t of ["types failed", "tsc", "41 s", 'data-act="recheck" data-name="aleph-30"', 'data-act="drop" data-name="aleph-30"']) expect(h).toContain(t);
  expect(h).not.toContain("data-cmd");
});

test("many needs-you jobs all render as rows, each with its details folded and its buttons", () => {
  const needs = [1, 2, 3, 4].map((i) => job({ name: `aleph-${i}`, state: "needs-you", needs: "held", reason: "Held path", item: { id: i, title: `t${i}` } }));
  const h = withAttn({ ...state, needs });
  expect(h.match(/class="job-card small issue-row held"/g)?.length).toBe(4);
  expect(h.match(/<details class="more" data-keep="more:[^"]*">/g)?.length).toBe(4 + 1);
  for (const i of [1, 2, 3, 4]) expect(h).toContain(`data-act="land" data-name="aleph-${i}"`);
});

test("the lede leads with a count and the items, colored; the page has no banner", () => {
  const h = r.renderLede(withFactory({}));
  expect(h).toContain("1 job needs you</a> and ");
  expect(h).toContain("1 job is stuck</a>.");
  expect(h).not.toContain("attention");
  expect(h).toContain('class="say error"');
  expect(h.indexOf("needs you")).toBeLessThan(h.indexOf("stuck"));
  const cases: [object, string][] = [
    [{ runsToday: 12 }, "day cap is reached"],
    [{ paused: true }, "paused"],
    [{ hold: "Held: aleph-116 is stuck (merge conflict). No run starts or lands until it is cleared." }, "Held: aleph-116 is stuck (merge conflict)."],
    [{ health: ["health: aleph main is red"] }, "main is red"],
    [{ probe: { at: "2026-10-27T14:35:00Z", ok: false, failed: ["no network"] } }, "sandbox probe"],
  ];
  for (const [o, text] of cases) expect(r.renderLede(withFactory(o))).toContain(text);
  const page = r.view.render(withFactory({ health: ["health: aleph main is red"] }));
  expect(page).not.toContain('class="banner"');
  expect(page).toMatch(/<p class="lede">[^]*main is red/);
});

test("warning-only problems get the warning class; a failed probe gets error", () => {
  const calm = { ...withFactory({}), needs: [], stuck: [] };
  expect(r.renderLede({ ...calm, factory: { ...calm.factory, paused: true } })).toMatch(/say warning">The factory is paused\./);
  expect(r.renderLede({ ...calm, factory: { ...calm.factory, paused: true, runsToday: 12 } })).toContain("The factory is paused and the day cap is reached.");
  expect(r.renderLede(withFactory({ needs: [], probe: { at: "x", ok: false, failed: [] } }))).toContain('say error">');
});

test("with nothing wrong the lede is one of the fine variants, with no count", () => {
  const calm = { ...withFactory({}), needs: [], stuck: [] };
  for (let i = 0; i < 20; i++) {
    const h = r.renderLede({ ...calm, now: new Date(Date.UTC(2026, 9, 28, 12, i * 10)).toISOString() });
    const text = h.replace(/<[^>]*>/g, "");
    expect(r.FINE).toContain(text);
    expect(h).toContain('class="say fine"');
    expect(h).not.toMatch(/\d|attention/);
  }
});

test("the fine sentence is stable within a 10-minute window and varies across windows; every variant is positive", () => {
  const calm = { ...withFactory({}), needs: [], stuck: [] };
  const at = (min: number) => r.renderLede({ ...calm, now: new Date(Date.UTC(2026, 9, 28, 12, 0, 0) + min * 60_000).toISOString() });
  expect(at(1)).toBe(at(2));
  expect(at(10)).toBe(at(11));
  expect(new Set(Array.from({ length: 10 }, (_, i) => at(i * 10))).size).toBeGreaterThan(1);
  for (const v of r.FINE) expect(v).not.toMatch(/\bnot\b|\bno |nothing|never/i);
});

test("a flake line is not shown on the Status page", () => {
  const calm = { ...withFactory({ health: ["health: aleph check tests passed on rerun 4 times in 7 days"] }), needs: [], stuck: [] };
  const h = r.renderLede(calm);
  expect(h).toContain('class="say fine"');
  expect(h).not.toContain("attention");
  expect(h).not.toContain("rerun");
  expect(r.view.render(calm)).not.toContain("rerun");
  expect(r.renderJobs(calm)).not.toContain("rerun");
});

test("the as-of line is h:mm am or pm, no date", () => {
  expect(r.renderAsOf({ now: new Date(2026, 9, 28, 9, 5).toISOString() })).toBe("9:05 am");
  expect(r.renderAsOf({ now: new Date(2026, 9, 28, 21, 5).toISOString() })).toBe("9:05 pm");
  expect(r.renderAsOf(state)).toMatch(/^\d{1,2}:\d{2} (am|pm)$/);
});

test("a running job past 40 minutes says so", () => {
  const late = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:19:00Z", run: { kind: "agent", started: "2026-10-27T16:19:00Z" } })] });
  expect(late).toContain("past the time box");
  expect(withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:30:00Z", run: { kind: "agent", started: "2026-10-27T16:30:00Z" } })] })).not.toContain("past the time box");
});

test("a land run is measured from its own start and never past the time box", () => {
  const h = withAttn({ ...state, now: "2026-10-27T16:55:00Z", running: [job({ name: "a", started: "2026-10-27T16:00:00Z", run: { kind: "land", started: "2026-10-27T16:50:00Z" } })] });
  expect(h).toContain("land");
  expect(h).toContain('<span class="elapsed" data-since="2026-10-27T16:50:00Z">5:00</span> elapsed');
  expect(h).not.toContain("past the time box");
});

test("a worker run older than 40 minutes is past the time box", () => {
  const h = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T15:00:00Z", run: { kind: "agent", started: "2026-10-27T16:00:00Z" } })] });
  expect(h).toContain("past the time box");
  expect(h).toContain("worker");
});

test("a build run is a worker and is past the time box after 40 minutes", () => {
  const h = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T15:00:00Z", run: { kind: "build", started: "2026-10-27T16:00:00Z" } })] });
  expect(h).toContain("worker");
  expect(h).toContain("past the time box");
  expect(withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:30:00Z", run: { kind: "build", started: "2026-10-27T16:30:00Z" } })] })).not.toContain("past the time box");
});

test("a 30-file stat shows 12 lines and +18 more files", () => {
  const stat = Array.from({ length: 30 }, (_, i) => ` f${i}.ts | 2 +-`).join("\n") + "\n 30 files changed, 30 insertions(+), 30 deletions(-)";
  const h = withAttn({ ...state, needs: [job({ name: "x", state: "needs-you", needs: "held", stat })] });
  expect(h.match(/ f\d+\.ts \| 2/g)?.length).toBe(12);
  expect(h).toContain("+18 more files");
});

test("a land does not show checks as facts", () => {
  const checks = [{ name: "tests", ok: true, seconds: 71 }, { name: "types", ok: false, seconds: 9 }];
  const land = landList({ ...state, delivered: [{ ...state.delivered[0], checks }] });
  expect(land).not.toContain("<dt>Tests</dt>");
  expect(land).not.toContain("<dt>Types</dt>");
  expect(withAttn(state)).not.toContain(" s ✓");
  expect(landList(state)).not.toContain("checks");
});

test("the Pause or Resume button sits in the page head beside the time; no Controls panel", () => {
  const on = r.renderControls(state);
  expect(on).toContain('data-act="pause"');
  expect(on).not.toContain('data-act="resume"');
  const off = r.renderControls({ ...state, factory: { ...state.factory, paused: true } });
  expect(off).toContain('data-act="resume"');
  expect(off).not.toContain('data-act="pause"');
  const page = r.view.render(state);
  expect(page).not.toContain('id="controls"');
  expect(page.indexOf('data-act="pause"')).toBeGreaterThan(page.indexOf('class="lede"'));
  expect(page.indexOf('data-act="pause"')).toBeGreaterThan(page.indexOf('class="asof"'));
  expect(page.indexOf('data-act="pause"')).toBeLessThan(page.indexOf('id="flow"'));
});

test("trailers show on one line joined by ' · ', escaped, and only when there are some", () => {
  const trailers = [{ key: "Item", value: "aleph-27" }, { key: "Job", value: "<script>x</script>" }, { key: "Held-by", value: "Chris" }];
  const del = { ...state, delivered: [job({ name: "aleph-28", state: "landed", trailers })] };
  const h = landList(del);
  expect(h).toContain("aleph-27 · Job &lt;script&gt;x&lt;/script&gt; · Held-by Chris");
  expect(h).not.toContain("Item aleph-27");
  expect(h).not.toContain("<script>");
  expect(h).not.toContain('<pre class="trailers"');
  expect(landList(state)).not.toContain("trailers");
});

test("the Job trailer is parsed into run kind and start, linked to the job page with the raw id in the title", () => {
  const id = "20261028-042822-aleph-aleph-240-agent";
  const del = { ...state, delivered: [job({ name: "aleph-240", state: "landed", trailers: [{ key: "Item", value: "aleph-240" }, { key: "Job", value: id }] })] };
  const h = landList(del);
  expect(h).toContain(`<p class="trailers-line">aleph-240 \u00b7 <a href="#/jobs/aleph-240" title="${id}">agent run, Oct 28 04:28</a></p>`);
  expect(h.replace(/title="[^"]*"/, "")).not.toContain(id);
  expect(landList({ ...del, delivered: [{ ...del.delivered[0], trailers: [{ key: "Job", value: id.replace("agent", "land").replace("042822", "134500") }] }] })).toContain(">land, Oct 28 13:45<");
});

test("a land card has no origin/main aside; a running land comes before landed ones", () => {
  const lands = { ...state, delivered: [job({ name: "land-1", state: "running" }), ...state.delivered] };
  const h = landList(lands);
  expect(h).not.toContain("origin/main");
  expect(h.indexOf("land-1")).toBeLessThan(h.indexOf("aleph-28"));
  expect(h).toMatch(/class="job-card big[ "]/);
});

const two: any = { ...state, needs: [job({ name: "job-a", state: "needs-you", needs: "held", defaults: [] }), job({ name: "job-b", state: "needs-you", needs: "held", defaults: [] })] };
const panel = (h: string, n: string) => h.match(new RegExp(`<div class="diff-panel" data-diff-for="${n}"[^>]*>`))![0];

test("an open diff survives a render; other panels stay hidden", () => {
  openDiffs.set("job-a", "@@ -1 +1 @@\n-old\n+new");
  try {
    const h = withAttn(two);
    expect(panel(h, "job-a")).not.toContain("hidden");
    expect(panel(h, "job-b")).toContain("hidden");
    expect(h).toContain("+new");
    expect(h).toContain("-old");
  } finally { openDiffs.clear(); }
});

test("an action message survives a render; none when empty", () => {
  actMessages.set("job-a", "land failed: conflict");
  try {
    const h = withAttn(two);
    expect(h).toContain('<span class="act-msg" role="alert">land failed: conflict</span>');
    expect(h.match(/act-msg/g)!.length).toBe(1);
  } finally { actMessages.clear(); }
  expect(withAttn(two)).not.toContain("act-msg");
});

test("message and diff text are escaped", () => {
  actMessages.set("job-a", "<b>x</b>");
  openDiffs.set("job-a", "+<script>alert(1)</script>");
  try {
    const h = withAttn(two);
    expect(h).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(h).toContain("&lt;script&gt;");
    expect(h).not.toContain("<script>");
  } finally { actMessages.clear(); openDiffs.clear(); }
});

test("a held row shows the review2 verdict and its reason in Details", () => {
  const withReview = (review2: object) => ({ ...state, needs: [{ ...state.needs[0], review2 }] });
  const h = withAttn(withReview({ verdict: "back", reason: "a test lost <an> assertion" }));
  expect(h).toContain("Reviewer: back: a test lost &lt;an&gt; assertion");
  expect(h.indexOf("Reviewer: back")).toBeGreaterThan(h.indexOf("<details"));
  expect(withAttn(state)).not.toContain("Reviewer:");
});

test("a needs-chris issue with fields shows the question, the options, the recommended mark, the context and the buttons in the row", () => {
  const decision = { question: "Haiku or Sonnet for the `digest`?", options: [{ label: "Haiku", line: "Cheaper, `fast`" }, { label: "Sonnet", line: "Better summaries" }], recommended: "Sonnet", kind: "product" as const, why: ["Digests run daily", "Quality matters more"] };
  const s = { ...state, needs: [], stuck: [], issues: [], factory: { ...state.factory, health: [] }, needsIssues: [{ ...issue(152), labels: ["needs-chris"], title: "Which tier?", question: "prose", decision }] };
  const [row] = rows(r.renderJobs(s));
  expect(row).toContain('<p class="dq">Haiku or Sonnet for the <code>digest</code>?</p>');
  expect(row).toContain("<code>fast</code>");
  expect(row).toMatch(/<li class="rec"><b>Sonnet<\/b> <span class="badge run">Recommended<\/span>/);
  expect(row).toContain("Digests run daily");
  // The row says the question in one sentence; the options and context are in the one Details.
  expect(problem(row)).toBe("Haiku or Sonnet for the digest?");
  expect(row.match(/<details class="more"/g)?.length).toBe(1);
  expect(row.indexOf("<details")).toBeLessThan(row.indexOf('<p class="dq">'));
  expect(row).toContain('href="#/issues/aleph/152"');
  const buttons = [...row.matchAll(/<button class="act( primary)?"[^>]*data-act="(\w+)"[^>]*data-label="([^"]*)"/g)].map((m) => [m[2], m[3], !!m[1]]);
  expect(buttons).toEqual([["decide", "Approve Sonnet", true], ["decide", "Approve Haiku", false], ["drop", "Drop the issue", false]]);
  expect(row).toContain('data-option="Sonnet"');
});

test("an old prose needs-chris note gets a Problem with no tag or lead, Approve recommendation and Deny", () => {
  const note = "triage: for Chris: Should `ui/x.ts` use A or B?\nA is simpler. My recommendation is A, because it is simpler. Then more words.";
  const s = { ...state, needs: [], stuck: [], issues: [], factory: { ...state.factory, health: [] }, needsIssues: [{ ...issue(152), labels: ["needs-chris"], title: "Which?", question: note }] };
  const [row] = rows(r.renderJobs(s));
  expect(problem(row)).not.toContain("triage: for Chris");
  expect(row).toContain('data-label="Approve recommendation"');
  expect(row).toContain('data-recommendation="true"');
  expect(row).toContain('data-label="Deny"');
  expect(row).toContain('class="reason"');
  expect(row.match(/<details class="more"/g)?.length).toBe(1);
});

test("the status line is not 'All is well.' when the Issues section has an item", () => {
  const calm = { ...state, needs: [], stuck: [], issues: [], needsIssues: [], factory: { ...state.factory, health: [], hold: undefined, paused: false } };
  for (const o of [{ needsIssues: [{ ...issue(7), labels: ["needs-chris"], question: "q" }] }]) {
    const h = r.renderLede({ ...calm, ...o });
    for (const v of r.FINE) expect(h).not.toContain(v);
    expect(h).toContain("1 issue needs a decision");
    expect(h).not.toContain("attention");
  }
});

test("a held run that waits for the firefighter is still one job needs you, never a fine line", () => {
  const held = { ...state, stuck: [], needsIssues: [], factory: { ...state.factory, health: [] } };
  const attention = attend({ needs: held.needs, needsIssues: [] }, { held: { action: "firefighter", at: "2026-10-28T00:00:00.000Z" } }, []).items;
  const h = r.renderLede({ ...held, attention });
  expect(h).toContain("1 job needs you");
  expect(h).toContain('class="say warning"');
  for (const v of r.FINE) expect(h).not.toContain(v);
});

test("Status times use the state's own now for the year check", () => {
  const run = (started: string) => withAttn({ ...state, now: "2027-01-05T12:00:00Z", running: [job({ name: "a", started, run: { kind: "land", started } })] });
  expect(run("2026-10-27T16:50:00Z")).toContain(">2026-10-27</span>");
  expect(run("2027-01-05T11:00:00Z")).toMatch(/>[A-Z][a-z]{2} \d\d \d\d:\d\d<\/span>/);
  const held = withAttn({ ...state, now: "2027-01-05T12:00:00Z", needs: [job({ name: "aleph-27", state: "needs-you", needs: "held", started: "2026-10-27T16:50:00Z", trailers: [{ key: "Job", value: "20261028-042822-aleph-aleph-240-agent" }] })] });
  expect(held).toContain("Started</dt><dd>2026-10-27");
  expect(held).not.toMatch(/\d\d? ?[AP]M/i);
});

test("a planner run is shown like a triage: Planning while it runs, Split once it filed children, planner as a running kind", async () => {
  // @ts-ignore plain JS, shared with the page
  const { triageCard } = await import("./views/cards.js");
  const plan = { name: "plan-aleph-5", item: { title: "Big" }, state: "running", run: { kind: "plan", started: "2026-10-27T16:50:00Z" }, started: "2026-10-27T16:50:00Z" };
  expect(triageCard(plan, "full", state.now)).toContain('<span class="badge run">Planning</span>');
  expect(triageCard({ ...plan, state: "done", outcome: "planned" }, "full", state.now)).toContain('<span class="badge done">Split</span>');
  expect(triageCard({ ...plan, state: "done", reason: "malformed plan: x" }, "compact", state.now)).toContain(">No plan<");
  expect(r.renderJobs({ ...state, running: [job({ name: "plan-aleph-5", run: plan.run })] })).toContain('<span class="badge run">planner');
});

test("a land shows the acceptance result of its goal, escaped, and nothing without one", () => {
  const h = landList({ ...state, delivered: [{ ...state.delivered[0], acceptance: "acceptance: pass at abc1234" }] });
  expect(h).toContain("<dt>Acceptance</dt><dd>pass at abc1234</dd>");
  const bad = landList({ ...state, delivered: [{ ...state.delivered[0], acceptance: "acceptance: fail, rerun: `bun test <x>`" }] });
  expect(bad).toContain("fail, rerun: `bun test &lt;x&gt;`");
  expect(landList(state)).not.toContain("Acceptance");
});

// ---- proposals ----
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList } from "../todo/lib/store.ts";
import { routes as proposalRoutes } from "./api/proposals.ts";

const prop = { id: "l-1234abcd", kind: "check", title: "No db mocks", target: "aleph checks", sentence: "Do not mock the db.", count: 3, signals: [
  { source: "chris", at: "2026-10-27T10:00:00Z", quote: "No, <script>alert(1)</script>", link: "https://lf/trace/t2" },
  { source: "gate", at: "2026-10-27T11:00:00Z", quote: "deny", link: "" },
] };

test("a proposal is a row with Yes-like buttons and its signals folded", () => {
  const h = r.renderJobs({ ...state, proposals: [prop] });
  const row = h.match(/<article class="job-card small issue-row proposal-check"[^]*?<\/article>/)![0];
  expect(problem(row)).toContain("Do not mock the db");
  expect(row).toContain('<span class="t">No db mocks</span>');
  expect(row).toContain('class="act primary" type="button" data-act="approve" data-id="l-1234abcd" data-label="Add a check to aleph">Add a check to aleph<');
  expect(row).toContain('data-act="decline" data-id="l-1234abcd" data-label="Add no check">');
  expect(row).toContain('data-reason="proposal-check:aleph"');
  expect(row).toContain('data-label="Add a check to aleph [auto-yes]"');
  expect(row.match(/<details class="more"/g)?.length).toBe(1);
  expect(row).toContain('<a href="https://lf/trace/t2">');
  expect(row).not.toContain("<script>");
  expect(row).toContain("&lt;script&gt;");
});

test("rows are ordered held, then needs-chris, then proposal, then error; the group is a list", () => {
  const s = { ...state, proposals: [prop], needsIssues: [{ id: "aleph-5", title: "T", href: "#/x", question: "Pick one?" }], factory: { ...state.factory, health: ["main is red"] } };
  const h = r.renderJobs(s);
  expect(h).toContain('<div class="list">');
  expect(h).not.toMatch(/id="jobs-needs"[^]*class="cards"[^]*id="jobs-stuck"/);
  expect(h.indexOf("aleph-27")).toBeLessThan(h.indexOf("aleph-5"));
  expect(h.indexOf("aleph-5")).toBeLessThan(h.indexOf("l-1234abcd"));
  expect(h.indexOf("l-1234abcd")).toBeLessThan(h.indexOf("main is red"));
  expect(h).toContain(">4<");
});

test("the lede counts proposals as one warning", () => {
  const s = { ...state, needs: [], stuck: [], factory: { ...state.factory, health: [] }, proposals: [prop] };
  expect(r.renderLede(s)).toContain("<a href=\"#jobs-needs\">1 proposal waits for Yes or No</a>.");
  expect(r.renderLede({ ...s, proposals: [prop, prop] })).toContain("2 proposals wait for Yes or No");
});

test("approve and decline handlers", async () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-prop-"));
  const keys = ["ALEPH_FACTORY_DIR", "ALEPH_ITEMS", "ALEPH_REPOS", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const sh = (cwd: string, ...a: string[]) => { const p = Bun.spawnSync(a, { cwd, stdout: "pipe", stderr: "pipe" }); if (p.exitCode) throw new Error(String(p.stderr)); };
  try {
    Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_ITEMS: join(base, "items"), ALEPH_REPOS: join(base, "repos.json") });
    sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
    sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
    sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
    sh(join(base, "items"), "git", "push", "-q", "origin", "main");
    writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: base, sandbox: true } }));
    mkdirSync(join(base, "factory"), { recursive: true });
    const sig = [{ id: "s", source: "chris", at: "2026-10-27T10:00:00Z", quote: "q", link: "" }];
    const lesson = (id: string) => ({ id, sentence: "S " + id, state: "proposed", signals: sig, count: 3, kind: "check" });
    const file = join(base, "factory", "corrections.json");
    writeFileSync(file, JSON.stringify({ minedAt: "", lessons: [lesson("l-a"), lesson("l-b")] }));
    const stored = () => JSON.parse(readFileSync(file, "utf8")).lessons;
    const post = (p: string, h: Record<string, string> = { "x-aleph-ui": "1" }) => new Request(`http://x/api/${p}`, { method: "POST", headers: h });
    const call = (key: string, p: string, id: string, h?: Record<string, string>) => (proposalRoutes as any)[key](post(p, h), { id }, new URL("http://x/"));

    expect((await call("POST /api/approve/:id", "approve/l-a", "l-a", {})).status).toBe(403);
    expect(stored()[0].state).toBe("proposed");
    const ok = await call("POST /api/approve/:id", "approve/l-a", "l-a");
    const body = await ok.json();
    expect(body.code).toBe(0);
    expect(stored()[0].state).toBe("approved");
    const items = readList({ key: "fac" })!.items;
    // The issue and its goal `.1`.
    expect(items.map((i) => i.fm.id)).toEqual(["1", "1.1"]);
    expect(items[0].fm).toMatchObject({ kind: "issue", source: "memory" });
    const again = await call("POST /api/approve/:id", "approve/l-a", "l-a");
    expect(again.status).toBe(422);
    expect((await again.json()).code).toBe(1);

    const d = await call("POST /api/decline/:id", "decline/l-b", "l-b");
    expect(await d.json()).toEqual({ code: 0, stdout: "declined", stderr: "" });
    expect(stored()[1].state).toBe("declined");
  } finally {
    for (const k of keys) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(base, { recursive: true, force: true });
  }
});

test("a running firefighter run shows its role as the kind", () => {
  const s = { ...state, running: [job({ name: "firefighter", phase: "firefighter", run: { kind: "firefighter", started: "2026-10-27T16:55:00Z" } })] };
  expect(r.renderJobs(s)).toContain('<span class="badge run">firefighter</span>');
});

test("a held job card has no badge or agent line", () => {
  const h = r.renderJobs({ ...state, stuck: [], needs: [{ ...state.needs[0], agent: true, review2: { verdict: "back", reason: "x" } }] });
  expect(rows(h)[0]).not.toContain("badge");
});

// ---- the attention rows ----
import { REASONS } from "../jobs/lib/standing.ts";

const sample = (reason: string) => {
  const run = (needs: string, o: object = {}) => ({ needs: [job({ name: "aleph-27", state: "needs-you", needs, reason: "<task-notification>x</task-notification> needs-chris: y", item: { id: 27, title: "T" }, ...o })], needsIssues: [] as any[], lessons: [] as any[] });
  const iss = (o: object) => ({ needs: [], needsIssues: [{ ...issue(7), labels: ["needs-chris"], title: "T", ...o }], lessons: [] as any[] });
  if (["held", "review"].includes(reason)) return run(reason, reason === "review" ? { review2: { verdict: "chris", reason: "r" } } : {});
  if (reason === "question") return run("question", { question: "<agent-message>q</agent-message> Which?" });
  if (reason.startsWith("proposal-")) return { needs: [], needsIssues: [] as any[], lessons: [{ ...prop, kind: reason.slice(9), target: { check: "aleph checks", "claude-md": "aleph/CLAUDE.md", skill: "skills/aleph/SKILL.md" }[reason.slice(9)] }] };
  const q: Record<string, object> = {
    proposal: { reason: "proposal", question: "T" },
    "host-check": { reason: "host-check", question: "triage: a live check: run it" },
    "no-commit": { reason: "no-commit", question: "needs-chris: ended with no commit, so the factory stopped" },
    "run-cap": { reason: "run-cap", question: "needs-chris: the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it." },
    "triage-no-verdict": { reason: "triage-no-verdict", question: "needs-chris: triage: no verdict in 2 runs: failed: x" },
    "acceptance-failed": { reason: "acceptance-failed", question: "needs-chris: acceptance: fail again" },
    decision: { reason: "decision", question: "needs-chris: Which one?" },
    rescue: { reason: "rescue", question: "needs-chris: Which one?", decision: { question: "Which?", options: [{ label: "A", line: "a" }], recommended: "A", kind: "product" as const, why: [] } },
    firefighter: { reason: "firefighter", question: "needs-chris: x changes y.ts, a held security path" },
  };
  return iss(q[reason]);
};

for (const reason of Object.keys(REASONS)) {
  test(`attention row for ${reason}: Problem, named buttons, a hint each, and Always`, () => {
    const sm = sample(reason);
    const items = attend({ needs: sm.needs as any, needsIssues: sm.needsIssues }, {}, sm.lessons).items;
    expect(items.map((i) => i.reason)).toEqual([reason]);
    const h = r.renderJobs({ ...state, needs: [], stuck: [], factory: { ...state.factory, health: [] }, attention: items });
    const row = h.match(new RegExp(`<article class="job-card small issue-row ${reason}"[^]*?</article>`))![0];
    expect(row).toContain(`data-reason="${reason}"`);
    const p = problem(row);
    expect(p.length).toBeGreaterThan(5);
    for (const t of ["<task-notification", "<agent-message", "needs-chris:"]) expect(p).not.toContain(t);
    const buttons = [...row.split("<details")[0].matchAll(/<button class="act( primary)?" [^>]*data-label="([^"]*)"/g)].map((m) => m[2]);
    expect(buttons).toEqual(items[0].actions.map((a) => a.label));
    for (const b of buttons) expect(["Yes", "No", "Open"]).not.toContain(b);
    expect(row).toContain(`data-kind="${items[0].kind}"`);
    expect(row).toContain('<span class="kind-tag">');
    const always = items[0].always;
    expect(row.match(/<div class="choice">/g)?.length).toBe(buttons.length + (always ? 1 : 0));
    expect(row.match(/<span class="effect">/g)?.length).toBe(buttons.length + (always ? 1 : 0));
    if (!always) { expect(row).not.toContain("act always"); return; }
    expect(row.match(/class="act always"/g)?.length).toBe(1);
    // The order of the choices: positive, positive [auto-yes], then the rest.
    expect(row.indexOf(`data-label="${items[0].actions[0].label}"`)).toBeLessThan(row.indexOf("act always"));
    expect(row.indexOf("act always")).toBeLessThan(row.indexOf(`data-label="${items[0].actions[1].label}"`));
    const keyed = reason.startsWith("proposal-") ? `${reason}:aleph` : reason;
    expect(row).toMatch(new RegExp(`class="act always" type="button" data-act="always" data-reason="${keyed}" data-action="[^"]+" data-first="${items[0].actions[0].act}" data-label="${always.label.replace(/[[\]]/g, "\\$&")}"`));
    expect(row.match(/<details class="more"/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
}

test("the Needs-you group is one list; its articles are the attention items plus the error lines", () => {
  const sm = sample("decision");
  const items = [...attend({ needs: state.needs, needsIssues: sm.needsIssues }, {}, [prop as any]).items];
  const s = { ...state, attention: items, stuck: [], factory: { ...state.factory, health: ["health: aleph main is red at abc1234: tests"] } };
  const h = r.renderJobs(s);
  const grp = h.match(/<div class="grp" id="jobs-needs">[^]*?<\/section>/)![0];
  expect(grp).toContain('<div class="list">');
  expect(grp).not.toContain('class="cards"');
  expect(grp.match(/<article /g)?.length).toBe(items.length + 1);
  const red = grp.match(/<article class="job-card small issue-row error"[^]*?<\/article>/)![0];
  expect(red).toContain('<p class="problem">Fix: aleph main is red');
  expect(red).not.toContain("always");
  expect(red).not.toContain("<button");
  expect(r.view.render(att(s))).toContain('<span class="count">4</span>');
});

test("Status has no Standing permissions section", () => {
  const s = { ...full, standing: [{ reason: "held", action: "firefighter", at: "2026-10-27T16:00:00Z", handed: 3 }] };
  expect(r.view.render(s)).not.toContain("Standing permissions");
  expect(r.view.render(s)).not.toContain('data-act="revoke"');
});

const done = (n: number) => ({ id: `aleph-${n}`, title: `Done ${n}`, href: `#/issues/aleph/${n}`, finished: "2026-10-27T16:30:00Z",
  jobs: [job({ name: `triage-aleph-${n}`, state: "done", outcome: "goal", run: { kind: "triage", started: "2026-10-27T10:00:00Z" } }),
    job({ name: `aleph-${n}`, state: "landed", commit: "50f301fabc", commitUrl: "https://github.com/o/r/commit/50f301fabc", run: { kind: "land", started: "2026-10-27T15:00:00Z" } })] });

test("Done lists the issue as head with its triage, work and land jobs and commit as links", () => {
  const h = r.renderLanes({ ...state, done: [done(5), done(4)] }).match(/<section id="lane-done"[^]*?<\/section>/)![0];
  expect(h).toContain('<h2 id="h-done">Done</h2><span class="count">2</span>');
  expect(h).toContain('<a href="#/issues/aleph/5" class="t">Done 5</a>');
  expect(h).toContain('href="#/jobs/aleph-5">land</a>');
  expect(h).toContain('href="#/jobs/triage-aleph-5">triage</a> (goal)');
  expect(h).toContain('<a href="https://github.com/o/r/commit/50f301fabc"><code>50f301f</code></a>');
  expect(h.indexOf("Done 5")).toBeLessThan(h.indexOf("Done 4"));
});

test("Incoming lists the untriaged issues only, with link, time and badge", () => {
  const inc = [1, 2].map((i) => ({ ...issue(i), created: "2026-10-27", status: "new" }));
  const h = r.renderLanes({ ...state, issues: inc, incoming: [{ ...issue(3), status: "queued" }] }).match(/<section id="lane-incoming"[^]*?<\/section>/)![0];
  expect(h).toContain(">new</span>");
  expect(h).toContain('<a href="#/issues/aleph/1" class="t">Issue 1</a>');
  expect(h).not.toContain("Issue 3");
  expect(h).toMatch(/Oct 27/);
});

test("a question attention item renders the Answer button with a text input in the same row", () => {
  const sm = sample("question");
  const items = attend({ needs: sm.needs as any, needsIssues: sm.needsIssues }, {}, sm.lessons).items;
  const h = r.renderJobs({ ...state, needs: [], stuck: [], factory: { ...state.factory, health: [] }, attention: items });
  const row = h.match(/<article class="job-card small issue-row question"[^]*?<\/article>/)![0];
  expect(row).toMatch(/data-act="answer"[^>]*data-name="aleph-27"|data-name="aleph-27"[^>]*data-act="answer"/);
  expect(row).toMatch(/<input [^>]*type="text"[^>]*name="answer"/);
});

test("efficiency cards stack at narrow widths: .meds.eff has its own media rules, since its 5-column rule outranks .meds", async () => {
  // @ts-ignore
  const { renderEffCards } = await import("./views/speed.js");
  const h = renderEffCards({ window: "week", flaky: 0, goals: { landed: 1, firstPass: 1, fixRounds: 0, week: null }, lost: { hours: 0, share: 0 } });
  expect(h).toContain('<div class="meds eff">');
  expect(h.match(/class="med/g)?.length ?? 0).toBeGreaterThan(0);
  const css = await Bun.file(new URL("./index.html", import.meta.url)).text();
  expect(css).toMatch(/@media \(max-width: 1020px\) \{ \.meds\.eff \{ grid-template-columns: repeat\(3,/);
  expect(css).toMatch(/@media \(max-width: 720px\) \{[^@]*\.meds, \.meds\.eff \{ grid-template-columns: minmax\(0, 1fr\); \}/);
});

test("Status grid: at 1600px and wider the metrics sit left and the four lanes stack in a right rail", async () => {
  const js = await Bun.file(new URL("./views/now.js", import.meta.url)).text();
  const css = await Bun.file(new URL("./index.html", import.meta.url)).text();
  expect(js.match(/class="status-grid"/g)?.length).toBe(1);
  expect(js.indexOf('class="status-grid"')).toBeLessThan(js.indexOf('class="speedrow"'));
  expect(js.indexOf('class="status-grid"')).toBeLessThan(js.indexOf("renderLanes(s)}"));
  const block = css.match(/@media \(min-width: 1600px\) \{[^\n]*\.status-grid[^\n]*\}/)![0];
  expect(block).toMatch(/\.status-grid \{[^}]*grid-template-columns: minmax\(0, 2\.2fr\) minmax\(0, 1fr\)/);
  expect(block).toMatch(/\.status-grid \{[^}]*gap: 40px/);
  expect(block).toMatch(/\.status-grid \{[^}]*align-items: start/);
  expect(block).toMatch(/\.lanes \{[^}]*grid-template-columns: minmax\(0, 1fr\)/);
  expect(block).toMatch(/\.speedrow \{[^}]*gap: 28px/);
  expect(css).not.toContain(".speedrow { display: grid; grid-template-columns: repeat(2");
});

test("Queued cards show why each goal waits", () => {
  const w = (id: number, why: string, kind: string, more: any = {}) => ({ repo: "aleph", id, title: `t${id}`, why, kind, ...more });
  const lanes = r.renderLanes({ ...state, waiting: [
    w(1, "Waits on aleph-630", "waits_on", { waits: [{ id: "aleph-630", href: "#/issues/aleph/630", state: "building" }] }),
    w(2, "Waits for you: pick one", "needs-chris", { ask: { href: "#/issues/aleph/2" } }),
    w(3, "Starts at the next dispatch", "ready"),
    w(4, "Waiting for a slot (12 of 12 running)", "gate"),
  ] });
  const q = lanes.match(/<section id="lane-queued"[^]*?<\/section>/)![0];
  expect(q).toContain('Waits on <a href="#/issues/aleph/630">aleph-630</a> <span class="badge quiet">building</span>');
  expect(q).toContain('<a href="#/issues/aleph/2">Waits for you: pick one</a>');
  expect(q).toContain("Starts at the next dispatch");
  expect(q).toContain("Waiting for a slot (12 of 12 running)");
  expect(q.match(/Waiting for a slot/g)?.length).toBe(1);
  expect(q).toContain('href="#/issues/aleph/1"');
  expect(r.renderLanes({ ...state, waiting: [{ repo: "aleph", id: 5, title: "x" }] })).toContain(">Queued</div>");
});

test("the status sentence wraps instead of clipping: .lede .say has no ellipsis or hidden overflow, and wraps", async () => {
  const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
  const say = [...html.matchAll(/\.lede \.say[^{}]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  expect(say).not.toContain("text-overflow: ellipsis");
  expect(say).not.toContain("overflow: hidden");
  expect(say).toContain("white-space: normal");
});

test("at 720px and below Pause sorts after the picker, so the screen order matches the tab order", () => {
  const html = require("node:fs").readFileSync(new URL("./index.html", import.meta.url), "utf8") as string;
  const rules = [...html.matchAll(/@media \(max-width: 720px\) \{([^]*?)\n\}/g)].map((m) => m[1]).join("\n");
  const order = (sel: string) => Number(rules.match(new RegExp(`\\.lede \\.${sel}\\s*\\{[^}]*?\\border:\\s*(\\d+)`))?.[1] ?? 0);
  expect(order("wpick")).toBeGreaterThan(0);
  expect(order("act")).toBeGreaterThan(order("wpick"));
});
