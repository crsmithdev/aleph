import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeList } from "../todo/lib/store.ts";
import { add } from "../todo/lib/todo.ts";
import { state } from "./state.ts";

let base: string, jobsDir: string, factory: string;
const saved: Record<string, string | undefined> = {};
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const now = new Date();
const ago = (h: number) => new Date(now.getTime() - h * 3600_000).toISOString();
function run(id: string, extra: Record<string, unknown>, files: Record<string, string> = {}) {
  const dir = join(jobsDir, id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "state.json"), JSON.stringify({ kind: "agent", repo: "fac", told: true, started: ago(3), ...extra }));
  for (const [f, text] of Object.entries(files)) writeFileSync(join(dir, f), text);
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-ui-"));
  jobsDir = join(base, "jobs");
  factory = join(base, "factory");
  mkdirSync(jobsDir); mkdirSync(factory);
  const repo = join(base, "repo");
  sh(base, "git", "init", "-q", "-b", "main", repo);
  sh(repo, "git", "remote", "add", "origin", "git@github.com:chris/demo.git");
  const itemsRemote = join(base, "items.git"), items = join(base, "items");
  sh(base, "git", "init", "-q", "--bare", "-b", "main", itemsRemote);
  sh(base, "git", "clone", "-q", itemsRemote, items);
  sh(items, "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(items, "git", "push", "-q", "origin", "main");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: repo, sandbox: true, checks: [] } }));
  for (const [k, v] of Object.entries({ ALEPH_JOBS_DIR: jobsDir, ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: items, ALEPH_FACTORY_DIR: factory, ALEPH_DAY_CAP: "12" })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  Object.assign(process.env, gitEnv);
  writeList({ key: "fac" }, "seed", (doc) => {
    for (const t of ["needs item", "waiting goal", "stuck item", "running item", "landed item", "old item"]) add(doc, t, { labels: t === "waiting goal" ? ["goal"] : [] });
    return true;
  }, true);

  run("20261027-000001-a", { job: "fac-1", name: "fac-1", state: "needs-you", needs: "held", todo: 1, stat: " held/x.ts | 2 +-", defaults: ["port? -> 3020"], shown: false, cost: 0.5 },
    { "result.md": "done\nFOLLOWUP: tidy the logs\n" });
  run("20261027-000002-a", { job: "fac-3", name: "fac-3", state: "stuck", reason: "a check failed", todo: 3 });
  run("20261027-000003-a", { job: "fac-4", name: "fac-4", state: "running", todo: 4 });
  run("20261027-000004-a", { job: "fac-5", name: "fac-5", state: "landed", todo: 5, commit: "abcdef1234567", ended: ago(2), started: ago(3) });
  run("20261027-000005-a", { job: "fac-6", name: "fac-6", state: "landed", todo: 6, commit: "123456abcdef", ended: ago(30), started: ago(31) });
  writeFileSync(join(factory, "tick.log"), `${ago(30)} yesterday line\n${now.toISOString()} started none\n`);
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

describe("state", () => {
  test("sorts the runs into their lists", () => {
    const before = readFileSync(join(jobsDir, "20261027-000001-a", "state.json"), "utf8");
    const s = state(now);
    expect(s.needs.map((j) => j.name)).toEqual(["fac-1"]);
    expect(s.needs[0].stat).toBe(" held/x.ts | 2 +-");
    expect(s.needs[0].defaults).toEqual(["port? -> 3020"]);
    expect(s.needs[0].followups).toEqual(["tidy the logs"]);
    expect(s.needs[0].item).toEqual({ id: 1, title: "needs item" });
    expect(s.stuck.map((j) => j.name)).toEqual(["fac-3"]);
    expect(s.running.map((j) => j.name)).toEqual(["fac-4"]);
    expect(s.delivered.map((j) => j.name)).toEqual(["fac-5"]);
    expect(s.delivered[0].commitUrl).toBe("https://github.com/chris/demo/commit/abcdef1234567");
    expect(s.waiting).toEqual([{ repo: "fac", id: 2, title: "waiting goal" }]);
    expect(s.factory.runsToday).toBe(4);
    expect(s.factory.dayCap).toBe(12);
    expect(s.factory.paused).toBe(false);
    expect(readFileSync(join(jobsDir, "20261027-000001-a", "state.json"), "utf8")).toBe(before);
    expect(JSON.parse(before).shown).toBe(false);
  });

  test("ticks hold today's lines only", () => {
    const s = state(now);
    expect(s.ticks.map((t) => t.line)).toEqual(["started none"]);
  });
});
