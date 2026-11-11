import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_REASONS } from "../jobs/lib/asks/ask.ts";
import { SECURITY_PATHS } from "../jobs/lib/gates/gate.ts";
import { LOG_MAX, gatesBody, log, metrics, repeats, rules, securityFacts } from "./api/gates.ts";
import { reasonText, type AskItem } from "./asks.ts";
import { withEnv, withServer } from "./test-server.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { pct, when } from "./lib.js";
// @ts-ignore gates.js is plain JS, shared with the page
import * as gates from "./views/gates.js";
import * as record from "../jobs/lib/records/record.ts";
import { allHolds, recordHold, type HoldRecord } from "../jobs/lib/gates/factory-status.ts";
import { issueDecision } from "../jobs/lib/gates/issue-decision.ts";
import { eventsDir, logEvent } from "../lib/layout.ts";
import { contentText, setCodes } from "../lib/naming.ts";

/** Make `rows` the only hold records: each issue's `hold` and `started` events in its job record. */
function setHolds(rows: HoldRecord[]): void {
  const names = new Set([...record.all().map((r) => r.issue), ...rows.map((x) => x.name)]);
  for (const n of names) record.update(n, (r) => {
    r.events = rows.filter((x) => x.name === n).map((x) => (x.kind === "started" ? { at: x.at, kind: "started", what: x.text } : { at: x.at, kind: "hold", what: x.text, data: { gate: x.kind, ...(x.event ? { event: x.event } : {}) } }));
  });
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
  writeFileSync(join(base, "repos.json"), JSON.stringify({
    held: { path: join(base, "held-repo"), sandbox: true, held: ["src/auth/**"] },
    plain: { path: join(base, "plain-repo"), sandbox: true },
    alpha: { path: join(base, "alpha"), sandbox: true }, "alpha-ui": { path: join(base, "alpha-ui"), sandbox: true }, beta: { path: join(base, "beta"), sandbox: true },
  }));
  const factory = join(base, "factory");
  mkdirSync(factory);
  writeFileSync(join(factory, "always.json"), JSON.stringify({ rescue: { action: "recommended", at: ago(30) }, "run-cap": { action: "rerun", at: ago(40) }, "proposal-claude-md:global": { action: "approve", at: ago(50) } }));
  calls = join(base, "calls");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${calls}\necho '{}'\nexit 0\n`);
  chmodSync(fake, 0o755);
  // systemctl answers `show` with a 1min tick and a 1h suite, and logs every call.
  const systemctl = join(base, "systemctl");
  writeFileSync(systemctl, `#!/bin/sh\necho "$@" >> ${join(base, "systemctl.log")}\ncase "$*" in *"show aleph-tick"*) echo "TimersMonotonic={ OnUnitActiveUSec=1min ; next_elapse=1min }";; *"show aleph-suite"*) echo "TimersMonotonic={ OnUnitActiveUSec=1h ; next_elapse=1h }";; esac\n`, { mode: 0o755 });
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_FACTORY_DIR: factory, ALEPH_CLI: fake, ALEPH_SYSTEMCTL: systemctl, ALEPH_UNIT_DIR: join(base, "config/systemd/user") });
  logEvent({ at: ago(3), by: "rule", subject: "r-5", action: "reran", sub: "rescue", result: "dropped" });
  logEvent({ at: ago(2), by: "firefighter", subject: "r-6", action: "answered", note: "r-6: picked the plain option" });
  logEvent({ at: ago(2.5), by: "director", subject: "r-8", action: "reran", sub: "capped", note: "the cause is fixed" });
  setHolds([
    // The log shows a hold's stored event, not its text; a hold with no event has no row.
    { at: ago(5), name: "r-3", kind: "gate", text: "5 agent runs are live", event: { at: ago(5), by: "gate", subject: "r-3", action: "full", sub: "local" } },
    { at: ago(6), name: "r-13", kind: "pause", text: "paused" },
    { at: ago(4), name: "r-3", kind: "started", text: "started" },
    { at: ago(60 * 24 * 9), name: "r-4", kind: "gate", text: "too old" },
  ]);
  ({ stop, at } = await withServer({ warm: false }));
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

// The body of GET /api/automation.
const body = async () => JSON.parse(JSON.stringify(gatesBody(await securityFacts())));

test("the body of /api/automation has every section, one rule per Ask reason with only its supported modes, and the held paths of gate.ts", async () => {
  const d: any = await body();
  expect(Object.keys(d).sort()).toEqual(["backend", "baseline", "capEnv", "gated", "held", "log", "metrics", "monitor", "now", "repeats", "repoHeld", "rules", "schedules", "settings"]);
  expect(d.baseline).toEqual([]);
  expect(d.rules.map((r: any) => r.reason)).toEqual(Object.keys(ASK_REASONS));
  for (const r of d.rules) expect(r.mode).toBe(ASK_REASONS[r.reason].always);
  const by = (k: string) => d.rules.find((r: any) => r.reason === k);
  expect(by("rescue").granted.action).toBe("recommended");
  expect(by("proposal-claude-md").places).toEqual(["proposal-claude-md:global"]);
  expect(d.held).toEqual(SECURITY_PATHS);
  expect(d.repoHeld).toEqual([{ repo: "held", held: ["src/auth/**"] }]);
});

test("the body names the held backend and the line it holds with, and the backend gate row binds while the hold is up", async () => {
  const file = join(process.env.ALEPH_FACTORY_DIR!, "backend-hold.json");
  const why = "API Error: 402 This request would exceed your available credits";
  try {
    writeFileSync(file, JSON.stringify({ via: "openrouter", why, since: ago(10) }));
    const d: any = await body();
    expect(d.backend).toEqual({ via: "OpenRouter", why });
    expect(d.gated).toEqual({ gate: "backend", why: `waits for OpenRouter: ${why}`, text: `Waiting for OpenRouter: ${why}` });
  } finally { rmSync(file, { force: true }); }
  // No hold: the body names no backend, and no factory gate binds.
  const d: any = await body();
  expect(d.backend).toBeNull();
  expect(d.gated).toBeNull();
});

/** An entry as one line: by, subject, action, sub, content and note. */
const line = (x: any) => [x.by, x.subject, x.action, x.sub ?? "-", contentText(x) || "-", x.note ?? "-"].join(" | ");

test("the log reads the hold, the rules Chris set, and the old rule, director and firefighter lines as events, newest first, 7 days back", async () => {
  const d: any = await body();
  const e = d.log.entries;
  expect(d.log.days).toBe(7);
  expect(e.map(line)).toEqual([
    "firefighter | r-6 | answered | - | - | r-6: picked the plain option",
    "director | r-8 | reran | capped | - | the cause is fixed",
    "rule | r-5 | reran | rescue | → dropped | -",
    "gate | r-3 | full | local | - | -",
    "human | rescue | changed | rescue | - | set to recommended",
    "human | run-cap | changed | capped | - | set to rerun",
    "human | proposal-claude-md:global | changed | - | - | set to approve",
  ]);
});

test("a hold writes its event, and the log shows it as busy with the job and the file's base name", () => {
  const was = allHolds();
  try {
    const d = issueDecision({ name: "aleph-1420", item: { id: 1420, notes: [], spec: "", fm: {} } as any, done: () => false, busy: { why: "waits for aleph-1372: both change the busy file ui/views/issues.js", on: "aleph-1372", file: "ui/views/issues.js" } });
    recordHold("aleph-1420", d.kind as any, d.why, d.ev);
    const e = log().find((x) => x.subject === "aleph-1420")!;
    expect(e).toMatchObject({ by: "gate", action: "busy", on: ["aleph-1372"], file: "ui/views/issues.js" });
    // The registry of this test has no code: the page gets the codes with the body.
    setCodes({ aleph: "a" });
    expect(contentText(e)).toBe("a1372 → issues.js");
    const h = gates.renderLog({ log: { entries: [e] }, codes: { aleph: "a" } });
    expect(h).toContain('<td><a class="idl" title="aleph-1420" href="#/issues/aleph/1420">a1420</a></td><td>busy</td><td></td><td class="what"><a class="idl" title="aleph-1372" href="#/issues/aleph/1372">a1372</a> → <code title="ui/views/issues.js">issues.js</code></td>');
  } finally { setHolds(was); }
});

test("a director decision shows its action and sub, and its long note only behind the row's button", () => {
  const note = `Director: landed over the reviewer hold. ${"word ".repeat(60)}`.trim();
  try {
    logEvent({ by: "director", subject: "r-12", action: "landed", sub: "override", note });
    const e = log().find((x) => x.subject === "r-12")!;
    expect(line(e)).toBe(`director | r-12 | landed | override | - | ${note}`);
    const h = gates.renderLog({ log: { entries: [e] } });
    expect(h).toContain(`<td>landed</td><td>override</td><td class="what"><div class="clamp">${note}</div><button class="link clamp-btn" type="button" aria-expanded="false">Show more</button></td>`);
  } finally { rmSync(eventsDir(), { recursive: true, force: true }); }
});

test("POST /api/automation/rules/:reason/revoke runs `aleph always revoke`, and refuses a request without the UI header", async () => {
  expect((await post("/api/automation/rules/rescue/revoke")).status).toBe(200);
  expect(readFileSync(calls, "utf8").trim().split("\n").at(-1)).toBe("always revoke -- rescue");
  const n = readFileSync(calls, "utf8").length;
  expect((await at("/api/automation/rules/rescue/revoke", { method: "POST" })).status).toBe(403);
  expect(existsSync(calls) && readFileSync(calls, "utf8").length).toBe(n);
});

const askItem = (reason: string, id: string): AskItem => ({ key: `issue:${id}`, reason, kind: "input", card: "decide", label: "Decide", headline: `t ${id}`, tag: "", id, href: `#/issues/r/${id.split("-")[1]}`, title: `t ${id}`, problem: `p ${id}`, situation: `p ${id}`, escalated: true,
  actions: [{ act: "checked", label: "Mark it checked", hint: "Records it.", primary: true, path: `/api/issues/${id}/checked`, body: {}, recommended: false }], details: {}, repo: "r" });

const data = () => ({
  now: new Date(NOW).toISOString(),
  schedules: [{ name: "tick", last: null, result: null }],
  factory: { paused: false, liveRuns: 5, liveCap: 5, runCap: 3, runStarts: 2, capEnv: { live: false, run: false } },
  metrics: { days: 7, rate: { auto: 3, total: 4, percent: 75 }, catches: { fired: 6, fixed: 2 }, held: { goals: 2, hours: 3 } },
  gated: { gate: "live-cap", why: "5 agent runs are live", text: "Waiting for a slot (5 of 5 running)" },
  baseline: [{ repo: "r", state: "green", line: "r abc1234" }],
  asks: [askItem("run-cap", "r-1")],
  repeats: [],
  rules: Object.entries(ASK_REASONS).map(([reason, r]) => ({ reason, ...reasonText(reason), kind: r.kind, mode: r.always, fired: 0, decided: { rule: 0, director: 0, chris: 0 }, outcome: { fixed: 0, none: 0 }, granted: reason === "rescue" ? { action: "recommended", at: ago(1) } : null, ...(reason.startsWith("proposal-") ? { places: [] } : {}) })),
  held: SECURITY_PATHS,
  repoHeld: [{ repo: "r", held: ["src/auth/**"] }],
  log: { days: 7, max: 200, entries: [{ at: ago(1), by: "rule", subject: "r-5", action: "reran", sub: "rescue", result: "dropped" }, { at: ago(2), by: "human", subject: "rescue", action: "changed", sub: "rescue", note: "set to recommended" }] },
});

test("the view draws the sections in order, a closed gate, and the rule switches with only Ask me and the reason's mode", () => {
  const h = gates.renderGates(data());
  const order = ["Waiting for You", "Rules", "Controls", "Held Paths", "Log"].map((t) => h.indexOf(`>${t}</h2>`));
  expect(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1]))).toBe(true);
  // The three metric tiles; no Gates now state cards.
  const tiles = [...h.matchAll(/<div class="tile sc"><span class="r1"><span class="k">([^<]*)<\/span>/g)].map((m) => m[1]);
  expect(tiles).toEqual(["Automation rate", "Gate catches", "Rule candidates", "Held time"]);
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
    const row = h.slice(h.indexOf(`<tr class="rule" data-reason="${reason}">`)).split("</tr>")[0];
    const modes = [...row.matchAll(/data-mode="([^"]*)"/g)].map((m) => m[1]);
    if (reason.startsWith("proposal-")) expect(modes).toEqual([]);
    else expect(modes).toEqual(r.always ? ["", r.always] : [""]);
    if (!r.always && !reason.startsWith("proposal-")) {
      expect(row).toContain("The director decides first and sends the rest to you.");
      expect(row).not.toContain("No automatic mode");
    }
  }
  const rescue = h.slice(h.indexOf('data-reason="rescue"'));
  expect(rescue).toMatch(/data-mode="recommended" aria-pressed="true">Recommended</);
  expect(h.match(/<tr class="rule" data-reason=/g)).toHaveLength(Object.keys(ASK_REASONS).length);
  for (const p of SECURITY_PATHS) expect(h).toContain(`<code class="chip">${p}</code>`);
  const card = gates.renderHeld(data());
  expect(card).toContain("<b>r</b>");
  expect(card).toContain('<code class="chip">src/auth/**</code>');
  for (const p of SECURITY_PATHS) expect(card).toContain(`<code class="chip">${p}</code>`);
  expect(gates.renderHeld({ ...data(), repoHeld: [] })).toContain('<div class="empty"><p>No repo names held paths.</p>');
});

const entry = (by: string, action = "answered", subject = "r-1") => ({ at: ago(1), by, subject, action }) as any;
const rec = (min: number, name: string, kind: string) => ({ at: ago(min), name, kind, text: "t" });

test("the automation rate is the rule and director decisions over those and Chris's answers; his rule changes, a director escalation and a second event of one decision do not count", () => {
  const e = [entry("rule", "reran"), entry("rule", "reran", "r-2"), entry("director", "reran"), entry("director", "filed"), entry("director", "escalated", "r-3"), entry("human"), entry("human", "changed", "rescue")];
  expect(metrics(e, []).rate).toEqual({ auto: 3, total: 4, percent: 75 });
  expect(metrics([], []).rate).toBeNull();
});

test("the body's automation rate counts every decision in the 7 days, past the log's cap of each actor", async () => {
  const before = (await body()).metrics.rate ?? { auto: 0, total: 0 };
  for (let i = 0; i < LOG_MAX; i++) logEvent({ at: ago(5 + i / 100), by: "rule", subject: `r-${i}`, action: "reran", sub: "rescue" });
  try {
    const after = (await body()).metrics.rate;
    expect(after.auto - before.auto).toBe(LOG_MAX);
    expect(after.total - before.total).toBe(LOG_MAX);
  } finally {
    rmSync(eventsDir(), { recursive: true, force: true });
  }
});

test("the held time sums, over the issues, the hours from a hold to the next start, or to now, in the 7 days", () => {
  const h = [rec(300, "a-1", "gate"), rec(120, "a-1", "started"), rec(60, "b-1", "gate"), rec(30, "b-1", "gate"), rec(60 * 24 * 9, "c-1", "gate"), rec(60 * 24 * 8, "c-1", "started")];
  expect(metrics([], h, NOW).held).toEqual({ goals: 2, hours: 4 });
});

test("gate catches are the builds a check or the reviewer sent back in the 7 days, against those a later build of the job passed", () => {
  const run = (job: string, min: number, condition: string, failed?: string) => ({ job, kind: "build", condition, started: ago(min), ...(failed ? { failed } : {}) });
  const r = (runs: any[]) => ({ issue: "r-1", runs }) as any;
  const records = [
    r([run("j1", 300, "returned", "tests"), run("j1", 200, "returned", "review"), run("j1", 100, "landed")]),
    r([run("j2", 300, "returned", "types"), run("j3", 200, "passed")]),
    r([run("j4", 60 * 24 * 9, "returned", "tests"), run("j4", 60, "passed")]),
  ];
  expect(metrics([], [], NOW, records).catches).toEqual({ fired: 3, fixed: 2 });
});

test("the log filter keeps one actor's entries", () => {
  const h = gates.renderLog(data(), "human");
  expect(h).toMatch(/class="seg"[^>]*>.*aria-pressed="true">human</);
  expect(h).not.toContain("fchip");
  expect(h).toContain('<td><a href="#rules">rescue</a></td><td>changed</td><td>rescue</td>');
  expect(h).not.toContain("r-5");
  expect(h).toContain('<tr><th>Logged</th><th>By</th><th>Subject</th><th>Action</th><th>Sub</th><th>Content</th><th class="num">Times</th></tr>');
  expect(h).toContain(`<td class="what"><div class="clamp">set to recommended</div><button class="link clamp-btn" type="button" aria-expanded="false">Show more</button></td>`);
  expect(gates.renderLog(data(), "rule")).not.toContain("clamp");
});

test("renderLog shows 50 rows with a pager; a Gate run shows its count in Times", () => {
  const e = (n: number): any => ({ at: new Date(NOW - n * 1000).toISOString(), by: "rule", subject: "x-1", action: "reran", note: `t${n}` });
  const entries = Array.from({ length: 120 }, (_, i) => e(i));
  entries[0] = { ...entries[0], by: "gate", times: 3, first: entries[1].at };
  const h = gates.renderLog({ log: { entries } } as any);
  expect(h.match(/<tr>/g)!.length - 1).toBe(50);
  expect(h).toContain("50 of 120");
  expect(h).toContain("Show 50 more");
  expect(h).toContain('<td class="num">3</td>');
  expect(h).not.toContain("×3");
});

const withHolds = (rows: HoldRecord[], f: () => void) => {
  const was = allHolds();
  setHolds(rows);
  try { f(); } finally { setHolds(was); }
};
const hold = (min: number, name = "r-9", text = "busy") => ({ at: ago(min), name, kind: "gate", text, event: { at: ago(min), by: "gate", subject: name, action: "busy" } });
const gateLines = () => log().filter((e) => e.by === "gate");

test("log collapses a run of identical gate events into one with times, first and last time", () => {
  withHolds([hold(30), hold(20), hold(10)], () => {
    const g = gateLines();
    expect(g.length).toBe(1);
    expect(g[0].times).toBe(3);
    expect(Date.parse(g[0].first!)).toBeCloseTo(NOW - 30 * 60_000, -4);
    expect(Date.parse(g[0].at)).toBeCloseTo(NOW - 10 * 60_000, -4);
  });
});

const capsPath = () => join(process.env.ALEPH_FACTORY_DIR!, "caps.json");
const postCaps = (b: unknown, headers: Record<string, string> = { "X-Aleph-UI": "1" }) => at("/api/automation/caps", { method: "POST", headers, body: JSON.stringify(b) });

test("POST /api/automation/caps refuses a missing header with 403 and bad values with 422, and leaves the file", async () => {
  const seed = JSON.stringify({ live: 9 });
  writeFileSync(capsPath(), seed);
  expect((await postCaps({ live: 5 }, {})).status).toBe(403);
  for (const v of [0, -1, 2.5, "x"]) {
    const r = await postCaps({ live: v });
    expect(r.status).toBe(422);
    expect(typeof (await r.json()).error).toBe("string");
  }
  expect(readFileSync(capsPath(), "utf8")).toBe(seed);
});

test("a cap post writes the live cap only and leaves the old day and awaiting keys alone", async () => {
  writeFileSync(capsPath(), JSON.stringify({ day: 999, awaiting: 5 }));
  const r = await postCaps({ live: 3, day: 7 });
  expect(r.status).toBe(200);
  expect(await r.json()).toMatchObject({ live: 3, run: 3, intakeTries: 2, jobSeconds: 1800, fixRounds: 2, landBatch: 8 });
  expect(JSON.parse(readFileSync(capsPath(), "utf8"))).toEqual({ day: 999, awaiting: 5, live: 3 });
});

test("a cap post writes the run cap and refuses 0", async () => {
  writeFileSync(capsPath(), "{}");
  const r = await postCaps({ run: 5 });
  expect(r.status).toBe(200);
  expect((await r.json()).run).toBe(5);
  expect(JSON.parse(readFileSync(capsPath(), "utf8")).run).toBe(5);
  expect((await postCaps({ run: 0 })).status).toBe(422);
});

test("a cap post writes the settings; fix rounds take 0 and the rest refuse it", async () => {
  writeFileSync(capsPath(), "{}");
  const r = await postCaps({ fixRounds: 0, jobSeconds: 2400, intakeTries: 3, landBatch: 4, loadLimit: 12 });
  expect(r.status).toBe(200);
  // The preload sets ALEPH_LOAD_LIMIT, which wins over the file: the file holds the load limit.
  expect(await r.json()).toMatchObject({ fixRounds: 0, jobSeconds: 2400, intakeTries: 3, landBatch: 4 });
  expect(JSON.parse(readFileSync(capsPath(), "utf8")).loadLimit).toBe(12);
  for (const k of ["jobSeconds", "intakeTries", "landBatch", "loadLimit"]) expect((await postCaps({ [k]: 0 })).status).toBe(422);
  expect((await postCaps({ fixRounds: -1 })).status).toBe(422);
  writeFileSync(capsPath(), "{}");
});

test("the Caps section holds a form each for the two caps, with use against limit, then one per setting, and no day cap", () => {
  const h = gates.renderCaps({ ...data(), factory: { ...data().factory, settings: { intakeTries: 2, jobSeconds: 1800, fixRounds: 2, landBatch: 8, loadLimit: 24 } } });
  expect([...h.matchAll(/data-cap="([^"]*)"/g)].map((m) => m[1])).toEqual(["live", "run", "intakeTries", "jobSeconds", "fixRounds", "landBatch", "loadLimit"]);
  expect(h).toContain("<b>Job time limit</b><span>1800</span>");
  expect(h).toContain('name="fixRounds" type="number" min="0"');
  expect(h).toContain("<span>5 / 5</span>");
  expect(h).toContain("<span>2 / 3</span>");
  expect(h).not.toContain("day");
  expect(gates.renderGates(data())).toContain(">Controls</h2>");
});

test("the cap row and the rule hints say job and issue, with no goal and no Run cap", () => {
  const h = gates.renderGates(data());
  const caps = h.slice(h.indexOf('<section class="card" id="gates-caps"'), h.indexOf('aria-label="Held paths"'));
  expect(caps).toContain("<b>Job cap</b>");
  expect(caps).toContain("live jobs against the cap");
  expect(caps).toContain("the most starts any one issue made in the last hour");
  const rules = h.slice(h.indexOf('<section id="rules"'));
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

test("the Automation page has no explaining aside; the controls panel holds the cap forms and no Pause button, before Held paths in one row", () => {
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
    const row = h.slice(h.indexOf('<div class="gates-two">'));
    expect(row.indexOf('id="gates-caps"')).toBeGreaterThan(0);
    expect(row.indexOf('id="gates-caps"')).toBeLessThan(row.indexOf('aria-label="Held paths"'));
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

test("a stored firefighter grant for held-path is dead: rules() shows no grant and the row has only Ask me", () => {
  const f = join(base, "factory", "always.json");
  const saved = readFileSync(f, "utf8");
  try {
    writeFileSync(f, JSON.stringify({ "held-path": { action: "firefighter", at: ago(5) } }));
    const row = rules().find((x) => x.reason === "held-path")!;
    expect(row.granted).toBeNull();
    const h = gates.renderRules({ rules: [row] });
    expect(h).not.toContain("always.json grants");
    expect(h.match(/<button[^>]*data-rule=/g)!.length).toBe(1);
    expect(h).toContain(">Ask me</button>");
  } finally { writeFileSync(f, saved); }
});

test("rules() counts each reason's Asks in the window by who decided them and what followed; renderRules shows the counts", () => {
  const at = (m: number) => new Date(NOW + m * 60_000).toISOString();
  const ask = (n: number, cleared = true) => ({ set: at(n * 10), ...(cleared ? { cleared: at(n * 10 + 1) } : {}), reason: "question" });
  const build = (m: number): any => ({ kind: "build", started: at(m) });
  const rec = (issue: string, asks: any[], runs: any[] = []): any => ({ issue, asks, runs, events: [] });
  const records = [
    rec("x-1", [ask(1)], [build(15)]), rec("x-2", [ask(2)]), rec("x-3", [ask(3)]), rec("x-4", [ask(4), ask(5, false)]),
    rec("x-5", [{ ...ask(6), reason: "run-cap" }]),
  ];
  const e = (n: number, by: any, subject: string, note?: string): any => ({ at: at(n * 10), by, subject, action: "answered", note });
  const entries = [e(1, "rule", "x-1"), e(2, "rule", "x-2"), e(3, "director", "x-3"), e(4, "human", "x-4", "Chris: yes")];
  const row: any = rules(entries, records, NOW + 3600_000).find((x) => x.reason === "question");
  expect(row.fired).toBe(5);
  expect(row.decided).toEqual({ rule: 2, director: 1, chris: 1 });
  expect(row.outcome).toEqual({ fixed: 1, none: 3 });
  const h = gates.renderRules({ rules: [row] });
  for (const t of ["Fired", "Decided by (Rule / Director / Manual)", "Outcome (Fixed / No Change)", "<td class=\"num\">5</td>", "2 / 1 / 1", "1 / 3"]) expect(h).toContain(t);
  expect(h).not.toContain("2 rule, 1 director, 1 Chris");
});

test("rules() takes an entry's missing reason from the run that awaited when it was set; with no such run the entry is not counted", () => {
  const set = new Date(NOW).toISOString();
  const fired = (records: any[]) => Object.fromEntries(rules([], records, NOW + 3600_000).map((x) => [x.reason, x.fired]));
  const base = fired([]);
  const awaiting: any = { id: "r1", kind: "build", condition: "waiting", started: new Date(NOW - 60_000).toISOString(), ended: set };
  expect(fired([{ issue: "x-1", asks: [{ set }], ask: { reason: "held-path" }, askRun: "r1", runs: [awaiting], events: [] }])["held-path"]).toBe(base["held-path"] + 1);
  expect(fired([{ issue: "x-2", asks: [{ set }], runs: [], events: [] }])).toEqual(base);
});

test("the Monitor panel says the monitor has not run with no report, and holds the newest report with the findings inside the part that expands", async () => {
  const dir = join(process.env.ALEPH_FACTORY_DIR!, "monitor"), file = join(dir, "2026-11-03.json");
  expect((await body()).monitor).toBeNull();
  expect(gates.renderMonitor(await body())).toContain("The monitor has not run.");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ day: "2026-11-03", table: {}, text: "READER-TEXT", findings: ["FIRST-ONE", "SECOND-ONE"] }));
  try {
    const d: any = await body();
    expect(d.monitor).toMatchObject({ day: "2026-11-03", findings: ["FIRST-ONE", "SECOND-ONE"], text: "READER-TEXT" });
    const [sum, rest] = gates.renderMonitor(d).split("</summary>");
    for (const x of ["2026-11-03", "2 findings", "FIRST-ONE"]) expect(sum).toContain(x);
    expect(sum).not.toContain("SECOND-ONE");
    for (const x of ["FIRST-ONE", "SECOND-ONE", "READER-TEXT"]) expect(rest).toContain(x);
  } finally {
    rmSync(dir, { recursive: true });
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

test("the body has the tick, the suite and the monitor with their last run from tick.json; with no record each has not run", async () => {
  const dir = process.env.ALEPH_FACTORY_DIR!;
  const none: any = (await body()).schedules;
  expect(none).toEqual([{ name: "tick", last: null, result: null, every: "1min" }, { name: "suite", last: null, result: null, every: "1h" }, { name: "monitor", last: null, result: null, every: "1d" }]);
  const h = gates.renderSchedules({ ...(await body()), schedules: none });
  expect(h).toContain("<h2>Schedules</h2>");
  expect(h).toContain("<th>Schedule</th><th>Every</th><th>Last Run</th><th>Result</th>");
  expect(h).toContain('<input type="checkbox" checked disabled aria-label="tick on"> tick');
  expect(h).toContain('value="1min"');
  expect(h.match(/has not run/g)).toHaveLength(3);
  const tbody = h.split("<tbody>")[1].split("</tbody>")[0];
  expect(tbody.match(/<tr>/g)).toHaveLength(3);
  expect(tbody).toContain("<td>has not run</td><td></td></tr>");
  expect(h).not.toContain("tick,has not run");
  const ran = { "suite plain": { at: ago(11), result: "green" }, "suite held": { at: ago(10), result: "green" }, monitor: { at: ago(50), result: "7 findings" } };
  writeFileSync(join(dir, "tick.json"), JSON.stringify({ last: { ci: ago(9), firefight: ago(2) }, missed: ["stalled:x"], suite: {}, ran }));
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
    rmSync(join(dir, "tick.json"));
  }
});

test("repeats() lists the answers that Chris gave 3 times to one Ask reason; renderRepeats and the tile show them, the button carries the reason and the mode", () => {
  const at = (m: number) => new Date(NOW + m * 60_000).toISOString();
  const rec = (n: number, reason: string): any => ({ issue: `x-${n}`, asks: [{ set: at(n * 10), cleared: at(n * 10 + 1), reason }], runs: [], events: [] });
  const records = [1, 2, 3].map((n) => rec(n, "intake-failed")).concat([4, 5].map((n) => rec(n, "question")));
  const entries: any[] = [1, 2, 3, 4, 5].map((n) => ({ at: at(n * 10), by: "human", subject: `x-${n}`, action: n < 4 ? "reran" : "answered", note: n < 4 ? "Chris: run intake again" : `Chris decided: My recommendation is plan ${n}.` }));
  const r = repeats(entries, records, NOW + 3600_000);
  expect(r).toEqual([{ reason: "intake-failed", answer: "retry", count: 3, name: "Failed intake", mode: "retry" }]);
  const rescue = [6, 7, 8].map((n) => rec(n, "rescue"));
  const approved = [6, 7, 8].map((n) => ({ at: at(n * 10), by: "human", subject: `x-${n}`, action: "answered", note: `Chris decided: My recommendation is fix ${n}.` }));
  expect(repeats(approved as any, rescue, NOW + 3600_000)).toEqual([{ reason: "rescue", answer: "recommended", count: 3, name: "Rescue of a stuck job", mode: "recommended" }]);
  const d = { ...data(), repeats: r };
  const h = gates.renderRepeats(d);
  expect(h).toContain("<h2>Rule Candidates");
  expect(h).toMatch(/<button[^>]*data-rule="intake-failed"[^>]*data-mode="retry"/);
  const bare = gates.renderNow({ ...d, metrics: { ...d.metrics, rate: null, held: undefined } });
  expect(bare).not.toMatch(/undefined|NaN/);
  expect(bare).toContain("<b>–</b>");
  expect(gates.renderNow(d)).toMatch(/Rule candidates<\/span><\/span><b>1<\/b>/);
  const none = gates.renderRepeats(data());
  expect(none).toContain("No answer repeats.");
  expect(none).not.toContain("<button");
});

test("GET /api/automation takes window and project: the log and the metrics keep that window and that repo; no parameter keeps 7 days of every repo; a bad window is 400", async () => {
  const m = (min: number) => min * 60 * 24;
  for (const [min, id] of [[30, "alpha-1"], [m(3), "beta-1"], [m(10), "beta-2"], [m(40), "alpha-3"]] as const) logEvent({ at: ago(min), by: "rule", subject: id, action: "reran", sub: "rescue" });
  logEvent({ at: ago(60 * 5), by: "rule", subject: "alpha-2", action: "reran", sub: "rescue" });
  const get = async (q: string) => { const r = await at(`/api/automation${q}`); return { status: r.status, d: r.status === 200 ? await r.json() as any : null }; };
  const items = (d: any) => d.log.entries.map((e: any) => e.subject).filter((i: string) => /^(alpha|beta)-/.test(i)).sort();
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
    logEvent({ at: ago(30), by: "rule", subject: "alpha-ui-2", action: "reran", sub: "rescue" });
    expect(items((await get("?project=alpha")).d)).toEqual(["alpha-1", "alpha-2"]);
    expect(items((await get("?project=beta&window=month")).d)).toEqual(["beta-1", "beta-2"]);
    expect((await get("?window=year")).status).toBe(400);
  } finally {
    rmSync(eventsDir(), { recursive: true, force: true });
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

test("Schedules, Repeat Answers, Rules and Log show empty() with no rows; Repeat Answers and Log page at 50", () => {
  expect(gates.renderLog({ log: { entries: [] } } as any)).toContain('class="empty"');
  expect(gates.renderLog({ log: { entries: Array.from({ length: 51 }, (_, i) => ({ at: new Date(NOW - i * 1000).toISOString(), by: "rule", subject: "x-1", action: "reran", note: `t${i}` })) } } as any)).toContain("50 of 51");
  expect(gates.renderSchedules({ schedules: [] })).toContain('class="empty"');
  expect(gates.renderRules({ rules: [] })).toContain('class="empty"');
  expect(gates.renderRepeats({ repeats: [] })).toContain('class="empty"');
  expect(gates.renderRepeats({ repeats: Array.from({ length: 51 }, (_, i) => ({ reason: `r${i}`, answer: "a", count: 3 })) })).toContain("50 of 51");
});

test("POST /api/automation/schedules writes a drop-in that keeps the boot and startup triggers, reloads systemd and restarts the timer; a bad interval or name is 422", async () => {
  const send = (b: unknown) => at("/api/automation/schedules", { method: "POST", headers: { "X-Aleph-UI": "1" }, body: JSON.stringify(b) });
  const res = await send({ name: "tick", every: "5min" });
  expect(res.status).toBe(200);
  const conf = readFileSync(join(base, "config/systemd/user/aleph-tick.timer.d/interval.conf"), "utf8");
  expect(conf).toContain("OnUnitActiveSec=\nOnBootSec=10min\nOnStartupSec=2min\nOnUnitActiveSec=5min\n");
  expect(readFileSync(join(base, "systemctl.log"), "utf8")).toContain("--user daemon-reload\n--user restart aleph-tick.timer\n");
  expect((await send({ name: "tick", every: "5 minutes" })).status).toBe(422);
  expect((await send({ name: "monitor", every: "1h" })).status).toBe(422);
});

test("the Automation page names the held backend and its reason, and no line when none is held", () => {
  const held = gates.renderGates({ ...data(), backend: { via: "OpenRouter", why: "probe failed" } });
  expect(held).toContain(`id="gates-backend">Waiting for OpenRouter: probe failed</p>`);
  expect(gates.renderGates({ ...data(), backend: null })).not.toContain("gates-backend");
});
