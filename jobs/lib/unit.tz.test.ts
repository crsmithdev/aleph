import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repo } from "./ledger.ts";
import { checksInSandbox } from "./checks.ts";
import { baselineChecks } from "./unit.ts";

// The check path through checksInSandbox: the check's environment must hold TZ=UTC, even when the parent process runs in another zone.
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

const KEYS = ["ALEPH_SANDBOX_CMD", "TZ", "ALEPH_SANDBOX_DIR", "XDG_RUNTIME_DIR", "ALEPH_CHECK_SLOTS"];
let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "unit-tz-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, {
    ALEPH_SANDBOX_CMD: "/usr/bin/env",
    TZ: "Asia/Tokyo",
    ALEPH_SANDBOX_DIR: join(base, "runs"),
    XDG_RUNTIME_DIR: join(base, "run"),
    ALEPH_CHECK_SLOTS: "1",
  });
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

test("a check run through baselineChecks sees TZ=UTC and date +%Z prints UTC", async () => {
  const path = join(base, "repo");
  sh(base, "git", "init", "-q", "-b", "main", path);
  writeFileSync(join(path, "f.txt"), "x\n");
  sh(path, "git", "add", ".");
  sh(path, "git", "commit", "-q", "-m", "init");
  const commit = sh(path, "git", "rev-parse", "HEAD");
  const repo = {
    key: "tz", path, main: "main", setup: [], manual: [], autoland: false, sandbox: true, held: [], hiddenRun: "",
    checks: [{ name: "tz", run: '[ "$TZ" = UTC ] && [ "$(date +%Z)" = UTC ]' }],
  } as unknown as Repo;
  expect(await baselineChecks(repo, commit, join(base, "logs"))).toBeNull();
});

test("checksInSandbox hands each step's process to onSpawn, so a drop can kill a running check", async () => {
  const path = join(base, "repo");
  sh(base, "git", "init", "-q", "-b", "main", path);
  writeFileSync(join(path, "f.txt"), "x\n");
  sh(path, "git", "add", ".");
  sh(path, "git", "commit", "-q", "-m", "init");
  const dir = join(base, "sb");
  for (const d of ["check", "checklog", "home", "tmp", "out"]) mkdirSync(join(dir, d), { recursive: true });
  sh(path, "git", "bundle", "create", join(dir, "out", "in.bundle"), "main");
  const repo = { key: "r", path, setup: [], checks: [{ name: "slow", run: "sleep 60" }] } as unknown as Repo;
  const spawned: ReturnType<typeof Bun.spawn>[] = [];
  const started = Date.now();
  const why = await checksInSandbox({
    folder: base, repo, changed: [], phase: () => {},
    onSpawn: (p) => { spawned.push(p); if (spawned.length > 1) setTimeout(() => p.kill("SIGKILL"), 200); },
  }, dir, "out/in.bundle", "refs/heads/main");
  // The setup step, the check, and the check's rerun after the failure.
  expect(spawned).toHaveLength(3);
  expect(why).not.toBeNull();
  expect(Date.now() - started).toBeLessThan(15_000);
}, 20_000);
