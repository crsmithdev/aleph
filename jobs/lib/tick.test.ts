// The tick starts only periodic work: each transition that used to wait for it now starts its next step at once,
// and the tick's sweep logs and starts what a transition missed.
import { afterAll, beforeAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../todo/lib/todo.ts";
import { readList, writeList } from "../../todo/lib/store.ts";
import { factoryRepos } from "../../tests/git-fixture.ts";
import { plainAsk, setAsk } from "./ask.ts";
import { runDispatch, triageNow, type Starts } from "./factory.ts";
import { setPaused, writeBaseline } from "./factory-status.ts";
import { git } from "./git.ts";
import { loadRegistry, writeRun, type Repo } from "./ledger.ts";
import { due, readTick, sweep, type SweepPorts } from "./tick.ts";

// The test's clock: the run that holds the live slot is `starting` against it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
const MIN = 60_000;
let base = "";
let n = 0;
let key = "";
const repo = (): Repo => loadRegistry()[key]!;

// The fake triage: `VERDICT:ask` sets an Ask; anything else gives no verdict.
const FAKE = `#!/bin/bash
prompt=$(cat)
case $prompt in
  *VERDICT:ask*) echo '{"type":"result","is_error":false,"result":"","structured_output":{"verdict":{"route":"ask","question":"A or B?"}}}' ;;
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
    ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_TRIAGE_CMD: join(base, "fake"),
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

/** Issues with a request and no spec: each is for triage, or waits for Chris with `ask`. */
function seed(items: { body: string; ask?: boolean }[]): void {
  writeList({ key }, "seed", (doc) => {
    for (const i of items) {
      const it = issues.add(doc, `issue ${i.body}`, { request: i.body });
      if (i.ask) setAsk(it, plainAsk("question", "which module?"));
    }
    return true;
  }, true);
}

/** The starts a transition makes, recorded. */
function recorder(): Starts & { triaged: string[]; directors: number } {
  const r = { triaged: [] as string[], directors: 0, triage: (rp: Repo, id: number) => { r.triaged.push(`${rp.key}-${id}`); }, director: () => { r.directors++; } };
  return r;
}

const tickLog = () => { try { return readFileSync(join(process.env.ALEPH_FACTORY_DIR!, "tick.log"), "utf8"); } catch { return ""; } };

test("a triage that sets an Ask starts the director at once, with no tick", async () => {
  seed([{ body: "VERDICT:ask" }]);
  const s = recorder();
  await triageNow(repo(), 1, s);
  expect(issues.find(readList({ key })!, 1)!.fm.ask).toBe("input");
  expect(s.directors).toBe(1);
  expect(s.triaged).toEqual([]);
});

test("a triage with no verdict starts its retry at once; after the tries it sets the Ask, which goes to the director", async () => {
  process.env.ALEPH_TRIAGE_TRIES = "2";
  try {
    seed([{ body: "nothing" }]);
    const s = recorder();
    await triageNow(repo(), 1, s);
    expect(s.triaged).toEqual([`${key}-1`]);
    expect(s.directors).toBe(0);
    await triageNow(repo(), 1, s);
    expect(issues.find(readList({ key })!, 1)!.fm.reason).toBe("triage-failed");
    expect(s.triaged).toEqual([`${key}-1`]);
    expect(s.directors).toBe(1);
  } finally {
    delete process.env.ALEPH_TRIAGE_TRIES;
  }
});

test("a triage the live cap held starts at the dispatch that a run's end makes, with no tick", async () => {
  process.env.ALEPH_LIVE_CAP = "1";
  seed([{ body: "nothing" }]);
  // A build run that holds the one live slot: made now, no pid yet.
  const folder = join(process.env.ALEPH_JOBS_DIR!, "20261104-120000-busy");
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "build", job: "busy", name: "busy", condition: "running", told: true, started: new Date(NOW).toISOString(), made: NOW });
  const s = recorder();
  const held = await triageNow(repo(), 1, s);
  expect(held.skipped).toEqual(["triage: 1 agent runs are live"]);
  expect((await runDispatch(s)).triaging).toBeUndefined();
  expect(s.triaged).toEqual([]);
  // The run ends: its unit writes `exit`, then runs the dispatch.
  writeFileSync(join(folder, "exit"), "0\n");
  expect((await runDispatch(s)).triaging).toEqual([`${key}-1`]);
  expect(s.triaged).toEqual([`${key}-1`]);
});

test("a dispatch after a write that set an Ask starts the director; an Ask with case text does not", async () => {
  seed([{ body: "a", ask: true }]);
  const s = recorder();
  await runDispatch(s);
  expect(s.directors).toBe(1);
  writeList({ key }, "case text", (doc) => { issues.find(doc, 1)!.fm.situation = "The case."; return true; });
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
  expect(tickLog()).toContain(`missed: ask:${key}-1`);
  expect(p.dispatches).toBe(1);
  expect(await sweep(NOW + 2 * MIN, s, p)).toEqual([]);
  expect(p.dispatches).toBe(1);
  setPaused(true);
  try { expect(await sweep(NOW + 3 * MIN, s, p)).toEqual([]); } finally { setPaused(false); }
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
