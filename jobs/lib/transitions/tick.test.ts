// The tick starts only periodic work: each transition that used to wait for it now starts its next step at once,
// and the tick's sweep logs and starts what a transition missed.
import { afterAll, beforeAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, readdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import * as issues from "../../../issues/lib/todo.ts";
import { readList, writeList } from "../../../issues/lib/store.ts";
import { factoryRepos } from "../../../tests/git-fixture.ts";
import { markAsked, plainAsk, setAsk, askOf } from "../asks/ask.ts";
import { intakeNow, runDispatch, type Starts } from "./factory.ts";
import { readEvents } from "../../../lib/layout.ts";
import { setPaused, writeBaseline, writeStalls } from "../gates/factory-status.ts";
import { git } from "../infra/git.ts";
import { specVersion } from "../roles/issue-spec.ts";
import { loadRegistry, type Repo } from "../records/ledger.ts";
import { lock } from "../infra/locks.ts";
import { archiveDir, putRun } from "../records/record.ts";
import { markFile } from "../records/migrate.ts";
import { due, readTick, runTick, sweep, type SweepPorts, type TickPorts } from "./tick.ts";

// The test's clock: the run that holds the live slot is `starting` against it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
const MIN = 60_000;
let base = "";
let n = 0;
let key = "";
const repo = (): Repo => loadRegistry()[key]!;

// The fake intake: `VERDICT:ask` sets an Ask; anything else gives no reply.
const FAKE = `#!/bin/bash
prompt=$(cat)
case $prompt in
  *VERDICT:ask*) echo '{"type":"result","is_error":false,"result":"","structured_output":{"verdict":{"route":"ask","reason":"a product choice","question":"A or B?"}}}' ;;
  *) exit 3 ;;
esac
`;

beforeAll(() => {
  setSystemTime(NOW);
  base = mkdtempSync(join(tmpdir(), "aleph-tick-"));
  factoryRepos(base);
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_INTAKE_CMD: join(base, "fake"),
    ALEPH_DISPATCH: "off", ALEPH_RESCUE: "off", XDG_RUNTIME_DIR: join(base, "run"),
  });
});
afterAll(() => { setSystemTime(); rmSync(base, { recursive: true, force: true }); });
beforeEach(() => {
  key = `tk${++n}`;
  writeFileSync(join(base, "repos.json"), JSON.stringify({ [key]: { path: join(base, "repo"), main: "main", sandbox: true } }));
  process.env.ALEPH_JOBS_DIR = join(base, `jobs${n}`);
  process.env.ALEPH_FACTORY_DIR = join(base, `factory${n}`);
  process.env.ALEPH_LIVE_CAP = "10";
});

/** Issues with a request and no spec: each is for intake, or waits for Chris with `ask`. */
function seed(items: { body: string; ask?: boolean }[]): void {
  writeList({ key }, "seed", (doc) => {
    for (const i of items) {
      const it = issues.add(doc, `issue ${i.body}`, { request: i.body });
      if (i.ask) setAsk(`${key}-${it.id}`, plainAsk("question", "which module?"));
    }
    return true;
  }, true);
}

/** The starts a transition makes, recorded. */
function recorder(): Starts & { taken: string[]; directors: number } {
  const r = { taken: [] as string[], directors: 0, intake: (rp: Repo, id: number) => { r.taken.push(`${rp.key}-${id}`); }, director: () => { r.directors++; } };
  return r;
}

const tickLog = () => { try { return readFileSync(join(process.env.ALEPH_FACTORY_DIR!, "tick.log"), "utf8"); } catch { return ""; } };
const missedKeys = () => readEvents().filter((e) => e.action === "missed").map((e) => e.subject);

test("an intake that sets an Ask starts the director at once, with no tick", async () => {
  seed([{ body: "VERDICT:ask" }]);
  const s = recorder();
  await intakeNow(repo(), 1, s);
  expect(askOf(`${key}-1`)?.kind).toBe("input");
  expect(s.directors).toBe(1);
  expect(s.taken).toEqual([]);
});

test("an intake with no reply starts its retry at once; after the tries it sets the Ask, which goes to the director", async () => {
  process.env.ALEPH_INTAKE_TRIES = "2";
  try {
    seed([{ body: "nothing" }]);
    const s = recorder();
    await intakeNow(repo(), 1, s);
    expect(s.taken).toEqual([`${key}-1`]);
    expect(s.directors).toBe(0);
    await intakeNow(repo(), 1, s);
    expect(askOf(`${key}-1`)?.reason).toBe("intake-failed");
    expect(s.taken).toEqual([`${key}-1`]);
    expect(s.directors).toBe(1);
  } finally {
    delete process.env.ALEPH_INTAKE_TRIES;
  }
});

test("an intake the live cap held starts at the dispatch that a run's end makes, with no tick", async () => {
  process.env.ALEPH_LIVE_CAP = "1";
  seed([{ body: "nothing" }]);
  // A build run that holds the one live slot: made now, no pid yet.
  const folder = join(process.env.ALEPH_JOBS_DIR!, "20261104-120000-busy");
  mkdirSync(folder, { recursive: true });
  putRun(basename(folder), { kind: "build", job: "busy", name: "busy", condition: "running", told: true, started: new Date(NOW).toISOString(), made: NOW });
  const s = recorder();
  const held = await intakeNow(repo(), 1, s);
  expect(held.skipped).toEqual(["intake: 1 agent runs are live"]);
  expect(readEvents().filter((e) => e.action === "skipped").map((e) => [e.subject, e.note])).toEqual([[`${key}-1`, "intake: 1 agent runs are live"]]);
  expect((await runDispatch(s)).intaking).toBeUndefined();
  expect(s.taken).toEqual([]);
  // The run ends: its unit writes `exit`, then runs the dispatch.
  writeFileSync(join(folder, "exit"), "0\n");
  expect((await runDispatch(s)).intaking).toEqual([`${key}-1`]);
  expect(s.taken).toEqual([`${key}-1`]);
});

test("a dispatch after a write that set an Ask starts the director; an Ask with case text does not", async () => {
  seed([{ body: "a", ask: true }]);
  const s = recorder();
  await runDispatch(s);
  expect(s.directors).toBe(1);
  setAsk(`${key}-1`, { ...askOf(`${key}-1`)!, situation: "The case." });
  await runDispatch(s);
  expect(s.directors).toBe(1);
});

/** Sweep ports that record what they start. */
function sweepPorts(): SweepPorts & { dispatches: number; suites: number } {
  const p = { dispatches: 0, suites: 0, dispatch: async () => { p.dispatches++; }, suite: () => { p.suites++; } };
  return p;
}

test("the sweep logs work that two ticks in a row saw as missed, once, and starts one dispatch for it", async () => {
  seed([{ body: "a", ask: true }]);
  const p = sweepPorts();
  const s = readTick();
  expect(await sweep(NOW, s, p)).toEqual([]);
  expect(p.dispatches).toBe(0);
  expect(await sweep(NOW + MIN, s, p)).toEqual([`ask:${key}-1`]);
  expect(missedKeys()).toEqual([`ask:${key}-1`]);
  expect(tickLog()).toBe("");
  expect(p.dispatches).toBe(1);
  expect(await sweep(NOW + 2 * MIN, s, p)).toEqual([]);
  expect(p.dispatches).toBe(1);
  setPaused(true);
  try { expect(await sweep(NOW + 3 * MIN, s, p)).toEqual([]); } finally { setPaused(false); }
});

test("the sweep logs a job that waits for a spec edit as missed once the spec moves, and starts one dispatch", async () => {
  writeList({ key }, "seed", (doc) => { issues.add(doc, "goal", { spec: "Old spec." }); return true; }, true);
  const folder = join(process.env.ALEPH_JOBS_DIR!, "w1");
  mkdirSync(folder, { recursive: true });
  putRun(basename(folder), { kind: "build", job: "w1", name: `${key}-1`, repo: key, on: `${key}-1`, condition: "failed", told: true, shown: true, started: new Date(NOW).toISOString(), made: NOW });
  markAsked({ id: "w1", folder, run: { job: "w1", name: `${key}-1`, repo: key, on: `${key}-1` } as any }, "which wins?", specVersion(issues.find(readList({ key })!, 1)!));
  const p = sweepPorts();
  const s = readTick();
  expect(await sweep(NOW, s, p)).toEqual([]);
  expect(await sweep(NOW + MIN, s, p)).toEqual([]);
  expect(p.dispatches).toBe(0);
  writeList({ key }, "edit", (doc) => { issues.find(doc, 1)!.spec = "New spec."; return true; });
  expect(await sweep(NOW + 2 * MIN, s, p)).toEqual([]);
  expect(await sweep(NOW + 3 * MIN, s, p)).toEqual([`edited:${key}-1`]);
  expect(missedKeys()).toEqual([`edited:${key}-1`]);
  expect(p.dispatches).toBe(1);
});

test("the sweep with nothing to move starts nothing", async () => {
  seed([]);
  const p = sweepPorts();
  const s = readTick();
  await sweep(NOW, s, p);
  await sweep(NOW + MIN, s, p);
  expect({ dispatches: p.dispatches, suites: p.suites, log: tickLog() }).toEqual({ dispatches: 0, suites: 0, log: "" });
});

test("a red main that moved since its record (a fix by hand) starts the suite once for the new commit", async () => {
  seed([]);
  await writeBaseline(key, () => ({ repo: key, commit: "0000000old", ok: false, failed: "tests" }));
  const p = sweepPorts();
  const s = readTick();
  await sweep(NOW, s, p);
  expect(p.suites).toBe(1);
  expect(s.suite[key]).toBe(git(join(base, "repo"), "rev-parse", "origin/main").out);
  await sweep(NOW + MIN, s, p);
  expect(p.suites).toBe(1);
});

test("a periodic step is due when it never ran or its period has passed", () => {
  const s = { last: { ci: new Date(NOW).toISOString() }, missed: [], suite: {} };
  expect(due(s, "ci", NOW + 4 * MIN)).toBe(false);
  expect(due(s, "ci", NOW + 5 * MIN)).toBe(true);
  expect(due(s, "episodes", NOW)).toBe(true);
});

test("a tick that finds the tick lock held runs no step, writes nothing and says so", async () => {
  // The lock gives up on a clock that moves; this file's clock is frozen at NOW.
  setSystemTime();
  try {
    seed([{ body: "a", ask: true }]);
    // A key a tick would see as missed: a tick that ran would start its dispatch.
    writeStalls({ [`ask:${key}-1`]: new Date(NOW).toISOString() });
    const file = join(process.env.ALEPH_FACTORY_DIR!, "tick.json");
    mkdirSync(process.env.ALEPH_FACTORY_DIR!, { recursive: true });
    const before = JSON.stringify({ last: {}, missed: [], suite: {} });
    writeFileSync(file, before);
    const calls: string[] = [];
    const ports: TickPorts = { dispatch: async () => { calls.push("dispatch"); }, suite: () => { calls.push("suite"); }, intake: () => { calls.push("intake"); } };
    const release = (await lock("tick", 0))!;
    try {
      expect(await runTick(NOW, ports)).toEqual({ tick: "lock busy" });
      expect(calls).toEqual([]);
      expect(readFileSync(file, "utf8")).toBe(before);
    } finally { release(); }
    // The lock is free: the next tick runs its steps and writes its own `last`.
    await runTick(NOW, ports);
    expect(calls).toEqual(["dispatch"]);
    expect(JSON.parse(readFileSync(file, "utf8")).last.ci).toBe(new Date(NOW).toISOString());
  } finally { setSystemTime(NOW); }
});

test("one tick moves a finished record older than 7 days into the archive folder", async () => {
  seed([]);
  expect(existsSync(markFile())).toBe(false);
  const started = new Date(NOW - 8 * 864e5).toISOString();
  putRun("20261020-120000-old", { kind: "build", job: "old", name: `${key}-1`, on: `${key}-1`, condition: "done", told: true, started } as any);
  const ports: TickPorts = { dispatch: async () => {}, suite: () => {}, intake: () => {} };
  const out = await runTick(NOW, ports);
  expect(out.archived).toEqual([`${key}-1`]);
  expect(readdirSync(archiveDir())).toEqual([`${key}-1.json`]);
  // The tick also runs the word migration, which leaves its mark file.
  expect(existsSync(markFile())).toBe(true);
});
