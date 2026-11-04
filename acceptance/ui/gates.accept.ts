// Archived goal tests from ui/gates.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ASK_REASONS } from "../../jobs/lib/ask.ts";
import { SECURITY_PATHS } from "../../jobs/lib/gate.ts";
import type { AskItem } from "../../ui/asks.ts";
import { withEnv, withServer } from "../../ui/test-server.ts";
// @ts-ignore lib.js is plain JS, shared with the page
import { when } from "../../ui/lib.js";
// @ts-ignore gates.js is plain JS, shared with the page
import * as gates from "../../ui/views/gates.js";

let base: string, stop: () => void, restoreEnv: () => void, calls: string;
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
  ({ stop } = await withServer({ warm: false }));
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

const askItem = (reason: string, id: string): AskItem => ({ key: `issue:${id}`, reason, kind: "input", id, href: `#/issues/r/${id.split("-")[1]}`, title: `t ${id}`, problem: `p ${id}`, situation: `p ${id}`, escalated: true,
  actions: [{ act: "checked", label: "Mark it checked", hint: "Records it.", primary: true, args: { repo: "r", id: id.split("-")[1] }, recommended: false }], details: {}, repo: "r" });

const data = () => ({
  now: new Date().toISOString(),
  factory: { paused: false, probe: { at: ago(10), ok: true, failed: [] }, liveRuns: 5, liveCap: 5, capEnv: { live: false } },
  gated: { gate: "live-cap", why: "5 agent runs are live", text: "Waiting for a slot (5 of 5 running)" },
  baseline: [{ repo: "r", state: "green", line: "r abc1234" }],
  goalGates: { baseline: 0, "not-ready": 0, "busy-file": 0, "loop-guard": 0 },
  asks: [askItem("run-cap", "r-1")],
  chores: [askItem("host-check", "r-2")],
  rules: Object.entries(ASK_REASONS).map(([reason, r]) => ({ reason, kind: r.kind, mode: r.always, granted: reason === "rescue" ? { action: "recommended", at: ago(1) } : null, ...(reason.startsWith("proposal-") ? { places: [] } : {}) })),
  held: SECURITY_PATHS,
  repoHeld: [{ repo: "r", held: ["src/auth/**"] }],
  sandbox: { read: ["<run>/in.bundle"], write: ["<run>/work"], denied: ["/home"], network: { domains: ["api.anthropic.com"], localBinding: false } },
  log: { days: 7, max: 200, entries: [{ at: ago(1), by: "Rule", item: "r-5", what: "rescue: recommended" }, { at: ago(2), by: "You", item: "rule", what: "rescue: set to recommended" }] },
});

test("renderNow draws a number input and a Save button for the live cap only", () => {
  const h = gates.renderNow(data());
  expect(h).toMatch(/<form class="capform" data-cap="live">[^]*?<input id="cap-live" name="live" type="number"[^]*?Save/);
  expect(h.match(/<form class="capform"/g)!.length).toBe(1);
  expect(h).toContain('value="5"');
  expect(h).not.toContain("has no effect");
});
