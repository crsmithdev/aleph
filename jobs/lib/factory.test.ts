import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { askOf, clearAsk, readList, writeList } from "../../todo/lib/store.ts";
import * as store from "../../todo/lib/store.ts";
import * as verbs from "../../todo/lib/issues.ts";
import * as issues from "../../todo/lib/todo.ts";
import { AWAITING_CAP, correctionsDue, dispatchGoals, episodeStep, report, gates, notReady, spentToday, waitReason, hold, saveProbe, setPaused, waitingToLand, type Rescue } from "./factory.ts";
import { readRun, writeRun, allJobs, allRuns, lock, type Run } from "./ledger.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

const KEYS = ["ALEPH_ISSUES", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR", "ALEPH_DAY_CAP", "ALEPH_LIVE_CAP", "SIDETONE_TELL_URL"];
let base: string;
let saved: Record<string, string | undefined>;

// Each test gets its own factory repo, work store and registry, so the baseline and the goal list start empty.
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-factory-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    ALEPH_ISSUES: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"),
    ALEPH_FACTORY_DIR: join(base, "factory"), XDG_RUNTIME_DIR: join(base, "run"), ALEPH_DAY_CAP: "100", ALEPH_LIVE_CAP: "5", SIDETONE_TELL_URL: "http://127.0.0.1:1/tell",
  });
  // The factory repo, with an origin the baseline can fetch.
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "repo.git"));
  sh(base, "git", "clone", "-q", join(base, "repo.git"), join(base, "repo"));
  sh(join(base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "init");
  sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
  // The work store, empty: a list starts with its first item.
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: join(base, "repo"), sandbox: true, autoland: false } }));
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

/** A new open goal in the store's factory list `key` (default `fac`), with the given areas; returns its id. */
const goal = (areas: string[] = [], key = "fac"): number =>
  writeList({ key }, "add a goal", (doc) => { const item = issues.add(doc, "ship it", { labels: areas, body: "Do the thing." }); item.fm.kind = "goal"; return item.id; }, true)!.value;

/** Change item `id` in the store, as Chris would while the baseline runs. */
const change = (id: number, f: (item: issues.Issue) => void) =>
  writeList({ key: "fac" }, "edit", (doc) => { f(issues.find(doc, id)!); return true; });

test("a goal turned back into an issue during the baseline is not started", async () => {
  const id = goal();
  const calls: string[] = [];
  let baselined = false;
  const out = await dispatchGoals(async (_repo, name) => { calls.push(name); return null; }, async () => {
    baselined = true;
    await change(id, (item) => { item.fm.kind = "issue"; });
    return null;
  });
  expect(baselined).toBe(true);
  expect(calls).toEqual([]);
  expect(out.skipped).toEqual([]);
});

test("a goal closed during the baseline is not started", async () => {
  const id = goal();
  const calls: string[] = [];
  const out = await dispatchGoals(async (_repo, name) => { calls.push(name); return null; }, async () => {
    await change(id, (item) => issues.setStatus(item, "done"));
    return null;
  });
  expect(calls).toEqual([]);
  expect(out.skipped).toEqual([]);
});

// The baselines all run before the goals are read again, so the gap that matters is between that read and a goal's lock:
// an earlier goal's start is where it opens.
test("a goal given an after while an earlier goal starts is not started", async () => {
  const first = goal();
  const second = goal();
  const other = writeList({ key: "fac" }, "add an open item", (doc) => { const i = issues.add(doc, "not a goal"); issues.setStatus(issues.addGoal(doc, i, { title: "g", body: "b" }), "dropped"); return i.id; }, true)!.value;
  const calls: string[] = [];
  const out = await dispatchGoals(async (_repo, name) => {
    calls.push(name);
    if (name === `fac-${first}`) await change(second, (item) => { item.fm.after = [`fac-${other}.1`]; });
    return null;
  }, async () => null);
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.started).toEqual([`fac-${first}`]);
  expect(out.skipped).toEqual([`fac-${second}: blocked: after fac-${other}.1`]);
});

// An "already met" drop closes a factory item with no commit that names it; the goals that wait on it still start.
test("a goal waiting on a factory item the store says done, with no commit naming it, starts", async () => {
  const blocker = writeList({ key: "fac" }, "add the blocker", (doc) => issues.add(doc, "met elsewhere").id, true)!.value;
  mk(`fac-${blocker}`, "build", "dropped", { reason: "the goal is already met" });
  await change(blocker, (item) => issues.setStatus(item, "done"));
  const waiter = goal();
  await change(waiter, (item) => { item.fm.after = [`fac-${blocker}`]; });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([`fac-${waiter}`]);
  expect(out.skipped).toEqual([]);
});

// The list is read after the baselines, so the label gap is between that read and a goal's lock: an earlier goal's start removes it.
test("a goal turned back into an issue while an earlier goal starts is not started", async () => {
  const first = goal();
  const second = goal();
  const calls: string[] = [];
  const out = await dispatchGoals(async (_repo, name) => {
    calls.push(name);
    if (name === `fac-${first}`) await change(second, (item) => { item.fm.kind = "issue"; });
    return null;
  }, async () => null);
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.started).toEqual([`fac-${first}`]);
  expect(out.skipped).toEqual([`fac-${second}: not a goal`]);
});

// The list is read after the baselines, so the closed gap is between that read and a goal's lock: an earlier goal's start closes it.
test("a goal closed while an earlier goal starts is not started", async () => {
  const first = goal();
  const second = goal();
  const calls: string[] = [];
  const out = await dispatchGoals(async (_repo, name) => {
    calls.push(name);
    if (name === `fac-${first}`) await change(second, (item) => issues.setStatus(item, "done"));
    return null;
  }, async () => null);
  expect(calls).toEqual([`fac-${first}`]);
  expect(out.started).toEqual([`fac-${first}`]);
  expect(out.skipped).toEqual([`fac-${second}: not a goal`]);
});

// A dispatch that finds the baseline held skips with `main baseline running`; the holder starts the goal.
test("a goal added while another dispatch holds the baseline is started by the holder", async () => {
  goal();
  let added = 0;
  let b: Awaited<ReturnType<typeof dispatchGoals>> | undefined;
  const a = await dispatchGoals(async () => null, async () => {
    added = goal();
    b = await dispatchGoals(async () => null, async () => null);
    return null;
  });
  expect(b!.started).toEqual([]);
  expect(b!.skipped).toContain(`fac-${added}: main baseline running`);
  expect(a.started).toContain(`fac-${added}`);
});

// The baseline of a repo that joins the list while another baseline runs is itself run before the goals start.
test("a goal added while the baseline of a repo that joined the list runs is started by the holder", async () => {
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "two.git"));
  sh(base, "git", "clone", "-q", join(base, "two.git"), join(base, "two"));
  sh(join(base, "two"), "git", "commit", "-q", "--allow-empty", "-m", "init");
  sh(join(base, "two"), "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({
    fac: { path: join(base, "repo"), sandbox: true, autoland: false },
    two: { path: join(base, "two"), sandbox: true, autoland: false },
  }));
  goal();
  let first = 0, second = 0;
  let b: Awaited<ReturnType<typeof dispatchGoals>> | undefined;
  const a = await dispatchGoals(async () => null, async (repo) => {
    if (repo.key === "fac") first = goal([], "two");
    else {
      second = goal([], "two");
      b = await dispatchGoals(async () => null, async () => null);
    }
    return null;
  });
  expect(b!.skipped).toContain(`two-${first}: main baseline running`);
  expect(b!.skipped).toContain(`two-${second}: main baseline running`);
  expect(a.started).toContain(`two-${first}`);
  expect(a.started).toContain(`two-${second}`);
});

test("a goal that stays open and labelled is started exactly once", async () => {
  const id = goal();
  const calls: string[] = [];
  const out = await dispatchGoals(async (_repo, name) => { calls.push(name); return null; }, async () => null);
  expect(calls).toEqual([`fac-${id}`]);
  expect(out.started).toEqual([`fac-${id}`]);
  expect(out.skipped).toEqual([]);
});

const entry = (kind: string, state: string, reason?: string): any =>
  ({ id: `x-${kind}-${state}`, folder: join(base, "none", `${kind}-${state}`), run: { kind, job: "j1", name: "n1", repo: "fac", state, started: "2026-10-28T00:00:00Z", ...(reason ? { reason } : {}) } });

test("gates returns the first reason, in the order pause, hold, probe, live cap, day cap, waiting", () => {
  const stuck = [[entry("build", "stuck")]];
  const order = () => gates({ jobs: stuck as any })?.gate;
  Object.assign(process.env, { ALEPH_LIVE_CAP: "0", ALEPH_DAY_CAP: "0", ALEPH_AWAITING_CAP: "0" });
  try {
    setPaused(true);
    saveProbe({ at: "2026-10-28T00:00:00Z", ok: false, failed: ["x"] });
    expect(order()).toBe("pause");
    setPaused(false);
    expect(order()).toBe("hold");
    expect(gates({ jobs: [] })?.gate).toBe("probe");
    saveProbe({ at: "2026-10-28T00:00:00Z", ok: true, failed: [] });
    expect(gates({ jobs: [] })?.gate).toBe("live");
    process.env.ALEPH_LIVE_CAP = "5";
    expect(gates({ jobs: [] })?.gate).toBe("day");
    process.env.ALEPH_DAY_CAP = "100";
    expect(gates({ jobs: [] })?.gate).toBe("awaiting");
    process.env.ALEPH_AWAITING_CAP = "5";
    expect(gates({ jobs: [] })).toBeNull();
    // `only` leaves the others out.
    process.env.ALEPH_DAY_CAP = "0";
    expect(gates({ jobs: stuck as any, only: ["day"] })?.gate).toBe("day");
  } finally {
    delete process.env.ALEPH_AWAITING_CAP;
  }
});

test("a land that failed 'job lock busy' does not hold the factory", () => {
  expect(hold([[entry("build", "passed"), entry("land", "failed", "job lock busy")]])).toBeNull();
});

test("a land that failed for another reason holds the factory", () => {
  expect(hold([[entry("build", "passed"), entry("land", "failed", "not landed")]])?.name).toBe("n1");
});

test("after a land that failed 'job lock busy' the passed agent run is waiting to land again", () => {
  const agent = entry("build", "passed");
  agent.run.land = true;
  expect(waitingToLand([[agent, entry("land", "failed", "job lock busy")]])).toEqual(["n1"]);
  expect(waitingToLand([[agent, entry("land", "failed", "not landed")]])).toEqual([]);
});

// Safe default actions for stuck and failed runs.

let seq = 0;
/** A run folder in the ledger: a new job when `job` is not given. Returns the folder and the job id. */
function mk(name: string, kind: Run["kind"], state: Run["state"], extra: Partial<Run> = {}, files: Record<string, string> = {}): { folder: string; job: string } {
  const id = `20261028-0000${String(++seq).padStart(2, "0")}-fac-${name}-${kind}`;
  const folder = join(base, "jobs", id);
  mkdirSync(folder, { recursive: true });
  for (const [f, text] of Object.entries(files)) writeFileSync(join(folder, f), text);
  writeRun(folder, { kind, job: id, name, repo: "fac", state, on: `fac-${name.split("-")[1]}`, told: true, shown: true, started: new Date().toISOString(), ...extra } as Run);
  return { folder, job: extra.job ?? id };
}
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
const notes = (id: number) => readList({ key: "fac" })!.items.find((i) => i.id === id)!.notes.join("\n");
const ask = (id: number) => askOf(readList({ key: "fac" })!.items.find((i) => i.id === id)!);

/** Fake actions that log their calls: a drop marks the run dropped, a recheck starts a passed recheck run. */
function fakes() {
  const calls: string[] = [];
  const rescue: Rescue = {
    drop: async (name, reason) => {
      calls.push(`drop ${name}`);
      const j = allJobs().find((x) => x.at(-1)!.run.name === name && x.at(-1)!.run.state !== "dropped")!;
      const last = j.at(-1)!;
      writeRun(last.folder, { ...last.run, state: "dropped", reason });
      return null;
    },
    recheck: async (name) => {
      calls.push(`recheck ${name}`);
      const j = allJobs().find((x) => x.at(-1)!.run.name === name)!;
      mk(name, "recheck", "running", { job: j[0].run.job, branch: j[0].run.branch });
      return null;
    },
  };
  const land = async (name: string) => { calls.push(`land ${name}`); return null; };
  const specs: string[] = [];
  const start = async (_r: unknown, name: string, _id: number | string, spec: string) => { calls.push(`start ${name}`); specs.push(spec); return null; };
  return { calls, rescue, land, specs, start };
}
const dispatch = (f: ReturnType<typeof fakes>) => dispatchGoals(f.start, async () => null, f.land, f.rescue);

// A run that a host restart killed: `running`, started before this boot, its process gone.
const BEFORE_BOOT = "2020-01-01T00:00:00.000Z";
const killedRun = (name: string, kind: Run["kind"] = "build", files: Record<string, string> = { pid: "999999999" }) => mk(name, kind, "running", { started: BEFORE_BOOT }, files);

test("a run killed by a host restart is dropped, its goal starts at once, and no Ask or rescue mark is left", async () => {
  const id = goal();
  const r = killedRun(`fac-${id}`);
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(out.started).toEqual([`fac-${id}`]);
  expect(f.specs[0]).toContain("a host restart killed build run");
  expect(notes(id)).toContain("a host restart killed build run");
  expect(ask(id)).toBeNull();
  expect(existsSync(join(r.folder, "rescued"))).toBe(false);
});

test("a goal whose run a host restart killed keeps its rerun: the next no commit reruns it with no Ask", async () => {
  const id = goal();
  killedRun(`fac-${id}`);
  const f = fakes();
  f.start = async () => null;
  await dispatchGoals(f.start, async () => null, f.land, f.rescue);
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" });
  await dispatchGoals(f.start, async () => null, f.land, f.rescue);
  expect(f.calls).toEqual([`drop fac-${id}`, `drop fac-${id}`]);
  expect(ask(id)).toBeNull();
});

test("a killed run with a pid that another process now holds is still killed", async () => {
  const id = goal();
  killedRun(`fac-${id}`, "build", { pid: String(process.pid) });
  const f = fakes();
  await dispatch(f);
  expect(f.calls[0]).toBe(`drop fac-${id}`);
});

test("a killed run that wrote no pid yet is killed too", async () => {
  const id = goal();
  killedRun(`fac-${id}`, "build", {});
  const f = fakes();
  await dispatch(f);
  expect(f.calls[0]).toBe(`drop fac-${id}`);
});

test("a run from before this boot whose pid's process names its folder is live and stays", async () => {
  const id = goal();
  const r = killedRun(`fac-${id}`, "build", {});
  // The sleep comes first: bash execs a last command, and its cmdline would lose the folder.
  const p = Bun.spawn(["bash", "-c", `sleep 20; : ${r.folder}`], { stdout: "ignore", stderr: "ignore" });
  try {
    writeFileSync(join(r.folder, "pid"), String(p.pid));
    const f = fakes();
    await dispatch(f);
    expect(f.calls).toEqual([]);
    expect(readRun(r.folder)!.state).toBe("running");
  } finally { p.kill(); }
});

test("a run started in this boot whose process is gone is left alone", async () => {
  const id = goal();
  const r = mk(`fac-${id}`, "build", "running", {}, { pid: "999999999" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([]);
  expect(readRun(r.folder)!.state).toBe("running");
});

test("a land killed by a host restart fails and lands again, and the goal does not start over", async () => {
  const id = goal();
  const first = mk(`fac-${id}`, "build", "passed", { branch: "b", started: BEFORE_BOOT });
  const l = mk(`fac-${id}`, "land", "running", { job: first.job, branch: "b", started: BEFORE_BOOT }, { pid: "999999999" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls[0]).toBe(`land fac-${id}`);
  expect(f.calls).not.toContain(`drop fac-${id}`);
  expect(readRun(l.folder)).toMatchObject({ state: "failed", reason: "host restart" });
  expect(existsSync(join(l.folder, "exit"))).toBe(true);
});

test("a paused factory leaves a killed run alone", async () => {
  const id = goal();
  const r = killedRun(`fac-${id}`);
  setPaused(true);
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([]);
  expect(readRun(r.folder)!.state).toBe("running");
});

test("no commit, the item already done: the run is dropped as a duplicate, once, and the factory is not held", async () => {
  const id = goal();
  await change(id, (item) => issues.setStatus(item, "done"));
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(notes(id)).toContain("already done: dropped as a duplicate");
  expect(allRuns()[0].run.reason).toContain("dropped as a duplicate");
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`]);
});

test("no commit, the work on main by its Job trailer: dropped as a duplicate and the item closed", async () => {
  const id = goal();
  const r = mk(`fac-${id}`, "build", "stuck", { reason: "no commit" });
  sh(join(base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nJob: ${r.job}`);
  sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(notes(id)).toMatch(/on main as [0-9a-f]{7}: dropped as a duplicate/);
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
  expect(f.specs).toEqual([]);
});

test("no commit, the item on main by its Item trailer: the open item is closed with a note naming the commit", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" });
  sh(join(base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nItem: fac-${id}\nJob: other`);
  sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
  const sha = Bun.spawnSync(["git", "rev-parse", "--short=7", "HEAD"], { cwd: join(base, "repo") }).stdout.toString().trim();
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(notes(id)).toContain(`on main as ${sha}: dropped as a duplicate`);
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
  expect(f.specs).toEqual([]);
});

test("a goal whose item is done on main is not dispatched", async () => {
  const id = goal();
  sh(join(base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nItem: fac-${id}\nJob: other`);
  sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([]);
  expect(f.specs).toEqual([]);
});

test("a fourth no-commit run in a row is not dispatched; the item gets an Ask", async () => {
  const id = goal();
  for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "no commit, run X ended with no commit: dropped as a duplicate", noCommit: true, started: new Date(Date.now() - (4 - i) * 60_000).toISOString() });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([]);
  expect(out.skipped.join()).toContain("3 runs in a row with no commit");
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain("ended with no commit");
  expect(readList({ key: "fac" })!.items.find((i) => i.id === id)!.fm.reason).toBe("no-commit");
  await dispatch(f);
  expect(f.specs).toEqual([]);
});

const noCommitRuns = (id: number, n: number, ago: number) => {
  for (let i = 0; i < n; i++) mk(`fac-${id}`, "build", "dropped", { reason: "run X ended with no commit: dropped", noCommit: true, started: new Date(Date.now() - (ago - i) * 1000).toISOString() });
};
const unlabel = (id: number) => change(id, (item) => clearAsk(item));
const chrisNotes = (id: number) => notes(id).split("asks Chris:").length - 1;

test("answering the Ask restarts the no-commit streak; three more no-commit runs give it another Ask", async () => {
  const id = goal();
  // Two hours back: outside the run cap's hour, so only the streak holds the goal.
  noCommitRuns(id, 3, 7200);
  const f = fakes();
  expect((await dispatch(f)).started).toEqual([]);
  expect(ask(id)).not.toBeNull();
  await new Promise((r) => setTimeout(r, 20));
  await unlabel(id);
  expect((await dispatch(f)).started).toEqual([`fac-${id}`]);
  // the started run is not a no-commit run; three more finish after the mark
  await new Promise((r) => setTimeout(r, 20));
  noCommitRuns(id, 3, 0);
  const g = fakes();
  expect((await dispatch(g)).started).toEqual([]);
  expect(g.specs).toEqual([]);
  expect(ask(id)).not.toBeNull();
  expect(chrisNotes(id)).toBe(2);
});

test("while the Ask stays on the item, dispatches start nothing and write one note", async () => {
  const id = goal();
  noCommitRuns(id, 3, 600);
  const f = fakes();
  await dispatch(f);
  await dispatch(f);
  expect(f.specs).toEqual([]);
  expect(ask(id)).not.toBeNull();
  expect(chrisNotes(id)).toBe(1);
});

test("two no-commit runs in a row are still dispatched", async () => {
  const id = goal();
  for (let i = 0; i < 2; i++) mk(`fac-${id}`, "build", "dropped", { reason: "run X ended with no commit: dropped", noCommit: true, started: new Date(Date.now() - (3 - i) * 60_000).toISOString() });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([`fac-${id}`]);
});

test("an item that the store closes while an earlier goal starts gets no run", async () => {
  const first = goal();
  const second = goal();
  const f = fakes();
  const out = await dispatchGoals(async (_repo, name) => {
    f.calls.push(`start ${name}`);
    if (name === `fac-${first}`) await change(second, (item) => issues.setStatus(item, "done"));
    return null;
  }, async () => null, f.land, f.rescue);
  expect(f.calls).toEqual([`start fac-${first}`]);
  expect(out.skipped.join()).toContain(`fac-${second}`);
  expect(out.started).toEqual([`fac-${first}`]);
});

test("a done item gets no run and no run-cap note, even with three recent runs", async () => {
  const id = goal();
  await change(id, (item) => issues.setStatus(item, "done"));
  for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "time box" });
  const f = fakes();
  await dispatch(f);
  expect(f.specs).toEqual([]);
  expect(ask(id)).toBeNull();
});

// The run cap: a fourth agent run of a goal in 60 minutes is not started; one Ask note says so.
const RUN_CAP_NOTE = "the factory started this goal 3 times in the last hour; it stops starting it until Chris reruns it";
test("a fourth start in an hour is skipped with one Ask note, and the goal is not started", async () => {
  const id = goal();
  for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - (i + 1) * 60_000).toISOString() });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([]);
  expect(out.skipped.join()).toContain("3 runs in the last hour");
  expect(f.specs).toEqual([]);
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain(RUN_CAP_NOTE);
  await dispatch(f);
  await dispatch(f);
  expect(f.specs).toEqual([]);
  expect(notes(id).split("asks Chris:").length - 1).toBe(1);
});

const recent = (id: number, n: number) => {
  for (let i = 0; i < n; i++) mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - (i + 1) * 60_000).toISOString() });
};
const capPath = (id: number) => join(base, "factory", "cap", `fac-${id}.txt`);

test("a cap mark with the label holds the goal below the hour count; once Chris removes the label it starts, and the next cap hit notes again", async () => {
  const id = goal();
  recent(id, 3);
  const f = fakes();
  await dispatch(f);
  expect(existsSync(capPath(id))).toBe(true);
  expect(notes(id).split("asks Chris:").length - 1).toBe(1);
  // Old starts leave the window: one start 60 seconds ago.
  const g = goal();
  mk(`fac-${g}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - 60_000).toISOString() });
  mkdirSync(join(base, "factory", "cap"), { recursive: true });
  writeFileSync(capPath(g), "x\n");
  await change(g, (item) => { store.setAsk(item, { kind: "input", reason: "run-cap", question: "q", options: [], why: [] }); });
  const out = await dispatch(fakes());
  expect(out.started).not.toContain(`fac-${g}`);
  // An item with an Ask is no goal: the dispatch lists nothing to skip.
  expect(notes(g)).not.toContain("asks Chris:");
  // Chris reruns: the label is removed while 3 starts are in the hour.
  recent(g, 2);
  await change(g, (item) => store.clearAsk(item));
  const f2 = fakes();
  const out2 = await dispatch(f2);
  expect(out2.started).toEqual([`fac-${g}`]);
  expect(existsSync(capPath(g))).toBe(false);
  // The started run is dropped; the hour count is still at the cap and no mark is left.
  mk(`fac-${g}`, "build", "dropped", { reason: "time box" });
  const out3 = await dispatch(f2);
  expect(out3.started).toEqual([]);
  expect(existsSync(capPath(g))).toBe(true);
  expect(notes(g).split("asks Chris:").length - 1).toBe(1);
  expect(notes(g)).toContain("until Chris reruns it");
  expect(ask(g)).not.toBeNull();
});

test("a failed run-cap note leaves no cap mark", async () => {
  const id = goal();
  recent(id, 3);
  // The clone cannot store a new commit, so the note write fails while the goal still reads.
  const objects = join(base, "items", ".git", "objects");
  sh(base, "chmod", "-R", "a-w", objects);
  const f = fakes();
  const out = await dispatch(f).finally(() => sh(base, "chmod", "-R", "u+w", objects));
  expect(out.started).toEqual([]);
  expect(ask(id)).toBeNull();
  expect(existsSync(capPath(id))).toBe(false);
});

test("a run that is three runs old, or three runs of other goals, does not hold the goal", async () => {
  const id = goal();
  for (let i = 0; i < 3; i++) mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - 7200_000).toISOString() });
  mk(`fac-${id + 100}`, "build", "dropped", { reason: "time box" });
  const f = fakes();
  const out = await dispatch(f);
  expect(out.started).toEqual([`fac-${id}`]);
  expect(ask(id)).toBeNull();
});

test("ALEPH_AWAITING_CAP=1 with one awaiting run skips the next start with the awaiting gate's line", async () => {
  const waiter = goal();
  const next = goal();
  mk(`fac-${waiter}`, "build", "awaiting", { ask: { kind: "input", reason: "question", question: "q?", options: [], why: [] } });
  process.env.ALEPH_AWAITING_CAP = "1";
  try {
    const f = fakes();
    const out = await dispatch(f);
    expect(out.started).toEqual([]);
    expect(out.skipped).toContain(`fac-${next}: 1 runs wait for Chris`);
    expect(f.specs).toEqual([]);
  } finally {
    delete process.env.ALEPH_AWAITING_CAP;
  }
});

test("caps.json awaiting sets the cap, and the old waiting key still does", () => {
  mkdirSync(join(base, "factory"), { recursive: true });
  writeFileSync(join(base, "factory", "caps.json"), JSON.stringify({ awaiting: 2 }));
  expect(AWAITING_CAP()).toBe(2);
  writeFileSync(join(base, "factory", "caps.json"), JSON.stringify({ waiting: 3 }));
  expect(AWAITING_CAP()).toBe(3);
  rmSync(join(base, "factory", "caps.json"));
  expect(AWAITING_CAP()).toBe(5);
});

test("the run cap holds with a standing Rerun: the rerun of the third run is the fourth start and gets the note", async () => {
  mkdirSync(join(base, "factory"), { recursive: true });
  writeFileSync(join(base, "factory", "always.json"), JSON.stringify({ rescue: { action: "recommended", at: new Date().toISOString() } }));
  const id = goal();
  mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - 120_000).toISOString() });
  mk(`fac-${id}`, "build", "dropped", { reason: "time box", started: new Date(Date.now() - 60_000).toISOString() });
  mk(`fac-${id}`, "build", "stuck", { reason: "tests failed after 2 fix rounds" });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toContain(`drop fac-${id}`);
  expect(f.calls.filter((c) => c.startsWith("start"))).toEqual([]);
  expect(out.skipped.join()).toContain("3 runs in the last hour");
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain(RUN_CAP_NOTE);
  expect(notes(id)).toContain("always: Rerun");
});

// A claim that the goal is met is checked on origin/main: a new commit there, so the baseline is run again.
const claimed = (name: string, result: string) => {
  sh(join(base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `main for ${name}`);
  sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
  return mk(name, "build", "stuck", { reason: "no commit" }, { "result.md": result });
};
const withChecks = (f: ReturnType<typeof fakes>, checks: (repo: unknown, commit: string, logs: string) => Promise<string | null>) =>
  dispatchGoals(f.start, checks, f.land, f.rescue);

test("no commit and the worker says the goal is already met, the checks pass on main: dropped and the item done", async () => {
  const id = goal();
  claimed(`fac-${id}`, "Looked.\nGoal: Already met — timeline.ts uses itemTimes\n");
  const f = fakes();
  const out = await withChecks(f, async () => null);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(f.specs).toEqual([]);
  expect(out.held).toBeUndefined();
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
  expect(notes(id)).toContain("says the goal is already met (timeline.ts uses itemTimes), and the checks pass on origin/main");
  expect(ask(id)).toBeNull();
  expect(allRuns()[0].run.reason).toContain("the item is done");
});

test("no commit and the worker says the goal is already met, but main is red: dropped with the claim; the goal reruns once main is green", async () => {
  const id = goal();
  claimed(`fac-${id}`, "Goal: Already met — main has it\n");
  const f = fakes();
  // Red main holds every start, so the goal waits; the rerun is the next dispatch on green main.
  await withChecks(f, async () => "tests failed");
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(notes(id)).toContain("but main is red at");
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("open");
  expect(ask(id)).toBeNull();
  sh(join(base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "fix main");
  sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
  await withChecks(f, async () => null);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(f.specs[0]).toContain("The last run said the goal is already met (main has it)");
});

test("no commit and the claim, but main cannot be checked: the run waits for the next dispatch", async () => {
  const id = goal();
  claimed(`fac-${id}`, "Goal: Already met\n");
  const f = fakes();
  await withChecks(f, async () => "checks did not start");
  expect(f.calls).toEqual([]);
  expect(allRuns()[0].run.state).toBe("stuck");
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("open");
});

test("a met goal: the claim waits on an unchecked main, then the next dispatch on green main drops it and the item is done", async () => {
  const id = goal();
  claimed(`fac-${id}`, "Goal: Already met — main has it\n");
  const f = fakes();
  await withChecks(f, async () => "checks did not start");
  expect(f.calls).toEqual([]);
  await withChecks(f, async () => null);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
  expect(ask(id)).toBeNull();
});

for (const red of [false, true]) {
  test(`a second claimed run after one rescued as claimed, main ${red ? "red: the goal label is off" : "green: the item is done"}, never an Ask`, async () => {
    const id = goal();
    const first = mk(`fac-${id}`, "build", "dropped", { reason: "no commit" }, { "result.md": "Goal: Already met\n" });
    writeFileSync(join(first.folder, "rescued"), "claimed\n");
    claimed(`fac-${id}`, "Goal: Already met\n");
    const f = fakes();
    await withChecks(f, async () => (red ? "tests failed" : null));
    expect(f.calls).toEqual([`drop fac-${id}`]);
    expect(ask(id)).toBeNull();
    if (red) {
      expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("open");
    } else {
      expect(issues.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
    }
  });
}

test("no commit, the item open, first time: dropped and the goal reruns once, with the last 20 lines of result.md", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(30) });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(f.specs[0]).toContain("made no commit");
  expect(f.specs[0]).toContain("line 11\n");
  expect(f.specs[0]).toContain("line 30");
  expect(f.specs[0]).not.toContain("line 10\n");
  expect(notes(id)).toContain("made no commit");
});

test("the second no-commit run with no claim goes back to triage: the goal label is off, no Ask, the note quotes result.md", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(3) });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(30) });
  const out = await dispatch(f);
  // The back-to-triage write (unlabel "goal") is a no-op on a new-shape goal, so the dispatch may start it again: only the first three calls are the test's.
  expect(f.calls.slice(0, 3)).toEqual([`drop fac-${id}`, `start fac-${id}`, `drop fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(ask(id)).toBeNull();
  expect(notes(id)).toContain("went back to triage");
  expect(notes(id)).toContain("line 11 | line 12");
  expect(notes(id)).toContain("line 30");
  expect(notes(id)).not.toContain("line 10 |");
});

test("a repeated no-commit run on an issue already sent back to triage once gets an Ask", async () => {
  const id = goal();
  const f = fakes();
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(3) });
  await dispatch(f);
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(3) });
  await dispatch(f);
  // Triage rewrote the goal and the run ends with no commit again.
  mk(`fac-${id}`, "build", "stuck", { reason: "no commit" }, { "result.md": lines(3) });
  await dispatch(f);
  expect(ask(id)).not.toBeNull();
});

test("time box, first time: dropped and the goal reruns once, with the last 20 lines of result.md", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "time box" }, { "result.md": lines(25) });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(f.specs[0]).toContain("time box ran out");
  expect(f.specs[0]).toContain("line 6\n");
  expect(f.specs[0]).not.toContain("line 5\n");
  expect(notes(id)).toContain("time box ran out");
});

test("the second time-box stuck run on one goal gets an Ask and no third run", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "time box" }, { "result.md": lines(3) });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  // The rerun runs, and ends in the time box again.
  mk(`fac-${id}`, "build", "stuck", { reason: "time box" });
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain("asks Chris: fac-");
  expect(out.held).toBeUndefined();
  await dispatch(f);
  expect(f.calls).toHaveLength(2);
  expect(notes(id).match(/asks Chris:/g)).toHaveLength(1);
});

test("an infrastructure failure of an agent run is rechecked once; of a land, landed again once", async () => {
  const id = goal();
  sh(join(base, "repo"), "git", "branch", `factory/fac-${id}`);
  mk(`fac-${id}`, "build", "failed", { reason: "fetch failed", branch: `factory/fac-${id}` });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`recheck fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(notes(id)).toContain("failed for infrastructure (fetch failed)");
  expect(notes(id)).toContain("rechecked, once");

  const id2 = goal();
  const a = mk(`fac-${id2}`, "build", "passed", { land: true });
  mk(`fac-${id2}`, "land", "stuck", { reason: "bundle failed: no space", job: a.job });
  await dispatch(f);
  expect(f.calls).toEqual([`recheck fac-${id}`, `land fac-${id2}`]);
  expect(notes(id2)).toContain("landed again, once");
});

test("a second infrastructure failure of one goal gets an Ask", async () => {
  const id = goal();
  const a = mk(`fac-${id}`, "build", "passed", { land: true });
  mk(`fac-${id}`, "land", "stuck", { reason: "fetch failed", job: a.job });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`land fac-${id}`]);
  // The land again fails the same way (the fake land started nothing, so the run still stands).
  const b = allJobs()[0];
  mk(`fac-${id}`, "land", "failed", { reason: "fetch failed", job: b[0].run.job });
  await dispatch(f);
  expect(f.calls).toEqual([`land fac-${id}`]);
  expect(ask(id)).not.toBeNull();
});

test("failed checks after a land merge, first time: dropped and the goal reruns once on the new main", async () => {
  const id = goal();
  const a = mk(`fac-${id}`, "build", "passed", { land: true });
  mk(`fac-${id}`, "land", "stuck", { reason: "tests failed", job: a.job }, { "checks.log": `## tests: exit 1\n${lines(30)}` });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(f.specs[0]).toContain("checks failed after the land merged main");
  expect(f.specs[0]).toContain("line 30");
  expect(notes(id)).toContain("checks failed after the land merged main");
});

test("a land that failed with a merge conflict is dropped and the goal reruns; the second one gets an Ask", async () => {
  const id = goal();
  const a = mk(`fac-${id}`, "build", "passed", { land: true });
  mk(`fac-${id}`, "land", "failed", { reason: "merge conflict", conflicts: ["a.ts", "b.ts"], job: a.job });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(f.specs[0]).toContain("merge conflict in a.ts, b.ts");
  expect(notes(id)).toContain("merge conflict in a.ts, b.ts");
  expect(ask(id)).toBeNull();

  const b = mk(`fac-${id}`, "build", "passed", { land: true });
  mk(`fac-${id}`, "land", "failed", { reason: "merge conflict", conflicts: ["a.ts"], job: b.job });
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(ask(id)).not.toBeNull();
});

test("a run that is not safe gets an Ask with a question and does not hold the factory; another goal starts", async () => {
  const id = goal();
  const other = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "tests failed after 2 fix rounds" });
  const f = fakes();
  const out = await dispatch(f);
  expect(ask(id)).not.toBeNull();
  expect(notes(id)).toContain("asks Chris: fac-");
  const stored = () => readList({ key: "fac" })!.items.find((i) => i.id === id)!;
  expect(stored().fm).toMatchObject({ ask: "input", reason: "rescue", recommended: "Rerun" });
  expect(askOf(stored())!.options.map((o) => o.label)).toEqual(["Rerun", "Another way"]);
  expect(existsSync(join(readdirSync(join(base, "jobs")).map((d) => join(base, "jobs", d))[0], "asked"))).toBe(true);
  verbs.decide({ key: "fac" }, id, "drop it");
  expect("reason" in stored().fm).toBe(false);
  expect(out.held).toBeUndefined();
  expect(f.calls).toEqual([`start fac-${other}`]);
  expect(hold()).toBeNull();
  expect(readRun(allRuns()[0].folder)!.state).toBe("stuck");
});

test("a standing rescue: recommended drops the unsafe stuck run, no Ask, an always: Rerun note", async () => {
  mkdirSync(join(base, "factory"), { recursive: true });
  writeFileSync(join(base, "factory", "always.json"), JSON.stringify({ rescue: { action: "recommended", at: new Date().toISOString() } }));
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "tests failed after 2 fix rounds" });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toContain(`drop fac-${id}`);
  expect(ask(id)).toBeNull();
  expect(notes(id)).toContain("always: Rerun");
  expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain(`always: rescue: recommended on fac-${id}`);
});

test("without rescue actions a stuck run still holds the factory", async () => {
  const id = goal();
  mk(`fac-${id}`, "build", "stuck", { reason: "time box" });
  const out = await dispatchGoals(async () => null, async () => null);
  expect(out.held).toContain("Held:");
});

test("a rescue that finds the lock taken waits, then acts once on the state it finds under the lock", async () => {
  const id = goal();
  const name = `fac-${id}`;
  const { folder } = mk(name, "build", "stuck", { reason: "weird" });
  // Dispatch A holds the lock; the stuck state B must act on appears only after A is done.
  const release = (await lock(`rescue-fac-${name}`, 0))!;
  const f = fakes();
  const b = dispatch(f);
  await Bun.sleep(300);
  expect(f.calls).toEqual([]);
  writeRun(folder, { ...readRun(folder)!, state: "failed", reason: "time box" });
  release();
  await b;
  expect(f.calls.filter((c) => c.startsWith("drop"))).toEqual([`drop ${name}`]);
  expect(notes(id)).toContain("the time box ran out");
});

test("two dispatches at once rescue one stuck job once", async () => {
  const id = goal();
  const name = `fac-${id}`;
  mk(name, "build", "stuck", { reason: "time box" });
  const f = fakes();
  const slow = { ...f.rescue, drop: async (n: string, r: string) => { await Bun.sleep(300); return f.rescue.drop(n, r); } };
  await Promise.all([dispatchGoals(f.start, async () => null, f.land, slow), dispatchGoals(f.start, async () => null, f.land, slow)]);
  expect(f.calls.filter((c) => c.startsWith("drop"))).toEqual([`drop ${name}`]);
});

test("a rescue whose lock wait runs out skips the job and does not throw", async () => {
  const id = goal();
  const name = `fac-${id}`;
  mk(name, "build", "stuck", { reason: "time box" });
  const release = (await lock(`rescue-fac-${name}`, 0))!;
  process.env.ALEPH_RESCUE_WAIT_MS = "200";
  try {
    const f = fakes();
    await dispatch(f);
    expect(f.calls).toEqual([]);
  } finally { delete process.env.ALEPH_RESCUE_WAIT_MS; release(); }
});

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
  expect(waitReason(repoX, mkItem({ due: "2999-01-01" }), { done: () => true }).text).toBe("Due 2999-01-01");
});

const storeAt = (lessons: unknown[], minedAt = "") => {
  mkdirSync(join(base, "factory"), { recursive: true });
  writeFileSync(join(base, "factory", "corrections.json"), JSON.stringify({ minedAt, lessons }));
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
  const vault = join(base, "vault");
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
      const item = issues.add(doc, "ship it", { body: "## Goal\nShip it." });
      item.fm.kind = "goal";
      issues.setStatus(item, "done");
      return item.id;
    }, true)!.value;
    const repo = join(base, "repo");
    writeFileSync(join(repo, "f.txt"), "x\n");
    sh(repo, "git", "add", ".");
    sh(repo, "git", "commit", "-q", "-m", "ship thing", "-m", `Item: fac-${id}`);
    sh(repo, "git", "push", "-q", "origin", "main");
    const folder = join(base, "jobs", `20261028-100000-fac-${id}-agent`);
    mkdirSync(folder, { recursive: true });
    writeRun(folder, { kind: "build", job: "j", name: `fac-${id}`, repo: "fac", state: "landed", told: true, on: `fac-${id}`, started: "2026-10-28T10:00:00Z", ended: "2026-10-28T10:20:00Z" });
    expect(await episodeStep()).toEqual([`fac-${id} ship it`]);
    expect(readdirSync(join(v.vault, "wiki", "episodes")).filter((f) => f.endsWith(".md"))).toEqual([`fac-${id} ship it.md`]);
    expect(readFileSync(join(base, "factory", "tick.log"), "utf8")).toContain(`episodes fac-${id} ship it\n`);
  } finally { v.done(); }
});

test("report prints the kept and rejected lines of a facts run, once", () => {
  const folder = join(base, "jobs", "20261028-000001-facts-n1-facts");
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "facts", job: "j1", name: "facts-n1", repo: "fac", state: "done", reason: "kept 1, rejected 1", told: true, shown: false, started: "2026-10-28T00:00:00Z", kept: ["Lemons Float"], rejected: [{ fact: "pears sink", reason: "b.ts says otherwise" }] } as Run);
  const old = join(base, "jobs", "20261028-000002-facts-n2-facts");
  mkdirSync(old, { recursive: true });
  writeRun(old, { kind: "facts", job: "j2", name: "facts-n2", repo: "fac", state: "done", reason: "kept 0, rejected 1", told: true, shown: false, started: "2026-10-28T00:00:01Z", kept: [], rejected: ["old: string form"] } as unknown as Run);
  const out = report();
  expect(out).toContain("fac/facts-n1 done: kept 1, rejected 1\n  kept: Lemons Float");
  expect(out).toContain("  rejected: old: string form");
  expect(out).toContain("  rejected: pears sink: b.ts says otherwise");
  expect(out.split("rejected: pears sink").length).toBe(2);
  expect(report()).not.toContain("fac/facts-n1");
});

test("a dispatch with checks, three factory repos and no open goals fetches the work store at most twice", async () => {
  const items = join(base, "items");
  writeFileSync(join(base, "repos.json"), JSON.stringify(Object.fromEntries(["fac", "fac2", "fac3"].map((k) => [k, { path: join(base, "repo"), sandbox: true, autoland: false }]))));
  const log = join(base, "fetch.log");
  mkdirSync(join(base, "bin"));
  const real = Bun.spawnSync(["which", "git"]).stdout.toString().trim();
  writeFileSync(log, "");
  writeFileSync(join(base, "bin", "git"), `#!/bin/sh\n[ "$1" = fetch ] && [ "$PWD" = ${items} ] && echo fetch >> ${log}\nexec ${real} "$@"\n`);
  Bun.spawnSync(["chmod", "+x", join(base, "bin", "git")]);
  const path = process.env.PATH;
  process.env.PATH = `${join(base, "bin")}:${path}`;
  try {
    const out = await dispatchGoals(async () => null, async () => null);
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
  const withSurface = () => writeList({ key: "fac" }, "add a goal", (doc) => { const item = issues.add(doc, "ship it", { body: surface }); item.fm.kind = "goal"; return item.id; }, true)!.value;
  for (const n of [901, 902, 903]) mk(`fac-${n}`, "land", "dropped", { conflicts: ["jobs/busy.ts"] });
  const first = withSurface();
  const second = withSurface();
  const { folder } = mk(`fac-${first}`, "build", "passed");
  const calls: string[] = [];
  const start = async (_repo: unknown, name: string) => { calls.push(name); return null; };
  const out = await dispatchGoals(start);
  expect(calls).toEqual([]);
  expect(out.skipped).toContain(`fac-${second}: waits for fac-${first}: both change the busy file jobs/busy.ts`);
  writeRun(folder, { ...readRun(folder)!, state: "awaiting", ask: { kind: "approval", reason: "held-path", question: "q", options: [], why: [] } });
  await dispatchGoals(start);
  expect(calls).toEqual([`fac-${second}`]);
});

test("a goal that shares only a quiet file with an open job starts", async () => {
  const body = "## Edit surface\n- jobs/quiet.ts\n";
  const add = () => writeList({ key: "fac" }, "add a goal", (doc) => { const item = issues.add(doc, "ship it", { body }); item.fm.kind = "goal"; return item.id; }, true)!.value;
  mk("fac-901", "land", "dropped", { conflicts: ["jobs/quiet.ts"] });
  const first = add();
  const second = add();
  mk(`fac-${first}`, "build", "passed");
  const calls: string[] = [];
  await dispatchGoals(async (_repo, name) => { calls.push(name); return null; });
  expect(calls).toEqual([`fac-${second}`]);
});
