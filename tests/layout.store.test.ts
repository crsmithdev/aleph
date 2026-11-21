import { afterAll, beforeAll, expect, test } from "bun:test";
import { putJson } from "../lib/db.ts";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI } from "../jobs/cli.testkit.ts";
import { renderItem } from "../lib/issue-file.ts";
import { itemsDir } from "../lib/store.ts";
import { seed } from "../jobs/job.testkit.ts";
import { layout } from "../lib/layout.ts";
import { writeRepos } from "./projects.testkit.ts";

// A temporary HOME and no layout variables: the paths follow what is on disk.
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const VARS = ["ALEPH_ITEMS", "ALEPH_JOBS_DIR", "ALEPH_RECORDS_DIR", "ALEPH_RUNS_DIR", "ALEPH_FACTORY_DIR", "ALEPH_DB"];
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
  // The CLI below inherits this path, so the test and the CLI read one table.
  process.env.ALEPH_DB = join(a, "aleph.db");
  sh(home, "git", "init", "-q", "--bare", "-b", "main", join(a, "items.git"));
  sh(home, "git", "clone", "-q", join(a, "items.git"), join(a, "items"));
  mkdirSync(join(a, "items", "issues", "1"), { recursive: true });
  const task = { id: 1, title: "the one issue", fm: { project: "project.1", created: "2026-10-01T00:00:00.000Z", priority: "medium" }, request: "x", spec: "", notes: [] };
  writeFileSync(join(a, "items", "issues", "1", "issue.md"), renderItem(task as any));
  sh(join(a, "items"), "git", "add", "-A");
  sh(join(a, "items"), "git", "commit", "-q", "-m", "one");
  sh(join(a, "items"), "git", "push", "-q", "origin", "main");
  seed({ name: "j1", repo: "aleph", role: "build", state: "failed", told: true, started: "2026-10-30T10:00:00Z" });
  putJson("settings", "paused", "2026-11-13T00:00:00.000Z");
  mkdirSync(join(home, "repo"));
  sh(join(home, "repo"), "git", "init", "-q", "-b", "main");
  sh(join(home, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(home, "repo"), "git", "update-ref", "refs/remotes/origin/main", "HEAD");
  writeRepos({ aleph: { path: join(home, "repo"), sandbox: true } });
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(home, { recursive: true, force: true });
});

test("layout() names the new layout only, and the CLI reads the data there", async () => {
  const fresh = { items: join(a, "items"), jobs: join(a, "jobs"), factory: join(a, "factory") };
  expect(layout()).toEqual(fresh);
  expect([itemsDir(), layout().jobs]).toEqual([fresh.items, fresh.jobs]);

  const list = await aleph("issue", "list", "aleph");
  expect(list.code).toBe(0);
  expect(list.stdout).toContain("the one issue");
  const jobs = await aleph("jobs");
  expect(jobs.code).toBe(0);
  expect(jobs.stdout).toContain("j1");
});
