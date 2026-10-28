import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as r from "./views/now.js";
// @ts-ignore
import { actMessages, openDiffs } from "./lib.js";

const job = (o: object) => ({ repo: "aleph", item: null, state: "running", started: "2026-10-27T16:00:00Z", defaults: [], followups: [], ...o });
const state: any = {
  now: "2026-10-27T17:00:00Z",
  factory: { paused: false, dayCap: 12, runsToday: 5, costToday: 0.25, nextTick: "2026-10-27T17:12:00Z", probe: { at: "2026-10-27T14:35:00Z", ok: true, failed: [] }, health: ["judge is down"] },
  needs: [job({ name: "aleph-27", state: "needs-you", reason: "Held path: hooks/lib/digest.ts", stat: " a.ts | 2 +-", defaults: ["Haiku tier per request"], item: { id: 27, title: "Digest head and tail" } })],
  stuck: [job({ name: "aleph-30", state: "stuck", reason: "types failed" })],
  running: [job({ name: "aleph-36", phase: "worker", item: { id: 36, title: "Route tiers" } })],
  delivered: [job({ name: "aleph-28", state: "landed", ended: "2026-10-27T16:30:00Z", commit: "50f301fabc", commitUrl: "https://github.com/o/r/commit/50f301fabc" })],
  waiting: [],
};

test("needs shows name, reason and defaults, and no copy commands", () => {
  const h = withAttn(state);
  for (const t of ["aleph-27", "Held path: hooks/lib/digest.ts", "Haiku tier per request", "a.ts | 2 +-"]) expect(h).toContain(t);
  expect(h).not.toContain("data-cmd=");
});

test("stuck, running and delivered show their jobs", () => {
  expect(withAttn(state)).toContain("types failed");
  expect(withAttn(state)).toContain("aleph-30");
  expect(withAttn(state)).toContain("aleph-36");
  expect(withAttn(state)).toContain("worker");
});

test("a commitUrl becomes a link", () => {
  expect(r.renderLands(state)).toContain('<a href="https://github.com/o/r/commit/50f301fabc"><code>50f301f</code></a>');
  const none = r.renderLands({ ...state, delivered: [{ ...state.delivered[0], commitUrl: undefined }] });
  expect(none).not.toContain("<a ");
});

test("an empty section shows its empty state", () => {
  expect(r.renderJobs({ ...state, needs: [], stuck: [], running: [] })).toContain("No job is open and no goal waits.");
  expect(r.renderIssues({ ...state, needs: [], stuck: [], issues: [], factory: { ...state.factory, health: [] } })).toContain("No issue is open that needs a look.");
  expect(r.renderTriage({ ...state, triage: [] })).toContain("No issue has been triaged yet.");
  expect(r.renderLands({ ...state, delivered: [] })).toContain("Nothing has landed yet.");
  // One line only, with no hint under it.
  expect(r.renderJobs({ ...state, needs: [], stuck: [], running: [] }).match(/<p/g)?.length).toBe(1);
});

const issue = (n: number) => ({ id: `aleph-${n}`, title: `Issue ${n}`, status: "open", href: `#/issues/aleph/${n}`, labels: [], notes: 0, created: "2026-10-27", updated: "2026-10-27" });
const triage = (n: number, o: object = {}) => job({ name: `triage-aleph-${n}`, state: "done", outcome: "goal", ended: "2026-10-27T16:05:00Z", item: { id: n, title: `Issue ${n}` }, ...o });
const full: any = { ...state, issues: [issue(1), issue(2)], triage: [triage(3, { state: "running", outcome: undefined, ended: undefined }), triage(4), triage(5, { outcome: "closed" })], waiting: [{ repo: "aleph", id: 9, title: "w" }] };
const withAttn = (s: any) => r.renderIssues(s) + r.renderJobs(s);
const section = (h: string, id: string) => h.match(new RegExp(`<section id="${id}"[^]*?</section>`))![0];

test("the page order is metric cards, status line and time, Issues, Lands beside Jobs, Triage; no other section", () => {
  const page = r.view.render(full);
  expect([...page.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1])).toEqual(["issues", "lands", "jobs", "triage"]);
  const at = (t: string) => page.indexOf(t);
  const order = ['class="metrics"', 'class="lede"', 'class="asof"', 'id="issues"', 'class="cols"', 'id="lands"', 'id="jobs"', 'id="triage"'];
  expect(order.map(at)).toEqual([...order.map(at)].sort((a, b) => a - b));
  expect(order.every((t) => at(t) >= 0)).toBe(true);
  // Lands and Jobs share the two-column block; Triage is below it.
  const cols = page.match(/<div class="cols">[^]*?<section id="triage"/)![0];
  expect(cols).toContain('id="lands"');
  expect(cols).toContain('id="jobs"');
  for (const id of ["attention", "run", "needs", "del", "wait", "running", "waiting", "delivered"]) expect(page).not.toContain(`<section id="${id}"`);
  for (const t of ["Next tick", "Cost today", "Runs today", 'id="ticks"', 'class="strip"', 'id="stuck"', 'class="banner"']) expect(page).not.toContain(t);
});

test("the metric cards are Issues, Lands, Running, Waiting, Landed and Triaged; Issues counts every open issue", () => {
  const velocity = { landed: { day: 12, avg: 9 }, triaged: { day: 4, avg: 2.5 } };
  const s = { ...full, velocity, openIssues: 37 };
  const h = r.renderMetrics(s);
  expect([...h.matchAll(/<span class="k">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(["Issues", "Lands", "Running", "Waiting", "Landed", "Triaged"]);
  for (const k of ["Needs you", "Stuck or failed", ">Triage<"]) expect(h).not.toContain(k);
  // 37 open issues, though the state lists 2 new ones.
  expect(h).toContain('href="#issues"><span class="k">Issues</span><span class="v">37</span>');
  const delivered = [job({ name: "land-1", state: "running" }), ...state.delivered];
  expect(r.renderMetrics({ ...s, delivered })).toContain('href="#lands"><span class="k">Lands</span><span class="v">2</span>');
  for (const [k, n] of [["Running", 1], ["Waiting", 1]] as const) expect(h).toContain(`<span class="k">${k}</span><span class="v">${n}</span>`);
  expect(h).toContain('<span class="sub">12 · 9/day</span>');
  expect(h).toContain('<span class="sub">4 · 2.5/day</span>');
  expect(r.view.render(s).indexOf('class="metrics"')).toBeLessThan(r.view.render(s).indexOf('class="lede"'));
});

test("Issues lists the rows that need Chris, then the new issues; Triage shows each run with its outcome; every section header has a count", () => {
  const i = r.renderIssues(full);
  // 1 held, 1 stuck, 1 error (judge is down), 2 new issues.
  expect(i).toContain('<h2 id="h-issues">Issues</h2><span class="count">5</span>');
  expect(i.indexOf("aleph-27")).toBeLessThan(i.indexOf("Issue 1"));
  expect(i).toContain("Issue 1");
  expect(i).not.toContain("job-card");
  const t = r.renderTriage(full);
  expect(t).toContain('<span class="count">3</span>');
  expect(t).toContain(">Triaging<");
  expect(t).toContain(">Goal<");
  expect(t).toContain(">Closed<");
  expect(r.renderTriage({ ...full, triage: [triage(6, { outcome: "needs-chris" })] })).toContain(">Needs Chris<");
  for (const h of [i, t, r.renderLands(full), r.renderJobs(full)]) expect(h).toMatch(/^<div class="sh"><h2 id="h-[a-z]+">[A-Za-z]+<\/h2><span class="count">\d+<\/span><\/div>/);
});

test("Jobs groups running, then waiting; every job card is compact; held and stuck runs are not in it", () => {
  const h = r.renderJobs(full);
  const at = (id: string) => h.indexOf(`id="jobs-${id}"`);
  expect(at("running")).toBeGreaterThan(-1);
  expect(at("running")).toBeLessThan(at("waiting"));
  expect(h).not.toContain("Needs you");
  expect(h).not.toContain("Stuck or failed");
  expect(h).toContain('<span class="count">2</span>');
  expect(h).not.toContain("job-card big");
  expect(h.match(/class="job-card small[ "]/g)?.length).toBe(2);
  expect(r.renderJobs({ ...full, waiting: [] })).not.toContain('id="jobs-waiting"');
});

const rows = (h: string) => h.split('<article class="issue-row ').slice(1);
const verb = (row: string) => row.match(/<span class="verb">([^<]*)<\/span>/)![1];

test("a held run, a stuck run, a needs-chris issue and a red main are one Issues row each, with a verb phrase, id, title and buttons", () => {
  const needsIssues = [{ ...issue(7), labels: ["needs-chris"], title: "Which tier?", question: "Haiku or Sonnet for the digest?" }];
  const s = { ...full, needs: [{ ...state.needs[0], review2: { verdict: "chris", reason: "touches hooks" } }], stuck: [job({ name: "aleph-30", state: "stuck", reason: "no commit", item: { id: 30, title: "Fix it" } })], needsIssues, issues: [], factory: { ...full.factory, health: ["health: aleph main is red at abc1234: tests"], hold: "Held: aleph-30 is stuck (no commit). No run starts or lands until it is cleared." } };
  const page = r.view.render(s);
  const top = section(page, "issues");
  const rs = rows(top);
  expect(rs.length).toBe(4);
  expect(rs.map((x) => x.match(/^(\w+)/)![1])).toEqual(["held", "stuck", "decide", "error"]);
  expect(verb(rs[0])).toStartWith("Review, then land or drop: ");
  expect(verb(rs[0])).toContain("the reviewer left it to you: touches hooks");
  expect(verb(rs[1])).toBe("Clear: stuck with no commit");
  expect(verb(rs[2])).toBe("Decide: Haiku or Sonnet for the digest?");
  expect(verb(rs[3])).toBe("Fix: aleph main is red at abc1234: tests");
  // The verb phrase comes first, then the id and title, then the buttons.
  for (const [row, id, title, btns] of [[rs[0], "aleph-27", "Digest head and tail", ["land", "drop"]], [rs[1], "aleph-30", "Fix it", ["recheck", "drop"]], [rs[2], "aleph-7", "Which tier?", []]] as const) {
    expect(row.indexOf("verb")).toBeLessThan(row.indexOf(id));
    expect(row.indexOf(id)).toBeLessThan(row.indexOf(title));
    expect(row.indexOf(title)).toBeLessThan(row.indexOf('class="actions"'));
    for (const b of btns) expect(row).toContain(`data-act="${b}"`);
  }
  // Diff and Details sit behind the row; a needs-chris issue links to the issue.
  expect(rs[0]).toMatch(/<details class="more"[^]*data-act="diff"/);
  expect(rs[2]).toContain('href="#/issues/aleph/7"');
  // Internal noise stays out, a red main shows once, and the hold of a stuck run that has its row adds none.
  for (const t of ["No agent working", "Agent working", "Review running"]) expect(top).not.toContain(t);
  expect(top.match(/main is red/g)?.length).toBe(1);
  expect(top).not.toContain("Held: aleph-30");
  expect(top).not.toContain("Decide the thing");
  expect(section(page, "jobs")).not.toContain("aleph-27");
  expect(section(page, "jobs")).toContain("aleph-36");
  // A needs-chris issue is not run together: its parts are separate elements.
  expect(rs[2]).toContain('<span class="id">aleph-7</span> <span class="t">Which tier?</span>');
});

test("a held run says why: no verdict, a verdict with its reason, a failed review; a running review is left out", () => {
  const why = (review2: any) => verb(rows(r.renderIssues({ ...state, stuck: [], factory: { ...state.factory, health: [] }, needs: [{ ...state.needs[0], reason: undefined, review2 }] }))[0]);
  expect(why(undefined)).toBe("Review, then land or drop: the reviewer gave no verdict");
  expect(why({ verdict: "back", reason: "lost an assertion" })).toBe("Review, then land or drop: the reviewer sent it back: lost an assertion");
  expect(why({ verdict: "error" })).toBe("Review, then land or drop: the review failed");
  expect(why({ verdict: "pending" })).not.toContain("running");
});

test("new issues are rows of the same kind, after the rows that need Chris", () => {
  const i = r.renderIssues({ ...full, needs: [], stuck: [], factory: { ...full.factory, health: [] } });
  expect(rows(i).length).toBe(2);
  expect(rows(i).every((x) => x.startsWith("new"))).toBe(true);
});

test("with nothing at all the Issues section says so; the page still has it", () => {
  const calm = { ...full, needs: [], stuck: [], issues: [], needsIssues: [], factory: { ...full.factory, health: [] } };
  expect(r.renderIssues(calm)).toContain("No issue is open that needs a look.");
  expect(r.view.render(calm)).toContain('id="issues"');
});

test("Issues holds the held runs before the stuck and failed ones, and none says whether an agent works", () => {
  const s = { ...state, running: [], stuck: [job({ name: "aleph-30", state: "failed", agent: true }), job({ name: "aleph-31", state: "stuck" })], needs: [{ ...state.needs[0], agent: false }] };
  const h = withAttn(s);
  expect(h).toContain(">Issues</h2>");
  expect(h.indexOf("aleph-27")).toBeLessThan(h.indexOf("aleph-30"));
  expect(h.indexOf("aleph-30")).toBeLessThan(h.indexOf("aleph-31"));
  expect(h).toContain("Clear: failed");
  expect(h).not.toContain("Agent working");
  expect(h).not.toContain("aleph drop");
  expect(h).not.toContain("data-cmd");
});

test("text from the state is escaped", () => {
  const bad = { ...state, needs: [job({ name: "x", state: "needs-you", item: { id: 1, title: "<script>alert(1)</script>" } })], waiting: [{ repo: "a", id: 1, title: "<script>w</script>" }] };
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
  expect(r.renderLands(open)).toContain('data-act="checked" data-name="aleph-28"');
  expect(r.renderLands(state)).not.toContain("data-act=");
  expect(r.renderLands(state)).not.toContain("data-cmd=");
});

test("a land from another day shows its date", () => {
  const old = { ...state, delivered: [{ ...state.delivered[0], ended: "2026-10-25T16:30:00Z" }] };
  expect(r.renderLands(old)).toMatch(/<dt>Landed<\/dt><dd>25 Oct \d\d:\d\d<\/dd>/);
  expect(r.renderLands(state)).toMatch(/<dt>Landed<\/dt><dd>\d\d:\d\d<\/dd>/);
});

const withFactory = (o: object) => ({ ...state, factory: { ...state.factory, health: [], ...o } });

test("a stuck job shows its reason, the failed check and its seconds, and Re-check and Drop buttons", () => {
  const h = withAttn({ ...state, needs: [], stuck: [job({ name: "aleph-30", state: "stuck", reason: "types failed", checks: [{ name: "lint", ok: true, seconds: 3 }, { name: "tsc", ok: false, seconds: 41 }] })] });
  for (const t of ["types failed", "tsc", "41 s", 'data-act="recheck" data-name="aleph-30"', 'data-act="drop" data-name="aleph-30"']) expect(h).toContain(t);
  expect(h).not.toContain("data-cmd");
});

test("many needs-you jobs all render as rows, each with its details folded and its buttons", () => {
  const needs = [1, 2, 3, 4].map((i) => job({ name: `aleph-${i}`, state: "needs-you", reason: "Held path", item: { id: i, title: `t${i}` } }));
  const h = withAttn({ ...state, needs });
  expect(h.match(/class="issue-row held"/g)?.length).toBe(4);
  expect(h.match(/<details class="more" data-keep="more:[^"]*">/g)?.length).toBe(4 + 1);
  for (const i of [1, 2, 3, 4]) expect(h).toContain(`data-act="land" data-name="aleph-${i}"`);
});

test("the lede leads with a count and the items, colored; the page has no banner", () => {
  const h = r.renderLede(withFactory({}));
  expect(h).toContain("Two things need your attention.");
  expect(h).toContain("1 job needs you");
  expect(h).toContain("1 job is stuck or failed");
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
  expect(r.renderLede({ ...calm, factory: { ...calm.factory, paused: true } })).toMatch(/say warning">One thing needs your attention\. The factory is paused/);
  expect(r.renderLede({ ...calm, factory: { ...calm.factory, paused: true, runsToday: 12 } })).toContain("Two things need your attention");
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
  expect(r.renderIssues(calm)).not.toContain("rerun");
});

test("the as-of line is h:mm with am or pm", () => {
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
  expect(h).toContain("5 min ago");
  expect(h).not.toContain("past the time box");
});

test("a worker run older than 40 minutes is past the time box", () => {
  const h = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T15:00:00Z", run: { kind: "agent", started: "2026-10-27T16:00:00Z" } })] });
  expect(h).toContain("past the time box");
  expect(h).toContain("worker");
});

test("a 30-file stat shows 12 lines and +18 more files", () => {
  const stat = Array.from({ length: 30 }, (_, i) => ` f${i}.ts | 2 +-`).join("\n") + "\n 30 files changed, 30 insertions(+), 30 deletions(-)";
  const h = withAttn({ ...state, needs: [job({ name: "x", state: "needs-you", stat })] });
  expect(h.match(/ f\d+\.ts \| 2/g)?.length).toBe(12);
  expect(h).toContain("+18 more files");
});

test("a job with checks shows them as facts; one without shows none", () => {
  const checks = [{ name: "tests", ok: true, seconds: 71 }, { name: "types", ok: false, seconds: 9 }];
  const both = "<div><dt>Tests</dt><dd>71 s ✓</dd></div><div><dt>Types</dt><dd>9 s ✗</dd></div></dl>";
  expect(withAttn({ ...state, needs: [{ ...state.needs[0], checks }] })).toContain(both);
  expect(r.renderLands({ ...state, delivered: [{ ...state.delivered[0], checks }] })).toContain(both);
  expect(withAttn(state)).not.toContain(" s ✓");
  expect(r.renderLands(state)).not.toContain("checks");
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
  expect(page.indexOf('data-act="pause"')).toBeLessThan(page.indexOf('id="issues"'));
});

test("trailers show on one line joined by ' · ', escaped, and only when there are some", () => {
  const trailers = [{ key: "Item", value: "aleph-27" }, { key: "Job", value: "<script>x</script>" }, { key: "Held-by", value: "Chris" }];
  const needs = { ...state, needs: [job({ name: "aleph-27", state: "needs-you", trailers })] };
  const del = { ...state, delivered: [job({ name: "aleph-28", state: "landed", trailers })] };
  for (const h of [withAttn(needs), r.renderLands(del)]) {
    expect(h).toContain("Item aleph-27 · Job &lt;script&gt;x&lt;/script&gt; · Held-by Chris");
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("pre.trailers");
    expect(h).not.toContain('<pre class="trailers"');
  }
  const bare = { ...state, needs: [job({ name: "aleph-27", state: "needs-you" })] };
  expect(withAttn(bare)).not.toContain("trailers");
  expect(r.renderLands(state)).not.toContain("trailers");
});

test("Lands lists a running land before landed ones, has no origin/main aside, and counts its cards", () => {
  const lands = { ...state, delivered: [job({ name: "land-1", state: "running" }), ...state.delivered] };
  const h = r.renderLands(lands);
  expect(h).toContain(">Lands</h2>");
  expect(h).toContain('<span class="count">2</span>');
  expect(h).not.toContain("origin/main");
  expect(h.indexOf("land-1")).toBeLessThan(h.indexOf("aleph-28"));
  expect(h).toMatch(/class="job-card big[ "]/);
});

const two: any = { ...state, needs: [job({ name: "job-a", state: "needs-you", defaults: [] }), job({ name: "job-b", state: "needs-you", defaults: [] })] };
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

test("a held row shows the review2 verdict and its reason in its verb phrase", () => {
  const withReview = (review2: object) => ({ ...state, needs: [{ ...state.needs[0], review2 }] });
  const h = withAttn(withReview({ verdict: "back", reason: "a test lost <an> assertion" }));
  expect(h).toContain("the reviewer sent it back: a test lost &lt;an&gt; assertion");
  expect(h.indexOf("sent it back")).toBeLessThan(h.indexOf('data-act="land"'));
  expect(withAttn(withReview({ verdict: "land" }))).toContain("the reviewer says land");
  expect(withAttn(state)).toContain("the reviewer gave no verdict");
});
