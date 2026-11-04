import { afterAll, beforeAll, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_REASONS } from "../jobs/lib/ask.ts";
import { SECURITY_PATHS } from "../jobs/lib/gate.ts";
import { gatesBody, log, securityFacts, splitAsks } from "./api/gates.ts";
import type { AskItem } from "./asks.ts";
import { withEnv, withServer } from "./test-server.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { when } from "./lib.js";
// @ts-ignore gates.js is plain JS, shared with the page
import * as gates from "./views/gates.js";

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
  writeFileSync(join(factory, "always.json"), JSON.stringify({ rescue: { action: "recommended", at: ago(30) }, "triage-failed": { action: "close", at: ago(40) }, "proposal-claude-md:global": { action: "approve", at: ago(50) } }));
  writeFileSync(join(factory, "holds.jsonl"), [
    // An old record, from before the 7 gates, still parses.
    { at: ago(5), name: "r-3", kind: "gate", text: "5 agent runs are live" },
    { at: ago(4), name: "r-3", kind: "started", text: "started" },
    { at: ago(60 * 24 * 9), name: "r-4", kind: "gate", text: "too old" },
  ].map((x) => JSON.stringify(x)).join("\n") + "\n");
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
const stub = { now: new Date(NOW).toISOString(), asks: [] as AskItem[], factory: { paused: false, liveRuns: 0, liveCap: 5, runsToday: 0 } as any, queued: [queued("not-ready"), queued("not-ready"), queued("busy-file"), queued("ready")] };
const body = async () => JSON.parse(JSON.stringify(gatesBody(stub, await securityFacts())));

test("the body of /api/gates has every section, one rule per Ask reason with only its supported modes, and the held paths of gate.ts", async () => {
  const d: any = await body();
  expect(Object.keys(d).sort()).toEqual(["asks", "baseline", "chores", "factory", "gated", "goalGates", "held", "log", "now", "repoHeld", "rules"]);
  expect(Object.keys(d.factory).sort()).toEqual(["capEnv", "liveCap", "liveRuns", "paused"]);
  expect(d.goalGates).toEqual({ baseline: 0, "not-ready": 2, "busy-file": 1, "loop-guard": 0 });
  expect(d.baseline).toEqual([]);
  expect(d.rules.map((r: any) => r.reason)).toEqual(Object.keys(ASK_REASONS));
  for (const r of d.rules) expect(r.mode).toBe(ASK_REASONS[r.reason].always);
  const by = (k: string) => d.rules.find((r: any) => r.reason === k);
  expect(by("rescue").granted.action).toBe("recommended");
  expect(by("host-check").mode).toBe("");
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
    "You rule triage-failed: set to close",
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

test("splitAsks keeps every Ask and puts host checks in the chores", () => {
  const { asks, chores } = splitAsks([askItem("run-cap", "r-1"), askItem("host-check", "r-2")]);
  expect(asks.map((a) => a.id)).toEqual(["r-1"]);
  expect(chores.map((a) => a.id)).toEqual(["r-2"]);
});

const data = () => ({
  now: new Date(NOW).toISOString(),
  factory: { paused: false, liveRuns: 5, liveCap: 5, capEnv: { live: false } },
  gated: { gate: "live-cap", why: "5 agent runs are live", text: "Waiting for a slot (5 of 5 running)" },
  baseline: [{ repo: "r", state: "green", line: "r abc1234" }],
  goalGates: { baseline: 0, "not-ready": 2, "busy-file": 0, "loop-guard": 1 },
  asks: [askItem("run-cap", "r-1")],
  chores: [askItem("host-check", "r-2")],
  rules: Object.entries(ASK_REASONS).map(([reason, r]) => ({ reason, kind: r.kind, mode: r.always, granted: reason === "rescue" ? { action: "recommended", at: ago(1) } : null, ...(reason.startsWith("proposal-") ? { places: [] } : {}) })),
  held: SECURITY_PATHS,
  repoHeld: [{ repo: "r", held: ["src/auth/**"] }],
  log: { days: 7, max: 200, entries: [{ at: ago(1), by: "Rule", item: "r-5", what: "rescue: recommended" }, { at: ago(2), by: "You", item: "rule", what: "rescue: set to recommended" }] },
});

test("the view draws the sections in order, a closed gate, and the rule switches with only Ask me and the reason's mode", () => {
  const h = gates.renderGates(data());
  const order = ["Gates now", "Waiting for you", "Host chores", "Rules", "Held paths", "Log"].map((t) => h.indexOf(`<h2>${t}</h2>`));
  expect(order.every((x, i) => x > 0 && (i === 0 || x > order[i - 1]))).toBe(true);
  expect(h).toContain("Closed at live-cap: Waiting for a slot (5 of 5 running).");
  // The 6 gates, in the dispatch's order; no tile for the removed hold, day cap or awaiting cap.
  const tiles = [...h.matchAll(/<div class="gt-head"><span>([^<]*)<\/span>/g)].map((m) => m[1]);
  expect(tiles).toEqual(["Pause", "Baseline", "Not ready", "Live cap", "Busy file", "Loop guard"]);
  expect(h).toContain("<b>2 held</b>");
  expect(h).not.toContain('data-cap="day"');
  expect(h).not.toContain('data-cap="awaiting"');
  expect(h).toContain('data-act="pause"');
  expect(h).not.toContain("Edit caps");
  for (const [reason, r] of Object.entries(ASK_REASONS)) {
    const row = h.slice(h.indexOf(`<div class="rule" data-reason="${reason}">`)).split('<div class="rule" ')[1];
    const modes = [...row.matchAll(/data-mode="([^"]*)"/g)].map((m) => m[1]);
    if (reason.startsWith("proposal-")) expect(modes).toEqual([]);
    else expect(modes).toEqual(r.always ? ["", r.always] : [""]);
    if (!r.always && !reason.startsWith("proposal-")) expect(row).toContain("No automatic mode");
  }
  const rescue = h.slice(h.indexOf('data-reason="rescue"'));
  expect(rescue).toMatch(/data-mode="recommended" aria-pressed="true">Recommended</);
  expect(h).toContain('data-act="checked" data-repo="r" data-id="2"');
  expect(h).toContain('data-gates="all-done"');
  for (const p of SECURITY_PATHS) expect(h).toContain(`<code class="chip">${p}</code>`);
  const card = gates.renderHeld(data());
  expect(card).toContain("<b>r</b>");
  expect(card).toContain('<code class="chip">src/auth/**</code>');
  for (const p of SECURITY_PATHS) expect(card).toContain(`<code class="chip">${p}</code>`);
  expect(gates.renderHeld({ ...data(), repoHeld: [] })).toContain("No repo names held paths.");
});

test("the log filter keeps one actor's entries", () => {
  const h = gates.renderLog(data(), "you");
  expect(h).toContain('aria-current="true">You<');
  expect(h).toContain("rescue: set to recommended");
  expect(h).not.toContain("rescue: recommended<");
});

const withHolds = (rows: any[], f: () => void) => {
  const file = join(process.env.ALEPH_FACTORY_DIR!, "holds.jsonl");
  const was = readFileSync(file, "utf8");
  writeFileSync(file, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
  try { f(); } finally { writeFileSync(file, was); }
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
  expect(await r.json()).toEqual({ live: 3 });
  expect(JSON.parse(readFileSync(capsPath(), "utf8"))).toEqual({ day: 999, awaiting: 5, live: 3 });
});
