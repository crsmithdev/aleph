// The shared setup of the landing.*.test.ts files: a repo `demo` with an origin that counts pushes, a second clone that moves main, and fake land ports.
import type { ChecksStop } from "../gates/checks.ts";
import { afterEach, beforeEach, setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LandPorts } from "./landing.ts";
import { type Check, type Entry, type Repo, type Run } from "../records/ledger.ts";
import { seed, type Seed } from "../../job.testkit.ts";
import { readSection } from "../records/run-files.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "ALEPH_DB", "XDG_RUNTIME_DIR", "ALEPH_LAND_BATCH", "ALEPH_ITEMS", "ALEPH_SYSTEMCTL", "GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"];
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
    Object.assign(process.env, { ALEPH_JOBS_DIR: join(dir, "jobs"), ALEPH_DB: join(dir, "aleph.db"), XDG_RUNTIME_DIR: join(dir, "run"), GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" });
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
  const base = { name, repo: "demo", branch: `job/${name}`, told: true, started: "2026-11-01T00:00:00.000Z" } as const;
  const build = seed({ ...base, role: "build", state: "passed", ...agent } as Seed);
  writeFileSync(join(build.folder, "spec.md"), "");
  const { id, folder, run } = seed({ ...base, role: "land", state: "running", prev: build.id, made: made++, ...extra } as Seed);
  return { id, folder, run };
}

/** A land run that counts as live, queued behind a leader. */
export function queued(e: Entry): Entry {
  // bash blocks on its own stdin: no child to orphan, and it exits when the test process dies.
  const s = Bun.spawn(["bash", "-c", "read", e.folder], { stdin: "pipe", stdout: "ignore", stderr: "ignore" });
  sleepers.push(s);
  // Until bash execs, /proc/<pid>/cmdline is the parent's: isLive reads it as lost. A spin, as the lint bars a sleep.
  while (!readFileSync(`/proc/${s.pid}/cmdline`, "utf8").includes(e.folder));
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
export const landLog = (e: Entry) => readSection(e.folder, "land") ?? "";
/** Fails only with both files in the tree, as a check does that two runs break together. */
export const both = (a: string, b: string) => (files: string[]) => files.includes(a) && files.includes(b) ? "bad failed" : null;
