import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI } from "../cli.helpers.ts";
import { renderItem } from "../../issues/lib/todo.ts";
import { config, storeDir } from "../../issues/lib/store.ts";
import { runsDir, writeRun } from "./ledger.ts";
import { layout } from "./layout.ts";

// A temporary HOME and no layout variables: the paths follow what is on disk.
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const VARS = ["ALEPH_ISSUES", "ALEPH_JOBS_DIR", "ALEPH_RECORDS_DIR", "ALEPH_RUNS_DIR", "ALEPH_FACTORY_DIR", "ALEPH_REPOS"];
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
  sh(home, "git", "init", "-q", "--bare", "-b", "main", join(a, "issues.git"));
  sh(home, "git", "clone", "-q", join(a, "issues.git"), join(a, "issues"));
  const tasks = join(a, "issues", "aleph", "backlog", "tasks");
  mkdirSync(tasks, { recursive: true });
  writeFileSync(join(a, "issues", "aleph", "backlog", "config.yml"), config("aleph"));
  const task = { id: 1, title: "the one issue", fm: { id: "1", created: "2026-10-01", updated: "2026-10-02", priority: "medium" }, request: "x", spec: "", notes: [] };
  writeFileSync(join(tasks, "aleph-1.md"), renderItem("aleph", task as any));
  sh(join(a, "issues"), "git", "add", "-A");
  sh(join(a, "issues"), "git", "commit", "-q", "-m", "one");
  sh(join(a, "issues"), "git", "push", "-q", "origin", "main");
  const run = join(a, "runs", "20261030-100000-aleph-j1-agent");
  mkdirSync(run, { recursive: true });
  writeRun(run, { job: "20261030-100000-aleph-j1-agent", name: "j1", repo: "aleph", kind: "build", condition: "failed", told: true, started: "2026-10-30T10:00:00Z" });
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

test("layout() names the new layout only, and the CLI reads the data there", async () => {
  const fresh = { store: join(a, "issues"), ledger: join(a, "runs"), factory: join(a, "factory") };
  expect(layout()).toEqual(fresh);
  expect([storeDir(), runsDir()]).toEqual([fresh.store, fresh.ledger]);

  const list = await aleph("issue", "list", "aleph");
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("the one issue");
  const jobs = await aleph("jobs");
  expect(jobs.code).toBe(0);
  expect(jobs.stdout).toContain("j1");
});
