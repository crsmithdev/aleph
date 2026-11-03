import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeRun, type Run } from "./ledger.ts";
import { STARTING_MS } from "./process.ts";
import { startJob } from "./transitions.ts";
import { Refusal } from "./refusal.ts";

let base: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-transitions-"));
  const repo = join(base, "repo");
  mkdirSync(repo);
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  writeFileSync(join(base, "repos.json"), JSON.stringify({ fac: { path: repo, sandbox: true }, plain: { path: repo } }));
  for (const [k, v] of Object.entries({
    ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ISSUES: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory"),
    XDG_RUNTIME_DIR: join(base, "run"), ALEPH_DISPATCH: "off", ALEPH_JOB_FOREGROUND: "1",
  })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

/** The refusal a transition throws, or "" when it goes through. */
async function refused(f: () => unknown): Promise<string> {
  try {
    await f();
    return "";
  } catch (e) {
    expect(e).toBeInstanceOf(Refusal);
    return (e as Error).message;
  }
}

/** No transition that refuses leaves a run folder behind. */
const runs = () => (existsSync(join(base, "jobs")) ? readdirSync(join(base, "jobs")) : []);

describe("startJob", () => {
  test("refuses a start while the last run is starting: made, running, no pid and no exit", async () => {
    const job = "20261103-000001-fac-x-agent";
    const folder = join(base, "jobs", job);
    mkdirSync(folder, { recursive: true });
    writeRun(folder, { kind: "build", job, name: "x", repo: "fac", branch: "factory/x", condition: "running", phase: "starting", told: false, started: new Date().toISOString(), made: Date.now() } as Run);
    expect(await refused(() => startJob({ repo: "fac", name: "x", spec: "s" }))).toBe(`x is running as ${job}`);
    expect(runs()).toEqual([job]);
  });

  test("does not refuse for the starting rule once the last run's made is older than STARTING_MS", async () => {
    const job = "20261103-000002-fac-x-agent";
    const folder = join(base, "jobs", job);
    mkdirSync(folder, { recursive: true });
    writeRun(folder, { kind: "build", job, name: "x", repo: "fac", branch: "factory/x", condition: "running", phase: "starting", told: false, started: new Date().toISOString(), made: Date.now() - STARTING_MS - 1000 } as Run);
    expect(await refused(() => startJob({ repo: "fac", name: "x", spec: "s" }))).not.toContain("is running as");
  });
});

describe("land", () => {
});

describe("recheck", () => {
});

describe("drop", () => {
});

describe("checked", () => {
});
