import { afterAll, afterEach, beforeAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { facts, onMain, repoStages } from "./status.ts";
import { writeRun } from "./ledger.ts";
import type { Repo, Run } from "./ledger.ts";
import type { Doc, Issue } from "../../../issues/lib/todo.ts";

// The test's clock: the recent-runs window reads it.
const NOW = Date.parse("2026-11-04T12:00:00Z");
const STARTED = new Date(NOW).toISOString();
beforeEach(() => setSystemTime(NOW));
afterEach(() => setSystemTime());

let base: string, remote: string, clone: string, repo: Repo;
const env = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const sh = (cwd: string, ...a: string[]) => {
  const p = Bun.spawnSync(a, { cwd, env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${a.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
};
const closed = (status: string) => (status === "open" ? {} : { closed_as: status });
const item = (id: number, status: string): Issue => ({ id, title: `t${id}`, fm: closed(status) as Issue["fm"], request: "", spec: "", notes: [] });
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
  repo = { key: "demo", path: clone, main: "main", setup: [], checks: [], manual: [], autoland: true, sandbox: false, held: [] };
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("a touched item the store closed is done without a fresh trailer commit, unless a revert undid its trailer", () => {
  const sandbox: Repo = { ...repo, sandbox: true };
  const closed: Doc = { items: [item(11, "done"), item(12, "done"), item(13, "done")] };
  for (const n of [11, 12, 13]) {
    const folder = join(base, "jobs", `20261028-0001${n}-demo-${n}-agent`);
    mkdirSync(folder, { recursive: true });
    writeRun(folder, { kind: "build", job: `j${n}`, name: `j${n}`, repo: "demo", on: `demo-${n}`, condition: "done", told: true, shown: true, started: STARTED });
  }
  // 12: landed.
  sh(clone, "git", "fetch", "-q");
  sh(clone, "git", "reset", "-q", "--hard", "origin/main");
  commit(clone, "land 12\n\nIssue: demo-12");
  // 13: landed, then reverted.
  commit(clone, "land 13\n\nIssue: demo-13");
  sh(clone, "git", "revert", "--no-edit", "HEAD");
  sh(clone, "git", "push", "-q", "origin", "HEAD:main");
  const states = (items?: number[]) => repoStages(sandbox, { fetch: true, doc: closed, items }).map((s) => [s.id, s.stage]);
  expect(states()).toEqual([["demo-11", "done"], ["demo-12", "done"], ["demo-13", "new"]]);
  expect(states([11])).toEqual([["demo-11", "done"]]);
  expect(states([13])).toEqual([["demo-13", "new"]]);
});

test("facts carry what stage() needs: status, spec, after, parts, ask kind and each job's last run", () => {
  const doc: Doc = { items: [
    { ...item(21, "open"), spec: "s", fm: { after: ["demo-22"] } },
    { ...item(22, "open"), fm: {} },
    { id: 22, sub: 1, title: "p", fm: {}, request: "", spec: "s", notes: [] },
  ] };
  const folder = join(base, "jobs", "20261028-000021-demo-21-build");
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "build", job: "j21", name: "j21", repo: "demo", on: "demo-21", condition: "waiting", ask: { kind: "input", reason: "question", question: "?", options: [], why: [] }, told: true, shown: true, started: STARTED });
  const f = facts(repo, doc);
  // The run owns the issue's one Ask, so the issue has none of its own.
  expect(f.items[21]).toMatchObject({ id: "demo-21", status: "open", spec: true, after: ["demo-22"], parts: [] });
  expect(f.items[21].ask).toBeUndefined();
  expect(f.items[22]).toMatchObject({ parts: ["demo-22.1"], after: [] });
  expect(f.runs[21]).toEqual([{ kind: "build", condition: "waiting", open: true, ask: { kind: "input", reason: "question" } }]);
});

test("a dotted ref in after, parts and on resolves to the goal, its runs and its status", () => {
  const part = (sub: number, fm: Record<string, unknown>) => ({ id: 5, sub, title: `g${sub}`, fm: { ...fm } as Issue["fm"], request: "", spec: "s", notes: [] });
  const mk = (g1: string): Doc => ({
    items: [
      { ...item(5, "open"), fm: {} },
      part(1, closed(g1)),
      part(2, { after: ["demo-5.1"] }),
    ],
  });
  const folder = join(base, "jobs", "20261030-000001-demo-5.1-build");
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "build", job: "dotted-build", name: "dotted-build", repo: "demo", on: "demo-5.1", condition: "running", told: true, shown: true, started: STARTED } as Run);

  const open = mk("open");
  const f = facts(repo, open);
  expect(f.items["5.1"]).toBeDefined();
  expect(f.runs["5.1"]).toBeDefined();
  const st = (items: (number | string)[], doc = open) => repoStages(repo, { fetch: false, doc, items });
  expect(st(["5.1"]).map((s) => ({ id: s.id, stage: s.stage }))).toEqual([{ id: "demo-5.1", stage: "working" }]);
  const blocked = st(["5.2"])[0];
  expect(blocked.stage).toBe("held");
  expect(blocked.why).toContain("demo-5.1");
  const issue = st([5])[0];
  expect(issue.stage).toBe("working");
  expect(issue.of).toEqual({ n: 0, m: 2 });
  // the default lists plain items only
  expect(repoStages(repo, { fetch: false, doc: open }).map((s) => s.id)).toEqual(["demo-5", "demo-5.1", "demo-5.2"]);

  const done = mk("done");
  expect(st(["5.2"], done)[0].stage).toBe("queued");
  expect(st([5], done)[0].of).toEqual({ n: 1, m: 2 });
});

test("onMain finds a Job trailer, an Issue trailer and a branch's content, and fetches only when asked", () => {
  const b = mkdtempSync(join(tmpdir(), "onmain-"));
  try {
    const bare = join(b, "o.git"), me = join(b, "me"), other = join(b, "other");
    sh(b, "git", "init", "-q", "--bare", "-b", "main", bare);
    sh(b, "git", "clone", "-q", bare, me);
    commit(me, "first");
    sh(me, "git", "push", "-q", "origin", "HEAD:main");
    sh(b, "git", "clone", "-q", bare, other);
    const r = { path: me, key: "demo", main: "main" };
    // A branch with new work is not on main.
    sh(me, "git", "checkout", "-q", "-b", "work");
    commit(me, "new work");
    expect(onMain(r, { job: "j-new", item: 7, branch: "work", fetch: false })).toBeNull();
    // A commit pushed after the last fetch is seen only with fetch.
    commit(other, "by job\n\nJob: j-1");
    sh(other, "git", "push", "-q", "origin", "HEAD:main");
    expect(onMain(r, { job: "j-1", fetch: false })).toBeNull();
    const byJob = onMain(r, { job: "j-1", fetch: true });
    expect(byJob?.how).toBe("Job trailer");
    expect(byJob?.commit).toBe(sh(other, "git", "rev-parse", "HEAD"));
    commit(other, "by item\n\nIssue: demo-5");
    sh(other, "git", "push", "-q", "origin", "HEAD:main");
    const byItem = onMain(r, { item: 5, fetch: true });
    expect(byItem).toEqual({ commit: sh(other, "git", "rev-parse", "--short=7", "HEAD"), how: "Issue trailer" });
    // The branch's change is already in main's tree: content.
    sh(me, "git", "checkout", "-q", "-b", "same", "origin/main");
    writeFileSync(join(me, "same.txt"), "same");
    sh(me, "git", "add", "-A"); sh(me, "git", "commit", "-qm", "same change");
    sh(other, "git", "pull", "-q", "origin", "main");
    writeFileSync(join(other, "same.txt"), "same");
    sh(other, "git", "add", "-A"); sh(other, "git", "commit", "-qm", "same change by hand");
    sh(other, "git", "push", "-q", "origin", "HEAD:main");
    const same = onMain(r, { branch: "same", fetch: true });
    expect(same).toEqual({ commit: sh(other, "git", "rev-parse", "HEAD"), how: "content" });
  } finally { rmSync(b, { recursive: true, force: true }); }
});
