import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { git } from "./git.ts";
import { itemStates, recentRepos } from "./status.ts";
import type { Repo } from "./ledger.ts";
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

  const before = itemStates(repo, { fetch: false, doc });
  expect(before.map((s) => [s.item, s.state])).toEqual([["demo-1", "open"], ["demo-2", "open"], ["demo-3", "dropped"], ["demo-4", "done"]]);

  const after = itemStates(repo, { fetch: true, doc });
  expect(after.map((s) => [s.item, s.state])).toEqual([["demo-1", "done"], ["demo-2", "open"], ["demo-3", "dropped"], ["demo-4", "done"]]);
  expect(after[0].why).toMatch(/^commit [0-9a-f]{7} on origin\/main$/);
  expect(after[3].why).toBe("the store says done");
});

test("items picks which states come back, and an item the store lacks is left out", () => {
  expect(itemStates(repo, { fetch: false, doc, items: [2] }).map((s) => s.item)).toEqual(["demo-2"]);
  expect(itemStates(repo, { fetch: false, doc, items: [1, 9, 2] }).map((s) => s.item)).toEqual(["demo-1", "demo-2"]);
  expect(itemStates(repo, { fetch: false, doc, items: [9] })).toEqual([]);
});

test("a reverted commit does not make the item done", () => {
  sh(clone, "git", "fetch", "-q");
  const sha = git(clone, "rev-parse", "origin/main").out;
  sh(clone, "git", "reset", "-q", "--hard", "origin/main");
  sh(clone, "git", "revert", "--no-edit", sha);
  sh(clone, "git", "push", "-q", "origin", "HEAD:main");
  expect(itemStates(repo, { fetch: true, doc, items: [1] })[0].state).toBe("open");
});

test("recentRepos keeps repos with an item updated in the last week, latest first", () => {
  const mk = (key: string): Repo => ({ ...repo, key });
  const at = (days: number) => ({ ...doc, items: [{ ...item(1, "open"), fm: { status: "open", updated: new Date(Date.now() - days * 86400_000).toISOString() } }] });
  expect(recentRepos([mk("a"), mk("b"), mk("c")], [at(3), at(30), at(1)])).toEqual([2, 0]);
  expect(recentRepos([mk("a")], [null])).toEqual([]);
});
