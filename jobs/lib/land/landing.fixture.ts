// The shared setup of the landing.*.test.ts files: a repo `demo` with an origin that counts pushes, a second clone that moves main, and fake land ports.
import type { ChecksStop } from "../gates/checks.ts";
import { afterEach, beforeEach, setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import type { LandPorts } from "./landing.ts";
import { type Check, type Entry, type Repo, type Run } from "../records/ledger.ts";
import { putRun } from "../records/record.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "XDG_RUNTIME_DIR", "ALEPH_LAND_BATCH", "ALEPH_ISSUES", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
export let dir: string, repo: Repo;
let saved: Record<string, string | undefined>;
let sleepers: ReturnType<typeof Bun.spawn>[];
let made: number;

export const sh = (cwd: string, ...args: string[]): string => {
  const p = Bun.spawnSync(args, { cwd, env: process.env, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
};
export const remote = (...a: string[]) => sh(dir, "git", "--git-dir", join(dir, "repo.git"), ...a);
const filesAt = (commit: string) => sh(repo.path, "git", "ls-tree", "-r", "--name-only", commit).split("\n");
export const mainFiles = () => remote("ls-tree", "-r", "--name-only", "main").split("\n");
export const pushes = () => existsSync(join(dir, "pushes")) ? readFileSync(join(dir, "pushes"), "utf8").trim().split("\n").length : 0;

/** Registers the hooks: a new repo, origin and ledger for each test. */
export function useLandingFixture(): void {
  setDefaultTimeout(120_000);

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "aleph-landing-"));
    saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
    delete process.env.ALEPH_LAND_BATCH;
    Object.assign(process.env, { ALEPH_JOBS_DIR: join(dir, "jobs"), XDG_RUNTIME_DIR: join(dir, "run"), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
    mkdirSync(join(dir, "jobs"));
    sh(dir, "git", "init", "-q", "--bare", "-b", "main", "repo.git");
    writeFileSync(join(dir, "repo.git", "hooks", "pre-receive"), `#!/bin/sh\necho x >> ${join(dir, "pushes")}\ncat > /dev/null\n`, { mode: 0o755 });
    sh(dir, "git", "clone", "-q", "repo.git", "repo");
    sh(join(dir, "repo"), "git", "commit", "-q", "--allow-empty", "-m", "init");
    sh(join(dir, "repo"), "git", "push", "-q", "origin", "main");
    sh(dir, "git", "clone", "-q", "repo.git", "other");
    rmSync(join(dir, "pushes"), { force: true });
    repo = { key: "demo", path: join(dir, "repo"), main: "main", checks: [], setup: [] } as unknown as Repo;
    sleepers = [];
    made = 1;
  });

  afterEach(() => {
    for (const s of sleepers) s.kill("SIGKILL");
    for (const k of KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
    rmSync(dir, { recursive: true, force: true });
  });
}

/** A commit on main that the land did not make. */
export function moveMain(file = `moved-${Math.random()}`, text = "x\n"): void {
  const o = join(dir, "other");
  sh(o, "git", "pull", "-q", "--rebase", "origin", "main");
  mkdirSync(join(o, file, ".."), { recursive: true });
  writeFileSync(join(o, file), text);
  sh(o, "git", "add", ".");
  sh(o, "git", "commit", "-qm", `other ${file}`);
  sh(o, "git", "push", "-q", "origin", "main");
}

/** A branch with one commit per file text, from origin/main. */
function branch(name: string, commits: [string, string][]): void {
  sh(repo.path, "git", "fetch", "-q", "origin");
  sh(repo.path, "git", "checkout", "-q", "-b", `job/${name}`, "origin/main");
  for (const [file, text] of commits) {
    mkdirSync(join(repo.path, file, ".."), { recursive: true });
    writeFileSync(join(repo.path, file), text);
    sh(repo.path, "git", "add", ".");
    sh(repo.path, "git", "commit", "-qm", `add ${file}`);
  }
  sh(repo.path, "git", "checkout", "-q", "main");
}

/** A passed job and its land run, not started. `extra` goes on the land run, `agent` on the agent run. */
export function job(name: string, commits: [string, string][], extra: Partial<Run> = {}, agent: Partial<Run> = {}): Entry {
  if (commits.length) branch(name, commits);
  const buildId = `20261101-000000-demo-${name}-build`;
  const started = "2026-11-01T00:00:00.000Z";
  const base = { name, repo: "demo", job: buildId, branch: `job/${name}`, told: true, started } as const;
  mkdirSync(join(dir, "jobs", buildId));
  writeFileSync(join(dir, "jobs", buildId, "spec.md"), "");
  putRun(buildId, { ...base, n: 1, kind: "build", condition: "passed", ...agent } as Run);
  const id = `20261101-000001-demo-${name}-land`;
  const folder = join(dir, "jobs", id);
  mkdirSync(folder);
  const run = { ...base, n: 2, kind: "land", condition: "running", made: made++, ...extra } as Run;
  putRun(basename(folder), run);
  return { id, folder, run };
}

/** A land run that counts as live, queued behind a leader. */
export function queued(e: Entry): Entry {
  // bash blocks on its own stdin: no child to orphan, and it exits when the test process dies.
  const s = Bun.spawn(["bash", "-c", "read", e.folder], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  sleepers.push(s);
  writeFileSync(join(e.folder, "pid"), String(s.pid));
  return e;
}

/** Checks that fail when `bad` says why, and move main during the first `races` calls. */
export function ports(o: { bad?: (files: string[]) => string | null; races?: number; raceOn?: (names: string[]) => boolean; room?: number[]; stop?: ChecksStop } = {}): LandPorts & { calls: string[][]; only: Check[][] } {
  const calls: string[][] = [];
  const only: Check[][] = [];
  let races = o.races ?? 0;
  return {
    calls,
    only,
    pull: async (room) => { o.room?.push(room); },
    check: async (commit, runs, _changed, picked) => {
      calls.push(runs.map((r) => r.name));
      only.push(picked.checks);
      if (races > 0 && (o.raceOn?.(runs.map((r) => r.name)) ?? true)) { races--; moveMain(); }
      const reason = o.bad?.(filesAt(commit)) ?? null;
      const why: ChecksStop | null = o.stop ?? (reason ? { cause: "check", checkName: reason.replace(/ failed$/, ""), reason } : null);
      return { why, checks: [{ name: "fake", ok: !why, seconds: 0 }], log: reason ? `the log of ${reason}\n` : "" };
    },
  };
}

export const given = (e: Entry) => JSON.parse(readFileSync(join(e.folder, "batch.json"), "utf8"));
export const landLog = (e: Entry) => readFileSync(join(e.folder, "land.log"), "utf8");
/** Fails only with both files in the tree, as a check does that two runs break together. */
export const both = (a: string, b: string) => (files: string[]) => files.includes(a) && files.includes(b) ? "bad failed" : null;
