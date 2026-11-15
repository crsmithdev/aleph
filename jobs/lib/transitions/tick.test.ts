// The tick starts only periodic work: each transition that used to wait for it now starts its next step at once,
// and the tick's sweep logs and starts what a transition missed.
import { afterAll, beforeAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as issues from "../../../issues/lib/todo.ts";
import { close, readList, writeList } from "../../../issues/lib/store.ts";
import { factoryRepos, vault } from "../../../tests/git-fixture.ts";
import { markAsked, plainAsk, setAsk, askOf } from "../asks/ask.ts";
import { intakeNow, runDispatch, type Starts } from "./factory.ts";
import { readEvents } from "../../../lib/layout.ts";
import { setPaused, setTick, tickRows, writeBaseline, writeStalls } from "../gates/factory-status.ts";
import { conn, getJson } from "../../../lib/db.ts";
import { git } from "../infra/git.ts";
import { specVersion } from "../roles/issue-spec.ts";
import { loadRegistry, type Repo } from "../records/ledger.ts";
import { lock } from "../infra/locks.ts";
import { seed as seedJob } from "../../job.testkit.ts";
import * as record from "../records/record.ts";
import { compiledDays, readRun, retryDays } from "../../../vault/lib/vault.ts";
import { memory, use } from "../../../lib/langfuse.ts";
import { due, maintainStep, readTick, runTick, sweep, type SweepPorts, type TickPorts } from "./tick.ts";
import { ciStep } from "../gates/ci.ts";
import { newItems, writeRepos } from "../../../tests/projects.ts";

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
  // No test reads the live Langfuse: the day has no traces.
  use(memory({ traces: [], observations: [] }));
  base = mkdtempSync(join(tmpdir(), "aleph-tick-"));
  factoryRepos(base);
  writeFileSync(join(base, "fake"), FAKE);
  chmodSync(join(base, "fake"), 0o755);
  Object.assign(process.env, {
    GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t",
    ALEPH_ITEMS: join(base, "items"), ALEPH_INTAKE_CMD: join(base, "fake"),
    ALEPH_DISPATCH: "off", ALEPH_RESCUE: "off", XDG_RUNTIME_DIR: join(base, "run"),
  });
});
afterAll(() => { use(null); setSystemTime(); rmSync(base, { recursive: true, force: true }); });
beforeEach(() => {
  key = `tk${++n}`;
  process.env.ALEPH_ITEMS = newItems(base, `items${n}`);
  writeRepos({ [key]: { path: join(base, "repo"), main: "main", sandbox: true } });
  process.env.ALEPH_JOBS_DIR = join(base, `jobs${n}`);
  process.env.ALEPH_FACTORY_DIR = join(base, `factory${n}`);
  process.env.ALEPH_DB = join(base, `aleph${n}.db`);
  process.env.ALEPH_VAULT = join(base, `vault${n}`);
  process.env.ALEPH_LIVE_CAP = "10";
});

/** The `vault` fixture at this test's ALEPH_VAULT, as `aleph memory init` lays it out. */
const vaultHere = (): string => { vault(process.env.ALEPH_VAULT!); return process.env.ALEPH_VAULT!; };

/** Issues with a request and no spec: each is for intake, or waits for Chris with `ask`. */
function seed(items: { body: string; ask?: boolean }[]): void {
  writeList({ key }, "seed", (doc) => {
    for (const i of items) {
      const it = issues.add(doc, `issue ${i.body}`, { request: i.body });
      if (i.ask) setAsk(`issue.${it.id}`, plainAsk("question", "which module?"));
    }
    return true;
  }, true);
}

/** The starts a transition makes, recorded. */
function recorder(): Starts & { taken: string[]; directors: number } {
  const r = { taken: [] as string[], directors: 0, intake: (rp: Repo, id: number) => { r.taken.push(`${rp.key}-${id}`); }, director: () => { r.directors++; } };
  return r;
}

const missedKeys = () => readEvents().filter((e) => e.action === "missed").map((e) => e.object);

test("an intake that sets an Ask starts the director at once, with no tick", async () => {
  seed([{ body: "VERDICT:ask" }]);
  const s = recorder();
  await intakeNow(repo(), 1, s);
  expect(askOf(`issue.1`)).not.toHaveProperty("kind");
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
    expect(askOf(`issue.1`)?.reason).toBe("intake-failed");
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
  const busy = seedJob({ role: "build", name: "busy", state: "running", told: true, started: new Date(NOW).toISOString(), made: NOW });
  const s = recorder();
  const held = await intakeNow(repo(), 1, s);
  expect(held.skipped).toEqual(["intake: 1 agent runs are live"]);
  expect(readEvents().filter((e) => e.action === "skipped").map((e) => [e.object, e.detail])).toEqual([[`issue.1`, "intake: 1 agent runs are live"]]);
  expect((await runDispatch(s)).intaking).toBeUndefined();
  expect(s.taken).toEqual([]);
  // The run ends: its unit writes `exit`, then runs the dispatch.
  writeFileSync(join(busy.folder, "exit"), "0\n");
  expect((await runDispatch(s)).intaking).toEqual(["issue.1"]);
  expect(s.taken).toEqual([`${key}-1`]);
});

test("a dispatch after a write that set an Ask starts the director; an Ask with case text does not", async () => {
  seed([{ body: "a", ask: true }]);
  const s = recorder();
  await runDispatch(s);
  expect(s.directors).toBe(1);
  setAsk(`issue.1`, { ...askOf(`issue.1`)!, situation: "The case." });
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
  expect(await sweep(NOW + MIN, s, p)).toEqual([`ask:issue.1`]);
  expect(missedKeys()).toEqual([`ask:issue.1`]);
  expect(p.dispatches).toBe(1);
  expect(await sweep(NOW + 2 * MIN, s, p)).toEqual([]);
  expect(p.dispatches).toBe(1);
  setPaused(true);
  try { expect(await sweep(NOW + 3 * MIN, s, p)).toEqual([]); } finally { setPaused(false); }
});

test("the sweep logs a job that waits for a spec edit as missed once the spec moves, and starts one dispatch", async () => {
  writeList({ key }, "seed", (doc) => { issues.add(doc, "goal", { spec: "Old spec." }); return true; }, true);
  const w = seedJob({ role: "build", name: "issue.1", repo: key, target: "issue.1", state: "failed", told: true, shown: true, started: new Date(NOW).toISOString(), made: NOW });
  markAsked({ id: w.id, folder: w.folder, run: w.run }, "which wins?", specVersion(issues.find(readList({ key })!, 1)!));
  const p = sweepPorts();
  const s = readTick();
  expect(await sweep(NOW, s, p)).toEqual([]);
  expect(await sweep(NOW + MIN, s, p)).toEqual([]);
  expect(p.dispatches).toBe(0);
  writeList({ key }, "edit", (doc) => { issues.find(doc, 1)!.spec = "New spec."; return true; });
  expect(await sweep(NOW + 2 * MIN, s, p)).toEqual([]);
  expect(await sweep(NOW + 3 * MIN, s, p)).toEqual([`edited:issue.1`]);
  expect(missedKeys()).toEqual([`edited:issue.1`]);
  expect(p.dispatches).toBe(1);
});

test("the sweep deletes the row of a closed issue and the Ask of a job that no longer waits, and keeps the rest", async () => {
  seed([{ body: "closed", ask: true }, { body: "open", ask: true }]);
  // The Ask put back after the close is a stale row, as the 22 on the live store.
  writeList({ key }, "close", (doc) => { issues.setStatus(issues.find(doc, 1)!, "done"); return true; });
  setAsk(`issue.1`, plainAsk("question", "which module?"));
  const ci = { url: "u", commit: "c", failure: "f" };
  record.editIssueState(`issue.1`, (s) => { s.ci = ci; });
  record.editIssueState(`issue.2`, (s) => { s.ci = ci; });
  const gone = seedJob({ role: "plain", name: "job", state: "waiting", ask: plainAsk("question", "which?") });
  const live = seedJob({ role: "plain", name: "job", state: "waiting", ask: plainAsk("question", "which?") });
  record.setState(gone.id, "done");
  const p = sweepPorts();
  await sweep(NOW, readTick(), p);
  expect(record.read(`issue.1`)).toBeNull();
  expect(askOf(`issue.2`)?.question).toBe("which module?");
  expect(record.read(`issue.2`)?.ci).toEqual(ci);
  expect(record.read(gone.id)).toBeNull();
  expect(record.read(live.id)?.ask?.question).toBe("which?");
});

test("the sweep with nothing to move starts nothing", async () => {
  seed([]);
  const p = sweepPorts();
  const s = readTick();
  await sweep(NOW, s, p);
  await sweep(NOW + MIN, s, p);
  expect({ dispatches: p.dispatches, suites: p.suites }).toEqual({ dispatches: 0, suites: 0 });
});

test("a red main that moved since its record (a fix by hand) starts the suite once for the new commit", async () => {
  seed([]);
  writeBaseline(key, () => ({ repo: key, commit: "0000000old", ok: false, failed: "tests" }));
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
  expect(due(s, "ci", NOW + MIN)).toBe(false);
});

test("ci and firefight are due every minute while a CI run on main is in progress", () => {
  const s = { last: { ci: new Date(NOW).toISOString(), firefight: new Date(NOW).toISOString() }, missed: [], suite: {} };
  const runs = (status: string) => [{ conclusion: "", status, headSha: "c1", url: "https://ci/c1", createdAt: "2026-11-04T11:59:00Z" }];
  ciStep([repo()], () => ({ ok: true, out: JSON.stringify(runs("in_progress")) }));
  expect([due(s, "ci", NOW + MIN), due(s, "firefight", NOW + MIN)]).toEqual([true, true]);
  ciStep([repo()], () => ({ ok: true, out: JSON.stringify(runs("completed")) }));
  expect([due(s, "ci", NOW + MIN), due(s, "firefight", NOW + MIN)]).toEqual([false, false]);
});

test("ci is due every minute for 15 minutes after a land on main, and every 5 minutes after that", () => {
  const s = { last: { ci: new Date(NOW).toISOString() }, missed: [], suite: {} };
  seedJob({ role: "land", state: "landed", repo: key, started: new Date(NOW - 12 * MIN).toISOString(), ended: new Date(NOW - 10 * MIN).toISOString() });
  expect(due(s, "ci", NOW + MIN)).toBe(true);
  // 17 minutes after the land.
  expect(due({ ...s, last: { ci: new Date(NOW + 6 * MIN).toISOString() } }, "ci", NOW + 7 * MIN)).toBe(false);
});

test("a tick that finds the tick lock held runs no step, writes nothing and says so", async () => {
  // The lock gives up on a clock that moves; this file's clock is frozen at NOW.
  setSystemTime();
  try {
    seed([{ body: "a", ask: true }]);
    // A key a tick would see as missed: a tick that ran would start its dispatch.
    writeStalls({ [`ask:issue.1`]: new Date(NOW).toISOString() });
    const state = () => JSON.stringify([tickRows(), getJson("state", "tick.missed", []), getJson("state", "tick.suite", {})]);
    const before = state();
    const calls: string[] = [];
    const ports: TickPorts = { dispatch: async () => { calls.push("dispatch"); }, suite: () => { calls.push("suite"); }, intake: () => { calls.push("intake"); } };
    const release = (await lock("tick", 0))!;
    try {
      expect(await runTick(NOW, ports)).toEqual({ tick: "lock busy" });
      expect(calls).toEqual([]);
      expect(state()).toBe(before);
    } finally { release(); }
    // The lock is free: the next tick runs its steps and writes its own `last`.
    await runTick(NOW, ports);
    expect(calls).toEqual(["dispatch"]);
    expect(tickRows().ci.last).toBe(new Date(NOW).toISOString());
  } finally { setSystemTime(NOW); }
});

const quiet = (): TickPorts => ({ dispatch: async () => {}, suite: () => {}, intake: () => {} });
test("a tick records the time and result of each due step in its tick row and keeps the suite's and the monitor's keys", async () => {
  seed([]);
  const kept = { "suite tk1": { last: "2026-11-04T10:00:00.000Z", result: "green" }, monitor: { last: "2026-11-04T03:00:00.000Z", result: "2 findings" } };
  for (const [k, v] of Object.entries(kept)) setTick(k, v);
  // The monitor writes its own key when it runs: here it does not.
  process.env.ALEPH_MONITOR = "off";
  try { await runTick(NOW, quiet()); } finally { delete process.env.ALEPH_MONITOR; }
  const ran = tickRows();
  const at = new Date(NOW).toISOString();
  for (const k of ["ci", "episodes", "sweep", "hold", "smoke", "retention", "firefighter", "timeout"]) {
    expect(ran[k]).toEqual({ last: at, result: expect.stringMatching(/\S/) });
  }
  // The preload points ALEPH_UI_PORT at port 1: the smoke step reaches a refusing port, not the live UI on 3020.
  expect(ran.smoke.result).toStartWith("failed: /: ");
  expect(ran["suite tk1"]).toEqual(kept["suite tk1"]);
  expect(ran.monitor).toEqual(kept.monitor);
});

test("a step that fails in a tick records a result that starts with failed and its error message", async () => {
  seed([]);
  // A ci row that is not JSON: the CI read throws.
  conn().run("INSERT OR REPLACE INTO state VALUES ('ci', 'not json')");
  // An aleph-ui that answers 503: the smoke test fails without a throw. The port goes back afterwards, so the
  // tests after this one keep the refusing port the preload set rather than the live 3020.
  const ui = Bun.serve({ port: 0, fetch: () => new Response("", { status: 503 }) });
  const before = process.env.ALEPH_UI_PORT;
  process.env.ALEPH_UI_PORT = String(ui.port);
  try { await runTick(NOW, quiet()); } finally {
    if (before === undefined) delete process.env.ALEPH_UI_PORT; else process.env.ALEPH_UI_PORT = before;
    ui.stop(true);
  }
  expect(process.env.ALEPH_UI_PORT).toBe(before);
  const ran = tickRows();
  expect(ran.ci.result).toMatch(/^failed: \S/);
  expect(ran.smoke.result).toBe("failed: / answered 503");
  expect(ran.episodes.result).toBe("0 written");
});

test("a tick where an episode page fails to write records the episodes result as failed", async () => {
  // A specced issue that landed on main, with a run: its page is due.
  const id = writeList({ key }, "add", (doc) => issues.add(doc, "ship it", { spec: "## Goal\nShip it." }).id, true)!.value;
  const dir = join(base, "repo");
  writeFileSync(join(dir, `${key}.txt`), "x\n");
  git(dir, "add", ".");
  git(dir, "commit", "-q", "-m", "ship it", "-m", `Issue: issue.${id}`);
  git(dir, "push", "-q", "origin", "main");
  close({ key }, id, "landed");
  seedJob({ role: "build", name: `issue.${id}`, repo: key, target: `issue.${id}`, state: "landed", told: true, started: new Date(NOW - 60 * MIN).toISOString(), ended: new Date(NOW - 30 * MIN).toISOString() });
  // An episodes folder the tick cannot write in.
  const episodes = join(process.env.ALEPH_FACTORY_DIR!, "episodes");
  mkdirSync(episodes, { recursive: true });
  chmodSync(episodes, 0o555);
  try { await runTick(NOW, quiet()); } finally { chmodSync(episodes, 0o755); }
  expect(tickRows().episodes.result).toMatch(/^failed: 1 of 1 pages, \S/);
});

// The daily vault maintenance, dry: from 03:00 local, on a vault that has Home.md, once per local date.

test("guard: the maintain step from 03:00 local returns the dry run's counts and records its run as ok", async () => {
  const dir = vaultHere();
  const r = await maintainStep(NOW);
  expect(r!.counts).toEqual({ fixed: 0, adopt: 0, core: 0, handoffs: 0, episodes: 0, decay: 0, overlap: 0, retry: 0, lessons: 0, notes: 0, rechecked: 0, resolved: 0, aliased: 0 });
  expect(readRun(dir, "maintain")?.result).toBe("ok");
});

test("guard: the maintain step returns null before 03:00, with no Home.md, and while the factory is paused", async () => {
  const dir = vaultHere();
  // 02:00 local: too early, so nothing runs and no run record is written.
  expect(await maintainStep(Date.parse("2026-11-04T02:00:00Z"))).toBeNull();
  // A folder that is there, with no Home.md: not a vault, so only the corrections mining runs.
  const empty = join(base, "no-home");
  mkdirSync(empty, { recursive: true });
  process.env.ALEPH_VAULT = empty;
  const r = await maintainStep(NOW);
  expect(r!.counts).toEqual({ lessons: 0 });
  expect(r!.compile).toBeUndefined();
  process.env.ALEPH_VAULT = dir;
  setPaused(true);
  try { expect(await maintainStep(NOW)).toBeNull(); } finally { setPaused(false); }
});

test("guard: the maintain step runs once per local date: the same date again is null, the next date runs", async () => {
  vaultHere();
  const first = await maintainStep(NOW);
  expect(await maintainStep(NOW + 3600_000)).toBeNull();
  expect((await maintainStep(NOW + 864e5))!.counts).toEqual(first!.counts);
});

test("guard: a tick with a vault present records the maintain step's dry result in ran", async () => {
  vaultHere();
  await runTick(NOW, quiet());
  const ran = tickRows();
  expect(ran.maintain.result).toMatch(/^dry: 0 fixed, .* · 0 lessons · 0 notes · 0 rechecked · 0 resolved · 0 aliased$/);
  expect(ran.corrections).toBeUndefined();
});

test("guard: the maintain step's dry compile of yesterday runs the model and records no day", async () => {
  const dir = vaultHere();
  const handoffs = join(base, `handoffs${n}`);
  mkdirSync(handoffs);
  writeFileSync(join(handoffs, "2026-11-03-120000.md"), "decided: keep the digest\n");
  writeFileSync(join(base, "maintainer"), `#!/bin/bash\ncat > /dev/null\necho '{"type":"result","is_error":false,"result":"","structured_output":{"notes":[{"title":"Keep The Digest","kind":"decision"}]}}'\n`);
  chmodSync(join(base, "maintainer"), 0o755);
  Object.assign(process.env, { ALEPH_HANDOFFS_DIR: handoffs, ALEPH_MAINTAINER_CMD: join(base, "maintainer") });
  try {
    const r = await maintainStep(NOW);
    expect(r!.compile).toMatchObject({ day: "2026-11-03", dry: true, notes: [{ title: "Keep The Digest", kind: "decision" }] });
    expect(r!.counts.notes).toBe(1);
    expect(compiledDays(dir)).toEqual([]);
  } finally {
    delete process.env.ALEPH_HANDOFFS_DIR;
    process.env.ALEPH_MAINTAINER_CMD = "false";
  }
});

// A failed compile of a day is tried again by the passes of the next 3 dates, before yesterday's.

const retrySetup = (): string => {
  const dir = vaultHere();
  const handoffs = join(base, `handoffs${n}`);
  mkdirSync(handoffs);
  for (const d of ["03", "04", "05", "06", "07", "08", "09"]) writeFileSync(join(handoffs, `2026-11-${d}-120000.md`), `decided: ${d}\n`);
  // The command fails while the file `fail` is there, and keeps the day of each prompt it gets in `asked`.
  writeFileSync(join(base, "maintainer"), `#!/bin/bash\ngrep -o '2026-11-[0-9][0-9]' | head -1 >> "${base}/asked"\n[ -e "${base}/fail" ] && exit 3\necho '{"type":"result","is_error":false,"result":"","structured_output":{"notes":[]}}'\n`);
  chmodSync(join(base, "maintainer"), 0o755);
  Object.assign(process.env, { ALEPH_HANDOFFS_DIR: handoffs, ALEPH_MAINTAINER_CMD: join(base, "maintainer") });
  return dir;
};
const asked = (): string[] => (existsSync(join(base, "asked")) ? readFileSync(join(base, "asked"), "utf8").split("\n").filter(Boolean) : []);
const endRetry = () => { delete process.env.ALEPH_HANDOFFS_DIR; process.env.ALEPH_MAINTAINER_CMD = "false"; };

test("the maintain step compiles a day whose compile failed again on the next date, before yesterday, and reports both", async () => {
  const dir = retrySetup();
  try {
    writeFileSync(join(base, "fail"), "");
    const first = await maintainStep(NOW);
    expect(first!.compile.error).toMatch(/exited 3/);
    expect(first!.retried).toBeUndefined();
    expect(retryDays(dir)).toEqual(["2026-11-03"]);
    rmSync(join(base, "fail"));
    rmSync(join(base, "asked"), { force: true });
    const r = await maintainStep(NOW + 864e5);
    expect(asked()).toHaveLength(2);
    expect(r!.retried).toMatchObject([{ day: "2026-11-03", dry: true, notes: [] }]);
    expect(r!.retried[0].error).toBeUndefined();
    expect(r!.compile).toMatchObject({ day: "2026-11-04", dry: true, notes: [] });
    expect(retryDays(dir)).toEqual([]);
  } finally { endRetry(); }
});

test("the tick's maintain result shows a failed retried compile with its day and its error", async () => {
  retrySetup();
  try {
    writeFileSync(join(base, "fail"), "");
    await runTick(NOW, quiet());
    await runTick(NOW + 864e5, quiet());
    expect(tickRows().maintain.result).toMatch(/retried failed: 2026-11-03 .*exited 3/);
  } finally { endRetry(); }
});

test("the maintain step makes no second compile of a failed day once a compile of it succeeded, or past 3 days before yesterday", async () => {
  const dir = retrySetup();
  const days = (r: any) => r.retried?.map((x: any) => x.day);
  try {
    writeFileSync(join(base, "fail"), "");
    // Every compile fails: the day of each pass is marked, and a day is retried on the 3 passes after the one that failed.
    expect(days(await maintainStep(NOW))).toBeUndefined();
    expect(days(await maintainStep(NOW + 864e5))).toEqual(["2026-11-03"]);
    await maintainStep(NOW + 2 * 864e5);
    await maintainStep(NOW + 3 * 864e5);
    // On the fifth date (yesterday 11-07) the 03rd is 4 days older than yesterday: not retried.
    expect(days(await maintainStep(NOW + 4 * 864e5))).toEqual(["2026-11-04", "2026-11-05", "2026-11-06"]);
    expect(retryDays(dir)).toEqual(["2026-11-03", "2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07"]);
    // The command works now: the three retried days and yesterday compile, and the 03rd and 04th stay uncompiled.
    rmSync(join(base, "fail"));
    expect(days(await maintainStep(NOW + 5 * 864e5))).toEqual(["2026-11-05", "2026-11-06", "2026-11-07"]);
    expect(retryDays(dir)).toEqual(["2026-11-03", "2026-11-04"]);
    // Nothing marked is in range any more: only yesterday compiles.
    rmSync(join(base, "asked"), { force: true });
    expect(days(await maintainStep(NOW + 6 * 864e5))).toBeUndefined();
    expect(asked()).toEqual(["2026-11-09"]);
  } finally { endRetry(); }
});
