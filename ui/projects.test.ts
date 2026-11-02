import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../todo/lib/store.ts";
import { add } from "../todo/lib/todo.ts";
import { withEnv, withServer } from "./test-server.ts";
// @ts-ignore plain JS, shared with the page
// @ts-ignore plain JS, shared with the page
import { priorityBadge } from "./lib.js";
// @ts-ignore plain JS, shared with the page
import { view as oneView } from "./views/project.js";

let base: string, stop: () => void, restoreEnv: () => void, at: (path: string) => Promise<Response>;
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}
const note = (kind: string, scope: string, updated: string) =>
  `---\nkind: ${kind}\nscope: ${scope}\nconfidence: measured\nupdated: ${updated}\nsupersedes: []\nsources: []\n---\nbody\n`;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-projects-"));
  const jobs = join(base, "jobs"), factory = join(base, "factory"), vault = join(base, "vault");
  mkdirSync(jobs); mkdirSync(factory); mkdirSync(join(vault, "wiki"), { recursive: true });
  // fac: a factory repo whose checkout is one commit behind its (already fetched) origin/main.
  const fac = join(base, "fac"), plain = join(base, "plain");
  sh(base, "git", "init", "-q", "-b", "main", fac);
  sh(fac, "git", "remote", "add", "origin", "git@github.com:chris/fac.git");
  sh(fac, "git", "commit", "-q", "--allow-empty", "-m", "first");
  sh(fac, "git", "commit", "-q", "--allow-empty", "-m", "second\n\nIssue: fac-2");
  sh(fac, "git", "commit", "-q", "--allow-empty", "-m", "third\n\nIssue: fac-3.1\nJob: x");
  sh(fac, "git", "commit", "-q", "--allow-empty", "-m", "fourth\n\nGoal: fac-4.1");
  sh(fac, "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  sh(fac, "git", "reset", "-q", "--hard", "HEAD~1");
  sh(base, "git", "init", "-q", "-b", "main", plain);
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: fac, sandbox: true, checks: [] }, plain: { path: plain } }));
  const items = join(base, "items"), remote = join(base, "items.git");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", remote);
  sh(base, "git", "clone", "-q", remote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  writeFileSync(join(factory, "baseline.json"), JSON.stringify({ fac: { repo: "fac", commit: "abcdef1234", ok: false, failed: "tests" } }));
  const run = (id: string, o: object) => {
    mkdirSync(join(jobs, id));
    writeFileSync(join(jobs, id, "state.json"), JSON.stringify({ kind: "build", told: true, started: "2026-10-27T10:00:00Z", ...o }));
  };
  run("20261027-100000-a", { job: "fac-1", name: "fac-1", repo: "fac", condition: "landed", on: "fac-1", ended: "2026-10-27T11:00:00Z" });
  run("20261027-110000-a", { job: "fac-2", name: "fac-2", repo: "fac", condition: "running" });
  run("20261027-120000-a", { job: "plain-1", name: "plain-1", repo: "plain", condition: "landed", ended: "2026-10-27T13:00:00Z" });
  writeFileSync(join(vault, "wiki", "A fact.md"), note("concept", "fac", "2026-10-01"));
  writeFileSync(join(vault, "wiki", "B fact.md"), note("gotcha", "fac", "2026-10-20"));
  writeFileSync(join(vault, "wiki", "C fact.md"), note("concept", "plain", "2026-10-05"));
  restoreEnv = withEnv({ ...gitEnv, ALEPH_JOBS_DIR: jobs, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: items, ALEPH_FACTORY_DIR: factory, ALEPH_VAULT: vault });
  writeList({ key: "fac" }, "seed", (doc) => {
    add(doc, "a goal", { spec: "Do it.", priority: "critical" });
    add(doc, "plain issue");
    return true;
  }, true);
  ({ stop, at } = await withServer({ warm: false }));
});
afterAll(() => {
  stop();
  restoreEnv();
  rmSync(base, { recursive: true, force: true });
});

test("/api/projects/<key> counts, behind, baseline and notes", async () => {
  const fac: any = await (await at("/api/projects/fac")).json();
  expect(fac).toMatchObject({ factory: true, openItems: 2, openGoals: 1, behind: 1, notes: 2, baseline: { commit: "abcdef1234", ok: false, failed: "tests" } });
  expect(fac.lastLanded).toEqual({ name: "fac-1", at: "2026-10-27T11:00:00Z" });
  const plain: any = await (await at("/api/projects/plain")).json();
  expect(plain).toMatchObject({ factory: false, openItems: 0, openGoals: 0, behind: null, baseline: null, notes: 1 });
});

test("/api/projects/<key> adds commits with their Issue trailer, issues, jobs and notes", async () => {
  const d: any = await (await at("/api/projects/fac")).json();
  expect(d.commits.map((c: any) => [c.subject, c.item])).toEqual([["fourth", null], ["third", "fac-3.1"], ["second", "fac-2"], ["first", null]]);
  expect(d.commits[0].commitUrl).toBe(`https://github.com/chris/fac/commit/${d.commits[0].hash}`);
  expect(d.items.map((i: any) => i.title)).toEqual(["a goal", "plain issue"]);
  expect(d.jobs.map((j: any) => j.name)).toEqual(["fac-2", "fac-1"]);
  expect(d.vault.map((n: any) => [n.title, n.kind, n.updated])).toEqual([["B fact", "gotcha", "2026-10-20"], ["A fact", "concept", "2026-10-01"]]);
  expect((await at("/api/projects/nope")).status).toBe(404);
});

test("/api/projects/<key> gives a job's item from its on (a dotted on stays a string), else its todo", async () => {
  const runs: [string, object][] = [
    ["20261001-100000-b", { job: "plain-on", name: "plain-on", repo: "plain", condition: "running", on: "plain-7" }],
    ["20261001-110000-b", { job: "plain-goal", name: "plain-goal", repo: "plain", condition: "running", on: "plain-8.1" }],
    ["20261001-120000-b", { job: "plain-todo", name: "plain-todo", repo: "plain", condition: "running", on: "plain-9" }],
  ];
  for (const [id, o] of runs) {
    mkdirSync(join(base, "jobs", id));
    writeFileSync(join(base, "jobs", id, "state.json"), JSON.stringify({ kind: "build", told: true, started: "2026-10-01T10:00:00Z", ...o }));
  }
  try {
    const d: any = await (await at("/api/projects/plain")).json();
    const item = (name: string) => d.jobs.find((j: any) => j.name === name).item;
    expect(item("plain-on")).toBe(7);
    expect(item("plain-goal")).toBe("8.1");
    expect(item("plain-todo")).toBe(9);
    expect(item("plain-1")).toBeNull();
  } finally {
    for (const [id] of runs) rmSync(join(base, "jobs", id), { recursive: true, force: true });
  }
});

test("?project= narrows every route", async () => {
  expect((await at("/api/projects/fac?project=fac")).status).toBe(200);
  expect((await at("/api/projects/fac?project=plain")).status).toBe(404);
});

test("the view renders the detail", async () => {
  expect(oneView.path).toBe("/projects/:key");
  const d = oneView.render(await (await at("/api/projects/fac")).json());
  for (const t of ["second", "fac-2", "a goal", "B fact"]) expect(d).toContain(t);
  expect(d).toContain(priorityBadge("critical"));
  expect(d).toContain(priorityBadge("medium"));
});

