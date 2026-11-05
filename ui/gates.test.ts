import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_REASONS } from "../jobs/lib/asks/ask.ts";
import { SECURITY_PATHS } from "../jobs/lib/gates/gate.ts";
import { LOG_MAX, gatesBody, log, metrics, repeats, rules, securityFacts } from "./api/gates.ts";
import type { AskItem } from "./asks.ts";
import { withEnv, withServer } from "./test-server.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { when } from "./lib.js";
// @ts-ignore gates.js is plain JS, shared with the page
import * as gates from "./views/gates.js";
import * as record from "../jobs/lib/records/record.ts";
import { allHolds, type HoldRecord } from "../jobs/lib/gates/factory-status.ts";

/** Make `rows` the only hold records: each goal's `hold` and `started` events in its job record. */
function setHolds(rows: HoldRecord[]): void {
  const names = new Set([...record.all().map((r) => r.issue), ...rows.map((x) => x.name)]);
  for (const n of names) record.update(n, (r) => {
    r.events = rows.filter((x) => x.name === n).map((x) => (x.kind === "started" ? { at: x.at, kind: "started", what: x.text } : { at: x.at, kind: "hold", what: x.text, data: { gate: x.kind } }));
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
  }));
  const factory = join(base, "factory");
  mkdirSync(factory);
  writeFileSync(join(factory, "always.json"), JSON.stringify({ rescue: { action: "recommended", at: ago(30) }, "run-cap": { action: "rerun", at: ago(40) }, "proposal-claude-md:global": { action: "approve", at: ago(50) } }));
  writeFileSync(join(factory, "tick.log"), [
    `${ago(3)} always: rescue: recommended on r-5`,
    `${ago(2)} firefighter: did answer r-6: picked the plain option`,
    `${ago(2.5)} director: r-8: run-cap: decided: rerun: the cause is fixed`,
    `${ago(1)} landed r-7`,
  ].join("\n") + "\n");
  calls = join(base, "calls");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${calls}\necho '{}'\nexit 0\n`);
  chmodSync(fake, 0o755);
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_FACTORY_DIR: factory, ALEPH_CLI: fake });
  setHolds([
    // An old record, from before the 7 gates, still reads.
    { at: ago(5), name: "r-3", kind: "gate", text: "5 agent runs are live" },
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

// The body of GET /api/gates from a stub of the Status page's state. The route itself adds only the state build, which
// this file leaves alone: a build here would share the worker with ui/state-load.test.ts in the same test process.
const queued = (kind: string) => ({ repo: "plain", id: 1, title: "t", priority: "medium", stage: "queued", why: "w", kind }) as any;
const stub = { now: new Date(NOW).toISOString(), asks: [] as AskItem[], factory: { paused: false, liveRuns: 0, liveCap: 5, runCap: 3, runStarts: 0, runsToday: 0 } as any, queued: [queued("not-ready"), queued("not-ready"), queued("busy-file"), queued("ready")] };
const body = async () => JSON.parse(JSON.stringify(gatesBody(stub, await securityFacts())));

test("the body of /api/gates has every section, one rule per Ask reason with only its supported modes, and the held paths of gate.ts", async () => {
  const d: any = await body();
  expect(Object.keys(d).sort()).toEqual(["asks", "baseline", "factory", "gated", "goalGates", "held", "log", "metrics", "monitor", "now", "repeats", "repoHeld", "rules", "schedules"]);
  expect(Object.keys(d.factory).sort()).toEqual(["capEnv", "liveCap", "liveRuns", "paused", "runCap", "runStarts"]);
  expect(d.goalGates).toEqual({ baseline: 0, "not-ready": 2, "busy-file": 1, "loop-guard": 0 });
  expect(d.baseline).toEqual([]);
  expect(d.rules.map((r: any) => r.reason)).toEqual(Object.keys(ASK_REASONS));
  for (const r of d.rules) expect(r.mode).toBe(ASK_REASONS[r.reason].always);
  const by = (k: string) => d.rules.find((r: any) => r.reason === k);
  expect(by("rescue").granted.action).toBe("recommended");
  expect(by("proposal-claude-md").places).toEqual(["proposal-claude-md:global"]);
  expect(d.held).toEqual(SECURITY_PATHS);
  expect(d.repoHeld).toEqual([{ repo: "held", held: ["src/auth/**"] }]);
});

test("the log has the hold, the rules Chris set, and the Rule, Director and Firefighter lines, newest first, 7 days back", async () => {
  const d: any = await body();
  const e = d.log.entries;
  expect(d.log.days).toBe(7);
  expect(e.map((x: any) => `${x.by} ${x.item} ${x.what}`)).toEqual([
    "Firefighter r-6 did answer r-6: picked the plain option",
    "Director r-8 run-cap: decided: rerun: the cause is fixed",
    "Rule r-5 rescue: recommended",
    "Gate r-3 gate: 5 agent runs are live",
    "You rule rescue: set to recommended",
    "You rule run-cap: set to rerun",
    "You rule proposal-claude-md:global: set to approve",
  ]);
});

test("POST /api/gates/revoke/:reason runs `aleph always revoke`, and refuses a request without the UI header", async () => {
  expect((await post("/api/gates/revoke/rescue")).status).toBe(200);
  expect(readFileSync(calls, "utf8").trim().split("\n").at(-1)).toBe("always revoke rescue");
  const n = readFileSync(calls, "utf8").length;
  expect((await at("/api/gates/revoke/rescue", { method: "POST" })).status).toBe(403);
  expect(existsSync(calls) && readFileSync(calls, "utf8").length).toBe(n);
});

const askItem = (reason: string, id: string): AskItem => ({ key: `issue:${id}`, reason, kind: "input", id, href: `#/issues/r/${id.split("-")[1]}`, title: `t ${id}`, problem: `p ${id}`, situation: `p ${id}`, escalated: true,
  actions: [{ act: "checked", label: "Mark it checked", hint: "Records it.", primary: true, args: { repo: "r", id: id.split("-")[1] }, recommended: false }], details: {}, repo: "r" });

const data = () => ({
  now: new Date(NOW).toISOString(),
  schedules: [{ name: "tick", last: null, result: null }],
  factory: { paused: false, liveRuns: 5, liveCap: 5, runCap: 3, runStarts: 2, capEnv: { live: false, run: false } },
  metrics: { days: 7, rate: { auto: 3, total: 4, percent: 75 }, catches: { fired: 6, fixed: 2 }, held: { goals: 2, hours: 3 } },
  gated: { gate: "live-cap", why: "5 agent runs are live", text: "Waiting for a slot (5 of 5 running)" },
  baseline: [{ repo: "r", state: "green", line: "r abc1234" }],
  goalGates: { baseline: 0, "not-ready": 2, "busy-file": 0, "loop-guard": 1 },
  asks: [askItem("run-cap", "r-1")],
  repeats: [],
  rules: Object.entries(ASK_REASONS).map(([reason, r]) => ({ reason, kind: r.kind, mode: r.always, fired: 0, decided: { rule: 0, director: 0, chris: 0 }, outcome: { fixed: 0, none: 0 }, granted: reason === "rescue" ? { action: "recommended", at: ago(1) } : null, ...(reason.startsWith("proposal-") ? { places: [] } : {}) })),
  held: SECURITY_PATHS,
  repoHeld: [{ repo: "r", held: ["src/auth/**"] }],
  log: { days: 7, max: 200, entries: [{ at: ago(1), by: "Rule", item: "r-5", what: "rescue: recommended" }, { at: ago(2), by: "You", item: "rule", what: "rescue: set to recommended" }] },
});

test("the view draws the sections in order, a closed gate, and the rule switches with only Ask me and the reason's mode", () => {
  const h = gates.renderGates(data());
  const order = ["Waiting for You", "Rules", "Controls", "Held Paths", "Log"].map((t) => h.indexOf(`<h2>${t}</h2>`));
  expect(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1]))).toBe(true);
  // The three metric tiles; no Gates now state cards.
  const tiles = [...h.matchAll(/<div class="tile sc"><span class="r1"><span class="k">([^<]*)<\/span>/g)].map((m) => m[1]);
  expect(tiles).toEqual(["Automation rate", "Gate catches", "Repeat answers", "Held time"]);
  expect(h).toContain('<section class="tiles" aria-label="Metrics">');
  expect(h).not.toContain("gtile");
  expect(h).not.toContain("gt-head");
  expect(h).toContain("<b>75%<em> / 4</em></b>");
  expect(h).toContain("<b>6<em> / 2</em></b>");
  expect(h).toContain("<b>3h<em> / 2</em></b>");
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

const entry = (by: string, what = "x", item = "r-1") => ({ at: ago(1), by, item, what }) as any;
const rec = (min: number, name: string, kind: string) => ({ at: ago(min), name, kind, text: "t" });

test("the automation rate is the Rule and Director decisions over those and Chris's answers; his rule changes and a Director escalation do not count", () => {
  const e = [entry("Rule"), entry("Rule"), entry("Director", "run-cap: decided: rerun"), entry("Director", "run-cap: escalated: x"), entry("You", "Chris: yes"), entry("You", "rescue: set to Ask me", "rule")];
  expect(metrics(e, []).rate).toEqual({ auto: 3, total: 4, percent: 75 });
  expect(metrics([], []).rate).toBeNull();
});

test("the body's automation rate counts every decision in the 7 days, past the log's cap of each actor", async () => {
  const logPath = join(process.env.ALEPH_FACTORY_DIR!, "tick.log"), was = readFileSync(logPath, "utf8");
  const before = (await body()).metrics.rate;
  writeFileSync(logPath, was + Array.from({ length: LOG_MAX }, (_, i) => `${ago(5 + i / 100)} always: rescue: recommended on r-${i}`).join("\n") + "\n");
  try {
    const after = (await body()).metrics.rate;
    expect(after.auto - before.auto).toBe(LOG_MAX);
    expect(after.total - before.total).toBe(LOG_MAX);
  } finally {
    writeFileSync(logPath, was);
  }
});

test("the held time sums, over the goals, the hours from a hold to the next start, or to now, in the 7 days", () => {
  const h = [rec(300, "a-1", "gate"), rec(120, "a-1", "started"), rec(60, "b-1", "gate"), rec(30, "b-1", "gate"), rec(60 * 24 * 9, "c-1", "gate"), rec(60 * 24 * 8, "c-1", "started")];
  expect(metrics([], h, NOW).held).toEqual({ goals: 2, hours: 4 });
});

test("gate catches are the builds a check or the reviewer sent back in the 7 days, against those a later build of the job passed", () => {
  const run = (job: string, min: number, condition: string, failed?: string) => ({ job, kind: "build", condition, started: ago(min), ...(failed ? { failed } : {}) });
  const r = (runs: any[]) => ({ issue: "r-1", runs }) as any;
  const records = [
    r([run("j1", 300, "stuck", "tests"), run("j1", 200, "stuck", "reviewer"), run("j1", 100, "landed")]),
    r([run("j2", 300, "stuck", "types"), run("j3", 200, "passed")]),
    r([run("j4", 60 * 24 * 9, "stuck", "tests"), run("j4", 60, "passed")]),
  ];
  expect(metrics([], [], NOW, records).catches).toEqual({ fired: 3, fixed: 2 });
});

test("the log filter keeps one actor's entries", () => {
  const h = gates.renderLog(data(), "you");
  expect(h).toMatch(/class="seg"[^>]*>.*aria-pressed="true">You</);
  expect(h).not.toContain("fchip");
  expect(h).toContain("<td>rescue</td>");
  expect(h).toContain("set to recommended");
  expect(h).not.toContain("rescue: recommended<");
  for (const t of ["When", "By", "Item", "Action", "What", "Times"]) expect(h).toContain(t);
  expect(h).toContain('<div class="dp-txt clamp">');
});

test("renderLog shows 50 rows with a pager; a Gate run shows its count in Times", () => {
  const e = (n: number): any => ({ at: new Date(NOW - n * 1000).toISOString(), by: "Rule", item: "x-1", what: `t${n}` });
  const entries = Array.from({ length: 120 }, (_, i) => e(i));
  entries[0] = { ...entries[0], by: "Gate", count: 3, first: entries[1].at };
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
const hold = (min: number, name = "r-9", text = "busy") => ({ at: ago(min), name, kind: "gate", text });
const gateLines = () => log().filter((e) => e.by === "Gate");

test("log collapses a run of identical Gate lines into one with count, first and last time", () => {
  withHolds([hold(30), hold(20), hold(10)], () => {
    const g = gateLines();
    expect(g.length).toBe(1);
    expect(g[0].count).toBe(3);
    expect(Date.parse(g[0].first!)).toBeCloseTo(NOW - 30 * 60_000, -4);
    expect(Date.parse(g[0].at)).toBeCloseTo(NOW - 10 * 60_000, -4);
  });
});

test("a revoke line in tick.log is a You entry on the rule, and an always line stays a Rule entry", async () => {
  const { appendFileSync } = await import("node:fs");
  appendFileSync(join(base, "factory", "tick.log"), `${ago(0.5)} always: revoked rescue\n${ago(0.4)} always: rescue: recommended on r-9\n`);
  const e: any[] = ((await body()) as any).log.entries;
  expect(e.find((x) => x.what === "rescue: set to Ask me")).toMatchObject({ by: "You", item: "rule" });
  expect(e.find((x) => x.item === "r-9")).toMatchObject({ by: "Rule", what: "rescue: recommended" });
});

const capsPath = () => join(process.env.ALEPH_FACTORY_DIR!, "caps.json");
const postCaps = (b: unknown, headers: Record<string, string> = { "X-Aleph-UI": "1" }) => at("/api/gates/caps", { method: "POST", headers, body: JSON.stringify(b) });

test("POST /api/gates/caps refuses a missing header with 403 and bad values with 422, and leaves the file", async () => {
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
  expect(await r.json()).toEqual({ live: 3, run: 3 });
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

test("the Caps section holds one form each for the live cap and the run cap, with use against limit, and no day cap", () => {
  const h = gates.renderCaps(data());
  expect([...h.matchAll(/data-cap="([^"]*)"/g)].map((m) => m[1])).toEqual(["live", "run"]);
  expect(h).toContain("<span>5 / 5</span>");
  expect(h).toContain("<span>2 / 3</span>");
  expect(h).not.toContain("day");
  expect(gates.renderGates(data())).toContain("<h2>Controls</h2>");
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
    expect(h.match(/<button/g)!.length).toBe(1);
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
  const e = (n: number, by: any, item: string, what = "question: decided: x"): any => ({ at: at(n * 10), by, item, what });
  const entries = [e(1, "Rule", "x-1"), e(2, "Rule", "x-2"), e(3, "Director", "x-3"), e(4, "You", "x-4", "Chris: yes")];
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
  const awaiting: any = { id: "r1", kind: "build", condition: "awaiting", started: new Date(NOW - 60_000).toISOString(), ended: set };
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

test("the body has the tick, the suite and the monitor with their last run from tick.json and tick.log; with no record each has not run", async () => {
  const dir = process.env.ALEPH_FACTORY_DIR!, logPath = join(dir, "tick.log"), was = readFileSync(logPath, "utf8");
  const none: any = (await body()).schedules;
  expect(none).toEqual([{ name: "tick", last: null, result: null }, { name: "suite", last: null, result: null }, { name: "monitor", last: null, result: null }]);
  const h = gates.renderSchedules({ ...(await body()), schedules: none });
  expect(h).toContain("<h2>Schedules</h2>");
  expect(h).toContain("<th>Last Run</th><th>Schedule</th><th>Result</th>");
  expect(h.match(/has not run/g)).toHaveLength(3);
  const tbody = h.split("<tbody>")[1].split("</tbody>")[0];
  expect(tbody.match(/<tr>/g)).toHaveLength(3);
  expect(tbody).toContain("<tr><td>has not run</td><td>tick</td><td></td></tr>");
  expect(h).not.toContain("tick,has not run");
  writeFileSync(join(dir, "tick.json"), JSON.stringify({ last: { ci: ago(9), firefight: ago(2) }, missed: ["stalled:x"], suite: {} }));
  writeFileSync(logPath, was + [`${ago(70)} suite plain: red`, `${ago(11)} suite plain: green`, `${ago(10)} suite held: green`, `${ago(50)} monitor 2026-11-03: 7 findings: FINDING-TEXT first`].join("\n") + "\n");
  try {
    const d: any = (await body()).schedules;
    expect(d).toEqual([
      { name: "tick", last: ago(2), result: "1 missed" },
      { name: "suite", last: ago(10), result: "held: green; plain: green" },
      { name: "monitor", last: ago(50), result: "7 findings" },
    ]);
    expect(gates.renderSchedules({ ...(await body()), schedules: d })).not.toContain("has not run");
    const t = gates.renderSchedules({ ...(await body()), schedules: d });
    expect(t).toContain("<td>7 findings</td>");
    expect(t).not.toContain("FINDING-TEXT");
  } finally {
    rmSync(join(dir, "tick.json"));
    writeFileSync(logPath, was);
  }
});

test("repeats() lists the answers that Chris gave 3 times to one Ask reason; renderRepeats and the tile show them, the button carries the reason and the mode", () => {
  const at = (m: number) => new Date(NOW + m * 60_000).toISOString();
  const rec = (n: number, reason: string): any => ({ issue: `x-${n}`, asks: [{ set: at(n * 10), cleared: at(n * 10 + 1), reason }], runs: [], events: [] });
  const records = [1, 2, 3].map((n) => rec(n, "intake-failed")).concat([4, 5].map((n) => rec(n, "question")));
  const entries: any[] = [1, 2, 3, 4, 5].map((n) => ({ at: at(n * 10), by: "You", item: `x-${n}`, what: n < 4 ? "Chris: run intake again" : `Chris decided: My recommendation is plan ${n}.` }));
  const r = repeats(entries, records, NOW + 3600_000);
  expect(r).toEqual([{ reason: "intake-failed", answer: "retry", count: 3, mode: "retry" }]);
  const rescue = [6, 7, 8].map((n) => rec(n, "rescue"));
  const approved = [6, 7, 8].map((n) => ({ at: at(n * 10), by: "You", item: `x-${n}`, what: `Chris decided: My recommendation is fix ${n}.` }));
  expect(repeats(approved as any, rescue, NOW + 3600_000)).toEqual([{ reason: "rescue", answer: "recommended", count: 3, mode: "recommended" }]);
  const d = { ...data(), repeats: r };
  const h = gates.renderRepeats(d);
  expect(h).toContain("<h2>Repeat Answers");
  expect(h).toMatch(/<button[^>]*data-rule="intake-failed"[^>]*data-mode="retry"/);
  expect(gates.renderNow(d)).toMatch(/Repeat answers<\/span><\/span><b>1<\/b>/);
  const none = gates.renderRepeats(data());
  expect(none).toContain("No answer repeats.");
  expect(none).not.toContain("<button");
});

test("GET /api/gates takes window and project: the log and the metrics keep that window and that repo; no parameter keeps 7 days of every repo; a bad window is 400", async () => {
  const logPath = join(process.env.ALEPH_FACTORY_DIR!, "tick.log"), was = readFileSync(logPath, "utf8");
  const m = (min: number) => min * 60 * 24;
  writeFileSync(logPath, [
    `${ago(30)} alpha-1: always: a-hour`,
    `${ago(60 * 5)} alpha-2: always: a-day`,
    `${ago(m(3))} beta-1: always: b-week`,
    `${ago(m(10))} beta-2: always: b-month`,
    `${ago(m(40))} alpha-3: always: a-old`,
  ].join("\n") + "\n");
  const get = async (q: string) => { const r = await at(`/api/gates${q}`); return { status: r.status, d: r.status === 200 ? await r.json() as any : null }; };
  const items = (d: any) => d.log.entries.map((e: any) => e.item).filter((i: string) => /^(alpha|beta)-/.test(i)).sort();
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
    expect(items((await get("?project=beta&window=month")).d)).toEqual(["beta-1", "beta-2"]);
    expect((await get("?window=year")).status).toBe(400);
  } finally {
    writeFileSync(logPath, was);
  }
});

test("a cap save keeps the Monitor fold open through the Automation redraw", async () => {
  const dir = join(process.env.ALEPH_FACTORY_DIR!, "monitor"), file = join(dir, "2026-11-03.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ day: "2026-11-03", table: {}, text: "READER-TEXT", findings: ["FIRST-ONE"] }));
  const d: any = await body();
  const was = { fetch: globalThis.fetch, location: (globalThis as any).location };
  // The view reads the address and the API. The fake root takes the HTML and keeps the details folds.
  (globalThis as any).location = { hash: "" };
  globalThis.fetch = (async (_url: string, init?: RequestInit) => ({ ok: true, json: async () => (init?.method === "POST" ? {} : d) })) as any;
  const root: any = {
    details: [] as any[],
    set innerHTML(html: string) {
      this.details = [...html.matchAll(/<details><summary>(.*?)<\/summary>/g)].map((m) => {
        const summary = { textContent: m[1] };
        return { open: false, summary, querySelector: () => summary, querySelectorAll: () => [] };
      });
    },
    querySelectorAll: (sel: string) => (sel === "details" ? root.details : []),
  };
  const fold = () => root.details.find((x: any) => x.summary.textContent.startsWith("2026-11-03"));
  const form: any = { dataset: { cap: "live" }, elements: { live: { value: "5" } }, querySelector: () => ({ disabled: false }) };
  form.closest = (sel: string) => (sel === "form.capform" ? form : null);
  try {
    root.innerHTML = gates.renderGates(d);
    gates.mount(root);
    fold().open = true;
    await root.onsubmit({ target: form, preventDefault() {} });
    expect(fold().open).toBe(true);
  } finally {
    globalThis.fetch = was.fetch;
    (globalThis as any).location = was.location;
    rmSync(dir, { recursive: true });
  }
});

test("every seg group on the Automation page has an accessible name, rule toggles included", () => {
  const h = gates.renderGates(data());
  const groups = h.match(/<div class="seg"[^>]*>/g)!;
  expect(groups.length).toBeGreaterThan(2);
  for (const g of groups) expect(g).toMatch(/aria-label="[^"]+"/);
  expect(h).toContain('aria-label="Who decides ');
});
