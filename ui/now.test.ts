import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { attend } from "./asks.ts";
import { awaitingHeld, held, job, state } from "./fixtures/status-state.ts";
// @ts-ignore
import { actMessages, openDiffs } from "./lib.js";

// The asks the server builds from the awaiting runs, the issues and goals with an Ask, and the proposals.
const asksOf = (runs: any[] = [], issues: any[] = [], lessons: any[] = []) => attend({ runs, issues }, {}, lessons).items;
const withAttn = (s: any) => view.renderNeeds(s) + view.renderLanes(s);

// @ts-ignore
import { trailerLine } from "./views/cards.js";
// The land cards of `delivered`: the Status page no longer lists them, Done links to them, but the card still renders.


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

test("an empty lane shows one quiet line; the Needs-you section is absent when nothing is wrong", () => {
  const calm = { ...state, asks: [], stuck: [], running: [], queued: [], issues: [], done: [], factory: { ...state.factory, health: [] } };
  const lanes = view.renderLanes(calm);
  for (const t of ["Nothing is queued.", "Nothing is done yet.", "Nothing is running."]) expect(lanes).toContain(t);
  expect(lanes.match(/<p/g)?.length).toBe(3);
  expect(view.renderNeeds(calm)).toBe("");
  expect(view.view.render(calm)).not.toContain('id="needs"');
});

const issue = (n: number) => ({ id: `aleph-${n}`, title: `Issue ${n}`, status: "open", href: `#/issues/aleph/${n}`, labels: [], notes: 0, created: "2026-10-27", updated: "2026-10-27" });
const full: any = { ...state, issues: [issue(1), issue(2)], queued: [{ repo: "aleph", id: 9, title: "w" }] };
const section = (h: string, id: string) => h.match(new RegExp(`<section id="${id}"[^]*?</section>`))![0];

test("Needs you groups needs you, then stuck or failed; the lanes hold running and queued; every card is compact", () => {
  const h = view.renderNeeds(full);
  const at = (id: string) => h.indexOf(`id="${id}"`);
  expect(at("awaiting")).toBeGreaterThan(-1);
  expect(at("awaiting")).toBeLessThan(at("jobs-stuck"));
  expect(h).not.toContain("jobs-running");
  const q = view.renderLanes(full);
  expect(q).toMatch(/<h2 id="h-queued">Queued<\/h2><span class="count">1<\/span>/);
  expect(h).not.toContain("job-card big");
  expect(h.match(/class="job-card small[ "]/g)?.length).toBe(h.match(/<article /g)?.length);
  expect(q.match(/class="job-card small lane-card/g)?.length).toBe(1 + 1); // 1 queued, 1 running
});

const rows = (h: string) => h.split('<article class="job-card small issue-row ').slice(1);
const problem = (row: string) => row.match(/<p class="problem">([^<]*)<\/p>/)![1];

test("a held run, a stuck run, an asking issue and a red main are one row each, with the id, title, Problem and buttons", () => {
  const asking = [{ ...issue(7), title: "Which tier?", question: "Haiku or Sonnet for the digest?" }];
  const s = { ...full, asks: asksOf([{ ...held, reviewCall: { call: "ask", reason: "touches hooks" } }], asking), stuck: [job({ name: "aleph-30", condition: "stuck", reason: "no commit", item: { id: 30, title: "Fix it" } })], issues: [], factory: { ...full.factory, health: ["health: aleph main is red at abc1234: tests"], hold: "Held: aleph-30 is stuck (no commit). No run starts or lands until it is cleared." } };
  const page = view.view.render(s);
  const top = section(page, "needs");
  const rs = rows(top);
  expect(rs.length).toBe(4);
  expect(rs.map((x) => x.match(/^([\w-]+)/)![1])).toEqual(["held-path", "question", "error", "stuck"]);
  expect(problem(rs[0])).toContain("changes a path the repo holds");
  expect(rs[0]).toContain("Reviewer: ask: touches hooks");
  expect(problem(rs[3])).toBe("Stuck with no commit.");
  expect(problem(rs[1])).toBe("Haiku or Sonnet for the digest?");
  expect(problem(rs[2])).toBe("Fix: aleph main is red at abc1234: tests");
  expect(rs[2]).not.toContain("<button");
  expect(rs[2]).not.toContain("always");
  // The id comes first, then the title and the Problem, then the buttons.
  for (const [row, id, title, btns] of [[rs[0], ">27</a>", "Digest head and tail", ["land", "drop"]], [rs[3], ">30</a>", "Fix it", ["recheck", "drop"]], [rs[1], ">7</a>", "Which tier?", ["decide", "deny"]]] as const) {
    expect(row).toContain('<span class="idp">aleph</span>');
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
});

test("a held run's details carry the hold note and the reviewer's verdict", () => {
  const why = (call: any) => rows(withAttn({ ...state, stuck: [], factory: { ...state.factory, health: [] }, asks: asksOf([{ ...held, reviewCall: call }]) }))[0];
  expect(why({ call: "back", reason: "lost an assertion" })).toContain("Reviewer: back: lost an assertion");
  expect(why({ call: "error" })).toContain("Reviewer: error");
  expect(why(undefined)).not.toContain("Reviewer:");
  expect(why(undefined)).toContain("Held path: hooks/lib/digest.ts");
});

test("issues that wait for triage are not rows and not in the status line: triage is the factory's", () => {
  const s = { ...full, asks: [], stuck: [], factory: { ...full.factory, health: [], hold: undefined, paused: false } };
  expect(rows(withAttn(s)).length).toBe(0);
  expect(view.renderLede(s)).not.toContain("Awaiting");
  expect(view.renderLede(s)).not.toContain("triage");
});

test("Issues holds the held runs before the stuck and failed ones, and none says whether an agent works", () => {
  const s = { ...state, running: [], stuck: [job({ name: "aleph-30", condition: "failed", agent: true }), job({ name: "aleph-31", condition: "stuck" })], asks: asksOf([{ ...held, agent: false }]) };
  const h = withAttn(s);
  expect(h).toContain(">Awaiting you<");
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
  const bad = { ...state, asks: asksOf([awaitingHeld({ name: "x", item: { id: 1, title: "<script>alert(1)</script>" } })]), queued: [{ repo: "a", id: 1, title: "<script>w</script>" }] };
  for (const h of [withAttn(bad), withAttn(bad)]) {
    expect(h).not.toContain("<script>");
    expect(h).toContain("&lt;script&gt;");
  }
});

test("an awaiting entry has Diff, Land and Drop buttons", () => {
  const h = withAttn(state);
  for (const v of ["diff", "land", "drop"]) expect(h).toContain(`data-act="${v}" data-name="aleph-27"`);
  expect(h).toContain("diff-panel");
});

const withFactory = (o: object) => ({ ...state, factory: { ...state.factory, health: [], ...o } });

test("a stuck job shows its reason, the failed check and its seconds, and Re-check and Drop buttons", () => {
  const h = withAttn({ ...state, asks: [], stuck: [job({ name: "aleph-30", condition: "stuck", reason: "types failed", checks: [{ name: "lint", ok: true, seconds: 3 }, { name: "tsc", ok: false, seconds: 41 }] })] });
  for (const t of ["types failed", "tsc", "41 s", 'data-act="recheck" data-name="aleph-30"', 'data-act="drop" data-name="aleph-30"']) expect(h).toContain(t);
  expect(h).not.toContain("data-cmd");
});

test("many awaiting jobs all render as rows, each with its details folded and its buttons", () => {
  const runs = [1, 2, 3, 4].map((i) => awaitingHeld({ name: `aleph-${i}`, reason: "Held path", item: { id: i, title: `t${i}` } }));
  const h = withAttn({ ...state, asks: asksOf(runs) });
  expect(h.match(/class="job-card small issue-row held-path"/g)?.length).toBe(4);
  expect(h.match(/<details class="more" data-keep="more:[^"]*">/g)?.length).toBe(4 + 1);
  for (const i of [1, 2, 3, 4]) expect(h).toContain(`data-act="land" data-name="aleph-${i}"`);
});

const calmState = { ...withFactory({}), asks: [], stuck: [] };
const said = (o: object, top: object = {}) => view.renderLede({ ...calmState, ...top, factory: { ...calmState.factory, ...o } }).replace(/<[^>]*>/g, "");
const ciRed = "health: aleph CI on main has failed 2 runs in a row since 2026-11-01 10:00 UTC (abc1234): https://x";
const mainRed = "health: aleph main is red at abc1234: tsc";

test("with nothing wrong the status sentence is the fine sentence", () => {
  expect(said({})).toBe("Everything is running smoothly.");
  expect(view.renderLede(calmState)).toContain('class="say fine"');
});

test("each error line says its alert, in red", () => {
  const cases: [object, string][] = [
    [{ health: [ciRed] }, "GitHub CI is broken"],
    [{ health: [mainRed] }, "the build is failing on main"],
    [{ probe: { at: "x", ok: false, failed: ["no network"] } }, "the sandbox is broken"],
    [{ hold: "Held: aleph-116 is stuck (merge conflict). No run starts or lands until it is cleared." }, "jobs are unhealthy"],
    [{ health: ["health: 2 passed runs did not land in 15 minutes"] }, "lands are stuck"],
    [{ health: ["health: the land run of aleph-5 is live for over 30 minutes"] }, "lands are stuck"],
    [{ health: ["health: 2 goals can start, but no run started in 15 minutes"] }, "queued jobs are not starting"],
    [{ health: ["health: 1 new issue did not move to jobs in 15 minutes"] }, "new issues are not becoming jobs"],
    [{ health: ["health: 4 runs wait for Chris; no new run starts"] }, "new runs wait for your answers"],
    [{ health: ["health: something new broke."] }, "something new broke"],
  ];
  for (const [o, text] of cases) {
    expect(said(o)).toBe(`Alert: ${text}.`);
    expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, ...o } })).toContain('class="say error"');
  }
});

test("stuck and failed jobs are one alert that links to their cards", () => {
  const stuck = [job({ name: "aleph-1", condition: "stuck" }), job({ name: "aleph-2", condition: "failed" })];
  const h = view.renderLede({ ...calmState, stuck });
  expect(h).toBe('<span class="say error">Alert: <a href="#jobs-stuck">jobs are unhealthy</a>.</span>');
});

test("two repos with the same trouble say it once", () => {
  expect(said({ health: [mainRed, "health: koans main is red at def5678: lint"] })).toBe("Alert: the build is failing on main.");
});

test("the sentence says at most three parts, the most serious first", () => {
  const stuck = [job({ name: "aleph-1", condition: "stuck" })];
  expect(said({ health: ["health: 4 runs wait for Chris; no new run starts", mainRed, ciRed] }, { stuck })).toBe("Alert: GitHub CI is broken; the build is failing on main; jobs are unhealthy.");
});

test("what asks for you follows the fine sentence, in the warning colour", () => {
  const ask = (kind: string) => ({ kind });
  const asks = (...k: string[]) => ({ asks: k.map(ask) });
  const raw = (top: object, o: object = {}) => view.renderLede({ ...calmState, ...top, factory: { ...calmState.factory, ...o } });
  expect(raw(asks("approval"))).toBe('<span class="say warning">Everything is running smoothly; <a href="#awaiting">your attention is needed</a>.</span>');
  expect(raw(asks("input", "input"))).toBe(raw(asks("approval")));
  expect(raw(asks("input", "approval"))).toBe(raw(asks("approval")));
  expect(raw({}, { runsToday: 12 })).toContain("Everything is running smoothly; the day cap is reached.");
  expect(raw(asks("approval"), { health: [mainRed] })).toContain('say error">Alert: <a href="#awaiting">the build is failing on main</a>; <a href="#awaiting">your attention is needed</a>.');
});

test("a paused factory does not say it runs smoothly", () => {
  expect(said({ paused: true })).toBe("The factory is paused.");
  expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, paused: true } })).toContain('class="say warning"');
  expect(said({ paused: true, runsToday: 12 })).toBe("The factory is paused; the day cap is reached.");
  expect(said({ paused: true, health: [mainRed] })).toBe("Alert: the build is failing on main; the factory is paused.");
});

const weekAt = (seven_day: number) => ({ usage: { now: { seven_day } } });

test("a weekly usage of 90% or more is said after the other parts, in the warning colour", () => {
  expect(said({}, weekAt(90))).toBe("Everything is running smoothly; weekly usage is at 90%.");
  expect(view.renderLede({ ...calmState, ...weekAt(90) })).toContain('class="say warning"');
  expect(said({}, weekAt(89.6))).toBe("Everything is running smoothly.");
  expect(view.renderLede({ ...calmState, ...weekAt(89.6) })).toContain('class="say fine"');
  expect(said({}, { usage: undefined })).toBe("Everything is running smoothly.");
  expect(said({}, weekAt(93.4))).toContain("weekly usage is at 93%");
  expect(said({ runsToday: 12, dayCap: 12 }, weekAt(95))).toBe("Everything is running smoothly; the day cap is reached; weekly usage is at 95%.");
});

test("an alert keeps its red sentence and holds the weekly usage part; three alerts cut it", () => {
  expect(said({ health: [mainRed] }, weekAt(90))).toBe("Alert: the build is failing on main; weekly usage is at 90%.");
  expect(view.renderLede({ ...calmState, ...weekAt(90), factory: { ...calmState.factory, health: [mainRed] } })).toContain('class="say error"');
  const three = { health: [ciRed, mainRed, "health: 4 runs wait for Chris; no new run starts"] };
  expect(said(three, weekAt(90))).toBe("Alert: GitHub CI is broken; the build is failing on main; new runs wait for your answers.");
});

test("a paused factory with weekly usage at 90% says so", () => {
  expect(said({ paused: true }, weekAt(90))).toBe("The factory is paused; weekly usage is at 90%.");
});

test("the page has no banner and the status line holds the alert", () => {
  const page = view.view.render(withFactory({ health: [mainRed] }));
  expect(page).not.toContain('class="banner"');
  expect(page).toMatch(/<p class="lede">[^]*the build is failing on main/);
});

test("the most flaked line stays in the report and off the status sentence and the error rows", () => {
  const line = "health: most flaked in acceptance in 7 days: a.test.ts > twice (1 times)";
  const page = view.view.render({ ...withFactory({ health: [line] }), asks: [], stuck: [] });
  expect(page).not.toContain("most flaked");
});

test("a flake line is not shown on the Status page", () => {
  const calm = { ...withFactory({ health: ["health: aleph check tests passed on rerun 4 times in 7 days"] }), asks: [], stuck: [] };
  const h = view.renderLede(calm);
  expect(h).toContain('class="say fine"');
  expect(h).not.toContain("Awaiting");
  expect(h).not.toContain("rerun");
  expect(view.view.render(calm)).not.toContain("rerun");
  expect(withAttn(calm)).not.toContain("rerun");
});

test("the as-of line is h:mm am or pm, no date", () => {
  expect(view.renderAsOf({ now: new Date(2026, 9, 28, 9, 5).toISOString() })).toBe("9:05 am");
  expect(view.renderAsOf({ now: new Date(2026, 9, 28, 21, 5).toISOString() })).toBe("9:05 pm");
  expect(view.renderAsOf(state)).toMatch(/^\d{1,2}:\d{2} (am|pm)$/);
});

test("a running job past 40 minutes says so", () => {
  const late = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:19:00Z", run: { kind: "build", started: "2026-10-27T16:19:00Z" } })] });
  expect(late).toContain("past the time box");
  expect(withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T16:30:00Z", run: { kind: "build", started: "2026-10-27T16:30:00Z" } })] })).not.toContain("past the time box");
});

test("a land run is measured from its own start and never past the time box", () => {
  const h = withAttn({ ...state, now: "2026-10-27T16:55:00Z", running: [job({ name: "a", started: "2026-10-27T16:00:00Z", run: { kind: "land", started: "2026-10-27T16:50:00Z" } })] });
  expect(h).toContain("land");
  expect(h).toContain('<span class="elapsed" data-since="2026-10-27T16:50:00Z">5:00</span> elapsed');
  expect(h).not.toContain("past the time box");
});

test("a worker run older than 40 minutes is past the time box", () => {
  const h = withAttn({ ...state, running: [job({ name: "a", started: "2026-10-27T15:00:00Z", run: { kind: "build", started: "2026-10-27T16:00:00Z" } })] });
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
  const h = withAttn({ ...state, asks: asksOf([awaitingHeld({ name: "x", stat })]) });
  expect(h.match(/ f\d+\.ts \| 2/g)?.length).toBe(12);
  expect(h).toContain("+18 more files");
});

test("an awaiting row does not show checks as facts", () => {
  expect(withAttn(state)).not.toContain(" s ✓");
});

test("the Pause or Resume button sits in the page head beside the time; no Controls panel", () => {
  const on = view.renderControls(state);
  expect(on).toContain('data-act="pause"');
  expect(on).not.toContain('data-act="resume"');
  const off = view.renderControls({ ...state, factory: { ...state.factory, paused: true } });
  expect(off).toContain('data-act="resume"');
  expect(off).not.toContain('data-act="pause"');
  const page = view.view.render(state);
  expect(page).not.toContain('id="controls"');
  expect(page.indexOf('data-act="pause"')).toBeGreaterThan(page.indexOf('class="lede"'));
  expect(page.indexOf('data-act="pause"')).toBeGreaterThan(page.indexOf('class="asof"'));
  expect(page.indexOf('data-act="pause"')).toBeLessThan(page.indexOf('id="scorecard"'));
});

test("trailers show on one line joined by ' · ', escaped, and only when there are some", () => {
  const trailers = [{ key: "Item", value: "aleph-27" }, { key: "Job", value: "<script>x</script>" }, { key: "Held-by", value: "Chris" }];
  const h = trailerLine(job({ name: "aleph-28", condition: "landed", trailers }), state.now);
  expect(h).toContain("aleph-27 · Job &lt;script&gt;x&lt;/script&gt; · Held-by Chris");
  expect(h).not.toContain("Item aleph-27");
  expect(h).not.toContain("<script>");
  expect(h).not.toContain('<pre class="trailers"');
  expect(trailerLine(state.delivered[0], state.now)).toBe("");
});

test("the Job trailer is parsed into run kind and start, linked to the job page with the raw id in the title", () => {
  const id = "20261028-042822-aleph-aleph-240-agent";
  const land = job({ name: "aleph-240", condition: "landed", trailers: [{ key: "Item", value: "aleph-240" }, { key: "Job", value: id }] });
  const h = trailerLine(land, state.now);
  expect(h).toContain(`<p class="trailers-line">aleph-240 \u00b7 <a href="#/jobs/aleph-240" title="${id}">agent run, Oct 28 04:28</a></p>`);
  expect(h.replace(/title="[^"]*"/, "")).not.toContain(id);
  expect(trailerLine({ ...land, trailers: [{ key: "Job", value: id.replace("agent", "land").replace("042822", "134500") }] }, state.now)).toContain(">land, Oct 28 13:45<");
});

const two: any = { ...state, asks: asksOf([awaitingHeld({ name: "job-a" }), awaitingHeld({ name: "job-b" })]) };
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

test("a held row shows the call verdict and its reason in Details", () => {
  const withReview = (call: object) => ({ ...state, asks: asksOf([{ ...held, reviewCall: call }]) });
  const h = withAttn(withReview({ call: "back", reason: "a test lost <an> assertion" }));
  expect(h).toContain("Reviewer: back: a test lost &lt;an&gt; assertion");
  expect(h.indexOf("Reviewer: back")).toBeGreaterThan(h.indexOf("<details"));
  expect(withAttn(state)).not.toContain("Reviewer:");
});

test("an asking issue with fields shows the question, the options, the recommended mark, the context and the buttons in the row", () => {
  const decision = { question: "Haiku or Sonnet for the `digest`?", options: [{ label: "Haiku", line: "Cheaper, `fast`" }, { label: "Sonnet", line: "Better summaries" }], recommended: "Sonnet", kind: "input" as const, reason: "question", why: ["Digests run daily", "Quality matters more"] };
  const s = { ...state, asks: asksOf([], [{ ...issue(152), title: "Which tier?", question: "prose", decision }]), stuck: [], issues: [], factory: { ...state.factory, health: [] } };
  const [row] = rows(withAttn(s));
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
  expect(buttons).toEqual([["decide", "Approve Sonnet", true], ["decide", "Approve Haiku", false], ["deny", "Deny", false]]);
  expect(row).toContain('data-option="Sonnet"');
});

test("an old prose note gets a Problem with no tag or lead, Approve recommendation and Deny", () => {
  const note = "triage: for Chris: Should `ui/x.ts` use A or B?\nA is simpler. My recommendation is A, because it is simpler. Then more words.";
  const s = { ...state, asks: asksOf([], [{ ...issue(152), title: "Which?", question: note }]), stuck: [], issues: [], factory: { ...state.factory, health: [] } };
  const [row] = rows(withAttn(s));
  expect(problem(row)).not.toContain("triage: for Chris");
  expect(row).toContain('data-label="Approve recommendation"');
  expect(row).toContain('data-recommendation="true"');
  expect(row).toContain('data-label="Deny"');
  expect(row).toContain('class="reason"');
  expect(row.match(/<details class="more"/g)?.length).toBe(1);
});

test("the status line says your attention is needed when the Issues section has an item", () => {
  const calm = { ...state, asks: [], stuck: [], issues: [], factory: { ...state.factory, health: [], hold: undefined, paused: false } };
  for (const o of [{ asks: asksOf([], [{ ...issue(7), question: "q" }]) }]) {
    const h = view.renderLede({ ...calm, ...o });
    expect(h).toContain("your attention is needed");
    expect(h).not.toContain("Awaiting");
  }
});

test("a held run that waits for the firefighter still asks for your attention", () => {
  const calm = { ...state, stuck: [], factory: { ...state.factory, health: [] } };
  const asks = attend({ runs: [held], issues: [] }, { "held-path": { action: "firefighter", at: "2026-10-28T00:00:00.000Z" } }, []).items;
  const h = view.renderLede({ ...calm, asks });
  expect(h).toContain("your attention is needed");
  expect(h).toContain('class="say warning"');
});

test("Status times use the state's own now for the year check", () => {
  const run = (started: string) => withAttn({ ...state, now: "2027-01-05T12:00:00Z", running: [job({ name: "a", started, run: { kind: "land", started } })] });
  expect(run("2026-10-27T16:50:00Z")).toContain(">2026-10-27</span>");
  expect(run("2027-01-05T11:00:00Z")).toMatch(/>[A-Z][a-z]{2} \d\d \d\d:\d\d<\/span>/);
  const page = withAttn({ ...state, now: "2027-01-05T12:00:00Z", asks: asksOf([awaitingHeld({ name: "aleph-27", started: "2026-10-27T16:50:00Z", trailers: [{ key: "Job", value: "20261028-042822-aleph-aleph-240-agent" }] })]) });
  expect(page).toContain("Started</dt><dd>2026-10-27");
  expect(page).not.toMatch(/\d\d? ?[AP]M/i);
});

test("a planner run shows as planner in the running lane", async () => {
  const plan = { name: "plan-aleph-5", item: { title: "Big" }, condition: "running", run: { kind: "plan", started: "2026-10-27T16:50:00Z" }, started: "2026-10-27T16:50:00Z" };
  expect(withAttn({ ...state, running: [job({ name: "plan-aleph-5", run: plan.run })] })).toContain('<span class="badge run">planner');
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
  const h = withAttn({ ...state, asks: asksOf([held], [], [prop]) });
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

test("rows are ordered held, then asking, then proposal, then error; the group is a list", () => {
  const s = { ...state, asks: asksOf([held], [{ id: "aleph-5", title: "T", href: "#/x", question: "Pick one?" }], [prop]), factory: { ...state.factory, health: ["main is red"] } };
  const h = withAttn(s);
  expect(h).toContain('<div class="list">');
  expect(h).not.toMatch(/id="awaiting"[^]*class="cards"[^]*id="jobs-stuck"/);
  expect(h.indexOf("aleph-27")).toBeLessThan(h.indexOf("aleph-5"));
  expect(h.indexOf("aleph-5")).toBeLessThan(h.indexOf("l-1234abcd"));
  expect(h.indexOf("l-1234abcd")).toBeLessThan(h.indexOf("main is red"));
  expect(h).toContain(">4<");
});

test("the lede says proposals need your attention", () => {
  const s = { ...state, asks: asksOf([], [], [prop]), stuck: [], factory: { ...state.factory, health: [] } };
  expect(view.renderLede(s)).toContain("<a href=\"#awaiting\">your attention is needed</a>.");
  expect(view.renderLede({ ...s, asks: asksOf([], [], [prop, prop]) })).toContain("your attention is needed");
});

test("approve and decline handlers", async () => {
  const base = mkdtempSync(join(tmpdir(), "aleph-prop-"));
  const keys = ["ALEPH_FACTORY_DIR", "ALEPH_ISSUES", "ALEPH_REPOS", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
  const saved = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  const sh = (cwd: string, ...a: string[]) => { const p = Bun.spawnSync(a, { cwd, stdout: "pipe", stderr: "pipe" }); if (p.exitCode) throw new Error(String(p.stderr)); };
  try {
    Object.assign(process.env, { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
      ALEPH_FACTORY_DIR: join(base, "factory"), ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json") });
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
    expect(items.map((i) => i.fm.id)).toEqual(["1"]);
    expect(items[0].fm).toMatchObject({ source: "memory" });
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
  expect(withAttn(s)).toContain('<span class="badge run">firefighter</span>');
});

test("a held job card has no badge or agent line", () => {
  const h = withAttn({ ...state, stuck: [], asks: asksOf([{ ...held, agent: true, reviewCall: { call: "back", reason: "x" } }]) });
  expect(rows(h)[0]).not.toContain("badge");
});

// ---- the ask rows ----
import { ASK_REASONS } from "../jobs/lib/always.ts";

const sample = (reason: string): { runs: any[]; issues: any[]; lessons: any[] } => {
  const run = (why: string, o: object = {}) => ({ runs: [job({ name: "aleph-27", condition: "awaiting", ask: { kind: why === "held-path" || why === "review" ? "approval" : "input", reason: why }, reason: "<task-notification>x</task-notification> y", item: { id: 27, title: "T" }, ...o })], issues: [] as any[], lessons: [] as any[] });
  const iss = (o: object) => ({ runs: [] as any[], issues: [{ ...issue(7), title: "T", ...o }], lessons: [] as any[] });
  if (["held-path", "review", "manual"].includes(reason)) return run(reason, reason === "review" ? { reviewCall: { call: "ask", reason: "r" } } : {});
  if (reason === "question") return run("question", { question: "<agent-message>q</agent-message> Which?" });
  if (reason.startsWith("proposal-")) return { runs: [] as any[], issues: [] as any[], lessons: [{ ...prop, kind: reason.slice(9), target: { check: "aleph checks", "claude-md": "aleph/CLAUDE.md", skill: "skills/aleph/SKILL.md" }[reason.slice(9)] }] };
  const q: Record<string, object> = {
    proposal: { reason: "proposal", question: "T" },
    "host-check": { reason: "host-check", question: "triage: a live check: run it" },
    "no-commit": { reason: "no-commit", question: "ended with no commit, so the factory stopped" },
    "run-cap": { reason: "run-cap", question: "the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it." },
    "triage-failed": { reason: "triage-failed", question: "triage: no verdict in 2 runs: failed: x" },
    "part-dropped": { reason: "part-dropped", question: "A goal was dropped." },
    "acceptance-failed": { reason: "acceptance-failed", question: "acceptance: fail again" },
    rescue: { reason: "rescue", question: "Which one?", decision: { question: "Which?", options: [{ label: "A", line: "a" }], recommended: "A", kind: "input" as const, reason: "question", why: [] } },
    firefighter: { reason: "firefighter", question: "x changes y.ts, a held security path" },
  };
  return iss(q[reason]);
};

for (const reason of Object.keys(ASK_REASONS)) {
  test(`ask row for ${reason}: Problem, named buttons, a hint each, and Always`, () => {
    const sm = sample(reason);
    const items = attend(sm, {}, sm.lessons).items;
    expect(items.map((i) => i.reason)).toEqual([reason]);
    const h = withAttn({ ...state, stuck: [], factory: { ...state.factory, health: [] }, asks: items });
    const row = h.match(new RegExp(`<article class="job-card small issue-row ${reason}"[^]*?</article>`))![0];
    expect(row).toContain(`data-reason="${reason}"`);
    const p = problem(row);
    expect(p.length).toBeGreaterThan(5);
    for (const t of ["<task-notification", "<agent-message", "ask:"]) expect(p).not.toContain(t);
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

test("the Awaiting-you group is one list; its articles are the asks plus the error lines", () => {
  const sm = sample("rescue");
  const items = [...attend({ runs: [held], issues: sm.issues }, {}, [prop as any]).items];
  const s = { ...state, asks: items, stuck: [], factory: { ...state.factory, health: ["health: aleph main is red at abc1234: tests"] } };
  const h = withAttn(s);
  const grp = h.match(/<div class="grp" id="awaiting">[^]*?<\/section>/)![0];
  expect(grp).toContain('<div class="list">');
  expect(grp).not.toContain('class="cards"');
  expect(grp.match(/<article /g)?.length).toBe(items.length + 1);
  const red = grp.match(/<article class="job-card small issue-row error"[^]*?<\/article>/)![0];
  expect(red).toContain('<p class="problem">Fix: aleph main is red');
  expect(red).not.toContain("always");
  expect(red).not.toContain("<button");
  expect(view.view.render(s)).toContain('<span class="count">4</span>');
});

test("Status has no Standing permissions section", () => {
  const s = full;
  expect(view.view.render(s)).not.toContain("Standing permissions");
  expect(view.view.render(s)).not.toContain('data-act="revoke"');
});

const done = (n: number) => ({ id: `aleph-${n}`, title: `Done ${n}`, href: `#/issues/aleph/${n}`, finished: "2026-10-27T16:30:00Z",
  jobs: [job({ name: `triage-aleph-${n}`, condition: "done", outcome: "goal", run: { kind: "triage", started: "2026-10-27T10:00:00Z" } }),
    job({ name: `aleph-${n}`, condition: "landed", commit: "50f301fabc", commitUrl: "https://github.com/o/r/commit/50f301fabc", run: { kind: "land", started: "2026-10-27T15:00:00Z" } })] });

test("Latest done lists the issue as head with its triage, work and land jobs and commit as links", () => {
  const h = view.renderLanes({ ...state, done: [done(5), done(4)] }).match(/<section id="lane-done"[^]*?<\/section>/)![0];
  expect(h).toContain('<h2 id="h-done">Latest done</h2></div>');
  expect(h).toContain('<a href="#/issues/aleph/5" class="t">Done 5</a>');
  expect(h).toContain('href="#/jobs/aleph-5">land</a>');
  expect(h).toContain('href="#/jobs/triage-aleph-5">triage</a> (goal)');
  expect(h).toContain('<a href="https://github.com/o/r/commit/50f301fabc"><code>50f301f</code></a>');
  expect(h.indexOf("Done 5")).toBeLessThan(h.indexOf("Done 4"));
});

test("a question ask renders the Answer button with a text input in the same row", () => {
  const sm = sample("question");
  const items = attend(sm, {}, sm.lessons).items;
  const h = withAttn({ ...state, stuck: [], factory: { ...state.factory, health: [] }, asks: items });
  const row = h.match(/<article class="job-card small issue-row question"[^]*?<\/article>/)![0];
  expect(row).toMatch(/data-act="answer"[^>]*data-name="aleph-27"|data-name="aleph-27"[^>]*data-act="answer"/);
  expect(row).toMatch(/<input [^>]*type="text"[^>]*name="answer"/);
});

test("a Queued card names a dead blocker and offers to remove only that wait", () => {
  const q = view.renderLanes({ ...state, queued: [{ repo: "aleph", id: 964, title: "t", why: "x", kind: "waits_on", waits: [
    { id: "aleph-963", href: "#/issues/aleph/963", title: "Old <work>", state: "dropped", dead: "dropped" },
    { id: "aleph-970", href: "#/issues/aleph/970", title: "Live", state: "building", dead: null },
  ] }] });
  expect(q).toContain('<a href="#/issues/aleph/963">963</a> <span>Old &lt;work&gt;</span> <span class="badge stuck">dropped</span>');
  expect(q).toContain('<span class="badge quiet">building</span>');
  expect(q).toContain("this wait never ends");
  expect(q).toContain('data-act="unblock" data-repo="aleph" data-id="964"');
  expect(q).toContain(">Stop waiting on 963</button>");
});

test("Queued cards show why each goal waits", () => {
  const w = (id: number, why: string, kind: string, more: any = {}) => ({ repo: "aleph", id, title: `t${id}`, why, kind, ...more });
  const lanes = view.renderLanes({ ...state, queued: [
    w(1, "Waits on aleph-630", "waits_on", { waits: [{ id: "aleph-630", href: "#/issues/aleph/630", state: "building" }] }),
    w(3, "Starts at the next dispatch", "ready"),
    w(4, "Waiting for a slot (12 of 12 running)", "gate"),
  ] });
  const q = lanes.match(/<section id="lane-queued"[^]*?<\/section>/)![0];
  expect(q).toContain('Blocked by</div><div class="blocker"><a href="#/issues/aleph/630">630</a> <span class="badge quiet">building</span>');
  expect(q).not.toContain('data-act="unblock"');
  expect(q).toContain("Starts at the next dispatch");
  expect(q).toContain("Waiting for a slot (12 of 12 running)");
  expect(q.match(/Waiting for a slot/g)?.length).toBe(1);
  expect(q).toContain('href="#/issues/aleph/1"');
  expect(view.renderLanes({ ...state, queued: [{ repo: "aleph", id: 5, title: "x" }] })).toContain(">Queued</div>");
});

test("the status sentence wraps instead of clipping: .lede .say has no ellipsis or hidden overflow, and wraps", async () => {
  const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
  const say = [...html.matchAll(/\.lede \.say[^{}]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  expect(say).not.toContain("text-overflow: ellipsis");
  expect(say).not.toContain("overflow: hidden");
  expect(say).toContain("white-space: normal");
});

test("a long unbroken word in the status sentence (a URL) breaks: .lede .say sets overflow-wrap: anywhere", async () => {
  const html = await Bun.file(new URL("./index.html", import.meta.url)).text();
  const say = [...html.matchAll(/\.lede \.say[^{}]*\{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  expect(say).toContain("overflow-wrap: anywhere");
});

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
const DAY = { ...WEEK, window: "day", done: 3, phases: { lead: { count: 2, p50: 900, p90: 1000 } }, issues: { ...WEEK.issues, firstPass: 0.8 }, lost: { hours: 1, share: 0.15 } };
const USAGE = { now: { seven_day: 7, five_hour: 2, seven_day_resets_at: "2026-11-07T08:00:00Z" }, series: [] };

test("the page order is the status line, Awaiting you, the scorecard, the lanes, the causes; no picker, no flow strip", () => {
  const page = view.view.render(full);
  const order = ['class="lede"', 'class="asof"', 'class="say', 'data-act="pause"', 'id="needs"', 'id="scorecard"', 'id="lane-running"', 'id="lane-queued"', 'id="lane-done"', 'id="causes"'];
  const at = order.map((t) => page.indexOf(t));
  expect(at.every((v) => v >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  for (const t of ["wpick", 'id="flow"', 'id="lane-incoming"', 'id="speed"', 'id="efficiency"']) expect(page).not.toContain(t);
});

test("the scorecard has five tiles with values from the data and 24 h comparisons", () => {
  const h = view.renderTiles({ ...state, now: "2026-11-01T08:00:00Z", usage: USAGE }, WEEK, DAY);
  expect([...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1])).toEqual(["Lost time", "Lead time p50", "First pass", "Lands", "Weekly usage"]);
  expect([...h.matchAll(/<b>([^<]+)<\/b>/g)].map((m) => m[1])).toEqual(["38%", "26m", "91%", "7", "7%"]);
  expect(h).toContain('<span class="good">▼ 15% in the last 24 h</span>');
  expect(h).toContain('<span class="warn">▼ 80% in the last 24 h</span>');
  expect(h).toContain("9 land runs");
  expect(h).toContain("3 in the last 24 h, 1 a day on average");
  for (const t of ["#/factory/efficiency", "#/factory/jobs", "#/factory/agents"]) expect(h).toContain(`href="${t}"`);
  expect(h).toContain("under pace: 14.3% of the week gone");
});

test("the scorecard before the data arrives: dashes, and usage unknown with no usage", () => {
  const h = view.renderTiles({ ...state, usage: undefined }, null, null);
  expect(h.match(/<b>–<\/b>/g)?.length).toBe(5);
  expect(h).toContain("usage unknown");
});

test("the causes merge across the lost classes, largest first, and leave out the classes that reached main", () => {
  const h = view.renderCauses(WEEK);
  expect([...h.matchAll(/efficiency">([^<]+)</g)].map((m) => m[1])).toEqual(["Issue had landed", "No commit"]);
  expect(h).toContain("3.0 h · 4 runs");
  expect(h).toContain("The first cause is 50% of the loss: Issue had landed, 4 runs.");
  expect(h.match(/class="barrow top"/g)?.length).toBe(1);
  expect(view.renderCauses(null)).toContain("Loading");
  expect(view.renderCauses({ error: "no <data>" })).toContain("no &lt;data&gt;");
  expect(view.renderCauses({ classes: [] })).toContain("No agent time was lost");
});

test("mountStatus fetches the week and the day and fills the scorecard and the causes", async () => {
  // @ts-ignore plain JS shared with the page
  const { resetSpeed } = await import("./views/speed.js");
  resetSpeed();
  const tiles = { innerHTML: "" }, causes = { innerHTML: "" };
  const urls: string[] = [];
  await view.mountStatus({ querySelector: (s: string) => (s === "#scorecard" ? tiles : s === "#causes" ? causes : null) }, { ...state, usage: USAGE, now: "2026-11-01T08:00:00Z" }, async (u: string) => { urls.push(u); return { ok: true, json: async () => (u.includes("day") ? DAY : WEEK) }; });
  expect(urls.sort()).toEqual(["/api/speed?window=day", "/api/speed?window=week"]);
  expect(tiles.innerHTML).toContain("<b>38%</b>");
  expect(causes.innerHTML).toContain("Issue had landed");
  resetSpeed();
});

test("the lanes: Running shows live agent runs of the cap and lists every open run; Latest done has two at most", () => {
  const mk = (n: number, kind: string) => job({ name: `${kind}-${n}`, run: { kind, started: "2026-10-30T09:00:00Z" } });
  const running = [...Array.from({ length: 12 }, (_, i) => mk(i, "agent")), mk(1, "land"), mk(2, "land")];
  const h = view.renderLanes({ ...full, running, factory: { ...full.factory, liveCap: 12, liveRuns: 12 }, done: [] });
  expect(h).toContain('<h2 id="h-running">Running</h2><span class="count">12 of 12</span>');
  expect((h.match(/class="[^"]*run-row/g) ?? []).length).toBe(14);
  const d = (n: number) => ({ id: `aleph-${n}`, title: `D${n}`, href: "#/x", jobs: [] });
  expect((view.renderLanes({ ...full, done: [d(1), d(2), d(3)] }).match(/done-row/g) ?? []).length).toBe(2);
});

test("an ask keeps its action buttons on the page", () => {
  const page = view.view.render(full);
  expect(page).toContain('data-act="pause"');
  expect(section(page, "needs")).toMatch(/data-act="/);
});

test("the sidebar links and the routes exist", async () => {
  for (const [f, path, old] of [["factory-jobs", "/factory/jobs", "#/status/performance"], ["efficiency", "/factory/efficiency", "#/status/efficiency"], ["factory-agents", "/factory/agents", "#/status/capacity"]]) {
    const m = await import(`./views/${f}.js`);
    expect(m.view.path).toBe(path);
    expect(m.redirect(old)).toBe(`#${path}`);
    expect(m.redirect(`#${path}`)).toBeNull();
  }
});

test("the Weekly usage tile shows the snapshot's age only while stale", () => {
  const now = { seven_day: 25, five_hour: 1, at: "2026-11-01T07:20:00Z", seven_day_resets_at: "2026-11-07T08:00:00Z" };
  const st = { ...state, now: "2026-11-01T08:00:00Z" };
  expect(view.renderTiles({ ...st, usage: { now, stale: true } }, WEEK, DAY)).toContain("as of 40m ago");
  expect(view.renderTiles({ ...st, usage: { now, stale: false } }, WEEK, DAY)).not.toContain("as of");
});

const OOD = "Alert: this status is out of date.";
const strip = (h: string) => h.replace(/<[^>]*>/g, "");
test("out-of-date data says so, in place of the fine and the paused sentence", () => {
  const h = view.renderLede(calmState, true);
  expect(strip(h)).toBe(OOD);
  expect(h).toContain('class="say error"');
  const p = view.renderLede({ ...calmState, factory: { ...calmState.factory, paused: true } }, true);
  expect(strip(p)).toBe(OOD);
});

test("the out-of-date part comes first and survives MAX_SAID", () => {
  const s = { ...calmState, health: { ...(calmState as any).health }, asks: [{ kind: "approval" }, { kind: "input" }], stuck: [{}] };
  const base = said({}, { stuck: [{}], asks: [{ kind: "approval" }, { kind: "input" }] });
  const h = strip(view.renderLede(s, true));
  expect(h.startsWith(OOD.slice(0, -1) + "; ")).toBe(true);
  expect(h.split("; ").length).toBe(base.split("; ").length + 1);
});

test("without the out-of-date input the sentence is unchanged", () => {
  expect(view.renderLede(calmState, false)).toBe(view.renderLede(calmState));
  expect(said({})).toBe("Everything is running smoothly.");
});

test("a dead factory tick says the alert, in red", () => {
  const dead = "Alert: the factory tick has stopped.";
  for (const o of [{ nextTick: null }, { nextTick: "2026-10-27T16:54:59Z" }]) {
    expect(said(o)).toBe(dead);
    expect(view.renderLede({ ...calmState, factory: { ...calmState.factory, ...o } })).toContain('class="say error"');
  }
  const fine = "Everything is running smoothly.";
  for (const o of [{ nextTick: "2026-10-27T17:12:00Z" }, { nextTick: "2026-10-27T16:56:00Z" }, { nextTick: null, tickInProgress: true }, { nextTick: "2026-10-27T16:00:00Z", tickInProgress: true }]) expect(said(o)).toBe(fine);
  expect(said({ paused: true, nextTick: null })).toBe("Alert: the factory tick has stopped; the factory is paused.");
});

test("the tick alert ranks after the probe and before the queued-jobs alert, and reads as a Check row", () => {
  const o = { nextTick: null, probe: { at: "x", ok: false, failed: ["no network"] }, health: ["health: 2 goals can start, but no run started in 15 minutes"] };
  expect(said(o)).toBe("Alert: the sandbox is broken; the factory tick has stopped; queued jobs are not starting.");
  expect(withAttn(withFactory({ nextTick: null }))).toContain("Check: the factory tick has stopped: aleph-tick.timer has no next run");
});
