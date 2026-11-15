import { afterAll, beforeAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_REASONS } from "../jobs/lib/asks/ask.ts";
import { SECURITY_PATHS } from "../jobs/lib/gates/gate.ts";
import { LOG_MAX, gatesBody, log, metrics, rules, securityFacts } from "./api/gates.ts";
import { reasonText, type AskItem } from "./asks.ts";
import { withEnv, withServer } from "./test-server.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { day, pct, tone, when } from "./lib.js";
// @ts-ignore gates.js is plain JS, shared with the page
import * as gates from "./views/gates.js";
import { allHolds, recordHold, setTick, type HoldRecord } from "../jobs/lib/gates/factory-status.ts";
import { issueDecision } from "../jobs/lib/gates/issue-decision.ts";
import { conn, getJson, putJson } from "../lib/db.ts";
import { seed } from "../jobs/job.testkit.ts";
import { logEvent } from "../lib/layout.ts";
import { contentText, setCodes } from "../lib/naming.ts";
import { writeRepos } from "../tests/projects.ts";

/** Make `rows` the only hold records: a hold is the event of its gate on an issue, a `started` record the rule's `started` event. */
function setHolds(rows: HoldRecord[]): void {
  conn().run("DELETE FROM events WHERE object LIKE 'issue.%' AND ((subject = 'gate' AND action NOT IN ('question', 'answered')) OR (subject = 'rule' AND action = 'started'))");
  for (const x of rows) {
    if (x.kind === "started") logEvent({ time: x.at, subject: "rule", action: "started", object: x.name, detail: x.text });
    else if (x.event) logEvent(x.event);
  }
}

// The test's clock: the code under test reads it, and the fixtures sit at known distances from it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
beforeAll(() => setSystemTime(NOW));
afterAll(() => setSystemTime());

let base: string, stop: () => void, restoreEnv: () => void, at: (path: string, init?: RequestInit) => Promise<Response>, calls: string;
const ago = (min: number) => new Date(NOW - min * 60_000).toISOString();
const post = (p: string) => at(p, { method: "POST", headers: { "X-Aleph-UI": "1" } });

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-gates-"));
  // No git store and no repo: this file shares its process with ui/state-load.test.ts, whose timer a blocking git call would stall.
  writeRepos({
    held: { path: join(base, "held-repo"), sandbox: true, held: ["src/auth/**"] },
    plain: { path: join(base, "plain-repo"), sandbox: true },
    alpha: { path: join(base, "alpha"), sandbox: true }, "alpha-ui": { path: join(base, "alpha-ui"), sandbox: true }, beta: { path: join(base, "beta"), sandbox: true },
  }, join(base, "items"));
  const factory = join(base, "factory");
  mkdirSync(factory);
  putJson("settings", "always", { rescue: { action: "resolve", at: ago(30) }, "run-cap": { action: "continue", at: ago(40) }, "proposal-claude-md:global": { action: "approve", at: ago(50) } });
  calls = join(base, "calls");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${calls}\necho '{}'\nexit 0\n`);
  chmodSync(fake, 0o755);
  // systemctl answers `show` with a 1min tick and a 1h suite, and logs every call.
  const systemctl = join(base, "systemctl");
  writeFileSync(systemctl, `#!/bin/sh\necho "$@" >> ${join(base, "systemctl.log")}\ncase "$*" in *"show aleph-tick"*) echo "TimersMonotonic={ OnUnitActiveUSec=1min ; next_elapse=1min }";; *"show aleph-suite"*) echo "TimersMonotonic={ OnUnitActiveUSec=1h ; next_elapse=1h }";; esac\n`, { mode: 0o755 });
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_ITEMS: join(base, "items"), ALEPH_FACTORY_DIR: factory, ALEPH_CLI: fake, ALEPH_SYSTEMCTL: systemctl, ALEPH_UNIT_DIR: join(base, "config/systemd/user") });
  setHolds([
    // The log shows a hold's stored event, not its text; a hold with no event has no row.
    { at: ago(5), name: "issue.3", kind: "gate", text: "5 agent runs are live", event: { time: ago(5), subject: "gate", object: "issue.3", action: "full", detail: "local" } },
    { at: ago(6), name: "issue.13", kind: "pause", text: "paused" },
    { at: ago(4), name: "issue.3", kind: "started", text: "started" },
    { at: ago(60 * 24 * 9), name: "issue.4", kind: "gate", text: "too old" },
  ]);
  ({ stop, at } = await withServer({ warm: false }));
});
// Each test starts with no events and no caps row: the ones it reads, it writes.
const clearEvents = () => void conn().run("DELETE FROM events");
beforeEach(() => { clearEvents(); conn().run("DELETE FROM settings WHERE key = 'caps'"); });
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

// The body of GET /api/automation.
const body = async () => JSON.parse(JSON.stringify(gatesBody(await securityFacts())));

test("the body of /api/automation has every section, one rule per Ask reason with only its supported modes, and the held paths of gate.ts", async () => {
  const d: any = await body();
  expect(Object.keys(d).sort()).toEqual(["backend", "baseline", "capEnv", "gated", "held", "log", "metrics", "monitor", "now", "repoHeld", "rules", "schedules", "settings"]);
  expect(d.baseline).toEqual([]);
  expect(d.rules.map((r: any) => r.reason)).toEqual(Object.keys(ASK_REASONS));
  for (const r of d.rules) expect(r.mode).toBe(ASK_REASONS[r.reason].always);
  const by = (k: string) => d.rules.find((r: any) => r.reason === k);
  expect(by("rescue").granted.action).toBe("resolve");
  expect(by("proposal-claude-md").places).toEqual(["proposal-claude-md:global"]);
  expect(d.held).toEqual(SECURITY_PATHS);
  expect(d.repoHeld).toEqual([{ repo: "held", held: ["src/auth/**"] }]);
});

test("the body names the held backend and the line it holds with, and the backend gate row binds while the hold is up", async () => {
  const why = "API Error: 402 This request would exceed your available credits";
  try {
    putJson("state", "backend-hold", { via: "openrouter", why, since: ago(10) });
    const d: any = await body();
    expect(d.backend).toEqual({ via: "OpenRouter", why });
    expect(d.gated).toEqual({ gate: "backend", why: `waits for OpenRouter: ${why}`, text: `Waiting for OpenRouter: ${why}` });
  } finally { putJson("state", "backend-hold", null); }
  // No hold: the body names no backend, and no factory gate binds.
  const d: any = await body();
  expect(d.backend).toBeNull();
  expect(d.gated).toBeNull();
});

/** An entry as one line: subject, object, action and detail. */
const line = (x: any) => [x.subject, x.object, x.action, x.detail ?? "-"].join(" | ");

test("the log reads the hold, the rules Chris set, and the old rule, director and firefighter lines as events, newest first, 7 days back", async () => {
  logEvent({ time: ago(5), subject: "gate", action: "full", object: "issue.3", detail: "local" });
  logEvent({ time: ago(3), subject: "rule", action: "reran", object: "issue.5", detail: "rescue" });
  logEvent({ time: ago(2), subject: "firefighter", action: "answered", object: "issue.6", detail: "issue.6: picked the plain option" });
  logEvent({ time: ago(2.5), subject: "director", action: "reran", object: "issue.8", detail: "the cause is fixed" });
  const d: any = await body();
  const e = d.log.entries;
  expect(d.log.days).toBe(7);
  expect(e.map(line)).toEqual([
    "firefighter | issue.6 | answered | issue.6: picked the plain option",
    "director | issue.8 | reran | the cause is fixed",
    "rule | issue.5 | reran | rescue",
    "gate | issue.3 | full | local",
    "human | rescue | changed | set to resolve",
    "human | run-cap | changed | set to continue",
    "human | proposal-claude-md:global | changed | set to approve",
  ]);
});

test("a hold writes its event, and the log shows it as busy with the job and the file's base name", () => {
  const was = allHolds();
  try {
    const d = issueDecision({ name: "issue.1420", item: { id: 1420, notes: [], spec: "", fm: {} } as any, done: () => false, busy: { why: "waits for issue.1372: both change the busy file ui/views/issues.js", on: "issue.1372", file: "ui/views/issues.js" } });
    recordHold("issue.1420", d.kind as any, d.why, d.ev);
    const e = log().find((x) => x.object === "issue.1420")!;
    expect(e).toMatchObject({ subject: "gate", action: "busy", detail: "issue.1372 holds ui/views/issues.js" });
    // The registry of this test has no code: the page gets the codes with the body.
    setCodes({ aleph: "a" });
    expect(contentText(e)).toBe("issue.1372 holds ui/views/issues.js");
    const h = gates.renderLog({ log: { entries: [e] }, codes: { aleph: "a" } });
    // An issue key names no repo, so the log shows its shown form and links nothing.
    expect(h).toContain("</td><td>i-01420</td><td>");
    expect(h).toContain('<tr><td class="time lead">');
    expect(h).toContain('</td><td>busy</td><td class="wide" title="issue.1372 holds ui/views/issues.js">i-01372 holds ui/views/issues.js</td>');
  } finally { setHolds(was); }
});

test("renderLog links an issue key to its page when the entry carries its project", () => {
  const e = { time: "2026-11-14T10:00:00Z", subject: "rule", action: "reran", object: "issue.1420", detail: "after issue.1372", project: "aleph" };
  const h = gates.renderLog({ log: { entries: [e] } });
  expect(h).toContain('href="#/issues/aleph/1420"');
  expect(h).not.toContain('href="#/issues/aleph/1372"');
  const j = gates.renderLog({ log: { entries: [{ ...e, object: "job.7", object_target: "issue.1420" }] } });
  expect(j).toContain('href="#/issues/aleph/1420"');
});

test("a director decision shows its action, and its long detail only behind the row's button", () => {
  const note = `Director: landed over the reviewer hold. ${"word ".repeat(60)}`.trim();
  try {
    logEvent({ subject: "director", action: "landed", object: "r-12", detail: `over review: ${note}` });
    const e = log().find((x) => x.object === "r-12")!;
    expect(line(e)).toBe(`director | r-12 | landed | over review: ${note}`);
    const h = gates.renderLog({ log: { entries: [e] } });
    expect(h).toContain(`<td>landed</td><td class="wide" title="over review: ${note}"><div class="clamp">over review: ${note}</div><button class="link clamp-btn" type="button" aria-expanded="false">Show more</button></td>`);
  } finally { clearEvents(); }
});

test("POST /api/automation/rules/:reason/revoke runs `aleph always revoke`, and refuses a request without the UI header", async () => {
  expect((await post("/api/automation/rules/rescue/revoke")).status).toBe(200);
  expect(readFileSync(calls, "utf8").trim().split("\n").at(-1)).toBe("always revoke -- rescue");
  const n = readFileSync(calls, "utf8").length;
  expect((await at("/api/automation/rules/rescue/revoke", { method: "POST" })).status).toBe(403);
  expect(existsSync(calls) && readFileSync(calls, "utf8").length).toBe(n);
});

test("rules() gives each reason row its timeout minutes and no-answer action, and POST timeout passes the action on", async () => {
  try {
    putJson("settings", "timeouts", { "held-path": 30, "core-change": 30, question: { minutes: 20, then: "drop" } });
    const row = (reason: string) => rules().find((x) => x.reason === reason)!;
    expect(row("held-path").timeout).toBeUndefined();
    expect(row("core-change").timeout).toBeUndefined();
    const held = gates.renderRules({ rules: [row("held-path")] });
    expect(held).not.toContain('data-field="wait"');
    expect(held).toContain("Keep waiting");
    expect(gates.renderRules({ rules: [row("question")] })).toContain('data-field="wait"');
    expect([row("question").timeout, row("question").noAnswer]).toEqual([20, "drop"]);
    expect([row("no-commit").timeout, row("no-commit").noAnswer]).toEqual([0, "pick"]);
    expect(row("proposal-check").timeout).toBeUndefined();
    const send = (minutes: number, then?: string) => at("/api/automation/rules/question/timeout", { method: "POST", headers: { "X-Aleph-UI": "1", "Content-Type": "application/json" }, body: JSON.stringify({ minutes, then }) });
    expect((await send(20, "drop")).status).toBe(200);
    expect(readFileSync(calls, "utf8").trim().split("\n").at(-1)).toBe("always timeout -- question 20 drop");
    expect((await send(20, "wait")).status).toBe(400);
  } finally { conn().run("DELETE FROM settings WHERE key = 'timeouts'"); }
});

const askItem = (reason: string, id: string): AskItem => ({ key: `issue:${id}`, reason, card: "decide", label: "Decide", headline: `t ${id}`, tag: "", id, href: `#/issues/r/${id.split("-")[1]}`, title: `t ${id}`, problem: `p ${id}`, situation: `p ${id}`, escalated: true,
  actions: [{ act: "checked", label: "Mark it checked", hint: "Records it.", primary: true, path: `/api/issues/${id}/checked`, body: {}, recommended: false }], details: {}, repo: "r" });

const data = () => ({
  now: new Date(NOW).toISOString(),
  schedules: [{ name: "tick", last: null, result: null }],
  factory: { paused: false, liveRuns: 5, liveCap: 5, runCap: 3, runStarts: 2, capEnv: { live: false, run: false } },
  metrics: { days: 7, rate: { auto: 3, total: 4, percent: 75 }, catches: { fired: 6, fixed: 2 }, held: { goals: 2, hours: 3 } },
  gated: { gate: "live-cap", why: "5 agent runs are live", text: "Waiting for a slot (5 of 5 running)" },
  baseline: [{ repo: "r", state: "green", line: "r abc1234" }],
  asks: [askItem("run-cap", "r-1")],
  rules: Object.entries(ASK_REASONS).map(([reason, r]) => ({ reason, ...reasonText(reason), mode: r.always, fired: 0, decided: { rule: 0, director: 0, chris: 0 }, outcome: { fixed: 0, none: 0 }, granted: reason === "rescue" ? { action: "resolve", at: ago(1) } : null, ...(reason.startsWith("proposal-") ? { places: [] } : {}) })),
  held: SECURITY_PATHS,
  repoHeld: [{ repo: "r", held: ["src/auth/**"] }],
  log: { days: 7, max: 200, entries: [{ time: ago(1), subject: "rule", object: "r-5", action: "reran", detail: "rescue" }, { time: ago(2), subject: "human", object: "rescue", action: "changed", detail: "set to resolve" }] },
});

test("the view draws the sections in order, a closed gate, and an Edit row with only Director and the reason's mode", () => {
  const h = gates.renderGates(data());
  const order = ["Waiting for the User", "Rules", "Controls", "Held Paths", "Log"].map((t) => h.indexOf(`>${t}</h2>`));
  expect(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1]))).toBe(true);
  // The three metric tiles; no Gates now state cards.
  const tiles = [...h.matchAll(/<div class="tile sc"[^>]*><span class="r1"><span class="k">([^<]*)<\/span>/g)].map((m) => m[1]);
  expect(tiles).toEqual(["Automation rate", "Gate catches", "Held time"]);
  expect(h).toContain('<section class="tiles" aria-label="Metrics">');
  expect(h).not.toContain("gtile");
  expect(h).not.toContain("gt-head");
  expect(h).toContain("<b>75%<em> / 4</em></b>");
  expect(h).toContain("<b>6<em> / 2</em></b>");
  expect(h).toContain("<b>3.0h<em> / 2</em></b>");
  expect(h).not.toContain("Gates now");
  expect(h).not.toContain('data-cap="day"');
  expect(h).not.toContain('data-cap="awaiting"');
  expect(h).not.toContain("Edit caps");
  for (const [reason, r] of Object.entries(ASK_REASONS)) {
    const form = h.split('<form class="rule-form"').find((x: string) => x.startsWith(` data-rule="${reason}"`));
    const modes = form ? [...form.slice(form.indexOf('data-field="decide"')).split("</div>")[0].matchAll(/data-value="([^"]*)"/g)].map((m) => m[1]) : [];
    // A memory proposal is granted per place, so it has no Edit row; every other reason offers Director, its mode and User.
    if (reason.startsWith("proposal-")) expect(form).toBeUndefined();
    else expect(modes).toEqual(["", ...(r.always ? [r.always] : []), "user"]);
  }
  expect(h).not.toContain("The director decides first");
  const rescue = h.slice(h.indexOf('data-rule="rescue"'));
  expect(rescue).toMatch(/data-value="resolve" aria-pressed="true">Take the pick</);
  expect(h.match(/<tr class="rule" data-reason=/g)).toHaveLength(Object.keys(ASK_REASONS).length);
  for (const p of SECURITY_PATHS) expect(h).toContain(`<code class="chip">${p}</code>`);
  const card = gates.renderHeld(data());
  expect(card).toContain("<dt>r</dt>");
  expect(card).toContain('<code class="chip">src/auth/**</code>');
  for (const p of SECURITY_PATHS) expect(card).toContain(`<code class="chip">${p}</code>`);
  expect(gates.renderHeld({ ...data(), repoHeld: [] })).toContain('<div class="empty"><p>No data</p></div>');
});

const entry = (subject: string, action = "answered", object = "r-1") => ({ time: ago(1), subject, object, action }) as any;
const rec = (min: number, name: string, kind: string) => ({ at: ago(min), name, kind, text: "t" });

test("the automation rate is the rule and director decisions over those and Chris's answers; his rule changes, a director escalation and a second event of one decision do not count", () => {
  const e = [entry("rule", "reran"), entry("rule", "reran", "r-2"), entry("director", "reran"), entry("director", "filed"), entry("director", "escalated", "r-3"), entry("human"), entry("human", "changed", "rescue")];
  expect(metrics(e, []).rate).toEqual({ auto: 3, total: 4, percent: 75 });
  expect(metrics([], []).rate).toBeNull();
});

test("the body's automation rate counts every decision in the 7 days, past the log's cap of each actor", async () => {
  const before = (await body()).metrics.rate ?? { auto: 0, total: 0 };
  for (let i = 0; i < LOG_MAX; i++) logEvent({ time: ago(5 + i / 100), subject: "rule", action: "reran", object: `r-${i}`, detail: "rescue" });
  try {
    const after = (await body()).metrics.rate;
    expect(after.auto - before.auto).toBe(LOG_MAX);
    expect(after.total - before.total).toBe(LOG_MAX);
  } finally {
    clearEvents();
  }
});

test("the held time sums, over the issues, the hours from a hold to the next start, or to now, in the 7 days", () => {
  const h = [rec(300, "a-1", "gate"), rec(120, "a-1", "started"), rec(60, "b-1", "gate"), rec(30, "b-1", "gate"), rec(60 * 24 * 9, "c-1", "gate"), rec(60 * 24 * 8, "c-1", "started")];
  expect(metrics([], h, NOW).held).toEqual({ goals: 2, hours: 4 });
});

test("gate catches are the builds a check or the reviewer sent back in the 7 days, against those a later build of the job passed", () => {
  const run = (job: string, min: number, state: string, failed?: string) => ({ run: { n: 1, job, role: "build", state, started: ago(min), ...(failed ? { failed } : {}) } });
  const r = (runs: any[]) => runs as any;
  const records = [
    r([run("j1", 300, "returned", "tests"), run("j1", 200, "returned", "review"), run("j1", 100, "landed")]),
    r([run("j2", 300, "returned", "types")]), r([run("j3", 200, "passed")]),
    r([run("j4", 60 * 24 * 9, "returned", "tests"), run("j4", 60, "passed")]),
  ];
  expect(metrics([], [], NOW, records).catches).toEqual({ fired: 3, fixed: 2 });
});

test("the log filter keeps one actor's entries", () => {
  const h = gates.renderLog(data(), "human");
  expect(h).toMatch(/class="seg"[^>]*>.*aria-pressed="true">human</);
  expect(h).not.toContain("fchip");
  expect(h).toContain('</td><td><a href="#rules">rescue</a></td><td>');
  expect(h).toContain(`</td><td>changed</td><td class="wide"`);
  expect(h).not.toContain("r-5");
  expect(h).toContain('<tr><th>Logged</th><th>Object</th><th>Subject</th><th>Action</th><th>Detail</th><th class="num">Times</th></tr>');
  expect(h).toContain(`<td class="wide" title="set to resolve">set to resolve</td>`);
  expect(gates.renderLog(data(), "rule")).not.toContain("set to resolve");
});

test("renderLog shows a missing action, and each By badge takes its tone from tone()", () => {
  const time = new Date(NOW).toISOString();
  const h = gates.renderLog({ log: { entries: [{ time, subject: "rule", object: "x-1" }] } } as any);
  expect(h.match(/<td><span title="no action">–<\/span><\/td>/g)).toHaveLength(1);
  expect(Object.keys(gates.BY)).toEqual(["human", "rule", "director", "firefighter", "gate"]);
  for (const by of Object.keys(gates.BY)) expect(gates.renderLog({ log: { entries: [{ time, subject: by, object: "x-1", action: "a" }] } } as any)).toContain(`<span class="badge ${tone(by)}">${by}</span>`);
  expect(new Set(Object.keys(gates.BY).map(tone)).size).toBe(5);
});

test("renderLog shows 50 rows with a pager; a Gate run shows its count in Times", () => {
  const e = (n: number): any => ({ time: new Date(NOW - n * 1000).toISOString(), subject: "rule", object: "x-1", action: "reran", detail: `t${n}` });
  const entries = Array.from({ length: 120 }, (_, i) => e(i));
  entries[0] = { ...entries[0], subject: "gate", times: 3, first: entries[1].time };
  const h = gates.renderLog({ log: { entries } } as any);
  expect(h.match(/<tr>/g)!.length - 1).toBe(50);
  expect(h).toContain("1–50 of 120");
  expect(h).toContain("Next 50");
  expect(h).toContain('<td class="num">3</td>');
  expect(h).not.toContain("×3");
});

const withHolds = (rows: HoldRecord[], f: () => void) => {
  const was = allHolds();
  setHolds(rows);
  try { f(); } finally { setHolds(was); }
};
const hold = (min: number, name = "issue.9", text = "busy") => ({ at: ago(min), name, kind: "gate", text, event: { time: ago(min), subject: "gate", object: name, action: "busy" } });
const gateLines = () => log().filter((e) => e.subject === "gate");

test("log collapses a run of identical gate events into one with times, first and last time", () => {
  withHolds([hold(30), hold(20), hold(10)], () => {
    const g = gateLines();
    expect(g.length).toBe(1);
    expect(g[0].times).toBe(3);
    expect(Date.parse(g[0].first!)).toBeCloseTo(NOW - 30 * 60_000, -4);
    expect(Date.parse(g[0].time)).toBeCloseTo(NOW - 10 * 60_000, -4);
  });
});

const postCaps = (b: unknown, headers: Record<string, string> = { "X-Aleph-UI": "1" }) => at("/api/automation/caps", { method: "POST", headers, body: JSON.stringify(b) });

test("POST /api/automation/caps refuses a missing header with 403 and bad values with 422, and leaves the file", async () => {
  const seed = { live: 9 };
  putJson("settings", "caps", seed);
  expect((await postCaps({ live: 5 }, {})).status).toBe(403);
  for (const v of [0, -1, 2.5, "x"]) {
    const r = await postCaps({ live: v });
    expect(r.status).toBe(422);
    expect(typeof (await r.json()).error).toBe("string");
  }
  expect(getJson<unknown>("settings", "caps", null)).toEqual(seed);
});

test("the Gates page says the user, never you, your or Chris, in its visible text", () => {
  const d = data();
  const text = (h: string) => h.replace(/<[^>]*>/g, " ");
  const h = gates.renderGates({ ...d, asks: [] });
  expect(h).toContain(">Waiting for the User</h2>");
  expect(h).toContain('<div class="empty"><p>No data</p></div>');
  expect(h).toContain("wait for the user after the reviewer passes the job");
  expect(text(h)).not.toMatch(/\b(you|your|Chris)\b/i);
});

test("a cap post writes the live cap only and leaves the old day and awaiting keys alone", async () => {
  putJson("settings", "caps", { day: 999, awaiting: 5 });
  const r = await postCaps({ live: 3, day: 7 });
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ live: 3, run: 3, intakeTries: 2, jobSeconds: 1800, fixRounds: 2, landBatch: 8 });
  expect(getJson<any>("settings", "caps", {})).toEqual({ day: 999, awaiting: 5, live: 3 });
});

test("a cap post writes the run cap and refuses 0", async () => {
  putJson("settings", "caps", {});
  const r = await postCaps({ run: 5 });
  expect(r.status).toBe(200);
  expect((await r.json()).run).toBe(5);
  expect(getJson<any>("settings", "caps", {}).run).toBe(5);
  expect((await postCaps({ run: 0 })).status).toBe(422);
});

test("a cap post writes the settings; fix rounds take 0 and the rest refuse it", async () => {
  putJson("settings", "caps", {});
  const r = await postCaps({ fixRounds: 0, jobSeconds: 2400, intakeTries: 3, landBatch: 4, loadLimit: 12 });
  expect(r.status).toBe(200);
  // The preload sets ALEPH_LOAD_LIMIT, which wins over the file: the file holds the load limit.
  expect(await r.json()).toMatchObject({ fixRounds: 0, jobSeconds: 2400, intakeTries: 3, landBatch: 4 });
  expect(getJson<any>("settings", "caps", {}).loadLimit).toBe(12);
  for (const k of ["jobSeconds", "intakeTries", "landBatch", "loadLimit"]) expect((await postCaps({ [k]: 0 })).status).toBe(422);
  expect((await postCaps({ fixRounds: -1 })).status).toBe(422);
  putJson("settings", "caps", {});
});

test("the Caps section holds a form each for the two caps, with use against limit, then one per setting, and no day cap", () => {
  const h = gates.renderCaps({ ...data(), factory: { ...data().factory, settings: { intakeTries: 2, jobSeconds: 1800, fixRounds: 2, landBatch: 8, loadLimit: 24 } } });
  expect([...h.matchAll(/data-cap="([^"]*)"/g)].map((m) => m[1])).toEqual(["live", "run", "intakeTries", "jobSeconds", "fixRounds", "landBatch", "loadLimit"]);
  expect(h).toContain('for="cap-jobSeconds">Job time limit</label>');
  expect(h).toContain('name="jobSeconds" type="number" id="cap-jobSeconds" value="1800"');
  expect(h).toMatch(/name="fixRounds"[^>]* min="0"/);
  expect(h).toContain("Live jobs against the cap: 5 of 5 now.");
  expect(h).toContain("in the last hour: 2 of 3.");
  expect(h).not.toContain("day");
  expect(gates.renderGates(data())).toContain(">Controls</h2>");
});

test("the cap row and the rule hints say job and issue, with no goal and no Run cap", () => {
  const h = gates.renderGates(data());
  const caps = h.slice(h.indexOf('<section class="card" id="gates-caps"'), h.indexOf('aria-label="Held paths"'));
  expect(caps).toContain(">Job cap</label>");
  expect(caps).toContain("Live jobs against the cap");
  expect(caps).toContain("The most starts any one issue made in the last hour");
  const rules = h.slice(h.indexOf('<section class="card" id="rules"'));
  expect(rules).toContain("Jobs with no commit");
  expect(rules).toContain("The last 3 jobs of an issue ended with nothing committed.");
  expect(rules).toContain("An issue started 3 times in one hour.");
  expect(rules).toContain("A sub-issue of an issue was dropped and no other sub-issue is open.");
  expect(h).not.toContain("Run cap");
  expect(h.replace(/<[^>]*>/g, "")).not.toMatch(/goal/i);
});

test("the view is Automation at #/automation in the Factory group; #/gates redirects; the By filter is buttons, not links", () => {
  expect(gates.view.path).toBe("/automation");
  expect(gates.view.title).toBe("Automation");
  expect(gates.view.group).toBe("factory");
  const h = gates.renderGates(data());
  expect(h).toContain("<h1>Automation</h1>");
  expect(h).not.toContain("<h1>Gates</h1>");
  expect(h).not.toContain('href="#/automation?by=');
  expect(h).not.toContain("#/gates");
  expect(gates.redirect("#/gates")).toBe("#/automation");
  expect(gates.redirect("#/gates?by=director")).toBe("#/automation?by=director");
  expect(gates.redirect("#/automation")).toBeNull();
});

test("the Automation page has no explaining aside; the controls panel holds the cap forms and no Pause button, before Held paths, each full width", () => {
  for (const paused of [false, true]) {
    const h = gates.renderGates({ ...data(), gated: null, factory: { ...data().factory, paused } });
    const head = h.slice(h.indexOf('<header class="ph">'), h.indexOf("</header>"));
    expect(head).not.toContain("data-act");
    expect(head.indexOf('<select name="project"')).toBeGreaterThan(-1);
    expect(head.indexOf('<select name="project"')).toBeLessThan(head.indexOf('data-name="window"'));
    expect(h).not.toContain('data-act="pause"');
    expect(h).not.toContain('data-act="resume"');
    const panel = h.slice(h.indexOf('<section class="card" id="gates-caps"'), h.indexOf('aria-label="Held paths"'));
    expect(panel).toContain('data-cap="live"');
    expect(panel).toContain('data-cap="run"');
    expect(h).not.toContain("gates-two");
    expect(h).not.toContain('<div class="pair">');
    expect(h.indexOf('id="gates-caps"')).toBeLessThan(h.indexOf('id="gates-held"'));
  }
  const h = gates.renderGates(data());
  for (const t of ["What can stop, hold or ask", "Every goal passes these in order", "Who decides each kind of Ask"]) expect(h).not.toContain(t);
});

test("rules() has one row per Ask reason; renderRules is one table with a row per rule", () => {
  const r = rules().map((x) => x.reason);
  expect(r).toEqual(Object.keys(ASK_REASONS));
  for (const k of ["proposal-check", "proposal-claude-md", "proposal-skill", "question", "held-path"]) expect(r).toContain(k);
  const h = gates.renderRules({ rules: rules() });
  expect(h.match(/<table/g)!.length).toBe(1);
  expect(h.match(/<tr class="rule" data-reason="/g)!.length).toBe(r.length);
});

test("a stored firefighter grant for held-path is dead: rules() shows no grant and Decides offers Director, Approve and User", () => {
  const saved = getJson("settings", "always", {});
  try {
    putJson("settings", "always", { "held-path": { action: "firefighter", at: ago(5) } });
    const row = rules().find((x) => x.reason === "held-path")!;
    expect(row.granted).toBeNull();
    const h = gates.renderRules({ rules: [row] });
    expect(h).not.toContain("always.json grants");
    expect(h).not.toContain("firefighter");
    expect(h).toMatch(/data-value="" aria-pressed="true">Director<\/button><button type="button" data-value="approve" aria-pressed="false">Approve<\/button><button type="button" data-value="user" aria-pressed="false">User</);
  } finally { putJson("settings", "always", saved); }
});

test("a reason granted user shows User in Decides, and the proposal-skill row offers no User choice", () => {
  const saved = getJson("settings", "always", {});
  try {
    putJson("settings", "always", { "held-path": { action: "user", at: ago(5) } });
    const all = rules();
    const held = gates.renderRules({ rules: all.filter((x) => x.reason === "held-path") });
    expect(held).toContain("<td>User</td>");
    expect(held).toMatch(/data-value="user" aria-pressed="true">User</);
    const skill = gates.renderRules({ rules: all.filter((x) => x.reason === "proposal-skill") });
    expect(skill).not.toContain('data-value="user"');
  } finally { putJson("settings", "always", saved); }
});

test("a grant that is neither the reason's mode nor user still shows pressed in Decides", () => {
  const saved = getJson("settings", "always", {});
  try {
    putJson("settings", "always", { "intake-failed": { action: "discontinue", at: ago(5) } });
    const h = gates.renderRules({ rules: rules().filter((x) => x.reason === "intake-failed") });
    expect(h).toMatch(/data-value="" aria-pressed="false">Director<\/button><button type="button" data-value="continue" aria-pressed="false">[^<]+<\/button><button type="button" data-value="discontinue" aria-pressed="true">[^<]+<\/button><button type="button" data-value="user" aria-pressed="false">User</);
  } finally { putJson("settings", "always", saved); }
});

test("rules() counts each reason's Asks in the window by who decided them and what followed; renderRules shows the counts", () => {
  const at = (m: number) => new Date(NOW + m * 60_000).toISOString();
  const ask = (n: number, cleared = true) => ({ set: at(n * 10), ...(cleared ? { cleared: at(n * 10 + 1) } : {}), reason: "question" });
  const rec = (n: number, asks: any[]) => asks.map((a) => ({ issue: `issue.${n}`, ...a }));
  // A build that starts after the Ask of issue 1 went is what followed it.
  const built = seed({ role: "build", state: "done", target: "issue.1", started: at(15) }).id;
  const records = [
    ...rec(1, [ask(1)]), ...rec(2, [ask(2)]), ...rec(3, [ask(3)]), ...rec(4, [ask(4), ask(5, false)]),
    ...rec(5, [{ ...ask(6), reason: "run-cap" }]),
  ];
  const e = (n: number, subject: any, object: string, detail?: string): any => ({ time: at(n * 10), subject, object, action: "answered", detail });
  const entries = [e(1, "rule", "issue.1"), e(2, "rule", "issue.2"), e(3, "director", "issue.3"), e(4, "human", "issue.4", "Chris: yes")];
  const row: any = rules(entries, records, NOW + 3600_000).find((x) => x.reason === "question");
  expect(row.fired).toBe(5);
  expect(row.decided).toEqual({ rule: 2, director: 1, chris: 1 });
  expect(row.outcome).toEqual({ fixed: 1, none: 3 });
  const h = gates.renderRules({ rules: [row] });
  expect(h).toContain('<th>Ask</th><th class="num">Fired</th><th>Decided By</th><th>Decides</th><th>If Auto Cannot</th><th>If No Answer</th><th></th>');
  expect(h).not.toMatch(/Manual|<th>[^<]*[()/]/);
  expect(h).toContain('<td class="num">5</td>');
  expect(h).toContain('<small class="split">2 rule · 1 director · 1 user</small>');
  expect(h).toMatch(/<i class="c-rule" style="width:50.0%"><\/i><i class="c-dir" style="width:25.0%"><\/i><i class="c-user" style="width:25.0%"><\/i>/);
  conn().run("DELETE FROM jobs WHERE id = ?", [built]);
});

test("the Monitor panel says the monitor has not run with no report, and holds the newest report with the findings inside the part that expands", async () => {
  const dir = join(process.env.ALEPH_FACTORY_DIR!, "monitor"), file = join(dir, "2026-11-03.json");
  expect((await body()).monitor).toBeNull();
  expect(gates.renderMonitor(await body())).toContain('<div class="empty"><p>No data</p></div>');
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ day: "2026-11-03", table: {}, text: "READER-TEXT", findings: ["FIRST-ONE", "SECOND-ONE"] }));
  try {
    const d: any = await body();
    expect(d.monitor).toMatchObject({ day: "2026-11-03", findings: ["FIRST-ONE", "SECOND-ONE"], text: "READER-TEXT" });
    const [sum, rest] = gates.renderMonitor(d).split("</summary>");
    for (const x of [day("2026-11-03T00:00"), "2 findings", "FIRST-ONE"]) expect(sum).toContain(x);
    expect(sum).not.toContain("SECOND-ONE");
    for (const x of ["FIRST-ONE", "SECOND-ONE", "READER-TEXT"]) expect(rest).toContain(x);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("the Monitor summary shows the report's day as a local day, and 1 finding for one finding", () => {
  const tz = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const h = gates.renderMonitor({ monitor: { day: "2026-11-03", findings: ["ONLY"], text: "", error: null } });
    expect(h).toContain(`${day("2026-11-03T00:00")}: 1 finding.`);
  } finally {
    // Bun reads a new TZ when it is set, not when it is deleted: set UTC back first.
    process.env.TZ = tz ?? "UTC";
    if (tz === undefined) delete process.env.TZ;
  }
});

test("the Monitor draws **text** as bold in the summary and the list, and escapes other HTML in a finding", async () => {
  const dir = join(process.env.ALEPH_FACTORY_DIR!, "monitor"), file = join(dir, "2026-11-03.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ day: "2026-11-03", table: {}, text: "", findings: ["**x** <i>y</i>", "**z**"] }));
  try {
    const [sum, rest] = gates.renderMonitor(await body()).split("</summary>");
    expect(sum).toContain("First: <b>x</b> &lt;i&gt;y&lt;/i&gt;");
    expect(sum).not.toContain("**");
    expect(rest).toContain("<li><b>x</b> &lt;i&gt;y&lt;/i&gt;</li>");
    expect(rest).toContain("<li><b>z</b></li>");
    expect(rest).not.toContain("**");
    expect(rest).not.toContain("<i>");
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("the body has the tick, the suite and the monitor with their last run from the tick table; with no record each has not run", async () => {
  const none: any = (await body()).schedules;
  expect(none).toEqual([{ name: "tick", last: null, result: null, every: "1min" }, { name: "suite", last: null, result: null, every: "1h" }, { name: "monitor", last: null, result: null, every: "1d" }]);
  const h = gates.renderSchedules({ ...(await body()), schedules: none });
  expect(h).toContain(">Schedules</h2>");
  expect(h).toContain(`<th>Schedule</th><th>Every</th><th>Result</th><th class="num">Last Run</th>`);
  expect(h).toContain('<td class="wide" title="tick">tick</td>');
  expect(h).not.toContain("<td><input");
  // The interval sits in its row: a locked number and unit with an Edit button, and none for the monitor.
  expect(h).toMatch(/<form class="every" data-schedule="tick"><input name="n" type="number" id="every-tick" value="1"[^>]* disabled[^>]*><select name="unit"[^>]* disabled><option value="s">seconds<\/option><option value="min" selected>minutes/);
  expect(h).toContain('<button type="button" class="act" data-edit>Edit</button></form>');
  expect(h).toMatch(/data-schedule="suite"><input[^>]*value="1"[^>]*>.*<option value="h" selected>hours/);
  expect(h).not.toContain('data-schedule="monitor"');
  expect(h).toContain("<td>1d</td>");
  expect(h).not.toContain("has not run");
  expect(h.indexOf("Last Run")).toBeLessThan(h.indexOf("<tbody>"));
  const tbody = h.split("<tbody>")[1].split("</tbody>")[0];
  expect(tbody.match(/<tr>/g)).toHaveLength(3);
  expect(tbody).toContain(`<td class="time"></td></tr>`);
  const ran = { "suite plain": { last: ago(11), result: "green" }, "suite held": { last: ago(10), result: "green" }, monitor: { last: ago(50), result: "7 findings" }, ci: { last: ago(9), result: null }, firefight: { last: ago(2), result: null } };
  for (const [k, v] of Object.entries(ran)) setTick(k, v);
  putJson("state", "tick.missed", ["stalled:x"]);
  try {
    const d: any = (await body()).schedules;
    expect(d).toEqual([
      { name: "tick", last: ago(2), result: "1 missed", every: "1min" },
      { name: "suite", last: ago(10), result: "held: green; plain: green", every: "1h" },
      { name: "monitor", last: ago(50), result: "7 findings", every: "1d" },
    ]);
    expect(gates.renderSchedules({ ...(await body()), schedules: d })).not.toContain("has not run");
    const t = gates.renderSchedules({ ...(await body()), schedules: d });
    expect(t).toContain("<td>7 findings</td>");
  } finally {
    conn().run("DELETE FROM tick");
    conn().run("DELETE FROM state");
  }
});

test("renderNow shows a dash, not undefined or NaN, with no rate and no held time", () => {
  const d = data();
  const bare = gates.renderNow({ ...d, metrics: { ...d.metrics, rate: null, held: undefined } });
  expect(bare).not.toMatch(/undefined|NaN/);
  expect(bare).toContain("<b>–</b>");
});

test("GET /api/automation takes window and project: the log and the metrics keep that window and that repo; no parameter keeps 7 days of every repo; a bad window is 400", async () => {
  const m = (min: number) => min * 60 * 24;
  for (const [min, id] of [[30, "alpha-1"], [m(3), "beta-1"], [m(10), "beta-2"], [m(40), "alpha-3"]] as const) logEvent({ time: ago(min), subject: "rule", action: "reran", object: id, detail: "rescue" });
  logEvent({ time: ago(60 * 5), subject: "rule", action: "reran", object: "alpha-2", detail: "rescue" });
  const get = async (q: string) => { const r = await at(`/api/automation${q}`); return { status: r.status, d: r.status === 200 ? await r.json() as any : null }; };
  const items = (d: any) => d.log.entries.map((e: any) => e.object).filter((i: string) => /^(alpha|beta)-/.test(i)).sort();
  try {
    const week = await get("");
    expect(items(week.d)).toEqual(["alpha-1", "alpha-2", "beta-1"]);
    expect(week.d.metrics.days).toBe(7);
    expect(week.d.metrics.rate.total).toBe(3);
    const day = await get("?window=day");
    expect(items(day.d)).toEqual(["alpha-1", "alpha-2"]);
    expect(day.d.metrics.rate.total).toBe(2);
    expect(items((await get("?window=hour")).d)).toEqual(["alpha-1"]);
    expect(items((await get("?window=month")).d)).toEqual(["alpha-1", "alpha-2", "beta-1", "beta-2"]);
    const alpha = await get("?project=alpha");
    expect(items(alpha.d)).toEqual(["alpha-1", "alpha-2"]);
    expect(alpha.d.metrics.rate.total).toBe(2);
    logEvent({ time: ago(30), subject: "rule", action: "reran", object: "alpha-ui-2", detail: "rescue" });
    expect(items((await get("?project=alpha")).d)).toEqual(["alpha-1", "alpha-2"]);
    expect(items((await get("?project=beta&window=month")).d)).toEqual(["beta-1", "beta-2"]);
    expect((await get("?window=year")).status).toBe(400);
  } finally {
    clearEvents();
  }
});

test("every seg group on the Automation page has an accessible name, rule toggles included", () => {
  const h = gates.renderGates(data());
  const groups = h.match(/<div class="seg"[^>]*>/g)!;
  expect(groups.length).toBeGreaterThan(2);
  for (const g of groups) expect(g).toMatch(/aria-label="[^"]+"/);
  expect(h).toContain('aria-label="Who decides ');
});

test("the Held time card reads hours() and the Automation rate reads pct()", () => {
  const d = data();
  const h = gates.renderGates({ ...d, metrics: { ...d.metrics, held: { goals: 2, hours: 3513.1 }, rate: { auto: 1, total: 8, percent: 12.5 } } });
  expect(h).toContain("<b>3513h<em>");
  expect(h).toContain(`<b>${pct(12.5)}<em>`);
});

test("Monitor, Schedules, Rules and Log are each a card that keeps its id", async () => {
  const d = { ...(await body()), rules: [], log: { entries: [] } } as any;
  const h = { monitor: gates.renderMonitor(d), "gates-schedules": gates.renderSchedules(d), rules: gates.renderRules(d), "gates-log": gates.renderLog(d) };
  for (const [id, html] of Object.entries(h)) {
    expect(html).toStartWith('<section class="card"');
    expect(html).toContain(`id="${id}"`);
  }
  const dir = join(process.env.ALEPH_FACTORY_DIR!, "monitor"), file = join(dir, "2026-11-03.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ day: "2026-11-03", table: {}, text: "T", findings: ["F"] }));
  try {
    expect(gates.renderMonitor(await body())).toStartWith('<section class="card" id="monitor"');
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("Schedules, Rules and Log show empty() with no rows; the Log pages at 50", () => {
  expect(gates.renderLog({ log: { entries: [] } } as any)).toContain('class="empty"');
  expect(gates.renderLog({ log: { entries: Array.from({ length: 51 }, (_, i) => ({ time: new Date(NOW - i * 1000).toISOString(), subject: "rule", object: "x-1", action: "reran", detail: `t${i}` })) } } as any)).toContain("50 of 51");
  expect(gates.renderSchedules({ schedules: [] })).toContain('class="empty"');
  expect(gates.renderRules({ rules: [] })).toContain('class="empty"');
});

test("POST /api/automation/schedules writes a drop-in that keeps the boot and startup triggers, reloads systemd and restarts the timer; a bad interval or name is 422", async () => {
  const send = (b: unknown) => at("/api/automation/schedules", { method: "POST", headers: { "X-Aleph-UI": "1" }, body: JSON.stringify(b) });
  const res = await send({ name: "tick", every: "5min" });
  expect(res.status).toBe(200);
  const conf = readFileSync(join(base, "config/systemd/user/aleph-tick.timer.d/interval.conf"), "utf8");
  expect(conf).toContain("OnUnitActiveSec=\nOnBootSec=10min\nOnStartupSec=2min\nOnUnitActiveSec=5min\n");
  // The build Worker reads the timers on its own thread, so its `show` lines land among these at any point.
  const wrote = readFileSync(join(base, "systemctl.log"), "utf8").split("\n").filter((l) => !l.includes("show"));
  expect(wrote.join("\n")).toContain("--user daemon-reload\n--user restart aleph-tick.timer\n");
  expect((await send({ name: "tick", every: "5 minutes" })).status).toBe(422);
  expect((await send({ name: "monitor", every: "1h" })).status).toBe(422);
});

test("the Automation page names the held backend and its reason, and no line when none is held", () => {
  const held = gates.renderGates({ ...data(), backend: { via: "OpenRouter", why: "probe failed" } });
  expect(held).toContain(`id="gates-backend">Waiting for OpenRouter: probe failed</p>`);
  expect(gates.renderGates({ ...data(), backend: null })).not.toContain("gates-backend");
});

test("a non-land reason shows its timeout in the largest whole unit with its action, and its Edit row opens on the matching choice", () => {
  const row = (reason: string, timeout: number, noAnswer: string): any => ({ reason, ...reasonText(reason), mode: "", fired: 0, decided: { rule: 0, director: 0, chris: 0 }, outcome: { fixed: 0, none: 0 }, granted: null, timeout, noAnswer });
  const h = gates.renderRules({ rules: [row("question", 120, "pick")] });
  expect(h).toContain("<td>After 2 h: take the pick</td>");
  expect(h).toContain('data-was-wait="120" data-was-then="pick"');
  expect(h).toMatch(/data-value="wait" aria-pressed="false">Keep waiting<\/button><button type="button" data-value="pick" aria-pressed="true">Take the pick<\/button><button type="button" data-value="drop" aria-pressed="false">Drop</);
  expect(h).toMatch(/<input name="n" type="number" value="2"[^>]*>/);
  expect(h).toContain('<option value="h" selected>hours</option>');
  expect(h).toMatch(/data-field="decide"><button type="button" data-value="" aria-pressed="true">Director<\/button><button type="button" data-value="user" aria-pressed="false">User</);
  expect(gates.renderRules({ rules: [row("question", 45, "drop")] })).toMatch(/data-value="drop" aria-pressed="true">Drop</);
  const off = gates.renderRules({ rules: [row("question", 0, "pick")] });
  expect(off).toContain("<td>Keep waiting</td>");
  expect(off).toMatch(/data-value="wait" aria-pressed="true">Keep waiting/);
  expect(off).toMatch(/<input name="n"[^>]* disabled>/);
});

test("Save posts a timeout with the action and minutes when the If No Answer choice changes, and none when it does not", () => {
  const form = (was: { wait: string; then: string }, pressed: string, n: string, unit: string): any => ({
    dataset: { rule: "question", wasDecide: "", wasWait: was.wait, wasThen: was.then },
    elements: { n: { value: n }, unit: { value: unit } },
    querySelector: (q: string) => (q.includes('data-field="wait"') ? { dataset: { value: pressed } } : { dataset: { value: "" } }),
  });
  const url = "/api/automation/rules/question/timeout";
  expect(gates.rulePosts(form({ wait: "0", then: "wait" }, "drop", "2", "h"))).toEqual([[url, { minutes: 120, then: "drop" }]]);
  expect(gates.rulePosts(form({ wait: "120", then: "pick" }, "drop", "2", "h"))).toEqual([[url, { minutes: 120, then: "drop" }]]);
  expect(gates.rulePosts(form({ wait: "120", then: "pick" }, "wait", "2", "h"))).toEqual([[url, { minutes: 0 }]]);
  expect(gates.rulePosts(form({ wait: "120", then: "pick" }, "pick", "2", "h"))).toEqual([]);
});
