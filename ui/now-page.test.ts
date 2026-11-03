import { expect, test } from "bun:test";
// @ts-ignore now.js is plain JS, shared with the page
import * as view from "./views/now.js";
import { job, state } from "./fixtures/status-state.ts";
import { withAttn, full, section } from "./test-now.ts";

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

test("Status has no Standing permissions section", () => {
  const s = full;
  expect(view.view.render(s)).not.toContain("Standing permissions");
  expect(view.view.render(s)).not.toContain('data-act="revoke"');
});

const done = (n: number) => ({ id: `aleph-${n}`, title: `Done ${n}`, href: `#/issues/aleph/${n}`, finished: "2026-10-27T16:30:00Z",
  jobs: [job({ name: `triage-aleph-${n}`, condition: "done", outcome: "goal", run: { kind: "triage", started: "2026-10-27T10:00:00Z" } }),
    job({ name: `aleph-${n}`, condition: "landed", commit: "50f301fabc", commitUrl: "https://github.com/o/r/commit/50f301fabc", run: { kind: "land", started: "2026-10-27T15:00:00Z" } })] });

test("Latest done lists the issue as a card with a 3-line face and no link to a commit, a land run or a triage run", () => {
  const h = view.renderLanes({ ...state, done: [{ ...done(5), since: "2026-10-27T10:00:00Z", finished: "2026-10-27T15:30:00Z" }, done(4)] }).match(/<section id="lane-done"[^]*?<\/section>/)![0];
  expect(h).toContain('<h2 id="h-done">Latest done</h2></div>');
  expect(h).toContain('<a href="#/issues/aleph/5" class="t" title="Done 5">Done 5</a>');
  expect(h).toContain('<span class="num dur">5h30m</span>');
  expect(h).not.toContain("/commit/");
  expect(h).not.toContain("#/jobs/");
  expect(h).not.toContain("<code>");
  expect(h.indexOf("Done 5")).toBeLessThan(h.indexOf("Done 4"));
});

test("a done part is its own card with a 3/4 link to its parent", () => {
  const h = view.renderLanes({ ...state, done: [{ ...done(5), id: "aleph-5.3", part: { n: 3, m: 4, parent: "aleph-5", href: "#/issues/aleph/5" } }] });
  expect(h).toContain('<a class="part" href="#/issues/aleph/5" title="Part 3 of 4 of aleph-5">3/4</a>');
});

test("the meta row is the id, status, priority, part, date, duration, then why it waits", () => {
  const h = view.renderLanes({ ...state, queued: [{ repo: "aleph", id: 7, title: "t", priority: "high", stage: "blocked", at: "2026-10-27T10:05:00", since: "2026-10-27T09:00:00", why: "Waits on aleph-630", kind: "waits_on", part: { n: 3, m: 4, parent: "aleph-6", href: "#/issues/aleph/6" } }] });
  const row = h.match(/<section id="lane-queued"[^]*?<div class="ih">[^]*?<\/div>/)![0];
  const order = ["idl", "badge quiet\">blocked", "badge need\">high", 'class="part"', "num date\">10/27 10:05", "num dur", 'class="why" title="Waits on aleph-630"'].map((x) => row.indexOf(x));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
});

test("a Queued card names a dead blocker and offers to remove only that wait", () => {
  const q = view.renderLanes({ ...state, queued: [{ repo: "aleph", id: 964, title: "t", why: "x", kind: "waits_on", waits: [
    { id: "aleph-963", href: "#/issues/aleph/963", title: "Old <work>", state: "dropped", dead: "dropped" },
    { id: "aleph-970", href: "#/issues/aleph/970", title: "Live", state: "working", dead: null },
  ] }] });
  expect(q).toContain('<a href="#/issues/aleph/963">963</a> <span>Old &lt;work&gt;</span> <span class="badge stuck">dropped</span>');
  expect(q).not.toContain("Live");
  expect(q).toContain("this wait never ends");
  expect(q).toContain('data-act="unblock" data-repo="aleph" data-id="964"');
  expect(q).toContain(">Stop waiting on 963</button>");
});

test("Queued cards show why each goal waits", () => {
  const w = (id: number, why: string, kind: string, more: any = {}) => ({ repo: "aleph", id, title: `t${id}`, why, kind, ...more });
  const lanes = view.renderLanes({ ...state, queued: [
    w(1, "Waits on aleph-630", "waits_on", { waits: [{ id: "aleph-630", href: "#/issues/aleph/630", state: "working" }] }),
    w(3, "Starts at the next dispatch", "ready"),
    w(4, "Waiting for a slot (12 of 12 running)", "gate"),
  ] });
  const q = lanes.match(/<section id="lane-queued"[^]*?<\/section>/)![0];
  expect(q).toContain('<span class="why" title="Waits on aleph-630">Waits on aleph-630</span>');
  expect(q).not.toContain('data-act="unblock"');
  expect(q).toContain("Starts at the next dispatch");
  expect(q).toContain("Waiting for a slot (12 of 12 running)");
  expect(q.match(/>Waiting for a slot/g)?.length).toBe(1);
  expect(q).toContain('href="#/issues/aleph/1"');
  expect(view.renderLanes({ ...state, running: [], queued: [{ repo: "aleph", id: 5, title: "x" }] })).not.toContain('class="why"');
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

const BASE = { prev: { lost: 0.3, hours: 5, leadP50: 1200, leadP90: 9000, queueP50: 60, queueP90: 300, landed: 5, firstPass: 0.8 }, base: { lost: 0.25, hours: 4, leadP50: 1200, leadP90: 9000, queueP50: 60, queueP90: 300, landed: 5, firstPass: 0.8 }, basis: "the previous 7 days" };
const withBase = (d: any, queue = { count: 4, p50: 90, p90: 400 }) => ({ ...d, phases: { ...d.phases, queue }, baseline: BASE });

const USAGE = { now: { seven_day: 7, five_hour: 2, seven_day_resets_at: "2026-11-07T08:00:00Z" }, series: [] };

test("the page order is the status line, Awaiting you, the scorecard, the lanes, the causes; the window picker, no flow strip", () => {
  const page = view.view.render(full);
  const order = ['class="lede"', 'class="asof"', 'class="say', 'data-act="pause"', 'id="needs"', 'id="scorecard"', 'id="lane-running"', 'id="lane-queued"', 'id="lane-done"', 'id="causes"'];
  const at = order.map((t) => page.indexOf(t));
  expect(at.every((v) => v >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
  for (const t of ["wpick", 'id="flow"', 'id="lane-incoming"', 'id="speed"', 'id="efficiency"']) expect(page).not.toContain(t);
});

test("the scorecard has five cards: Lost time, Completion, Landed, Queue wait, Usage", () => {
  const h = view.renderTiles({ ...state, now: "2026-11-01T08:00:00Z", usage: USAGE }, withBase(WEEK), "week");
  expect([...h.matchAll(/<span class="k">([^<]+)</g)].map((m) => m[1])).toEqual(["Lost time", "Completion", "Landed", "Queue wait", "Usage"]);
  expect([...h.matchAll(/<b>(.*?)<\/b>/g)].map((m) => m[1])).toEqual(["38%<em> / 6.0h</em>", "26m<em> / 4h36m</em>", "7<em> / 91%</em>", "1m<em> / 6m</em>", "7%"]);
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

test("a card has no trend without a baseline or with a zero baseline of a count", () => {
  const h = view.renderTiles({ ...state, usage: USAGE }, WEEK, "week");
  expect(h).not.toContain('class="tr');
  const z = view.renderTiles({ ...state, usage: USAGE }, { ...withBase(WEEK), baseline: { ...BASE, base: { ...BASE.base, landed: 0 } } }, "week");
  expect(z).not.toContain("Previous 5;");
});

test("the scorecard before the data arrives: dashes, and usage unknown with no usage", () => {
  const h = view.renderTiles({ ...state, usage: undefined }, null);
  expect(h.match(/<b>–/g)?.length).toBe(5);
  expect(h).not.toContain('class="tr');
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
  await view.mountStatus({ querySelector: (s: string) => (s === "#scorecard" ? tiles : s === "#causes" ? causes : null) }, { ...state, usage: USAGE, now: "2026-11-01T08:00:00Z" }, async (u: string) => { urls.push(u); return { ok: true, json: async () => ({ ...WEEK, baseline: BASE }) }; });
  expect(urls).toEqual(["/api/speed?window=week&baseline=1"]);
  expect(tiles.innerHTML).toContain("<b>38%<em> / 6.0h</em></b>");
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

const pressedIn = (h: string) => [...(h.match(/data-name="window">(.*?)<\/div>/)?.[1] ?? "").matchAll(/data-value="(\w+)" aria-pressed="(\w+)"/g)];

test("the page head holds the Hour, Day, Week, Month picker with the chosen window pressed", () => {
  const page = view.view.render(full, {}, new URLSearchParams("window=month"));
  const head = page.match(/<header class="ph">.*?<\/header>/)![0];
  expect(head).toContain("<h1>Status</h1>");
  expect(head).toContain('class="aside"');
  expect(pressedIn(head).map((m) => m[1])).toEqual(["hour", "day", "week", "month"]);
  expect(pressedIn(head).filter((m) => m[2] === "true").map((m) => m[1])).toEqual(["month"]);
  for (const t of [">Hour<", ">Day<", ">Week<", ">Month<"]) expect(head).toContain(t);
  expect(pressedIn(view.view.render(full, {}, new URLSearchParams())).filter((m) => m[2] === "true").map((m) => m[1])).toEqual(["week"]);
});

test("the cards follow the window: links keep it, and a trend reads the window's baseline", () => {
  const h = view.renderTiles({ ...state, usage: USAGE }, withBase({ ...WEEK, window: "hour" }), "hour");
  expect(h).toContain('href="#/factory/efficiency?window=hour"');
  expect(h).toContain('href="#/factory/jobs?window=hour"');
  expect(h).toContain('href="#/factory/agents"');
});

test("mountStatus loads the window of the address", async () => {
  const g: any = globalThis;
  g.localStorage = { getItem: () => null, setItem: () => {} };
  g.location = { hash: "#/?window=hour" };
  g.history = { replaceState: () => {} };
  // @ts-ignore plain JS shared with the page
  const { resetSpeed } = await import("./views/speed.js");
  resetSpeed();
  const urls: string[] = [];
  await view.mountStatus({ querySelector: () => null }, { ...state, usage: USAGE }, async (u: string) => { urls.push(u); return { ok: true, json: async () => WEEK }; }, new URLSearchParams("window=hour"));
  expect(urls).toEqual(["/api/speed?window=hour&baseline=1"]);
  resetSpeed();
  delete g.localStorage; delete g.location; delete g.history;
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

test("an ask and a stuck card start their meta row with the id, then the kind mark, the priority, the date and the duration, and keep the choices below the face", () => {
  const row = view.askRow({ key: "issue:aleph-7", reason: "question", kind: "input", id: "aleph-7", href: "#/issues/aleph/7", title: "Which?", problem: "p", situation: "s", explained: true, repo: "aleph", priority: "high",
    at: "2026-10-27T10:05:00", since: "2026-10-27T09:00:00", part: { n: 1, m: 2, parent: "aleph-6", href: "#/issues/aleph/6" },
    actions: [{ act: "answer", label: "Answer", hint: "h", primary: true, args: {}, recommended: false }], details: {} } as any, "2026-10-27T11:05:00");
  const head = row.match(/<div class="ih">[^]*?<\/div>/)![0];
  const order = ["idl", "kind-tag", "badge need\">high", 'class="part"', "num date\">10/27 10:05", "num dur\">2h05m"].map((x) => head.indexOf(x));
  expect(order.every((i) => i >= 0)).toBe(true);
  expect(order).toEqual([...order].sort((a, b) => a - b));
  expect(row.indexOf('class="t"')).toBeGreaterThan(row.indexOf("</div>"));
  expect(row.indexOf('class="actions choices"')).toBeGreaterThan(row.indexOf('class="t"'));
});
