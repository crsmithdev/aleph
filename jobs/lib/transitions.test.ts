import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRun, writeRun, type Run } from "./ledger.ts";
import { checked, drop, land, recheck, Refusal, refusal, startJob, startPlain } from "./transitions.ts";

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
    ALEPH_JOBS_DIR: join(base, "jobs"), ALEPH_REPOS: join(base, "repos.json"), ALEPH_ITEMS: join(base, "items"), ALEPH_FACTORY_DIR: join(base, "factory"),
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

/** A run folder of job `job`, ended (it has `exit`), so no transition takes it for live. */
function run(id: string, job: string, extra: Partial<Run> = {}): string {
  const folder = join(base, "jobs", id);
  mkdirSync(folder, { recursive: true });
  writeRun(folder, { kind: "agent", job, name: "x", repo: "fac", branch: "factory/x", state: "stuck", told: true, started: "2026-10-28T00:00:00Z", ...extra } as Run);
  writeFileSync(join(folder, "exit"), "0");
  return folder;
}

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
  test("refuses an unknown repo, a bad name and a --todo that is no number, before any run", async () => {
    expect(await refused(() => startJob({ repo: "nope", name: "x", spec: "s" }))).toBe('unknown repo "nope"; known: fac, plain');
    expect(await refused(() => startJob({ repo: "fac", name: "a b", spec: "s" }))).toBe("the name must be letters, digits and hyphens");
    expect(await refused(() => startJob({ repo: "fac", name: "x", spec: "s", todo: NaN }))).toBe("--todo takes an issue number");
    expect(runs()).toEqual([]);
  });

  test("a repo key is read without case and spaces; a name open in another repo is refused", async () => {
    run("20261028-000001-plain-x-agent", "20261028-000001-plain-x-agent", { repo: "plain" });
    expect(await refused(() => startJob({ repo: " FAC ", name: "x", spec: "s" }))).toBe("x is open in plain");
    expect(runs()).toHaveLength(1);
  });
});

test("startPlain refuses a run with no command", async () => {
  expect(await refused(() => startPlain({ name: "p", argv: [], cwd: base }))).toBe("usage: aleph run <name> -- <command> [args...]");
});

describe("land", () => {
  test("refuses a name with no open job, and a job that has not passed", async () => {
    expect(await refused(() => land("x"))).toBe("no open job named x");
    run("20261028-000001-fac-x-agent", "20261028-000001-fac-x-agent", { state: "stuck" });
    expect(await refused(() => land("x"))).toBe("x is stuck, not passed");
    run("20261028-000002-fac-x-agent", "20261028-000001-fac-x-agent", { state: "needs-you", needs: "question" });
    expect(await refused(() => land("x"))).toBe("x is needs-you (question), not passed");
    expect(runs()).toHaveLength(2);
  });
});

describe("recheck", () => {
  test("refuses each case that cannot be rechecked, in order", async () => {
    expect(await refused(() => recheck("x"))).toBe("no open job named x");
    const job = "20261028-000001-fac-x-agent";
    const first = run(job, job, { state: "passed" });
    expect(await refused(() => recheck("x"))).toBe("x is passed, not stuck or failed");
    run("20261028-000002-fac-x-land", job, { kind: "land", state: "failed" });
    expect(await refused(() => recheck("x"))).toBe("x: the last run is a land run, not an agent run");
    rmSync(join(base, "jobs", "20261028-000002-fac-x-land"), { recursive: true });
    writeRun(first, { ...readRun(first)!, state: "stuck", repo: "plain" });
    expect(await refused(() => recheck("x"))).toBe("x is not a factory job");
    writeRun(first, { ...readRun(first)!, repo: "fac" });
    expect(await refused(() => recheck("x"))).toBe("x has no branch: drop it");
    expect(runs()).toEqual([job]);
  });
});

describe("drop", () => {
  test("refuses a name with no open job", async () => {
    expect(await refused(() => drop("x"))).toBe("no open job named x");
  });

  test("marks the job's last run dropped, with the reason, and is not news", async () => {
    const folder = run("20261028-000001-x-agent", "20261028-000001-x-agent", { repo: undefined, reason: "no commit" });
    expect(await drop("x", { reason: "not needed", quiet: true })).toEqual({ job: "20261028-000001-x-agent", name: "x", state: "dropped", reason: "not needed" });
    const r = readRun(folder)!;
    expect([r.state, r.reason, r.told, r.noCommit]).toEqual(["dropped", "not needed", true, true]);
    expect(await refused(() => drop("x"))).toBe("no open job named x");
  });

  test("with no reason the reason is Chris's", async () => {
    run("20261028-000001-x-agent", "20261028-000001-x-agent", { repo: undefined });
    expect((await drop("x")).reason).toBe("dropped by Chris");
  });
});

describe("checked", () => {
  test("a land run marked by the facts gate keeps its check and is still found", () => {
    const folder = run("20261028-000002-y-agent", "20261028-000002-y-agent", { name: "y", repo: undefined, state: "landed", check: "open", facts: true });
    expect(checked("y")).toEqual({ job: "20261028-000002-y-agent", name: "y", state: "landed", check: "done" });
    expect(readRun(folder)).toMatchObject({ state: "landed", check: "done", facts: true });
  });

  test("refuses a job with no open check, and closes an open one once", () => {
    expect(() => checked("x")).toThrow("x has no open check");
    const folder = run("20261028-000001-x-agent", "20261028-000001-x-agent", { repo: undefined, state: "landed", check: "open" });
    expect(checked("x")).toEqual({ job: "20261028-000001-x-agent", name: "x", state: "landed", check: "done" });
    expect(readRun(folder)!.check).toBe("done");
    expect(() => checked("x")).toThrow("x has no open check");
  });

  test("works for a land followed by a facts run", () => {
    const folder = run("20261028-000001-x-agent", "20261028-000001-x-agent", { repo: undefined, state: "landed", check: "open" });
    run("20261028-000002-x-facts", "20261028-000001-x-agent", { repo: undefined, name: "facts-x", kind: "facts", state: "done" });
    expect(checked("x").check).toBe("done");
    expect(readRun(folder)!.check).toBe("done");
  });
});

test("refusal answers a port: the message of a refusal, or null", async () => {
  expect(await refusal(() => land("x"))).toBe("no open job named x");
  run("20261028-000001-x-agent", "20261028-000001-x-agent", { repo: undefined });
  expect(await refusal(() => drop("x", { quiet: true }))).toBeNull();
  expect(readFileSync(join(base, "jobs", "20261028-000001-x-agent", "exit"), "utf8")).toBe("0");
});
