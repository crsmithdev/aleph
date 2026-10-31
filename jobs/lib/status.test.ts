import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.ts";
import { facts, itemOnMain, repoStages, recentRepos } from "./status.ts";
import { writeRun } from "./ledger.ts";
import type { Repo, Run } from "./ledger.ts";
import type { Doc } from "../../todo/lib/todo.ts";

let base: string, remote: string, clone: string, repo: Repo;
const env = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sh = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(a, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${a.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
};
const item = (id: number, status: string) => ({ id, title: `t${id}`, fm: { status }, body: "", notes: [], legacy: false });
const doc: Doc = { head: "", items: [item(1, "open"), item(2, "open"), item(3, "dropped"), item(4, "done")] };
const commit = (cwd: string, msg: string) => { writeFileSync(join(cwd, msg.replace(/\W/g, "_")), msg); sh(cwd, "git", "add", "-A"); sh(cwd, "git", "commit", "-qm", msg); };

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "status-"));
  process.env.ALEPH_JOBS_DIR = join(base, "jobs");
  remote = join(base, "remote.git");
  clone = join(base, "clone");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, clone);
  commit(clone, "first");
  sh(clone, "git", "push", "-q", "origin", "HEAD:main");
  sh(clone, "git", "fetch", "-q");
  repo = { key: "demo", path: clone, main: "main", setup: [], checks: [], manual: [], autoland: true, sandbox: false, held: [], hiddenRun: "" };
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("without a fetch, the states read origin/main as it is; with one, they see what landed", () => {
  const other = join(base, "other");
  sh(base, "git", "clone", "-q", remote, other);
  commit(other, "do it\n\nItem: demo-1");
  sh(other, "git", "push", "-q", "origin", "HEAD:main");

  const before = repoStages(repo, { fetch: false, doc });
  expect(before.map((s) => [s.id, s.stage])).toEqual([["demo-1", "new"], ["demo-2", "new"], ["demo-3", "dropped"], ["demo-4", "done"]]);

  const after = repoStages(repo, { fetch: true, doc });
  expect(after.map((s) => [s.id, s.stage])).toEqual([["demo-1", "done"], ["demo-2", "new"], ["demo-3", "dropped"], ["demo-4", "done"]]);
  expect(after[0].why).toMatch(/^commit [0-9a-f]{7} on origin\/main$/);
  expect(after[3].why).toBe("the store says done");
});

test("items picks which states come back, and an item the store lacks is left out", () => {
  expect(repoStages(repo, { fetch: false, doc, items: [2] }).map((s) => s.id)).toEqual(["demo-2"]);
  expect(repoStages(repo, { fetch: false, doc, items: [1, 9, 2] }).map((s) => s.id)).toEqual(["demo-1", "demo-2"]);
  expect(repoStages(repo, { fetch: false, doc, items: [9] })).toEqual([]);
});

test("a reverted commit does not make the item done", () => {
  sh(clone, "git", "fetch", "-q");
  const sha = git(clone, "rev-parse", "origin/main").out;
  sh(clone, "git", "reset", "-q", "--hard", "origin/main");
  sh(clone, "git", "revert", "--no-edit", sha);
  sh(clone, "git", "push", "-q", "origin", "HEAD:main");
  expect(repoStages(repo, { fetch: true, doc, items: [1] })[0].stage).toBe("new");
});

test("a triage run does not make its item touched; an agent run does, and the store's done still stands", () => {
  const sandbox: Repo = { ...repo, sandbox: true };
  const done: Doc = { head: "", items: [item(5, "done"), item(6, "done")] };
  const run = (job: string, kind: Run["kind"], todo: number, state: Run["state"]) => {
    const folder = join(base, "jobs", job);
    mkdirSync(folder, { recursive: true });
    writeRun(folder, { kind, job, name: job, repo: "demo", todo, state, told: true, shown: true, started: new Date().toISOString() });
  };
  run("20261028-000001-demo-5-triage", "triage", 5, "done");
  run("20261028-000002-demo-6-agent", "agent", 6, "done");

  const f = facts(sandbox, done);
  expect(f.touched).toEqual([6]);
  const states = repoStages(sandbox, { fetch: false, doc: done, items: [5, 6] });
  expect(states.map((s) => [s.id, s.stage, s.why])).toEqual([
    ["demo-5", "done", "the store says done"],
    ["demo-6", "done", "the store says done"],
  ]);
});

test("a passed agent run whose later land found the job lock busy leaves the item running, not stuck", () => {
  const open: Doc = { head: "", items: [item(7, "open")] };
  const job = "20261028-000003-demo-7-agent";
  const write = (folder: string, run: Partial<Run>) => {
    mkdirSync(join(base, "jobs", folder), { recursive: true });
    writeRun(join(base, "jobs", folder), { kind: "agent", job, name: job, repo: "demo", todo: 7, state: "passed", told: true, shown: true, started: new Date().toISOString(), ...run } as Run);
  };
  write("20261028-000003-demo-7-agent", {});
  write("20261028-000004-demo-7-land", { kind: "land", state: "failed", reason: "job lock busy" });

  expect(repoStages(repo, { fetch: false, doc: open, items: [7] }).map((s) => [s.id, s.stage, s.why])).toEqual([
    ["demo-7", "building", "its job is passed"],
  ]);
});

test("recentRepos keeps repos with an item updated in the last week, latest first", () => {
  const mk = (key: string): Repo => ({ ...repo, key });
  const at = (days: number) => ({ ...doc, items: [{ ...item(1, "open"), fm: { status: "open", updated: new Date(Date.now() - days * 86400_000).toISOString() } }] });
  expect(recentRepos([mk("a"), mk("b"), mk("c")], [at(3), at(30), at(1)])).toEqual([2, 0]);
  expect(recentRepos([mk("a")], [null])).toEqual([]);
});

test("a touched item the store closed is done without a fresh trailer commit, unless a revert undid its trailer", () => {
  const sandbox: Repo = { ...repo, sandbox: true };
  const closed: Doc = { head: "", items: [item(11, "done"), item(12, "done"), item(13, "done")] };
  for (const n of [11, 12, 13]) {
    const folder = join(base, "jobs", `20261028-0001${n}-demo-${n}-agent`);
    mkdirSync(folder, { recursive: true });
    writeRun(folder, { kind: "agent", job: `j${n}`, name: `j${n}`, repo: "demo", todo: n, state: "done", told: true, shown: true, started: new Date().toISOString() });
  }
  // 12: its trailer commit is at or before the acceptance since.
  sh(clone, "git", "fetch", "-q");
  sh(clone, "git", "reset", "-q", "--hard", "origin/main");
  commit(clone, "land 12\n\nItem: demo-12");
  const since = sh(clone, "git", "rev-parse", "HEAD");
  // 13: landed, then reverted.
  commit(clone, "land 13\n\nItem: demo-13");
  sh(clone, "git", "revert", "--no-edit", "HEAD");
  sh(clone, "git", "push", "-q", "origin", "HEAD:main");
  process.env.ALEPH_FACTORY_DIR = join(base, "factory");
  mkdirSync(join(base, "factory", "acceptance"), { recursive: true });
  writeFileSync(join(base, "factory", "acceptance", "demo-12.json"), JSON.stringify({ result: "fail", fails: 1, since }));
  const states = (items?: number[]) => repoStages(sandbox, { fetch: true, doc: closed, items }).map((s) => [s.id, s.stage]);
  expect(states()).toEqual([["demo-11", "done"], ["demo-12", "done"], ["demo-13", "new"]]);
  expect(states([11])).toEqual([["demo-11", "done"]]);
  expect(states([13])).toEqual([["demo-13", "new"]]);
});

test("facts carry what stage() needs: status, kind, after, goals, ask kind and each job's last run", () => {
  const doc: Doc = { head: "", items: [
    { ...item(21, "open"), fm: { status: "open", kind: "goal", after: ["demo-22"], ask: "approval", reason: "review" } },
    { ...item(22, "open"), fm: { status: "open", labels: ["planned"], waiting_on: "demo-21" } },
  ] };
  const folder = join(base, "jobs", "20261028-000021-demo-21-build");
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "build", job: "j21", name: "j21", repo: "demo", on: "demo-21", state: "awaiting", ask: { kind: "input", reason: "question", question: "?", options: [], why: [] }, told: true, shown: true, started: new Date().toISOString() });
  const f = facts(repo, doc);
  expect(f.items[21]).toMatchObject({ id: "demo-21", status: "open", kind: "goal", after: ["demo-22"], goals: [], ask: { kind: "approval", reason: "review" } });
  expect(f.items[22]).toMatchObject({ kind: "issue", goals: ["demo-21"], after: [] });
  expect(f.runs[21]).toEqual([{ kind: "build", state: "awaiting", open: true, ask: { kind: "input", reason: "question" } }]);
});

test("a commit with Issue and Goal trailers resolves for its goal", () => {
  const other = join(base, "other");
  sh(other, "git", "pull", "-q", "origin", "main");
  expect(itemOnMain(repo, "2.1")).toBeNull();
  commit(other, "goal work\n\nIssue: demo-2\nGoal: demo-2.1\nJob: j-goal");
  sh(other, "git", "push", "-q", "origin", "HEAD:main");
  sh(clone, "git", "fetch", "-q");
  expect(itemOnMain(repo, "2.1")).toMatch(/^[0-9a-f]{7}$/);
  expect(itemOnMain(repo, "2.2")).toBeNull();
});

test("a commit with Issue and a plain-number Goal trailer resolves for that old goal", () => {
  const other = join(base, "other");
  sh(other, "git", "pull", "-q", "origin", "main");
  expect(itemOnMain(repo, 7)).toBeNull();
  commit(other, "old goal work\n\nIssue: demo-2\nGoal: demo-7\nJob: j-old");
  sh(other, "git", "push", "-q", "origin", "HEAD:main");
  sh(clone, "git", "fetch", "-q");
  expect(itemOnMain(repo, 7)).toMatch(/^[0-9a-f]{7}$/);
});
