import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeList } from "../../todo/lib/store.ts";
import * as issues from "../../todo/lib/todo.ts";
import { correctionsDue, dispatchIssues, episodeStep, report, notReady, spentToday, waitReason, setPaused, health, stalled, stallStep } from "./factory.ts";
import { readRun, writeRun } from "./ledger.ts";
import { type Run } from "./ledger.ts";
import { ctx, sh, goal, change, mk, setup, teardown } from "./factory.helpers.ts";

beforeEach(setup);
afterEach(teardown);

test("notReady: a migrated goal waits on its after list, dotted ids included", () => {
  const item = { fm: { after: ["fac-1", "fac-2.1"] } } as unknown as issues.Issue;
  expect(notReady(item, () => true)).toBeNull();
  expect(notReady(item, (r) => r === "fac-1")).toBe("blocked: after fac-2.1");
});

const repoX = { key: "fac" } as never;
const mkItem = (fm: Record<string, unknown>, notes: string[] = []) => ({ fm, notes }) as unknown as issues.Issue;

test("waitReason: waits_on names only the open refs", () => {
  const r = waitReason(repoX, mkItem({ after: ["fac-1", "fac-2"] }), { done: (ref) => ref === "fac-1" });
  expect(r).toEqual({ kind: "waits_on", ids: ["fac-2"], text: "Waits on fac-2" });
});

test("waitReason: an Ask gives its question", () => {
  const asked = mkItem({ ask: "input", reason: "no-commit", question: "q?" });
  expect(waitReason(repoX, asked, { done: () => true })).toEqual({ kind: "ask", reason: "q?", text: "Waits for you: q?" });
});

test("waitReason: ready, gated live, and red", () => {
  const item = mkItem({});
  expect(waitReason(repoX, item, { done: () => true, gated: null })).toEqual({ kind: "ready", text: "Starts at the next dispatch" });
  process.env.ALEPH_LIVE_CAP = "12";
  const live = waitReason(repoX, item, { done: () => true, gated: { gate: "live", why: "12 agent runs are live" } });
  expect(live).toEqual({ kind: "gate", gate: "live", text: "Waiting for a slot (12 of 12 running)" });
  expect(waitReason(repoX, item, { done: () => true, red: "main is red" })).toEqual({ kind: "red", text: "main is red" });
});

const storeAt = (lessons: unknown[], minedAt = "") => {
  mkdirSync(join(ctx.base, "factory"), { recursive: true });
  writeFileSync(join(ctx.base, "factory", "corrections.json"), JSON.stringify({ minedAt, lessons }));
};

test("correctionsDue: from 03:00 local, once per local day", () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
  expect(correctionsDue(at(28, 2, 59))).toBe(false);
  expect(correctionsDue(at(28, 3))).toBe(true);
  storeAt([], new Date(at(28, 3, 1)).toISOString());
  expect(correctionsDue(at(28, 15))).toBe(false);
  expect(correctionsDue(at(29, 2, 59))).toBe(false);
  expect(correctionsDue(at(29, 3))).toBe(true);
});

test("report lists a proposed lesson on every report until decided", () => {
  storeAt([{ id: "L1", sentence: "run the tests before ending", state: "proposed", kind: "check", signals: [], count: 3 }]);
  const line = "  L1 check: run the tests before ending (3 signals)";
  expect(report()).toContain(`proposed lessons (Yes or No on Status):\n${line}`);
  expect(report()).toContain(line);
});

test("report prints no proposed lessons block with none", () => {
  storeAt([{ id: "L2", sentence: "x", state: "open", signals: [], count: 1 }]);
  expect(report()).not.toContain("proposed lessons");
});

/** A temp vault under ALEPH_VAULT for one test; the old value is restored by `done`. */
function withVault(): { vault: string; done: () => void } {
  const old = process.env.ALEPH_VAULT;
  const vault = join(ctx.base, "vault");
  process.env.ALEPH_VAULT = vault;
  const init = Bun.spawnSync(["bun", join(import.meta.dir, "..", "..", "vault", "cli.ts"), "init"], { env: process.env, stdout: "pipe", stderr: "pipe" });
  if (init.exitCode !== 0) throw new Error(`vault init: ${init.stderr}`);
  return { vault, done: () => { if (old === undefined) delete process.env.ALEPH_VAULT; else process.env.ALEPH_VAULT = old; } };
}

test("report lists each new episode page once, and nothing without a wiki/episodes folder", () => {
  const v = withVault();
  try {
    rmSync(join(v.vault, "wiki", "episodes"), { recursive: true, force: true });
    expect(report()).not.toContain("episodes:");
    mkdirSync(join(v.vault, "wiki", "episodes"), { recursive: true });
    writeFileSync(join(v.vault, "wiki", "episodes", "fac-1 Ship it.md"), "x\n");
    writeFileSync(join(v.vault, "wiki", "episodes", "fac-2 Other.md"), "x\n");
    const first = report();
    expect(first).toContain("episodes:\n  fac-1 Ship it\n  fac-2 Other");
    const second = report();
    expect(second).not.toContain("fac-1 Ship it");
    expect(second).not.toContain("fac-2 Other");
  } finally { v.done(); }
});

test("episodeStep writes nothing while paused", async () => {
  const v = withVault();
  try {
    setPaused(true);
    expect(await episodeStep()).toEqual([]);
    expect(existsSync(join(v.vault, "wiki", "episodes")) ? readdirSync(join(v.vault, "wiki", "episodes")).filter((f) => f.endsWith(".md")) : []).toEqual([]);
  } finally { v.done(); }
});

test("episodeStep writes the page of a done goal and logs its title", async () => {
  const v = withVault();
  try {
    const id = writeList({ key: "fac" }, "add", (doc) => {
      const item = issues.add(doc, "ship it", { spec: "## Goal\nShip it." });

      issues.setStatus(item, "done");
      return item.id;
    }, true)!.value;
    const repo = join(ctx.base, "repo");
    writeFileSync(join(repo, "f.txt"), "x\n");
    sh(repo, "git", "add", ".");
    sh(repo, "git", "commit", "-q", "-m", "ship thing", "-m", `Issue: fac-${id}`);
    sh(repo, "git", "push", "-q", "origin", "main");
    const folder = join(ctx.base, "jobs", `20261028-100000-fac-${id}-agent`);
    mkdirSync(folder, { recursive: true });
    writeRun(folder, { kind: "build", job: "j", name: `fac-${id}`, repo: "fac", condition: "landed", told: true, on: `fac-${id}`, started: "2026-10-28T10:00:00Z", ended: "2026-10-28T10:20:00Z" });
    expect(await episodeStep()).toEqual([`fac-${id} ship it`]);
    expect(readdirSync(join(v.vault, "wiki", "episodes")).filter((f) => f.endsWith(".md"))).toEqual([`fac-${id} ship it.md`]);
    expect(readFileSync(join(ctx.base, "factory", "tick.log"), "utf8")).toContain(`episodes fac-${id} ship it\n`);
  } finally { v.done(); }
});

test("report prints the kept and rejected lines of a facts run, once", () => {
  const folder = join(ctx.base, "jobs", "20261028-000001-facts-n1-facts");
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "facts", job: "j1", name: "facts-n1", repo: "fac", condition: "done", reason: "kept 1, rejected 1", told: true, shown: false, started: "2026-10-28T00:00:00Z", kept: ["Lemons Float"], rejected: [{ fact: "pears sink", reason: "b.ts says otherwise" }] } as Run);
  const old = join(ctx.base, "jobs", "20261028-000002-facts-n2-facts");
  mkdirSync(old, { recursive: true });
  writeRun(old, { kind: "facts", job: "j2", name: "facts-n2", repo: "fac", condition: "done", reason: "kept 0, rejected 1", told: true, shown: false, started: "2026-10-28T00:00:01Z", kept: [], rejected: ["old: string form"] } as unknown as Run);
  const out = report();
  expect(out).toContain("fac/facts-n1 done: kept 1, rejected 1\n  kept: Lemons Float");
  expect(out).toContain("  rejected: old: string form");
  expect(out).toContain("  rejected: pears sink: b.ts says otherwise");
  expect(out.split("rejected: pears sink").length).toBe(2);
  expect(report()).not.toContain("fac/facts-n1");
});

test("a dispatch with checks, three factory repos and no open goals fetches the work store at most twice", async () => {
  const items = join(ctx.base, "items");
  writeFileSync(join(ctx.base, "repos.json"), JSON.stringify(Object.fromEntries(["fac", "fac2", "fac3"].map((k) => [k, { path: join(ctx.base, "repo"), sandbox: true, autoland: false }]))));
  const log = join(ctx.base, "fetch.log");
  mkdirSync(join(ctx.base, "bin"));
  const real = Bun.spawnSync(["which", "git"]).stdout.toString().trim();
  writeFileSync(log, "");
  writeFileSync(join(ctx.base, "bin", "git"), `#!/bin/sh\n[ "$1" = fetch ] && [ "$PWD" = ${items} ] && echo fetch >> ${log}\nexec ${real} "$@"\n`);
  Bun.spawnSync(["chmod", "+x", join(ctx.base, "bin", "git")]);
  const path = process.env.PATH;
  process.env.PATH = `${join(ctx.base, "bin")}:${path}`;
  try {
    const out = await dispatchIssues(async () => null, async () => null);
    expect(out.started).toEqual([]);
  } finally {
    process.env.PATH = path;
  }
  const n = readFileSync(log, "utf8").split("\n").filter(Boolean).length;
  console.log(`store fetches: ${n}`);
  expect(n).toBeLessThanOrEqual(2);
});

test("the day's spend counts every kind that records a cost", () => {
  for (const [name, kind, cost] of [["fac-1", "build", 1], ["fac-2", "triage", 2], ["fac-3", "plan", 4], ["fac-4", "facts", 8], ["fac-5", "firefighter", 16]] as const) mk(name, kind, "done", { cost });
  expect(spentToday()).toBe(31);
});

test("a goal that names a busy file an open job also names waits; a job waiting for Chris does not count", async () => {
  const surface = "## Edit surface\n- jobs/busy.ts (the change)\n- jobs/other.ts\n";
  const withSurface = () => writeList({ key: "fac" }, "add a goal", (doc) => { const item = issues.add(doc, "ship it", { spec: surface }); return item.id; }, true)!.value;
  for (const n of [901, 902, 903]) mk(`fac-${n}`, "land", "dropped", { conflicts: ["jobs/busy.ts"] });
  const first = withSurface();
  const second = withSurface();
  const { folder } = mk(`fac-${first}`, "build", "passed");
  const calls: string[] = [];
  const start = async (_repo: unknown, name: string) => { calls.push(name); return null; };
  const out = await dispatchIssues(start);
  expect(calls).toEqual([]);
  expect(out.skipped).toContain(`fac-${second}: waits for fac-${first}: both change the busy file jobs/busy.ts`);
  writeRun(folder, { ...readRun(folder)!, condition: "awaiting", ask: { kind: "approval", reason: "held-path", question: "q", options: [], why: [] } });
  await dispatchIssues(start);
  expect(calls).toEqual([`fac-${second}`]);
});

test("a goal that shares only a quiet file with an open job starts", async () => {
  const body = "## Edit surface\n- jobs/quiet.ts\n";
  const add = () => writeList({ key: "fac" }, "add a goal", (doc) => { const item = issues.add(doc, "ship it", { spec: body }); return item.id; }, true)!.value;
  mk("fac-901", "land", "dropped", { conflicts: ["jobs/quiet.ts"] });
  const first = add();
  const second = add();
  mk(`fac-${first}`, "build", "passed");
  const calls: string[] = [];
  await dispatchIssues(async (_repo, name) => { calls.push(name); return null; });
  expect(calls).toEqual([`fac-${second}`]);
});

test("stalled lists what could move: a goal, a new issue and a passed run, each until a gate or a live run explains it", () => {
  const id = goal();
  const fresh = writeList({ key: "fac" }, "add an issue", (doc) => issues.add(doc, "new thing").id, true)!.value;
  expect(stalled()).toEqual([`goal:fac-${id}`, `ingest:fac-${fresh}`]);
  writeFileSync(join(ctx.base, "repos.json"), JSON.stringify({ fac: { path: join(ctx.base, "repo"), sandbox: true, autoland: true } }));
  const { folder } = mk(`fac-${id}`, "build", "passed");
  expect(stalled()).toEqual([`land:fac-${id}`, `ingest:fac-${fresh}`]);
  setPaused(true);
  expect(stalled()).toEqual([]);
  setPaused(false);
  writeRun(folder, { ...readRun(folder)!, condition: "stuck" });
  expect(stalled()).toEqual([]); // the hold has its own line
});

test("a blocked goal does not stall; a live agent run leaves a ready goal out", async () => {
  const blocker = goal();
  const after = goal();
  await change(after, (item) => { item.fm.after = [`fac-${blocker}`]; });
  expect(stalled()).toEqual([`goal:fac-${blocker}`]);
  mk("fac-other", "build", "running", { made: Date.now() });
  expect(stalled()).toEqual([]);
});

test("health says a stall only after 15 minutes of ticks, and stops when the work moves", async () => {
  const id = goal();
  const t0 = Date.parse("2026-11-01T12:00:00Z"), min = 60_000;
  const said = (at: number) => health(at).filter((l) => l.includes("can start"));
  stallStep(t0);
  stallStep(t0 + 5 * min);
  expect(said(t0 + 14 * min)).toEqual([]);
  expect(said(t0 + 15 * min)).toEqual(["health: 1 goal can start, but no run started in 15 minutes"]);
  await change(id, (item) => { issues.setStatus(item, "done"); });
  stallStep(t0 + 16 * min);
  expect(said(t0 + 16 * min)).toEqual([]);
  expect(health(t0).some((l) => l.includes("24 hours"))).toBe(false);
});
