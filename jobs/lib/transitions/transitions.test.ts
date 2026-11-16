import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { seed } from "../../job.testkit.ts";
import { STARTING_MS } from "../infra/process.ts";
import { recheck, startJob, type Start } from "./transitions.ts";
import { Refusal } from "../../../lib/refusal.ts";
import { writeRepos } from "../../../tests/projects.testkit.ts";

let base: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "aleph-transitions-"));
  const repo = join(base, "repo");
  mkdirSync(repo);
  const git = (...a: string[]) => Bun.spawnSync(["git", "-C", repo, ...a], { env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } });
  git("init", "-q", "-b", "main");
  git("commit", "-q", "--allow-empty", "-m", "base");
  writeRepos({ fac: { path: repo, sandbox: true }, plain: { path: repo } }, join(base, "items"));
  for (const [k, v] of Object.entries({
    ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_DB: join(base, "aleph.db"), ALEPH_ITEMS: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory"),
    XDG_RUNTIME_DIR: join(base, "run"), ALEPH_DISPATCH: "off", ALEPH_JOB_FOREGROUND: "1", ALEPH_LIVE_CAP: "5",
  })) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
});

afterEach(() => {
  for (const [k, v] of Object.entries(saved)) if (v === undefined) delete process.env[k]; else process.env[k] = v;
  rmSync(base, { recursive: true, force: true });
});

/** The refusal a transition throws, or "" when it goes through: a started unit is waited for, so it ends before afterEach removes the store. */
async function refused(f: () => unknown): Promise<string> {
  try {
    const s = (await f()) as Start | undefined;
    await s?.child?.exited;
    return "";
  } catch (e) {
    expect(e).toBeInstanceOf(Refusal);
    return (e as Error).message;
  }
}

/** No transition that refuses leaves a run folder behind. */
const runs = () => (existsSync(join(base, "jobs")) ? readdirSync(join(base, "jobs")).filter((d) => !d.startsWith(".")) : []);

describe("startJob", () => {
  // The test's clock: the starting rule and the made stamp read it.
  const NOW = Date.parse("2026-11-03T00:00:00Z");
  beforeEach(() => setSystemTime(NOW));
  afterEach(() => setSystemTime());

  test("refuses a start while the last run is starting: made, running, no pid and no exit", async () => {
    const { id, folder } = seed({ role: "build", name: "x", repo: "fac", branch: "factory/x", state: "running", phase: "starting", told: false, started: "2026-11-03T00:00:00Z", made: NOW });
    expect(await refused(() => startJob({ repo: "fac", name: "x", spec: "s" }))).toBe(`x is running as ${id}`);
    expect(runs()).toEqual([basename(folder)]);
  });

  test("does not refuse for the starting rule once the last run's made is older than STARTING_MS", async () => {
    seed({ role: "build", name: "x", repo: "fac", branch: "factory/x", state: "running", phase: "starting", told: false, started: "2026-11-03T00:00:00Z", made: NOW - STARTING_MS - 1000 });
    expect(await refused(() => startJob({ repo: "fac", name: "x", spec: "s" }))).not.toContain("is running as");
  });
});

describe("Run now", () => {
  test("a build start with the live cap at 0 makes the job when it is Run now, and is refused with the full gate when it is not", async () => {
    process.env.ALEPH_LIVE_CAP = "0";
    const why = await startJob({ repo: "fac", name: "x", spec: "s" }).catch((e) => e);
    expect(why).toMatchObject({ gate: "full" });
    expect(runs()).toEqual([]);
    expect(await refused(() => startJob({ repo: "fac", name: "x", spec: "s" }, { now: true }))).toBe("");
    expect(runs()).toHaveLength(1);
  });
});

describe("land", () => {
});

describe("recheck", () => {
  test("refuses a land as the last run: the refusal says job, not run, and hides the kind", async () => {
    seed({ role: "land", name: "x", repo: "fac", state: "failed", started: "2026-11-03T00:00:00Z" });
    const why = await refused(() => recheck("x"));
    expect(why).toContain("job");
    expect(why).not.toMatch(/\brun\b/);
    expect(why).not.toContain("land");
  });
});

describe("drop", () => {
});

describe("checked", () => {
});
