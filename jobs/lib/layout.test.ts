import { afterAll, beforeAll, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI } from "../cli.helpers.ts";
import { renderItem } from "../../todo/lib/todo.ts";
import { config, storeDir } from "../../todo/lib/store.ts";
import { runsDir } from "./ledger.ts";
import { layout } from "./layout.ts";
import { sandboxDir } from "./sandbox.ts";

// A temporary HOME and no layout variables: the paths follow what is on disk.
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const VARS = ["ALEPH_ITEMS", "ALEPH_ISSUES", "ALEPH_JOBS_DIR", "ALEPH_RUNS_DIR", "ALEPH_SANDBOX_DIR", "ALEPH_FACTORY_DIR", "ALEPH_REPOS", "ALEPH_BACKUPS_DIR"];
let home: string, a: string;
const saved: Record<string, string | undefined> = {};

function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}
async function aleph(...args: string[]) {
  const env: Record<string, string | undefined> = { ...process.env, ...gitEnv, HOME: home };
  for (const k of VARS) delete env[k];
  const p = Bun.spawn(["bun", CLI, ...args], { env, stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  const [stdout, stderr] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text()]);
  return { code: await p.exited, stdout, stderr };
}

beforeAll(() => {
  home = mkdtempSync(join(tmpdir(), "aleph-layout-"));
  a = join(home, ".aleph");
  for (const k of [...VARS, "HOME"]) saved[k] = process.env[k];
  for (const k of VARS) delete process.env[k];
  process.env.HOME = home;
  sh(home, "git", "init", "-q", "--bare", "-b", "main", join(a, "items.git"));
  sh(home, "git", "clone", "-q", join(a, "items.git"), join(a, "items"));
  const tasks = join(a, "items", "aleph", "backlog", "tasks");
  mkdirSync(tasks, { recursive: true });
  writeFileSync(join(a, "items", "aleph", "backlog", "config.yml"), config("aleph"));
  const task = { id: 1, title: "the one issue", fm: { id: "1", status: "open", created: "2026-10-01", updated: "2026-10-02", priority: "medium", labels: [], }, body: "Body.", notes: [], legacy: false };
  writeFileSync(join(tasks, "aleph-1.md"), renderItem("aleph", task as any));
  sh(join(a, "items"), "git", "add", "-A");
  sh(join(a, "items"), "git", "commit", "-q", "-m", "one");
  sh(join(a, "items"), "git", "push", "-q", "origin", "main");
  const run = join(a, "jobs", "20261030-100000-aleph-j1-agent");
  mkdirSync(run, { recursive: true });
  writeFileSync(join(run, "state.json"), JSON.stringify({ job: "20261030-100000-aleph-j1-agent", name: "j1", repo: "aleph", kind: "build", state: "failed", told: true, started: "2026-10-30T10:00:00Z" }, null, 2) + "\n");
  mkdirSync(join(a, "runs", "sandbox-run"), { recursive: true });
  mkdirSync(join(a, "factory"), { recursive: true });
  writeFileSync(join(a, "factory", "paused"), "");
  mkdirSync(join(home, "repo"));
  sh(join(home, "repo"), "git", "init", "-q", "-b", "main");
  sh(join(home, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(home, "repo"), "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  writeFileSync(join(a, "repos.json"), JSON.stringify({ aleph: { path: join(home, "repo"), sandbox: true } }));
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(home, { recursive: true, force: true });
});

test("layout() names the new layout only; the migration moves the old roots there and the CLI reads the migrated data", async () => {
  const fresh = { store: join(a, "issues"), ledger: join(a, "runs"), sandbox: join(a, "sandbox") };
  expect(layout()).toEqual(fresh);
  expect([storeDir(), runsDir(), sandboxDir()]).toEqual([fresh.store, fresh.ledger, fresh.sandbox]);

  const done = await aleph("migrate", "--apply");
  if (done.code !== 0) console.log(done.stderr, done.stdout);
  expect(done.code).toBe(0);
  expect(existsSync(join(a, "issues"))).toBe(true);

  expect(layout()).toEqual({ store: join(a, "issues"), ledger: join(a, "runs"), sandbox: join(a, "sandbox") });
  expect([storeDir(), runsDir(), sandboxDir()]).toEqual([join(a, "issues"), join(a, "runs"), join(a, "sandbox")]);

  const list = await aleph("issue", "list", "aleph");
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("the one issue");
  const jobs = await aleph("jobs");
  expect(jobs.code).toBe(0);
  expect(jobs.stdout).toContain("j1");
});

test("the environment wins, variable by variable; ALEPH_RUNS_DIR is not read", () => {
  const set = (o: Record<string, string>) => { for (const [k, v] of Object.entries(o)) process.env[k] = v; };
  try {
    set({ ALEPH_RUNS_DIR: "/x/runs" });
    expect(layout()).toEqual({ store: join(a, "issues"), ledger: join(a, "runs"), sandbox: join(a, "sandbox") });
    set({ ALEPH_ISSUES: "/x/issues", ALEPH_JOBS_DIR: "/x/jobs", ALEPH_SANDBOX_DIR: "/x/sandbox" });
    expect(layout()).toEqual({ store: "/x/issues", ledger: "/x/jobs", sandbox: "/x/sandbox" });
  } finally { for (const k of VARS) delete process.env[k]; }
});

test("migrate roots() takes the source store from ALEPH_ITEMS, not ALEPH_ISSUES, when both are set", async () => {
  const keep = { i: process.env.ALEPH_ITEMS, s: process.env.ALEPH_ISSUES };
  process.env.ALEPH_ITEMS = "/x/items";
  process.env.ALEPH_ISSUES = "/x/issues";
  try {
    const { roots } = await import("./migrate.ts");
    const r = roots();
    expect(r.store).toBe("/x/items");
    expect(r.issues).toBe("/x/issues");
    expect(r.store).not.toBe(r.issues);
  } finally {
    for (const [k, v] of [["ALEPH_ITEMS", keep.i], ["ALEPH_ISSUES", keep.s]] as const) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
});
