import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as todos from "../../todo/lib/todo.ts";
import { writeList } from "../../todo/lib/store.ts";
import { dispatchGoals } from "./factory.ts";

const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
const repo = { key: "fac", path: "" };
let base: string;
let saved: Record<string, string | undefined>;

function sh(cwd: string, ...args: string[]): void {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
}

// Each test gets its own repo, goal list, and factory dir, so no baseline, lock, or item carries over.
let runs = 0;
function reset(): void {
  const n = ++runs;
  repo.key = `fac${n}`;
  process.env.ALEPH_FACTORY_DIR = join(base, `factory-${n}`);
  writeFileSync(join(base, "repos.json"), JSON.stringify({ [repo.key]: { path: join(base, "code"), sandbox: true, autoland: false } }));
  writeList(repo, "reset", (doc) => {
    todos.add(doc, "goal", { labels: ["goal"] });
    return true;
  }, true);
}
const setStatus = (status: "done" | "open") => writeList(repo, "status", (doc) => {
  todos.setStatus(todos.find(doc, 1)!, status);
  return true;
});

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-factory-"));
  saved = Object.fromEntries(["ALEPH_ITEMS", "ALEPH_REPOS", "ALEPH_JOBS_DIR", "XDG_RUNTIME_DIR", "ALEPH_FACTORY_DIR"].map((k) => [k, process.env[k]]));
  // The items store, with the repo's list in it.
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "items.git"));
  sh(base, "git", "clone", "-q", join(base, "items.git"), join(base, "items"));
  sh(join(base, "items"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "items"), "git", "push", "-q", "origin", "main");
  // The code checkout the baseline checks, with a green main.
  sh(base, "git", "init", "-q", "--bare", "-b", "main", join(base, "code.git"));
  sh(base, "git", "clone", "-q", join(base, "code.git"), join(base, "code"));
  sh(join(base, "code"), "git", "commit", "-q", "--allow-empty", "-m", "start");
  sh(join(base, "code"), "git", "push", "-q", "origin", "main");
  repo.path = join(base, "code");
  Object.assign(process.env, gitEnv, {
    ALEPH_ITEMS: join(base, "items"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_JOBS_DIR: join(base, "jobs"),
    XDG_RUNTIME_DIR: join(base, "run"),
  });
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

test("a goal that closes while the baseline runs starts nothing", async () => {
  reset();
  const started: string[] = [];
  // The baseline takes minutes; the goal closes during it, after openGoals() has read it.
  const checks = async () => { setStatus("done"); return null; };
  const r = await dispatchGoals(async (_repo, name) => { started.push(name); return null; }, checks);
  expect(started).toEqual([]);
  expect(r.started).toEqual([]);
  expect(r.skipped).toEqual([`${repo.key}-1: closed`]);
});

test("a goal still open after the baseline starts once", async () => {
  reset();
  const started: string[] = [];
  const r = await dispatchGoals(async (_repo, name) => { started.push(name); return null; }, async () => null);
  expect(started).toEqual([`${repo.key}-1`]);
  expect(r.started).toEqual([`${repo.key}-1`]);
});
