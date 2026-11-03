// Archived goal tests from jobs/lib/status.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "../../../jobs/lib/git.ts";
import { facts, itemOnMain, repoStages, recentRepos } from "../../../jobs/lib/status.ts";
import { writeRun } from "../../../jobs/lib/ledger.ts";
import type { Repo, Run } from "../../../jobs/lib/ledger.ts";
import type { Doc, Issue } from "../../../todo/lib/todo.ts";

let base: string, remote: string, clone: string, repo: Repo;
const env = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sh = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(a, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${a.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
};
const closed = (status: string) => (status === "open" ? {} : { closed_as: status });
const item = (id: number, status: string): Issue => ({ id, title: `t${id}`, fm: closed(status) as Issue["fm"], request: "", spec: "", notes: [] });
const doc: Doc = { items: [item(1, "open"), item(2, "open"), item(3, "dropped"), item(4, "done")] };
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
  commit(other, "do it\n\nIssue: demo-1");
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
  const done: Doc = { items: [item(5, "done"), item(6, "done")] };
  const run = (job: string, kind: Run["kind"], todo: number | undefined, state: Run["condition"]) => {
    const folder = join(base, "jobs", job);
    mkdirSync(folder, { recursive: true });
    writeRun(folder, { kind, job, name: job, repo: "demo", ...(todo !== undefined ? { on: `demo-${todo}` } : {}), condition: state, told: true, shown: true, started: new Date().toISOString() });
  };
  run("20261028-000001-demo-5-triage", "triage", 5, "done");
  run("20261028-000002-demo-6-agent", "build", 6, "done");

  const f = facts(sandbox, done);
  expect(f.touched).toEqual([6]);
  const states = repoStages(sandbox, { fetch: false, doc: done, items: [5, 6] });
  expect(states.map((s) => [s.id, s.stage, s.why])).toEqual([
    ["demo-5", "done", "the store says done"],
    ["demo-6", "done", "the store says done"],
  ]);
});

test("a passed agent run whose later land found the job lock busy leaves the item running, not stuck", () => {
  const open: Doc = { items: [item(7, "open")] };
  const job = "20261028-000003-demo-7-agent";
  const write = (folder: string, run: Partial<Run>) => {
    mkdirSync(join(base, "jobs", folder), { recursive: true });
    writeRun(join(base, "jobs", folder), { kind: "build", job, name: job, repo: "demo", on: "demo-7", condition: "passed", told: true, shown: true, started: new Date().toISOString(), ...run } as Run);
  };
  write("20261028-000003-demo-7-agent", {});
  write("20261028-000004-demo-7-land", { kind: "land", condition: "failed", reason: "job lock busy" });

  expect(repoStages(repo, { fetch: false, doc: open, items: [7] }).map((s) => [s.id, s.stage, s.why])).toEqual([
    ["demo-7", "working", "its job is passed"],
  ]);
});

test("recentRepos keeps repos with an item updated in the last week, latest first", () => {
  const mk = (key: string): Repo => ({ ...repo, key });
  const at = (days: number) => ({ ...doc, items: [{ ...item(1, "open"), fm: { updated: new Date(Date.now() - days * 86400_000).toISOString() } }] });
  expect(recentRepos([mk("a"), mk("b"), mk("c")], [at(3), at(30), at(1)])).toEqual([2, 0]);
  expect(recentRepos([mk("a")], [null])).toEqual([]);
});

test("a commit with Issue and Goal trailers resolves for its goal", () => {
  const other = join(base, "other");
  sh(other, "git", "pull", "-q", "origin", "main");
  expect(itemOnMain(repo, "2.1")).toBeNull();
  commit(other, "goal work\n\nIssue: demo-2.1\nJob: j-goal");
  sh(other, "git", "push", "-q", "origin", "HEAD:main");
  sh(clone, "git", "fetch", "-q");
  expect(itemOnMain(repo, "2.1")).toMatch(/^[0-9a-f]{7}$/);
  expect(itemOnMain(repo, "2.2")).toBeNull();
});

test("a commit with Issue and a plain-number Goal trailer resolves for that old goal", () => {
  const other = join(base, "other");
  sh(other, "git", "pull", "-q", "origin", "main");
  expect(itemOnMain(repo, 7)).toBeNull();
  commit(other, "old goal work\n\nIssue: demo-7\nJob: j-old");
  sh(other, "git", "push", "-q", "origin", "HEAD:main");
  sh(clone, "git", "fetch", "-q");
  expect(itemOnMain(repo, 7)).toMatch(/^[0-9a-f]{7}$/);
});
