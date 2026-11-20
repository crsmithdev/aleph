import { afterAll, beforeAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_REASONS } from "../jobs/lib/asks/ask.ts";
import { SECURITY_PATHS } from "../jobs/lib/gates/gate.ts";
import { CAP_ENV, CAP_KEYS, capMin } from "../jobs/lib/infra/settings.ts";
import { LOG_MAX, askHistory, gatesBody, log, metrics, rules, securityFacts } from "./api/gates.ts";
import { reasonText, type AskItem } from "./asks.ts";
import { withEnv, withServer } from "./server.testkit.ts";
import { updater } from "./updater.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { day, pct, when } from "./views/lib/format.js";
// @ts-ignore gates.js is plain JS, shared with the page
import * as gates from "./views/gates.js";
import { recordHold } from "../jobs/lib/gates/holds.ts";
import { setTick } from "../jobs/lib/gates/tables.ts";
import { issueDecision } from "../jobs/lib/gates/issue-decision.ts";
import { conn, getJson, putJson } from "../lib/db.ts";
import { seed } from "../jobs/job.testkit.ts";
import { logEvent } from "../lib/layout.ts";
import { contentText, setCodes } from "../lib/naming.ts";
import { writeRepos } from "../tests/projects.testkit.ts";

type Found = { tag: string; attrs: Record<string, string>; text: string };
const ENTITIES: Record<string, string> = { "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'", "&amp;": "&" };
/** The elements of `html` that match the CSS selector `sel`, in page order, each with its attributes and its text as the page shows it. */
function find(html: string, sel: string): Found[] {
  const out: Found[] = [];
  new HTMLRewriter().on(sel, { element(el) { out.push({ tag: el.tagName, attrs: Object.fromEntries(el.attributes), text: "" }); }, text(t) { out.at(-1)!.text += t.text.replace(/&(lt|gt|quot|#39|amp);/g, (m) => ENTITIES[m]); } }).transform(html);
  return out;
}
/** The rows of the tables in `html`, the head row first, each as the text of its cells. */
function table(html: string): string[][] {
  const rows: string[][] = [];
  new HTMLRewriter().on("tr", { element() { rows.push([]); } }).on("th, td", { element() { rows.at(-1)!.push(""); }, text(t) { const r = rows.at(-1)!; r[r.length - 1] += t.text; } }).transform(html);
  return rows;
}
/** The visible text of `html`. */
const text = (html: string) => html.replace(/<[^>]*>/g, " ");
/** The buttons of a rule form's `field` choice under `scope`: each one's value, whether it is pressed, and its label. */
const choices = (html: string, field: string, scope = "") => find(html, `${scope} [data-field="${field}"] button`).map((b) => [b.attrs["data-value"], b.attrs["aria-pressed"] === "true", b.text]);

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
  calls = join(base, "calls");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${calls}\necho '{}'\nexit 0\n`);
  chmodSync(fake, 0o755);
  // systemctl answers `show` with a 1min tick and a 1h suite, and logs every call.
  const systemctl = join(base, "systemctl");
  writeFileSync(systemctl, `#!/bin/sh\necho "$@" >> ${join(base, "systemctl.log")}\ncase "$*" in *"show aleph-tick"*) echo "TimersMonotonic={ OnUnitActiveUSec=1min ; next_elapse=1min }";; *"show aleph-suite"*) echo "TimersMonotonic={ OnUnitActiveUSec=1h ; next_elapse=1h }";; esac\n`, { mode: 0o755 });
  // Each test's database is a copy of this empty one: a schema build takes about 40 ms. The server opens the next one, which closes this.
  restoreEnv = withEnv({ ALEPH_DB: join(base, "empty.db"), ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_ITEMS: join(base, "items"), ALEPH_FACTORY_DIR: factory, ALEPH_CLI: fake, ALEPH_SYSTEMCTL: systemctl, ALEPH_UNIT_DIR: join(base, "config/systemd/user") });
  conn();
  process.env.ALEPH_DB = join(base, "aleph.db");
  ({ stop, at } = await withServer({ warm: false }));
});
// Each test starts on a new database, so with no events, jobs or settings but the three grants: the ones it reads, it writes.
let dbs = 0;
// The server answers a GET from the build an earlier test's GET kept, until it sees the change: each test starts with none kept.
beforeEach(() => {
  process.env.ALEPH_DB = join(base, `aleph-${++dbs}.db`);
  copyFileSync(join(base, "empty.db"), process.env.ALEPH_DB);
  putJson("settings", "always", { rescue: { action: "resolve", at: ago(30) }, "run-cap": { action: "continue", at: ago(40) }, "core-change:global": { action: "approve", at: ago(50) } });
  updater.reset();
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
  expect(Object.keys(d).sort()).toEqual(["backend", "baseline", "caps", "held", "log", "metrics", "monitor", "now", "repoHeld", "rules", "schedules", "settings"]);
  expect(d.baseline).toEqual([]);
  expect(d.rules.map((r: any) => r.reason)).toEqual(Object.keys(ASK_REASONS));
  for (const r of d.rules) { expect(r.mode).not.toBe(""); expect(r.mode).toBe(ASK_REASONS[r.reason].always); }
  const by = (k: string) => d.rules.find((r: any) => r.reason === k);
  expect(by("rescue").granted.action).toBe("resolve");
  expect(by("core-change").projects).toEqual([{ project: "global", action: "approve", at: expect.any(String) }]);
  expect(d.held).toEqual(SECURITY_PATHS);
  expect(d.repoHeld).toEqual([{ repo: "held", held: ["src/auth/**"] }]);
});

test("the body names the held backend and the line it holds with", async () => {
  const why = "API Error: 402 This request would exceed your available credits";
  try {
    putJson("state", "backend-hold", { via: "openrouter", why, since: ago(10) });
    const d: any = await body();
    expect(d.backend).toEqual({ via: "OpenRouter", why });
  } finally { putJson("state", "backend-hold", null); }
  // No hold: the body names no backend.
  const d: any = await body();
  expect(d.backend).toBeNull();
});

/** An entry as one line: subject, object, action and detail. */
const line = (x: any) => [x.subject, x.object, x.action, x.detail ?? "-"].join(" | ");

test("an Ask's reason in the history is its question event's detail before the facts", () => {
  logEvent({ time: ago(3), subject: "gate", action: "question", object: "issue.31", detail: "no-commit: 3 / 3 jobs with no commit" });
  expect(askHistory().filter((a) => a.issue === "issue.31").map((a) => a.reason)).toEqual(["no-commit"]);
});

test("the log reads the hold, the rules Chris set, and the old rule, director and firefighter lines as events, newest first, 7 days back", async () => {
  logEvent({ time: ago(5), subject: "gate", action: "held", object: "issue.3", detail: "full: local" });
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
    "gate | issue.3 | held | full: local",
    "human | rescue | changed | set to resolve",
    "human | run-cap | changed | set to continue",
    "human | core-change:global | changed | set to approve",
  ]);
});

test("a hold writes its held event, and the log shows it with the file and the job", () => {
  const d = issueDecision({ name: "issue.1420", item: { id: 1420, notes: [], spec: "", fm: {} } as any, done: () => false, busy: { why: "waits for issue.1372: both change the busy file ui/views/issues.js", on: "issue.1372", job: "job.1372", file: "ui/views/issues.js" } });
  recordHold("issue.1420", d.kind as any, d.ev);
  const e = log().find((x) => x.object === "issue.1420")!;
  expect(e).toMatchObject({ subject: "gate", action: "held", detail: "file: ui/views/issues.js: job.1372" });
  // The registry of this test has no code: the page gets the codes with the body.
  setCodes({ aleph: "a" });
  expect(contentText(e)).toBe("file: ui/views/issues.js: job.1372");
  const h = gates.renderLog({ log: { entries: [e] }, codes: { aleph: "a" } });
  // An issue key names no repo, so the log shows its shown form and links nothing.
  expect(table(h)[1].slice(1, 5)).toEqual(["i1420", "file: ui/views/issues.js: j1372", "held", "gate"]);
  expect(find(h, "td a")).toEqual([]);
  expect(find(h, "td.wide")[0].attrs.title).toBe("file: ui/views/issues.js: job.1372");
});

test("renderLog links an issue key to its page when the entry carries its project", () => {
  const e = { time: "2026-11-14T10:00:00Z", subject: "rule", action: "reran", object: "issue.1420", detail: "after issue.1372", project: "aleph" };
  const links = (h: string) => find(h, "td a").map((a) => a.attrs.href);
  expect(links(gates.renderLog({ log: { entries: [e] } }))).toEqual(["#/issues/aleph/1420"]);
  expect(links(gates.renderLog({ log: { entries: [{ ...e, object: "job.7", object_target: "issue.1420" }] } }))).toEqual(["#/issues/aleph/1420"]);
});

test("a director decision shows its action, and its long detail only behind the row's button", () => {
  const note = `Director: landed over the reviewer hold. ${"word ".repeat(60)}`.trim();
  logEvent({ subject: "director", action: "landed", object: "r-12", detail: `over review: ${note}` });
  const e = log().find((x) => x.object === "r-12")!;
  expect(line(e)).toBe(`director | r-12 | landed | over review: ${note}`);
  const h = gates.renderLog({ log: { entries: [e] } });
  expect(find(h, "td.wide")[0].attrs.title).toBe(`over review: ${note}`);
  expect(find(h, "td.wide .clamp").map((x) => x.text)).toEqual([`over review: ${note}`]);
  expect(find(h, "td.wide button").map((x) => x.text)).toEqual(["Show more"]);
  expect(table(h)[1][3]).toBe("landed");
});

test("POST /api/automation/rules/:reason/revoke runs `aleph always revoke`, and refuses a request without the UI header", async () => {
  expect((await post("/api/automation/rules/rescue/revoke")).status).toBe(200);
  expect(readFileSync(calls, "utf8").trim().split("\n").at(-1)).toBe("always revoke -- rescue");
  const n = readFileSync(calls, "utf8").length;
  expect((await at("/api/automation/rules/rescue/revoke", { method: "POST" })).status).toBe(403);
  expect(existsSync(calls) && readFileSync(calls, "utf8").length).toBe(n);
});

test("rules() gives each reason row its timeout minutes and no-answer action, and POST timeout passes the action on", async () => {
  putJson("settings", "timeouts", { "held-path": 30, "core-change": 30, question: { minutes: 20, then: "drop" } });
  const row = (reason: string) => rules().find((x) => x.reason === reason)!;
  expect(row("held-path").timeout).toBeUndefined();
  expect(row("core-change").timeout).toBeUndefined();
  const held = gates.renderRules({ rules: [row("held-path")] });
  expect(find(held, '[data-field="wait"]')).toEqual([]);
  expect(table(held)[1][4]).toBe("Keep waiting");
  expect(find(gates.renderRules({ rules: [row("question")] }), '[data-field="wait"]')).toHaveLength(1);
  expect([row("question").timeout, row("question").noAnswer]).toEqual([20, "drop"]);
  expect([row("no-commit").timeout, row("no-commit").noAnswer]).toEqual([0, "pick"]);
  expect(row("held-path").timeout).toBeUndefined();
  const send = (minutes: number, then?: string) => at("/api/automation/rules/question/timeout", { method: "POST", headers: { "X-Aleph-UI": "1", "Content-Type": "application/json" }, body: JSON.stringify({ minutes, then }) });
  expect((await send(20, "drop")).status).toBe(200);
  expect(readFileSync(calls, "utf8").trim().split("\n").at(-1)).toBe("always timeout -- question 20 drop");
  expect((await send(20, "wait")).status).toBe(400);
});

const askItem = (reason: string, id: string): AskItem => ({ key: `issue:${id}`, reason, card: "decide", label: "Decide", headline: `t ${id}`, tag: "", id, href: `#/issues/r/${id.split("-")[1]}`, title: `t ${id}`, problem: `p ${id}`, situation: `p ${id}`, escalated: true,
  actions: [], details: {}, repo: "r" });

const CAPS = Object.fromEntries(CAP_KEYS.map((k) => [k, { env: CAP_ENV[k], min: capMin(k), set: false }]));

const data = () => ({
  now: new Date(NOW).toISOString(),
  schedules: [{ name: "tick", last: null, result: null }],
  factory: { paused: false, liveRuns: 5, liveCap: 5, runCap: 3, runStarts: 2, caps: CAPS },
  metrics: { days: 7, rate: { auto: 3, total: 4, percent: 75 }, catches: { fired: 6, fixed: 2 }, held: { issues: 2, hours: 3 } },
  baseline: [{ repo: "r", state: "green", line: "r abc1234" }],
  asks: [askItem("run-cap", "r-1")],
  rules: Object.entries(ASK_REASONS).map(([reason, r]) => ({ reason, ...reasonText(reason), mode: r.always, fired: 0, decided: { rule: 0, director: 0, chris: 0 }, outcome: { fixed: 0, none: 0 }, granted: reason === "rescue" ? { action: "resolve", at: ago(1) } : null })),
  held: SECURITY_PATHS,
  repoHeld: [{ repo: "r", held: ["src/auth/**"] }],
  log: { days: 7, max: 200, entries: [{ time: ago(1), subject: "rule", object: "r-5", action: "reran", detail: "rescue" }, { time: ago(2), subject: "human", object: "rescue", action: "changed", detail: "set to resolve" }] },
  processes: { steps: [], decay: { stale: [] } },
});

test("the view draws the sections in order, a closed gate, and an Edit row with only Director and the reason's mode", () => {
  const h = gates.renderGates(data());
  const sections = ["Schedules", "Controls", "Rules", "Held Paths", "Log"];
  expect(find(h, "h2").map((x) => x.text).filter((t) => sections.includes(t))).toEqual(sections);
  expect(find(h, "h2").map((x) => x.text)).not.toContain("Waiting for the User");
  expect(find(h, "#gates-waiting")).toEqual([]);
  // The three metric tiles; no Gates now state cards.
  expect(find(h, 'section[aria-label="Metrics"] .tile .k').map((x) => x.text)).toEqual(["Automation rate", "Gate catches", "Held time"]);
  expect(find(h, ".gtile, .gt-head")).toEqual([]);
  expect(find(h, ".tile b").map((x) => x.text)).toEqual(["75% / 4", "6 / 2", "3.0h / 2"]);
  expect(text(h)).not.toContain("Gates now");
  expect(find(h, '[data-cap="day"], [data-cap="awaiting"]')).toEqual([]);
  expect(text(h)).not.toContain("Edit caps");
  for (const [reason, r] of Object.entries(ASK_REASONS)) {
    const modes = find(h, `form[data-rule="${reason}"] [data-field="decide"] button`).map((b) => b.attrs["data-value"]);
    // Each reason offers Director, its mode and User.
    expect(modes).toEqual(["", ...(r.always ? [r.always] : []), "user"]);
  }
  expect(text(h)).not.toContain("The director decides first");
  expect(choices(h, "decide", 'form[data-rule="rescue"]').filter((c) => c[1])).toEqual([["resolve", true, "Take the pick"]]);
  expect(find(h, "td.acts")).toHaveLength(Object.keys(ASK_REASONS).length);
  expect(find(h, "code.chip")).toEqual([]);
  const card = gates.renderHeld(data());
  expect(find(card, ".held, .chip")).toEqual([]);
  // Each path is its own line, a bare code element; no line holds two, and both scope labels sit in one list.
  expect(find(card, "dd > div").map((x) => x.text)).toEqual([...SECURITY_PATHS, "src/auth/**"]);
  expect(find(card, "dd > div > code").map((x) => x.text)).toEqual([...SECURITY_PATHS, "src/auth/**"]);
  expect(find(card, "dl dt").map((x) => x.text)).toEqual(["Every repo", "r"]);
  expect(find(card, "dl")).toHaveLength(1);
  const bare = gates.renderHeld({ ...data(), repoHeld: [] });
  expect(find(bare, "dt").map((x) => x.text)).toEqual(["Every repo"]);
  expect(find(bare, ".empty")).toEqual([]);
  expect(find(gates.renderHeld({ ...data(), held: [], repoHeld: [] }), ".empty").map((x) => x.text)).toEqual(["No data"]);
});

test("each hint and note of the page is at most four words, and the longer text is a title", () => {
  const h = gates.renderGates(data());
  const shown = find(h, ".hint, .note").map((x) => x.text);
  expect(shown.length).toBeGreaterThan(8);
  for (const t of shown) expect(t.trim().split(/\s+/).length).toBeLessThanOrEqual(4);
  expect(h).not.toContain("The security paths and a repo's held paths wait for the user");
  expect(h).not.toContain("Live jobs against the cap:");
  expect(find(h, '[title^="Director: the director decides"]').length).toBeGreaterThan(0);
});

test("a cap set by its environment variable keeps its use in the hint, marks env, and keeps the long warning as a title", () => {
  const h = gates.renderCaps({ ...data(), factory: { ...data().factory, caps: { ...CAPS, live: { ...CAPS.live, set: true } } } });
  expect(find(h, '[data-cap="live"] .hint').map((x) => x.text)).toEqual(["5 of 5, env"]);
  expect(find(h, '[data-cap="live"]')[0].attrs.title).toContain("ALEPH_LIVE_CAP is set: an edit has no effect while that variable is set.");
});

test("a rule form's Cancel and Save are act buttons, Save the one primary submit, and Decided By counts show with thousands", () => {
  const row = { ...rules().find((x) => x.reason === "held-path")!, decided: { rule: 1200, director: 1, chris: 0 } };
  const h = gates.renderRules({ rules: [row] });
  expect(find(h, "form.rule-form button[data-cancel]").map((b) => [b.attrs.class, b.attrs.type, b.text])).toEqual([["act", "button", "Cancel"]]);
  expect(find(h, 'form.rule-form button.primary[type="submit"]').map((b) => [b.attrs.class, b.text])).toEqual([["act primary", "Save"]]);
  expect(find(h, ".split").map((x) => x.text)).toEqual(["1,200 rule · 1 director · 0 user"]);
});

test("a Monitor report with an error shows Could not load, and the message only in the Technical details fold", () => {
  const h = gates.renderMonitor({ monitor: { day: "2026-11-03", findings: [], text: "", error: "boom" } });
  expect(text(h)).toContain("Could not load");
  expect(text(h)).not.toContain("No reading");
  expect(find(h, "details summary").map((x) => x.text)).toContain("Technical details");
  expect(find(h, ".error details pre").map((x) => x.text)).toEqual(["boom"]);
  expect(text(h).match(/boom/g)).toHaveLength(1);
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
  const after = (await body()).metrics.rate;
  expect(after.auto - before.auto).toBe(LOG_MAX);
  expect(after.total - before.total).toBe(LOG_MAX);
});

test("the held time sums, over the issues, the hours from a hold to the next start, or to now, in the 7 days", () => {
  const h = [rec(300, "a-1", "gate"), rec(120, "a-1", "started"), rec(60, "b-1", "gate"), rec(30, "b-1", "gate"), rec(60 * 24 * 9, "c-1", "gate"), rec(60 * 24 * 8, "c-1", "started")];
  expect(metrics([], h, NOW).held).toEqual({ issues: 2, hours: 4 });
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
  expect(find(h, '.seg [aria-pressed="true"]').map((x) => x.text)).toEqual(["human"]);
  expect(find(h, ".fchip")).toEqual([]);
  expect(find(h, 'td a[href="#rules"]').map((x) => x.text)).toEqual(["rescue"]);
  expect(table(h).slice(1).map((r) => r.slice(1, 5))).toEqual([["rescue", "set to resolve", "changed", "human"]]);
  expect(find(h, "td.wide")[0].attrs.title).toBe("set to resolve");
  expect(text(gates.renderLog(data(), "rule"))).not.toContain("set to resolve");
});

test("the By filter is over the five actors", () => {
  expect(Object.keys(gates.BY)).toEqual(["human", "rule", "director", "firefighter", "gate"]);
});

// Each row: the case, one log entry, and the cell it renders with that cell's text; no row shows a badge or "undefined".
test.each<[string, Record<string, unknown>, string, string]>([
  ["a missing action is miss()", { subject: "rule", object: "x-1" }, 'td > span[title="no action"]', "–"],
  ["a missing object is miss()", { subject: "rule", action: "reran" }, 'td > span[title="no object"]', "–"],
  ["Times goes through count()", { subject: "gate", object: "x-1", action: "held", times: 1200 }, "td.num", "1,200"],
  ["no times is 1", { subject: "gate", object: "x-1", action: "held" }, "td.num", "1"],
  ["the actor is a chip", { subject: "director", object: "x-1", action: "a" }, "td > .chip", "director"],
])("renderLog: %s", (_, entry, cell, shown) => {
  const h = gates.renderLog({ log: { entries: [{ time: new Date(NOW).toISOString(), ...entry }] } } as any);
  expect(find(h, cell).map((x) => x.text)).toEqual([shown]);
  expect(find(h, ".badge")).toEqual([]);
  expect(h).not.toContain("undefined");
});

test("renderLog heads the columns time first, then id, title, action, subject and number", () => {
  const h = gates.renderLog(data());
  expect(table(h)[0]).toEqual(["Logged", "Object", "Detail", "Action", "Subject", "Times"]);
  expect(find(h, "th.num").map((x) => x.text)).toEqual(["Times"]);
  expect(table(h)).toHaveLength(3);
  const kind = (c: Found) => (c.attrs.class?.includes("wide") ? "wide" : c.attrs.class?.includes("num") ? "num" : "cell");
  expect(find(h, "tbody td").map(kind)).toEqual(["cell", "cell", "wide", "cell", "cell", "num", "cell", "cell", "wide", "cell", "cell", "num"]);
});

test("renderLog shows 50 rows with a pager; a Gate run shows its count in Times", () => {
  const e = (n: number): any => ({ time: new Date(NOW - n * 1000).toISOString(), subject: "rule", object: "x-1", action: "reran", detail: `t${n}` });
  const entries = Array.from({ length: 120 }, (_, i) => e(i));
  entries[0] = { ...entries[0], subject: "gate", times: 3, first: entries[1].time };
  const h = gates.renderLog({ log: { entries } } as any);
  expect(table(h).length - 1).toBe(50);
  expect(text(h)).toContain("1–50 of 120");
  expect(find(h, ".pager button").map((x) => x.text)).toEqual(["Next 50"]);
  expect(table(h)[1][5]).toBe("3");
  expect(text(h)).not.toContain("×3");
});

test("log collapses a run of identical gate events into one with times, first and last time", () => {
  // A hold is the gate's event on an issue.
  for (const min of [30, 20, 10]) logEvent({ time: ago(min), subject: "gate", object: "issue.9", action: "held" });
  const g = log().filter((e) => e.subject === "gate");
  expect(g.length).toBe(1);
  expect(g[0].times).toBe(3);
  expect(Date.parse(g[0].first!)).toBeCloseTo(NOW - 30 * 60_000, -4);
  expect(Date.parse(g[0].time)).toBeCloseTo(NOW - 10 * 60_000, -4);
});

const postCaps = (b: unknown) => at("/api/automation/caps", { method: "POST", headers: { "X-Aleph-UI": "1" }, body: JSON.stringify(b) });

test("POST /api/automation/caps refuses bad values with 422, and leaves the file", async () => {
  expect((await postCaps({ live: 9 })).status).toBe(200);
  for (const v of [0, -1, 2.5, "x"]) {
    const r = await postCaps({ live: v });
    expect(r.status).toBe(422);
    expect(typeof (await r.json()).error).toBe("string");
  }
  // A post with no key writes nothing and answers the caps as they are.
  expect((await (await postCaps({})).json()).live).toBe(9);
});

test("the Gates page says the user, never you, your or Chris, in its visible text", () => {
  const d = data();
  const h = gates.renderGates({ ...d, asks: [] });
  expect(find(h, ".empty").map((x) => x.text)).toContain("No data");
  expect(find(h, '[title*="then these paths wait for the user"]')).toHaveLength(1);
  expect(text(h)).not.toMatch(/\b(you|your|Chris)\b/i);
});

test("a cap post writes the live cap only, ignores the old day cap, and leaves the caps it does not name", async () => {
  putJson("settings", "caps", { day: 999, awaiting: 5 });
  expect((await postCaps({ run: 5 })).status).toBe(200);
  const r = await postCaps({ live: 3, day: 7 });
  expect(r.status).toBe(200);
  // Each answer reads the caps back from the setting: the run cap of the first post is still there.
  const caps = await r.json();
  expect(caps).toMatchObject({ live: 3, run: 5, intakeTries: 2, jobSeconds: 1800, fixRounds: 2, landBatch: 8 });
  // No answer shows the keys outside the caps, so read the row: it keeps them and stores no new day.
  expect(getJson("settings", "caps", {})).toEqual({ day: 999, awaiting: 5, run: 5, live: 3 });
});

test("a cap post writes the run cap and refuses 0", async () => {
  const r = await postCaps({ run: 5 });
  expect(r.status).toBe(200);
  // The answer reads the run cap back from the setting.
  expect((await r.json()).run).toBe(5);
  expect((await postCaps({ run: 0 })).status).toBe(422);
});

test("a cap post writes the settings; fix rounds take 0 and the rest refuse it", async () => {
  // The preload sets ALEPH_LOAD_LIMIT, which wins over the setting: an empty one lets the answer read the setting.
  const restore = withEnv({ ALEPH_LOAD_LIMIT: "" });
  try {
    const r = await postCaps({ fixRounds: 0, jobSeconds: 2400, intakeTries: 3, landBatch: 4, loadLimit: 12 });
    expect(r.status).toBe(200);
    expect(await r.json()).toMatchObject({ fixRounds: 0, jobSeconds: 2400, intakeTries: 3, landBatch: 4, loadLimit: 12 });
  } finally { restore(); }
  for (const k of ["jobSeconds", "intakeTries", "landBatch", "loadLimit"]) expect((await postCaps({ [k]: 0 })).status).toBe(422);
  expect((await postCaps({ fixRounds: -1 })).status).toBe(422);
});

test("the Caps section holds a form each for the two caps, with use against limit, then one per setting, and no day cap", () => {
  const h = gates.renderCaps({ ...data(), factory: { ...data().factory, settings: { intakeTries: 2, jobSeconds: 1800, fixRounds: 2, landBatch: 8, loadLimit: 24 } } });
  expect(find(h, "[data-cap]").map((x) => x.attrs["data-cap"])).toEqual(["live", "run", "intakeTries", "jobSeconds", "fixRounds", "landBatch", "loadLimit"]);
  expect(find(h, 'label[for="cap-jobSeconds"]').map((x) => x.text)).toEqual(["Job time limit"]);
  expect(find(h, "input#cap-jobSeconds")[0].attrs).toMatchObject({ name: "jobSeconds", type: "number", value: "1800" });
  expect(find(h, 'input[name="fixRounds"]')[0].attrs.min).toBe("0");
  expect(find(h, '[data-cap="live"] .hint, [data-cap="run"] .hint').map((x) => x.text)).toEqual(["5 of 5", "2 of 3"]);
  expect(h).not.toContain("day");
  expect(find(gates.renderGates(data()), "#gates-caps h2").map((x) => x.text)).toEqual(["Controls"]);
});

test("the cap row and the rule hints say job and issue, with no goal and no Run cap", () => {
  const h = gates.renderGates(data());
  expect(find(h, "#gates-caps label").map((x) => x.text)).toContain("Job cap");
  const caps = find(h, "#gates-caps [title]").map((x) => x.attrs.title).join(" ");
  expect(caps).toContain("Live jobs now, of the cap");
  expect(caps).toContain("The most starts any one issue made in the last hour");
  const rules = find(h, "#rules td.wide").map((x) => `${x.text} ${x.attrs.title}`).join(" ");
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
  expect(find(h, "h1").map((x) => x.text)).toEqual(["Automation"]);
  expect(find(h, '[href^="#/automation?by="]')).toEqual([]);
  expect(h).not.toContain("#/gates");
  expect(gates.redirect("#/gates")).toBe("#/automation");
  expect(gates.redirect("#/gates?by=director")).toBe("#/automation?by=director");
  expect(gates.redirect("#/automation")).toBeNull();
});

test("the Automation page has no explaining aside; the controls panel holds the cap forms and no Pause button, before Held paths, each full width", () => {
  for (const paused of [false, true]) {
    const h = gates.renderGates({ ...data(), factory: { ...data().factory, paused } });
    expect(find(h, "header.ph [data-act]")).toEqual([]);
    expect(find(h, 'header.ph select[name="project"], header.ph [data-name="window"]').map((x) => x.tag)).toEqual(["select", "div"]);
    expect(find(h, '[data-act="pause"], [data-act="resume"]')).toEqual([]);
    expect(find(h, "#gates-caps [data-cap]").map((x) => x.attrs["data-cap"])).toEqual(expect.arrayContaining(["live", "run"]));
    expect(h).not.toContain("gates-two");
    // Schedules with Controls.
    expect(find(h, ".pair")).toHaveLength(1);
    expect(find(h, ".pair > section").map((x) => x.attrs.id)).toEqual(["gates-schedules", "gates-caps"]);
    const ids = find(h, "section[id]").map((x) => x.attrs.id);
    expect(ids.indexOf("gates-caps")).toBeLessThan(ids.indexOf("gates-held"));
  }
  const h = gates.renderGates(data());
  for (const t of ["What can stop, hold or ask", "Every goal passes these in order", "Who decides each kind of Ask"]) expect(h).not.toContain(t);
});

test("rules() has one row per Ask reason; renderRules is one table with a row per rule", () => {
  const r = rules().map((x) => x.reason);
  expect(r).toEqual(Object.keys(ASK_REASONS));
  for (const k of ["question", "held-path"]) expect(r).toContain(k);
  const h = gates.renderRules({ rules: rules() });
  expect(find(h, "table")).toHaveLength(1);
  expect(find(h, "td.acts")).toHaveLength(r.length);
});

test("a rule row names the reason in its title cell, ends in a small Edit button, and its form follows the table", () => {
  const h = gates.renderRules({ rules: rules().filter((x) => x.reason === "held-path") });
  const [title] = find(h, "td.wide");
  expect(title.attrs.title).toStartWith("held-path");
  expect(title.text).not.toBe("");
  expect(table(h)[1].at(-1)).toBe("Edit");
  expect(find(h, 'td.acts button.act.small[data-edit-rule="held-path"]').map((x) => x.text)).toEqual(["Edit"]);
  expect(find(h, "table, form.rule-form").map((x) => x.tag)).toEqual(["table", "form"]);
});

test("a stored firefighter grant for held-path is dead: rules() shows no grant and Decides offers Director, Approve and User", () => {
  putJson("settings", "always", { "held-path": { action: "firefighter", at: ago(5) } });
  const row: any = rules().find((x) => x.reason === "held-path")!;
  expect(row.granted).toBeNull();
  const h = gates.renderRules({ rules: [row] });
  expect(h).not.toContain("always.json grants");
  expect(h).not.toContain("firefighter");
  expect(choices(h, "decide")).toEqual([["", true, "Director"], ["approve", false, "Approve"], ["user", false, "User"]]);
});

test("a reason granted user shows User in Decides", () => {
  putJson("settings", "always", { "held-path": { action: "user", at: ago(5) } });
  const all = rules();
  const held = gates.renderRules({ rules: all.filter((x) => x.reason === "held-path") });
  expect(table(held)[1][3]).toBe("User");
  expect(choices(held, "decide").filter((c) => c[1])).toEqual([["user", true, "User"]]);
});

test("a grant of reason:project is listed in that reason's row with its project, and not as the row's own grant", () => {
  putJson("settings", "always", { "held-path:aleph": { action: "approve", at: ago(5) } });
  const row: any = rules().find((x) => x.reason === "held-path")!;
  expect(row.projects).toEqual([{ project: "aleph", action: "approve", at: ago(5) }]);
  expect(row.granted).toBeNull();
  expect((rules().find((x) => x.reason === "review-held") as any).projects).toEqual([]);
});

test("a grant that is neither the reason's mode nor user still shows pressed in Decides", () => {
  putJson("settings", "always", { "intake-failed": { action: "discontinue", at: ago(5) } });
  const h = gates.renderRules({ rules: rules().filter((x) => x.reason === "intake-failed") });
  expect(choices(h, "decide").map((c) => c.slice(0, 2))).toEqual([["", false], ["continue", false], ["discontinue", true], ["user", false]]);
});

test("rules() counts each reason's Asks in the window by who decided them and what followed; renderRules shows the counts", () => {
  const at = (m: number) => new Date(NOW + m * 60_000).toISOString();
  const ask = (n: number, cleared = true) => ({ set: at(n * 10), ...(cleared ? { cleared: at(n * 10 + 1) } : {}), reason: "question" });
  const rec = (n: number, asks: any[]) => asks.map((a) => ({ issue: `issue.${n}`, ...a }));
  // A build that starts after the Ask of issue 1 went is what followed it.
  seed({ role: "build", state: "done", target: "issue.1", started: at(15) });
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
  expect(table(h)[0]).toEqual(["Ask", "Fired", "Decided By", "Decides", "If No Answer", ""]);
  expect(find(h, "th.num").map((x) => x.text)).toEqual(["Fired"]);
  for (const t of ["If Auto Cannot", "Ask me", "Manual"]) expect(text(h)).not.toContain(t);
  expect(find(h, "[colspan], .note")).toEqual([]);
  expect(table(h)[0].filter((t) => /[()/]/.test(t))).toEqual([]);
  expect(table(h)[1][1]).toBe("5");
  expect(find(h, ".split").map((x) => x.text)).toEqual(["2 rule · 1 director · 1 user"]);
  expect(find(h, ".meter i").map((x) => [x.attrs.class, x.attrs.style])).toEqual([["c-rule", "width:50.0%"], ["c-dir", "width:25.0%"], ["c-user", "width:25.0%"]]);
});

test("the Monitor panel says the monitor has not run with no report, and holds the newest report with the findings inside the part that expands", async () => {
  const dir = join(process.env.ALEPH_FACTORY_DIR!, "monitor"), file = join(dir, "2026-11-03.json");
  expect((await body()).monitor).toBeNull();
  expect(find(gates.renderMonitor(await body()), ".empty").map((x) => x.text)).toEqual(["No data"]);
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ day: "2026-11-03", table: {}, text: "READER-TEXT", findings: ["FIRST-ONE", "SECOND-ONE"] }));
  try {
    const d: any = await body();
    expect(d.monitor).toMatchObject({ day: "2026-11-03", findings: ["FIRST-ONE", "SECOND-ONE"], text: "READER-TEXT" });
    const h = gates.renderMonitor(d), [sum] = find(h, "summary").map((x) => x.text);
    for (const x of [day("2026-11-03T00:00"), "2 findings", "FIRST-ONE"]) expect(sum).toContain(x);
    expect(sum).not.toContain("SECOND-ONE");
    expect(find(h, "details li").map((x) => x.text)).toEqual(["FIRST-ONE", "SECOND-ONE"]);
    expect(find(h, "details pre").map((x) => x.text)).toEqual(["READER-TEXT"]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("the Monitor summary shows the report's day as a local day, and 1 finding for one finding", () => {
  const tz = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const h = gates.renderMonitor({ monitor: { day: "2026-11-03", findings: ["ONLY"], text: "", error: null } });
    expect(find(h, "summary")[0].text).toContain(`${day("2026-11-03T00:00")}: 1 finding.`);
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
    const h = gates.renderMonitor(await body()), [sum] = find(h, "summary").map((x) => x.text);
    // The finding's own tags show as text: the page draws no <i>.
    expect(sum).toContain("First: x <i>y</i>");
    expect(find(h, "summary b").map((x) => x.text)).toEqual(["x"]);
    expect(find(h, "li").map((x) => x.text)).toEqual(["x <i>y</i>", "z"]);
    expect(find(h, "li b").map((x) => x.text)).toEqual(["x", "z"]);
    expect(find(h, "i")).toEqual([]);
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("the body has the tick, the suite and the monitor with their last run from the tick table; with no record each has not run", async () => {
  const none: any = (await body()).schedules;
  expect(none).toEqual([{ name: "tick", last: null, result: null, every: "1min" }, { name: "suite", last: null, result: null, every: "1h" }, { name: "monitor", last: null, result: null, every: "1d", hour: 0 }]);
  const h = gates.renderSchedules({ ...(await body()), schedules: none });
  expect(find(h, "h2").map((x) => x.text)).toEqual(["Schedules"]);
  // One settings list: no table, a row per schedule with its control and Save, and a miss text for the run it has not had.
  expect(find(h, "table")).toEqual([]);
  expect(find(h, ".settings")).toHaveLength(1);
  expect(find(h, "form.srow").map((x) => x.attrs["data-schedule"])).toEqual(["tick", "suite", "monitor"]);
  expect(find(h, ".hint").map((x) => x.text)).toEqual(["no run", "no run", "no run"]);
  // Each row: its label, whether the label names the input, the input's value, the unit picked and the submit button.
  const form = (name: string) => {
    const at = (sel: string) => find(h, `form[data-schedule="${name}"] ${sel}`);
    return [at("label")[0].text, at("label")[0].attrs.for === at("input")[0].attrs.id, at("input")[0].attrs.value, at("option[selected]").map((x) => x.text), at('button[type="submit"]').map((x) => x.text)];
  };
  expect(["tick", "suite", "monitor"].map(form)).toEqual([
    ["Tick every", true, "1", ["minutes"], ["Save"]],
    ["Suite every", true, "1", ["hours"], ["Save"]],
    ["Monitor hour", true, "0", [], ["Save"]],
  ]);
  expect(text(h)).not.toContain("has not run");
  const ran = { "suite plain": { last: ago(11), result: "green" }, "suite held": { last: ago(10), result: "green" }, monitor: { last: ago(50), result: "7 findings" }, ci: { last: ago(9), result: null }, firefight: { last: ago(2), result: null } };
  for (const [k, v] of Object.entries(ran)) setTick(k, v);
  putJson("state", "tick.missed", ["stalled:x"]);
  const d: any = (await body()).schedules;
  expect(d).toEqual([
    { name: "tick", last: ago(2), result: "1 missed", every: "1min" },
    { name: "suite", last: ago(10), result: "held: green; plain: green", every: "1h" },
    { name: "monitor", last: ago(50), result: "7 findings", every: "1d", hour: 0 },
  ]);
  const t = gates.renderSchedules({ ...(await body()), schedules: d });
  expect(text(t)).not.toContain("has not run");
  expect(find(t, 'form[data-schedule="monitor"] .hint').map((x) => x.text)).toEqual([`7 findings · ${when(ago(50))}`]);
});

test("renderNow shows a dash, not undefined or NaN, with no rate and no held time", () => {
  const d = data();
  const bare = gates.renderNow({ ...d, metrics: { ...d.metrics, rate: null, held: undefined } });
  expect(bare).not.toMatch(/undefined|NaN/);
  expect(find(bare, ".tile b")[0].text).toBe("–");
});

test("GET /api/automation takes window and project: the log and the metrics keep that window and that repo; no parameter keeps 7 days of every repo; a bad window is 400", async () => {
  const m = (min: number) => min * 60 * 24;
  for (const [min, id] of [[30, "alpha-1"], [m(3), "beta-1"], [m(10), "beta-2"], [m(40), "alpha-3"]] as const) logEvent({ time: ago(min), subject: "rule", action: "reran", object: id, detail: "rescue" });
  logEvent({ time: ago(60 * 5), subject: "rule", action: "reran", object: "alpha-2", detail: "rescue" });
  const get = async (q: string) => { const r = await at(`/api/automation${q}`); return { status: r.status, d: r.status === 200 ? await r.json() as any : null }; };
  const items = (d: any) => d.log.entries.map((e: any) => e.object).filter((i: string) => /^(alpha|beta)-/.test(i)).sort();
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
  // The updater watches the database the server started on, not this test's: forget the kept answers so the GET reads the new event.
  updater.reset();
  expect(items((await get("?project=alpha")).d)).toEqual(["alpha-1", "alpha-2"]);
  expect(items((await get("?project=beta&window=month")).d)).toEqual(["beta-1", "beta-2"]);
  expect((await get("?window=year")).status).toBe(400);
});

test("every seg group on the Automation page has an accessible name, rule toggles included", () => {
  const h = gates.renderGates(data());
  const groups = find(h, ".seg").map((x) => x.attrs["aria-label"]);
  expect(groups.length).toBeGreaterThan(2);
  for (const g of groups) expect(g).toMatch(/./);
  expect(groups.some((g) => g.startsWith("Who decides "))).toBe(true);
});

test("the Held time card reads hours() and the Automation rate reads pct()", () => {
  const d = data();
  const h = gates.renderGates({ ...d, metrics: { ...d.metrics, held: { issues: 2, hours: 3513.1 }, rate: { auto: 1, total: 8, percent: 12.5 } } });
  expect(find(h, ".tile b").map((x) => x.text)).toEqual([`${pct(12.5)} / 8`, "6 / 2", "3513h / 2"]);
});

test("Monitor, Schedules, Rules and Log are each a card that keeps its id", async () => {
  const d = { ...(await body()), rules: [], log: { entries: [] } } as any;
  const h = { monitor: gates.renderMonitor(d), "gates-schedules": gates.renderSchedules(d), rules: gates.renderRules(d), "gates-log": gates.renderLog(d) };
  for (const [id, html] of Object.entries(h)) expect(find(html, "section")[0].attrs).toMatchObject({ class: "card", id });
  const dir = join(process.env.ALEPH_FACTORY_DIR!, "monitor"), file = join(dir, "2026-11-03.json");
  mkdirSync(dir, { recursive: true });
  writeFileSync(file, JSON.stringify({ day: "2026-11-03", table: {}, text: "T", findings: ["F"] }));
  try {
    expect(find(gates.renderMonitor(await body()), "section")[0].attrs).toMatchObject({ class: "card", id: "monitor" });
  } finally {
    rmSync(dir, { recursive: true });
  }
});

test("Schedules, Rules and Log show empty() with no rows; the Log pages at 50", () => {
  const empty = (h: string) => find(h, ".empty").map((x) => x.text);
  expect(empty(gates.renderLog({ log: { entries: [] } } as any))).toEqual(["No data"]);
  expect(find(gates.renderLog({ log: { entries: Array.from({ length: 51 }, (_, i) => ({ time: new Date(NOW - i * 1000).toISOString(), subject: "rule", object: "x-1", action: "reran", detail: `t${i}` })) } } as any), ".pager")[0].text).toContain("50 of 51");
  expect(empty(gates.renderSchedules({ schedules: [] }))).toEqual(["No data"]);
  expect(empty(gates.renderRules({ rules: [] }))).toEqual(["No data"]);
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

test("POST /api/automation/schedules stores the monitor's hour, which the next GET shows; a value that is not a whole number from 0 to 23 is 422 and leaves it", async () => {
  const send = (b: unknown) => at("/api/automation/schedules", { method: "POST", headers: { "X-Aleph-UI": "1" }, body: JSON.stringify(b) });
  const hour = async () => ((await (await at("/api/automation")).json()) as any).schedules.find((s: any) => s.name === "monitor").hour;
  expect((await send({ name: "monitor", hour: 9 })).status).toBe(200);
  expect(await hour()).toBe(9);
  for (const bad of [24, -1, "x", 1.5]) expect((await send({ name: "monitor", hour: bad })).status).toBe(422);
  expect(await hour()).toBe(9);
});

test("the Automation page names the held backend and its reason, and no line when none is held", () => {
  const held = gates.renderGates({ ...data(), backend: { via: "OpenRouter", why: "probe failed" } });
  expect(find(held, "#gates-backend").map((x) => x.text)).toEqual(["Waiting for OpenRouter: probe failed"]);
  expect(find(gates.renderGates({ ...data(), backend: null }), "#gates-backend")).toEqual([]);
});

test("a non-land reason shows its timeout in the largest whole unit with its action, and its Edit row opens on the matching choice", () => {
  const row = (reason: string, timeout: number, noAnswer: string): any => ({ reason, ...reasonText(reason), mode: "", fired: 0, decided: { rule: 0, director: 0, chris: 0 }, outcome: { fixed: 0, none: 0 }, granted: null, timeout, noAnswer });
  const h = gates.renderRules({ rules: [row("question", 120, "pick")] });
  expect(table(h)[1][4]).toBe("After 2 h: take the pick");
  expect(find(h, "form.rule-form")[0].attrs).toMatchObject({ "data-was-wait": "120", "data-was-then": "pick" });
  expect(choices(h, "wait")).toEqual([["wait", false, "Keep waiting"], ["pick", true, "Take the pick"], ["drop", false, "Drop"]]);
  expect(find(h, 'form.rule-form input[name="n"]')[0].attrs).toMatchObject({ type: "number", value: "2" });
  expect(find(h, "form.rule-form option[selected]").map((x) => [x.attrs.value, x.text])).toEqual([["h", "hours"]]);
  expect(choices(h, "decide")).toEqual([["", true, "Director"], ["user", false, "User"]]);
  expect(choices(gates.renderRules({ rules: [row("question", 45, "drop")] }), "wait").filter((c) => c[1])).toEqual([["drop", true, "Drop"]]);
  const off = gates.renderRules({ rules: [row("question", 0, "pick")] });
  expect(table(off)[1][4]).toBe("Keep waiting");
  expect(choices(off, "wait").filter((c) => c[1])).toEqual([["wait", true, "Keep waiting"]]);
  expect(find(off, 'form.rule-form input[name="n"]')[0].attrs).toHaveProperty("disabled");
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
