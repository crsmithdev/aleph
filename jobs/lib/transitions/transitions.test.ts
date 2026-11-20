import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { seed } from "../../job.testkit.ts";
import { STARTING_MS } from "../infra/process.ts";
import { getRun } from "../records/record.ts";
import type { Run } from "../records/ledger.ts";
import { drop, recheck, startJob, type Start } from "./transitions.ts";
import { Refusal } from "../../../lib/refusal.ts";
import { writeRepos } from "../../../tests/projects.testkit.ts";
import { eventsOf } from "../../../lib/layout.ts";

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

describe("a fix round's session", () => {
  const SESSION = "5a5f0000-0000-4000-8000-000000000001";
  /** The run `startJob` makes after a build that returned with `failed` and `more`; the build's session file is there unless `file` is false. */
  async function nextRun(name: string, failed: string, file = true, more: Partial<Run> = {}): Promise<Run> {
    process.env.ALEPH_CLAUDE_PROJECTS = join(base, "projects");
    mkdirSync(join(base, "projects", "p"), { recursive: true });
    const f = join(base, "projects", "p", `${SESSION}.jsonl`);
    if (file) writeFileSync(f, ""); else rmSync(f, { force: true });
    seed({ role: "build", name, repo: "fac", branch: `factory/${name}`, state: "returned", failed, session: SESSION, ...more });
    const s = await startJob({ repo: "fac", name, spec: "note" });
    await s.child?.exited;
    return getRun(s.started.run)!;
  }
  afterEach(() => delete process.env.ALEPH_CLAUDE_PROJECTS);

  test("after a review hold the new build is resumed; after a failed check, a held merge round or with the session file gone it is not", async () => {
    expect(await nextRun("held", "review")).toMatchObject({ session: SESSION, resumed: true });
    for (const run of [await nextRun("check", "tests"), await nextRun("merge", "review", true, { merge: true }), await nextRun("gone", "review", false)]) {
      expect(run.session).not.toBe(SESSION);
      expect(run.resumed).toBeUndefined();
    }
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
  const held = { reason: "held-path", question: "land it?", options: [], why: [] };
  const answers = (key: string) => eventsOf(key, "answered").map((e) => [e.subject, e.detail]);

  test("Chris's drop of a waiting run answers its Ask: a plain drop takes the second verb, an answer-and-rerun the first, a quiet drop none", async () => {
    seed({ role: "build", name: "a", target: "issue.1", state: "waiting", ask: held });
    seed({ role: "build", name: "b", target: "issue.2", state: "waiting", ask: { ...held, reason: "question" } });
    seed({ role: "build", name: "c", target: "issue.3", state: "waiting", ask: held });
    await drop("a");
    await drop("b", { reason: `Chris answered the worker's question "which?": B`, answered: true });
    await drop("c", { quiet: true });
    expect([answers("issue.1"), answers("issue.2"), answers("issue.3")]).toEqual([
      [["human", "held-path: disapprove"]], [["human", "question: resolve"]], [["rule", "held-path"]],
    ]);
  });
});

describe("checked", () => {
});
