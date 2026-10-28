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
  expect(none).not.toContain("commit/");
});

test("an empty section shows its empty state", () => {
  expect(r.renderJobs({ ...state, needs: [], stuck: [], running: [] })).toContain("Nothing queued.");
  expect(r.renderIssues({ ...state, needs: [], stuck: [], issues: [], factory: { ...state.factory, health: [] } })).toContain("No issues.");
  expect(r.renderLands({ ...state, delivered: [] })).toContain("Nothing has landed yet.");
  // One line only, with no hint under it.
  expect(r.renderJobs({ ...state, needs: [], stuck: [], running: [] }).match(/<p/g)?.length).toBe(1);
  expect(r.renderJobs({ ...state, running: [] })).not.toContain('id="jobs-running"');
});

const issue = (n: number) => ({ id: `aleph-${n}`, title: `Issue ${n}`, status: "open", href: `#/issues/aleph/${n}`, labels: [], notes: 0, created: "2026-10-27", updated: "2026-10-27" });
const full: any = { ...state, issues: [issue(1), issue(2)], waiting: [{ repo: "aleph", id: 9, title: "w" }] };
const withAttn = (s: any) => r.renderIssues(s) + r.renderJobs(s);
const section = (h: string, id: string) => h.match(new RegExp(`<section id="${id}"[^]*?</section>`))![0];

test("the page order is metric cards, status line and time, Issues, Lands beside Jobs; no other section", () => {
  const page = r.view.render(full);
  expect([...page.matchAll(/<section id="([^"]+)"/g)].map((m) => m[1])).toEqual(["issues", "lands", "jobs"]);
  const at = (t: string) => page.indexOf(t);
  const order = ['class="metrics"', 'class="lede"', 'class="asof"', 'id="issues"', 'class="cols"', 'id="lands"', 'id="jobs"'];
  expect(order.map(at)).toEqual([...order.map(at)].sort((a, b) => a - b));
  expect(order.every((t) => at(t) >= 0)).toBe(true);
  expect(page).not.toContain("Triage");
  for (const id of ["attention", "run", "needs", "del", "wait", "running", "waiting", "delivered", "triage"]) expect(page).not.toContain(`<section id="${id}"`);
  for (const t of ["Next tick", "Cost today", "Runs today", 'id="ticks"', 'class="strip"', 'id="stuck"', 'class="banner"']) expect(page).not.toContain(t);
});

test("the metric cards are Issues, Lands, Running / cap, Queued and Untriaged", () => {
  const s = { ...full, openIssues: 37, landing: 1, newIssues: 6, factory: { ...full.factory, liveCap: 12 } };
  const h = r.renderMetrics(s);
  expect([...h.matchAll(/<span class="k">([^<]+)<\/span>/g)].map((m) => m[1])).toEqual(["Issues", "Lands", "Running", "Queued", "Untriaged"]);
  for (const k of ["Needs you", "Stuck or failed", "Triage", "Landed", "Waiting"]) expect(h).not.toContain(k);
  // 37 open issues, though the state lists 2 new ones.
  expect(h).toContain('class="metric" href="#issues"><span class="k">Issues</span><span class="v">37</span>');
  // Lands counts the lands going on now, not the delivered list.
  expect(h).toContain('<a class="metric done" href="#lands"><span class="k">Lands</span><span class="v">1</span>');
  expect(h).toContain('<a class="metric run" href="#jobs"><span class="k">Running</span><span class="v">1 <span class="of">/ 12</span></span>');
  expect(h).toContain('<span class="k">Queued</span><span class="v">1</span>');
  expect(h).toContain('<span class="k">Untriaged</span><span class="v">6</span>');
  // Untriaged is ink, never --need.
  expect(h).toContain('<a class="metric" href="#issues"><span class="k">Untriaged</span>');
  expect(r.view.render(s).indexOf('class="metrics"')).toBeLessThan(r.view.render(s).indexOf('class="lede"'));
});

test("Issues lists the rows that need Chris and no new issues; every section header has a count", () => {
  const i = r.renderIssues(full);
  // 1 held, 1 stuck, 1 error (judge is down); the 2 new issues wait for triage and are not rows.
  expect(i).toContain('<h2 id="h-issues">Issues</h2><span class="count">3</span>');
  expect(i).toContain("aleph-27");
  expect(i).not.toContain("Issue 1");
  expect(i).not.toContain("job-card");
  for (const h of [i, r.renderLands(full), r.renderJobs(full)]) expect(h).toMatch(/^<div class="sh"><h2 id="h-[a-z]+">[A-Za-z]+<\/h2><span class="count">\d+<\/span><\/div>/);
});

test("Jobs groups running, then queued; every job card is compact; held and stuck runs are not in it", () => {
  const h = r.renderJobs(full);
  const at = (id: string) => h.indexOf(`id="jobs-${id}"`);
  expect(at("running")).toBeGreaterThan(-1);
  expect(at("running")).toBeLessThan(at("queued"));
  expect(h).not.toContain("Needs you");
  expect(h).not.toContain("Stuck or failed");
  expect(h).toContain('<span class="count">2</span>');
  expect(h).toContain(">Queued<");
  expect(h).not.toContain("Waiting");
  expect(h).not.toContain("job-card big");
  expect(h.match(/class="job-card small[ "]/g)?.length).toBe(2);
  const none = r.renderJobs({ ...full, waiting: [] });
  expect(none).toContain('id="jobs-queued"');
  expect(none).toContain("Nothing queued.");
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
  expect(verb(rs[0])).toBe("Review the run, then land or drop it."); // the reason is only a path
  expect(rs[0]).toContain("Reviewer: the reviewer left it to you: touches hooks");
  expect(verb(rs[1])).toBe("Stuck with no commit.");
  expect(verb(rs[2])).toBe("Haiku or Sonnet for the digest?");
  expect(verb(rs[3])).toBe("Fix: aleph main is red at abc1234: tests");
  // The id comes first, then the title and the one sentence, then the buttons.
  for (const [row, id, title, btns] of [[rs[0], "aleph-27", "Digest head and tail", ["land", "drop"]], [rs[1], "aleph-30", "Fix it", ["recheck", "drop"]], [rs[2], "aleph-7", "Which tier?", []]] as const) {
    expect(row.indexOf(id)).toBeLessThan(row.indexOf(title));
    expect(row.indexOf(title)).toBeLessThan(row.indexOf("verb"));
    expect(row.indexOf("verb")).toBeLessThan(row.indexOf('class="actions"'));
    expect(row.match(/<details/g)?.length ?? 0).toBeLessThanOrEqual(1);
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
  expect(rs[2]).toContain('<a class="idl" href="#/issues/aleph/7">aleph-7</a> <span class="t">Which tier?</span> <span class="verb">');
});

test("a held run says why: no verdict, a verdict with its reason, a failed review; a running review is left out", () => {
  const why = (review2: any) => rows(r.renderIssues({ ...state, stuck: [], factory: { ...state.factory, health: [] }, needs: [{ ...state.needs[0], reason: undefined, review2 }] }))[0];
  expect(why(undefined)).toContain("Reviewer: the reviewer gave no verdict");
  expect(why({ verdict: "back", reason: "lost an assertion" })).toContain("Reviewer: the reviewer sent it back: lost an assertion");
  expect(why({ verdict: "error" })).toContain("Reviewer: the review failed");
  expect(why({ verdict: "pending" })).not.toContain("Reviewer:");
  // The row's one sentence is the hold reason, with no file paths or line numbers.
  const held = (reason: string) => verb(rows(r.renderIssues({ ...state, stuck: [], factory: { ...state.factory, health: [] }, needs: [{ ...state.needs[0], reason }] }))[0]);
  expect(held("Touches `hooks/lib/digest.ts:12-30` and the `digest` tier. More words.")).toBe("Touches and the digest tier.");
  expect(held("Review ui/now.js line 40 before landing.")).toBe("Review before landing.");
});

test("issues that wait for triage are not rows and not in the status line: triage is the factory's", () => {
  const s = { ...full, needs: [], stuck: [], needsIssues: [], factory: { ...full.factory, health: [], hold: undefined, paused: false } };
  expect(rows(r.renderIssues(s)).length).toBe(0);
  expect(r.renderIssues(s)).toContain("No issues.");
  expect(r.renderLede(s)).not.toContain("attention");
  expect(r.renderLede(s)).not.toContain("triage");
});

test("with nothing at all the Issues section says so; the page still has it", () => {
  const calm = { ...full, needs: [], stuck: [], issues: [], needsIssues: [], factory: { ...full.factory, health: [] } };
  expect(r.renderIssues(calm)).toContain("No issues.");
  expect(r.view.render(calm)).toContain('id="issues"');
});

test("Issues holds the held runs before the stuck and failed ones, and none says whether an agent works", () => {
  const s = { ...state, running: [], stuck: [job({ name: "aleph-30", state: "failed", agent: true }), job({ name: "aleph-31", state: "stuck" })], needs: [{ ...state.needs[0], agent: false }] };
  const h = withAttn(s);
  expect(h).toContain(">Issues</h2>");
  expect(h.indexOf("aleph-27")).toBeLessThan(h.indexOf("aleph-30"));
  expect(h.indexOf("aleph-30")).toBeLessThan(h.indexOf("aleph-31"));
  expect(h).toContain('<span class="verb">Failed.</span>');
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
  expect(r.renderLands(old)).toMatch(/<dt>Landed<\/dt><dd>Oct 25 \d\d:\d\d<\/dd>/);
  expect(r.renderLands(state)).toMatch(/<dt>Landed<\/dt><dd>Oct 27 \d\d:\d\d<\/dd>/);
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

test("the as-of line reads like every Status time: Oct 28 09:17", () => {
  expect(r.renderAsOf({ now: new Date(2026, 9, 28, 9, 17).toISOString() })).toBe("Oct 28 09:17");
  expect(r.renderAsOf({ now: new Date(2026, 9, 28, 21, 5).toISOString() })).toBe("Oct 28 21:05");
  expect(r.renderAsOf(state)).toMatch(/^[A-Z][a-z]{2} \d{2} \d{2}:\d{2}$/);
});

test("a running job past 40 minutes says so", () => {
  const late = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:19:00Z", run: { kind: "agent", started: "2026-10-27T16:19:00Z" } })] });
  expect(late).toContain("past the time box");
  expect(withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:30:00Z", run: { kind: "agent", started: "2026-10-27T16:30:00Z" } })] })).not.toContain("past the time box");
});

test("a land run is measured from its own start and never past the time box", () => {
  const h = withAttn({ ...state, now: "2026-10-27T16:55:00Z", running: [job({ name: "a", started: "2026-10-27T16:00:00Z", run: { kind: "land", started: "2026-10-27T16:50:00Z" } })] });
  expect(h).toContain("land");
  expect(h).toMatch(/Started [A-Z][a-z]{2} \d\d \d\d:\d\d \u00b7 <span class="elapsed" data-since="2026-10-27T16:50:00Z">5:00<\/span> elapsed/);
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
  const land = r.renderLands({ ...state, delivered: [{ ...state.delivered[0], checks }] });
  expect(land).not.toContain("<dt>Tests</dt>");
  expect(land).not.toContain("<dt>Types</dt>");
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
    expect(h).toContain("aleph-27 · Job &lt;script&gt;x&lt;/script&gt; · Held-by Chris");
    expect(h).not.toContain("Item aleph-27");
    expect(h).not.toContain("<script>");
    expect(h).not.toContain("pre.trailers");
    expect(h).not.toContain('<pre class="trailers"');
  }
  const bare = { ...state, needs: [job({ name: "aleph-27", state: "needs-you" })] };
  expect(withAttn(bare)).not.toContain("trailers");
  expect(r.renderLands(state)).not.toContain("trailers");
});

test("the Job trailer is parsed into run kind and start, linked to the job page with the raw id in the title", () => {
  const id = "20261028-042822-aleph-aleph-240-agent";
  const del = { ...state, delivered: [job({ name: "aleph-240", state: "landed", trailers: [{ key: "Item", value: "aleph-240" }, { key: "Job", value: id }] })] };
  const h = r.renderLands(del);
  expect(h).toContain(`<p class="trailers-line">aleph-240 \u00b7 <a href="#/jobs/aleph-240" title="${id}">agent run, Oct 28 04:28</a></p>`);
  expect(h.replace(/title="[^"]*"/, "")).not.toContain(id);
  expect(r.renderLands({ ...del, delivered: [{ ...del.delivered[0], trailers: [{ key: "Job", value: id.replace("agent", "land").replace("042822", "134500") }] }] })).toContain(">land, Oct 28 13:45<");
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
  expect(h.indexOf("sent it back")).toBeGreaterThan(h.indexOf("<details"));
  expect(withAttn(withReview({ verdict: "land" }))).toContain("the reviewer says land");
  expect(withAttn(state)).toContain("the reviewer gave no verdict");
});

test("a needs-chris issue with fields shows the question, the options, the recommended mark, the context and the buttons in the row", () => {
  const decision = { question: "Haiku or Sonnet for the `digest`?", options: [{ label: "Haiku", line: "Cheaper, `fast`" }, { label: "Sonnet", line: "Better summaries" }], recommended: "Sonnet", why: ["Digests run daily", "Quality matters more"] };
  const s = { ...state, needs: [], stuck: [], issues: [], factory: { ...state.factory, health: [] }, needsIssues: [{ ...issue(152), labels: ["needs-chris"], title: "Which tier?", question: "prose", decision }] };
  const [row] = rows(r.renderIssues(s));
  expect(row).toContain('<p class="dq">Haiku or Sonnet for the <code>digest</code>?</p>');
  expect(row).toContain("<code>fast</code>");
  expect(row).toMatch(/<li class="rec"><b>Sonnet<\/b> <span class="badge run">Recommended<\/span>/);
  expect(row).toContain("Digests run daily");
  // The row says the question in one sentence; the options and context are in the one Details.
  expect(row).toContain('<span class="verb">Haiku or Sonnet for the digest?</span>');
  expect(row.match(/<details/g)?.length).toBe(1);
  expect(row.indexOf("<details")).toBeLessThan(row.indexOf('<p class="dq">'));
  expect(row).toContain('href="#/issues/aleph/152"');
  const buttons = [...row.matchAll(/<button class="act( primary)?"[^>]*data-act="(\w+)"[^>]*data-label="([^"]*)"/g)].map((m) => [m[2], m[3], !!m[1]]);
  expect(buttons).toEqual([["decide", "Approve Sonnet", true], ["decide", "Approve Haiku", false], ["deny", "Deny", false]]);
  expect(row).toContain('data-option="Sonnet"');
  expect(row).toContain('class="reason"');
});

test("an old prose needs-chris note is readable: paragraphs, code, the recommendation picked out, Approve recommendation and Deny", () => {
  const note = "2026-10-28 04:00: triage: for Chris: Should `ui/x.ts` use A or B?\nA is simpler. My recommendation is A, because it is simpler. Then more words.";
  const s = { ...state, needs: [], stuck: [], issues: [], factory: { ...state.factory, health: [] }, needsIssues: [{ ...issue(152), labels: ["needs-chris"], title: "Which?", question: note }] };
  const [row] = rows(r.renderIssues(s));
  expect(row).toContain("<code>ui/x.ts</code>");
  expect(row).not.toContain("triage: for Chris");
  expect(row).toContain('<p class="dp rec">My recommendation is A, because it is simpler.</p>');
  expect(row).toContain('data-label="Approve recommendation"');
  expect(row).toContain('data-recommendation="1"');
  expect(row).toContain('data-label="Deny"');
  expect(row).toContain('<span class="verb">Should use A or B?</span>');
  expect(row.match(/<details/g)?.length).toBe(1);
});

test("the status line is not 'All is well.' when the Issues section has an item", () => {
  const calm = { ...state, needs: [], stuck: [], issues: [], needsIssues: [], factory: { ...state.factory, health: [], hold: undefined, paused: false } };
  for (const o of [{ needsIssues: [{ ...issue(7), labels: ["needs-chris"], question: "q" }] }]) {
    const h = r.renderLede({ ...calm, ...o });
    for (const v of r.FINE) expect(h).not.toContain(v);
    expect(h).toContain("One thing needs your attention.");
  }
});

test("Status times use the state's own now for the year check", () => {
  const run = (started: string) => withAttn({ ...state, now: "2027-01-05T12:00:00Z", running: [job({ name: "a", started, run: { kind: "land", started } })] });
  expect(run("2026-10-27T16:50:00Z")).toContain("Started 2026-10-27 \u00b7");
  expect(run("2027-01-05T11:00:00Z")).toMatch(/Started [A-Z][a-z]{2} \d\d \d\d:\d\d \u00b7/);
  const held = withAttn({ ...state, now: "2027-01-05T12:00:00Z", needs: [job({ name: "aleph-27", state: "needs-you", started: "2026-10-27T16:50:00Z", trailers: [{ key: "Job", value: "20261028-042822-aleph-aleph-240-agent" }] })] });
  expect(held).toContain("Started</dt><dd>2026-10-27");
  expect(held).toContain("agent run, 2026-10-28");
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

// ---- proposals ----
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, labels as itemLabels } from "../todo/lib/store.ts";
import { routes as proposalRoutes } from "./api/proposals.ts";

const prop = { id: "l-1234abcd", kind: "check", sentence: "Do not mock the db.", count: 3, signals: [
  { source: "chris", at: "2026-10-27T10:00:00Z", quote: "No, <script>alert(1)</script>", link: "https://lf/trace/t2" },
  { source: "gate", at: "2026-10-27T11:00:00Z", quote: "deny", link: "" },
] };

test("a proposal is a decide row with Yes and No and its signals folded", () => {
  const h = r.renderIssues({ ...state, proposals: [prop] });
  const row = h.match(/<article class="issue-row decide"[^]*?<\/article>/)![0];
  expect(row).toContain("Proposal: a check");
  expect(row).toContain('<span class="verb">Do not mock the db.</span>');
  expect(row).toContain('class="act primary" type="button" data-act="approve" data-name="l-1234abcd" data-label="Yes">Yes<');
  expect(row).toContain('data-act="decline" data-name="l-1234abcd" data-label="No">No<');
  expect(row.match(/<details/g)?.length).toBe(1);
  expect(row).toContain('<a href="https://lf/trace/t2">');
  expect(row).not.toContain("<script>");
  expect(row).toContain("&lt;script&gt;");
  expect(row).not.toContain("<a href=\"#/");
});

test("rows are ordered held, stuck, needs-chris, proposal, error", () => {
  const s = { ...state, proposals: [prop], needsIssues: [{ id: "aleph-5", title: "T", href: "#/x", question: "Pick one?" }], factory: { ...state.factory, health: ["main is red"] } };
  const h = r.renderIssues(s);
  const at = ["held", "stuck", "decide", "decide", "error"].reduce<number[]>((a, k) => [...a, h.indexOf(`data-kind="${k}"`, (a.at(-1) ?? -1) + 1)], []);
  expect(at.every((n) => n >= 0)).toBe(true);
  expect(h.indexOf("aleph-5")).toBeLessThan(h.indexOf("l-1234abcd"));
  expect(h.indexOf("l-1234abcd")).toBeLessThan(h.indexOf("main is red"));
  expect(h).toContain(">5<");
});

test("the lede counts proposals as one warning", () => {
  const s = { ...state, needs: [], stuck: [], factory: { ...state.factory, health: [] }, proposals: [prop] };
  expect(r.renderLede(s)).toContain("One thing needs your attention. <a href=\"#issues\">1 proposal waits for Yes or No</a>");
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
    expect(items.length).toBe(1);
    expect(itemLabels(items[0])).toEqual(["goal", "memory"]);
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
