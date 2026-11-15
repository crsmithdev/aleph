import { afterAll, afterEach, beforeAll, beforeEach, expect, setSystemTime, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { facts, onMain, repoStages } from "./status.ts";
import type { Repo } from "./ledger.ts";
import { seed } from "../../job.testkit.ts";
import { logEvent } from "../../../lib/layout.ts";
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
  process.env.ALEPH_DB = join(base, "aleph.db");
  remote = join(base, "remote.git");
  clone = join(base, "clone");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, clone);
  commit(clone, "first");
  sh(clone, "git", "push", "-q", "origin", "HEAD:main");
  sh(clone, "git", "fetch", "-q");
  repo = { key: "demo", n: 1, path: clone, main: "main", setup: [], checks: [], manual: [], autoland: true, sandbox: false, held: [] };
});
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("a touched item the store closed is done without a fresh trailer commit, and a revert does not undo it", () => {
  const sandbox: Repo = { ...repo, sandbox: true };
  const closed: Doc = { items: [item(11, "done"), item(12, "done"), item(13, "done")] };
  for (const n of [11, 12, 13]) {
    seed({ role: "build", name: `issue.${n}`, repo: "demo", target: `issue.${n}`, state: "done", shown: true, started: STARTED });
  }
  // 12: landed.
  sh(clone, "git", "fetch", "-q");
  sh(clone, "git", "reset", "-q", "--hard", "origin/main");
  commit(clone, "land 12\n\nIssue: issue.12");
  // 13: landed, then reverted.
  commit(clone, "land 13\n\nIssue: issue.13");
  sh(clone, "git", "revert", "--no-edit", "HEAD");
  sh(clone, "git", "push", "-q", "origin", "HEAD:main");
  const states = (items?: number[]) => repoStages(sandbox, { fetch: true, doc: closed, items }).map((s) => [s.id, s.stage]);
  expect(states()).toEqual([["demo-11", "done"], ["demo-12", "done"], ["demo-13", "done"]]);
  expect(states([11])).toEqual([["demo-11", "done"]]);
  expect(states([13])).toEqual([["demo-13", "done"]]);
});

test("facts carry what stage() needs: status, spec, parts, ask kind and each job's last run", () => {
  const doc: Doc = { items: [
    { ...item(21, "open"), spec: "s", fm: { after: ["issue.22"] } },
    { ...item(22, "open"), fm: {} },
    { id: 23, title: "p", fm: { from: "issue.22" }, request: "", spec: "s", notes: [] },
  ] };
  const built = seed({ role: "build", name: "issue.21", repo: "demo", target: "issue.21", state: "waiting", ask: { reason: "question", question: "?", options: [], why: [] }, shown: true, started: STARTED });
  const f = facts(repo, doc);
  // The run owns the issue's one Ask, so the issue has none of its own.
  expect(f.items[21]).toMatchObject({ id: "demo-21", status: "open", spec: true, parts: [] });
  expect(f.items[21].ask).toBeUndefined();
  expect(f.items[22]).toMatchObject({ parts: ["demo-23"] });
  expect(f.runs[21]).toEqual([{ id: built.id, kind: "build", state: "waiting", open: true, ask: { reason: "question" } }]);
});

test("a child's from and after resolve to the issues, their runs and their status", () => {
  const child = (id: number, fm: Record<string, unknown>) => ({ id, title: `g${id}`, fm: { from: "issue.5", ...fm } as Issue["fm"], request: "", spec: "s", notes: [] });
  const mk = (g1: string): Doc => ({
    items: [
      { ...item(5, "open"), fm: {} },
      child(6, closed(g1)),
      child(7, { after: ["issue.6"] }),
    ],
  });
  const built = seed({ role: "build", name: "issue.6", repo: "demo", target: "issue.6", state: "running", shown: true, started: STARTED });

  logEvent({ subject: "gate", action: "held", object: "issue.7", detail: "after: issue.6" });
  const open = mk("open");
  const f = facts(repo, open);
  expect(f.items[6]).toMatchObject({ id: "demo-6", status: "open" });
  expect(f.runs[6]).toEqual([{ id: built.id, kind: "build", state: "running", open: true }]);
  const st = (items: number[], doc = open) => repoStages(repo, { fetch: false, doc, items });
  expect(st([6]).map((s) => ({ id: s.id, stage: s.stage }))).toEqual([{ id: "demo-6", stage: "working" }]);
  const blocked = st([7])[0];
  expect(blocked.stage).toBe("held");
  expect(blocked.why).toBe("issue.7 held: after issue.6");
  const issue = st([5])[0];
  expect(issue.stage).toBe("working");
  expect(issue.of).toEqual({ n: 0, m: 2 });
  expect(repoStages(repo, { fetch: false, doc: open }).map((s) => s.id)).toEqual(["demo-5", "demo-6", "demo-7"]);

  const done = mk("done");
  // The hold lasts until a start: a done blocker does not end it.
  expect(st([7], done)[0].stage).toBe("held");
  logEvent({ subject: "rule", action: "started", object: "issue.7", detail: "model default" });
  expect(st([7], done)[0].stage).toBe("queued");
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
    expect(onMain(r, { jobs: ["job.99"], item: 7, branch: "work", fetch: false })).toBeNull();
    // A commit pushed after the last fetch is seen only with fetch.
    commit(other, "by job\n\nJob: job.1");
    sh(other, "git", "push", "-q", "origin", "HEAD:main");
    expect(onMain(r, { jobs: ["job.1"], fetch: false })).toBeNull();
    const byJob = onMain(r, { jobs: ["job.1"], fetch: true });
    expect(byJob?.how).toBe("Job trailer");
    expect(byJob?.commit).toBe(sh(other, "git", "rev-parse", "HEAD"));
    commit(other, "by item\n\nIssue: issue.5");
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
