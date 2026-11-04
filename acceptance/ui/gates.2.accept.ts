// Archived goal tests from ui/gates.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_REASONS } from "../../jobs/lib/ask.ts";
import { SECURITY_PATHS } from "../../jobs/lib/gate.ts";
import { DAY_CAP, LIVE_CAP } from "../../jobs/lib/settings.ts";
import { gatesBody, log, securityFacts } from "../../ui/api/gates.ts";
import type { AskItem } from "../../ui/asks.ts";
import { withEnv, withServer } from "../../ui/test-server.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { when } from "../../ui/lib.js";
// @ts-ignore gates.js is plain JS, shared with the page
import * as gates from "../../ui/views/gates.js";

let base: string, stop: () => void, restoreEnv: () => void, at: (path: string, init?: RequestInit) => Promise<Response>, calls: string;
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

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
    { at: ago(5), name: "r-3", kind: "gate", text: "5 agent runs are live" },
    { at: ago(4), name: "r-3", kind: "started", text: "started" },
    { at: ago(60 * 24 * 9), name: "r-4", kind: "gate", text: "too old" },
  ].map((x) => JSON.stringify(x)).join("\n") + "\n");
  writeFileSync(join(factory, "tick.log"), [
    `${ago(3)} always: rescue: recommended on r-5`,
    `${ago(2)} firefighter: did answer r-6: picked the plain option`,
    `${ago(1)} landed r-7`,
  ].join("\n") + "\n");
  calls = join(base, "calls");
  const fake = join(base, "fake-aleph");
  writeFileSync(fake, `#!/bin/sh\necho "$*" >> ${calls}\necho '{}'\nexit 0\n`);
  chmodSync(fake, 0o755);
  restoreEnv = withEnv({ ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_FACTORY_DIR: factory, ALEPH_SANDBOX_DIR: join(base, "sandbox"), ALEPH_CLI: fake });
  ({ stop, at } = await withServer({ warm: false }));
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

// The body of GET /api/gates from a stub of the Status page's state. The route itself adds only the state build, which
// this file leaves alone: a build here would share the worker with ui/state-load.test.ts in the same test process.
const stub = { now: new Date().toISOString(), asks: [] as AskItem[], factory: { paused: false, hold: null, probe: null, liveRuns: 0, liveCap: 5, runsToday: 0, dayCap: 12, awaitingCap: 5 } as any };
const body = async () => JSON.parse(JSON.stringify(gatesBody(stub, await securityFacts())));

const askItem = (reason: string, id: string): AskItem => ({ key: `issue:${id}`, reason, kind: "input", id, href: `#/issues/r/${id.split("-")[1]}`, title: `t ${id}`, problem: `p ${id}`, situation: `p ${id}`, escalated: true,
  actions: [{ act: "checked", label: "Mark it checked", hint: "Records it.", primary: true, args: { repo: "r", id: id.split("-")[1] }, recommended: false }], details: {}, repo: "r" });

const data = () => ({
  now: new Date().toISOString(),
  factory: { paused: false, hold: null, probe: { at: ago(10), ok: true, failed: [] }, liveRuns: 5, liveCap: 5, runsToday: 3, dayCap: 12, awaiting: 1, awaitingCap: 5 },
  gated: { gate: "live", why: "5 agent runs are live", text: "Waiting for a slot (5 of 5 running)" },
  main: { repos: 1, red: [], commits: ["r abc1234"] },
  asks: [askItem("run-cap", "r-1")],
  chores: [askItem("host-check", "r-2")],
  rules: Object.entries(ASK_REASONS).map(([reason, r]) => ({ reason, kind: r.kind, mode: r.always, granted: reason === "rescue" ? { action: "recommended", at: ago(1) } : null, ...(reason.startsWith("proposal-") ? { places: [] } : {}) })),
  held: SECURITY_PATHS,
  repoHeld: [{ repo: "r", held: ["src/auth/**"] }],
  sandbox: { read: ["<run>/in.bundle"], write: ["<run>/work"], denied: ["/home"], network: { domains: ["api.anthropic.com"], localBinding: false } },
  log: { days: 7, max: 200, entries: [{ at: ago(1), by: "Rule", item: "r-5", what: "rescue: recommended" }, { at: ago(2), by: "You", item: "rule", what: "rescue: set to recommended" }] },
});

const withHolds = (rows: any[], f: () => void) => {
  const file = join(process.env.ALEPH_FACTORY_DIR!, "holds.jsonl");
  const was = readFileSync(file, "utf8");
  writeFileSync(file, rows.map((x) => JSON.stringify(x)).join("\n") + "\n");
  try { f(); } finally { writeFileSync(file, was); }
};
const hold = (min: number, name = "r-9", text = "busy") => ({ at: ago(min), name, kind: "gate", text });
const gateLines = () => log().filter((e) => e.by === "Gate");

test("a different Gate line between identical ones ends the run", () => {
  withHolds([hold(30), hold(20, "r-9", "other"), hold(10)], () => expect(gateLines().length).toBe(3));
  withHolds([hold(30), hold(20, "r-8"), hold(10)], () => expect(gateLines().length).toBe(3));
});

test("a You or Rule line between identical Gate lines does not split them", () => {
  withHolds([hold(55), hold(5)], () => {
    const l = log();
    expect(l.filter((e) => e.by === "Gate").length).toBe(1);
    expect(l.filter((e) => e.by === "Gate")[0].count).toBe(2);
    expect(l.some((e) => e.by === "You")).toBe(true);
    expect(l.some((e) => e.by === "Rule")).toBe(true);
  });
});

test("a single Gate line has no count and no first", () => {
  withHolds([hold(5)], () => {
    const g = gateLines();
    expect(g.length).toBe(1);
    expect("count" in g[0]).toBe(false);
    expect("first" in g[0]).toBe(false);
  });
});

test("renderLog draws a collapsed entry as one row (after the header) with the count and both times", () => {
  const d = data();
  d.log.entries = [{ at: ago(10), first: ago(30), count: 37, by: "Gate", item: "r-9", what: "gate: busy" }] as any;
  const h = gates.renderLog(d, undefined);
  expect(h.match(/<tr>/g)!.length).toBe(2);
  expect(h).toContain("×37");
  expect(h).toContain(`${when(ago(30))} – ${when(ago(10))}`);
});

const capsPath = () => join(process.env.ALEPH_FACTORY_DIR!, "caps.json");
const postCaps = (b: unknown, headers: Record<string, string> = { "X-Aleph-UI": "1" }) => at("/api/gates/caps", { method: "POST", headers, body: JSON.stringify(b) });

test("POST /api/gates/caps merges keys, keeps awaiting, and the readers see them", async () => {
  const restore = withEnv({ ALEPH_DAY_CAP: "", ALEPH_LIVE_CAP: "" });
  try {
    writeFileSync(capsPath(), JSON.stringify({ awaiting: 7 }));
    const r = await postCaps({ day: 20, live: 4 });
    expect(r.status).toBe(200);
    expect(JSON.parse(readFileSync(capsPath(), "utf8"))).toEqual({ awaiting: 7, day: 20, live: 4 });
    expect(await r.json()).toEqual({ day: 20, live: 4, awaiting: 7 });
    expect(DAY_CAP()).toBe(20);
    expect(LIVE_CAP()).toBe(4);
  } finally { restore(); }
});

test("gatesBody marks a cap overridden only for a non-empty ALEPH_* variable", async () => {
  const restore = withEnv({ ALEPH_DAY_CAP: "3", ALEPH_LIVE_CAP: "", ALEPH_AWAITING_CAP: "" });
  try {
    const d: any = await body();
    expect(d.factory.capEnv).toEqual({ day: true, live: false, awaiting: false });
  } finally { restore(); }
});

test("renderNow says an edit has no effect while the environment variable is set, and names it", () => {
  const d: any = data();
  d.factory.capEnv = { day: true, live: false, awaiting: false };
  const h = gates.renderNow(d);
  expect(h).toContain("ALEPH_DAY_CAP is set: an edit has no effect while that variable is set.");
  expect(h).not.toContain("ALEPH_LIVE_CAP");
  expect(h).not.toContain("ALEPH_AWAITING_CAP");
});
