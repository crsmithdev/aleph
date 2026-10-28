import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../../todo/lib/store.ts";
import * as todos from "../../todo/lib/todo.ts";
import { dispatchGoals, hold, waitingToLand } from "./factory.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

const KEYS = ["ALEPH_ITEMS", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR", "ALEPH_DAY_CAP", "ALEPH_LIVE_CAP"];
let base: string;
let saved: Record<string, string | undefined>;

// Each test gets its own factory repo, work store and registry, so the baseline and the goal list start empty.
beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-factory-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    ALEPH_ITEMS: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"),
    ALEPH_FACTORY_DIR: join(base, "factory"), XDG_RUNTIME_DIR: join(base, "run"), ALEPH_DAY_CAP: "100", ALEPH_LIVE_CAP: "5",
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
  expect(out.skipped).toEqual([`fac-${id}: not a goal`]);
});

test("a goal closed during the baseline is not started", async () => {
  const id = goal();
  const calls: string[] = [];
  const out = await dispatchGoals(async (_repo, name) => { calls.push(name); return null; }, async () => {
    await change(id, (item) => todos.setStatus(item, "done"));
    return null;
  });
  expect(calls).toEqual([]);
  expect(out.skipped).toEqual([`fac-${id}: not a goal`]);
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
