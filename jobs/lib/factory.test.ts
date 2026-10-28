import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readList, writeList } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import { dispatchGoals, hold, waitingToLand, type Rescue } from "./factory.ts";
import { readRun, writeRun, allJobs, allRuns, lock, type Run } from "./ledger.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

const KEYS = ["ALEPH_ITEMS", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR", "ALEPH_DAY_CAP", "ALEPH_LIVE_CAP", "SIDETONE_TELL_URL"];
let base: string;
let saved: Record<string, string | undefined>;

// Each test gets its own factory repo, work store and registry, so the baseline and the goal list start empty.
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-factory-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    ALEPH_ITEMS: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"),
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

/** A new open item in the store's factory list `fac`, with the given labels; returns its id. */
const goal = (labels = ["goal"]): number =>
  writeList({ key: "fac" }, "add a goal", (doc) => todos.add(doc, "ship it", { labels, body: "Do the thing." }).id, true)!.value;

/** Change item `id` in the store, as Chris would while the baseline runs. */
const change = (id: number, f: (item: todos.Item) => void) =>
  writeList({ key: "fac" }, "edit", (doc) => { f(todos.find(doc, id)!); return true; });

test("a goal whose label is removed during the baseline is not started", async () => {
  const id = goal();
  const calls: string[] = [];
  let baselined = false;
  const out = await dispatchGoals(async (_repo, name) => { calls.push(name); return null; }, async () => {
    baselined = true;
    await change(id, (item) => todos.edit(item, { labels: [] }));
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
    await change(id, (item) => todos.setStatus(item, "done"));
    return null;
  });
  expect(calls).toEqual([]);
  expect(out.skipped).toEqual([]);
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

test("a land that failed 'job lock busy' does not hold the factory", () => {
  expect(hold([[entry("agent", "passed"), entry("land", "failed", "job lock busy")]])).toBeNull();
});

test("a land that failed for another reason holds the factory", () => {
  expect(hold([[entry("agent", "passed"), entry("land", "failed", "not landed")]])?.name).toBe("n1");
});

test("after a land that failed 'job lock busy' the passed agent run is waiting to land again", () => {
  const agent = entry("agent", "passed");
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
  writeRun(folder, { kind, job: id, name, repo: "fac", state, todo: Number(name.split("-")[1]), told: true, shown: true, started: new Date().toISOString(), ...extra } as Run);
  return { folder, job: extra.job ?? id };
}
const lines = (n: number) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
const notes = (id: number) => readList({ key: "fac" })!.items.find((i) => i.id === id)!.notes.join("\n");
const labels = (id: number) => (readList({ key: "fac" })!.items.find((i) => i.id === id)!.fm.labels as string[]) ?? [];

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
  const start = async (_r: unknown, name: string, _id: number, spec: string) => { calls.push(`start ${name}`); specs.push(spec); return null; };
  return { calls, rescue, land, specs, start };
}
const dispatch = (f: ReturnType<typeof fakes>) => dispatchGoals(f.start, async () => null, f.land, f.rescue);

test("no commit, the item already done: the run is dropped as a duplicate, once, and the factory is not held", async () => {
  const id = goal();
  await change(id, (item) => todos.setStatus(item, "done"));
  mk(`fac-${id}`, "agent", "stuck", { reason: "no commit" });
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
  const r = mk(`fac-${id}`, "agent", "stuck", { reason: "no commit" });
  sh(join(base, "repo"), "git", "commit", "-q", "--allow-empty", "-m", `the work\n\nJob: ${r.job}`);
  sh(join(base, "repo"), "git", "push", "-q", "origin", "main");
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`]);
  expect(notes(id)).toContain("on main: dropped as a duplicate");
  expect(todos.status(readList({ key: "fac" })!.items.find((i) => i.id === id)!)).toBe("done");
  expect(f.specs).toEqual([]);
});

test("no commit, the item open, first time: dropped and the goal reruns once, with the last 20 lines of result.md", async () => {
  const id = goal();
  mk(`fac-${id}`, "agent", "stuck", { reason: "no commit" }, { "result.md": lines(30) });
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

test("time box, first time: dropped and the goal reruns once, with the last 20 lines of result.md", async () => {
  const id = goal();
  mk(`fac-${id}`, "agent", "stuck", { reason: "time box" }, { "result.md": lines(25) });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(f.specs[0]).toContain("time box ran out");
  expect(f.specs[0]).toContain("line 6\n");
  expect(f.specs[0]).not.toContain("line 5\n");
  expect(notes(id)).toContain("time box ran out");
});

test("the second time-box stuck run on one goal gets needs-chris and no third run", async () => {
  const id = goal();
  mk(`fac-${id}`, "agent", "stuck", { reason: "time box" }, { "result.md": lines(3) });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  // The rerun runs, and ends in the time box again.
  mk(`fac-${id}`, "agent", "stuck", { reason: "time box" });
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(labels(id)).toContain("needs-chris");
  expect(notes(id)).toContain("needs-chris: fac-");
  expect(out.held).toBeUndefined();
  await dispatch(f);
  expect(f.calls).toHaveLength(2);
  expect(notes(id).match(/needs-chris:/g)).toHaveLength(1);
});

test("an infrastructure failure of an agent run is rechecked once; of a land, landed again once", async () => {
  const id = goal();
  sh(join(base, "repo"), "git", "branch", `factory/fac-${id}`);
  mk(`fac-${id}`, "agent", "failed", { reason: "fetch failed", branch: `factory/fac-${id}` });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`recheck fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(notes(id)).toContain("failed for infrastructure (fetch failed)");
  expect(notes(id)).toContain("rechecked, once");

  const id2 = goal();
  const a = mk(`fac-${id2}`, "agent", "passed", { land: true });
  mk(`fac-${id2}`, "land", "stuck", { reason: "bundle failed: no space", job: a.job });
  await dispatch(f);
  expect(f.calls).toEqual([`recheck fac-${id}`, `land fac-${id2}`]);
  expect(notes(id2)).toContain("landed again, once");
});

test("a second infrastructure failure of one goal gets needs-chris", async () => {
  const id = goal();
  const a = mk(`fac-${id}`, "agent", "passed", { land: true });
  mk(`fac-${id}`, "land", "stuck", { reason: "fetch failed", job: a.job });
  const f = fakes();
  await dispatch(f);
  expect(f.calls).toEqual([`land fac-${id}`]);
  // The land again fails the same way (the fake land started nothing, so the run still stands).
  const b = allJobs()[0];
  mk(`fac-${id}`, "land", "failed", { reason: "fetch failed", job: b[0].run.job });
  await dispatch(f);
  expect(f.calls).toEqual([`land fac-${id}`]);
  expect(labels(id)).toContain("needs-chris");
});

test("failed checks after a land merge, first time: dropped and the goal reruns once on the new main", async () => {
  const id = goal();
  const a = mk(`fac-${id}`, "agent", "passed", { land: true });
  mk(`fac-${id}`, "land", "stuck", { reason: "tests failed", job: a.job }, { "checks.log": `## tests: exit 1\n${lines(30)}` });
  const f = fakes();
  const out = await dispatch(f);
  expect(f.calls).toEqual([`drop fac-${id}`, `start fac-${id}`]);
  expect(out.held).toBeUndefined();
  expect(f.specs[0]).toContain("checks failed after the land merged main");
  expect(f.specs[0]).toContain("line 30");
  expect(notes(id)).toContain("checks failed after the land merged main");
});

test("a run that is not safe is labelled needs-chris with a question and does not hold the factory; another goal starts", async () => {
  const id = goal();
  const other = goal();
  mk(`fac-${id}`, "agent", "stuck", { reason: "tests failed after 2 fix rounds" });
  const f = fakes();
  const out = await dispatch(f);
  expect(labels(id)).toContain("needs-chris");
  expect(notes(id)).toContain("needs-chris: fac-");
  expect(out.held).toBeUndefined();
  expect(f.calls).toEqual([`start fac-${other}`]);
  expect(hold()).toBeNull();
  expect(readRun(allRuns()[0].folder)!.state).toBe("stuck");
});

test("without rescue actions a stuck run still holds the factory", async () => {
  const id = goal();
  mk(`fac-${id}`, "agent", "stuck", { reason: "time box" });
  const out = await dispatchGoals(async () => null, async () => null);
  expect(out.held).toContain("Held:");
});

test("a rescue that finds the lock taken waits, then acts once on the state it finds under the lock", async () => {
  const id = goal();
  const name = `fac-${id}`;
  const { folder } = mk(name, "agent", "stuck", { reason: "weird" });
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
  mk(name, "agent", "stuck", { reason: "time box" });
  const f = fakes();
  const slow = { ...f.rescue, drop: async (n: string, r: string) => { await Bun.sleep(300); return f.rescue.drop(n, r); } };
  await Promise.all([dispatchGoals(f.start, async () => null, f.land, slow), dispatchGoals(f.start, async () => null, f.land, slow)]);
  expect(f.calls.filter((c) => c.startsWith("drop"))).toEqual([`drop ${name}`]);
});

test("a rescue whose lock wait runs out skips the job and does not throw", async () => {
  const id = goal();
  const name = `fac-${id}`;
  mk(name, "agent", "stuck", { reason: "time box" });
  const release = (await lock(`rescue-fac-${name}`, 0))!;
  process.env.ALEPH_RESCUE_WAIT_MS = "200";
  try {
    const f = fakes();
    await dispatch(f);
    expect(f.calls).toEqual([]);
  } finally { delete process.env.ALEPH_RESCUE_WAIT_MS; release(); }
});
