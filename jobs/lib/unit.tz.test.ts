import { afterEach, beforeEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repo } from "./ledger.ts";
import { checksInSandbox, runOnCommit } from "./checks.ts";
import { checkSlot } from "./ledger.ts";
import { fixture } from "../../tests/git-fixture.ts";
import { waitFor } from "../../tests/wait.ts";

// The check path through checksInSandbox: the check's environment must hold TZ=UTC, even when the parent process runs in another zone.
const gitEnv = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
function sh(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(args, { cwd, env: { ...process.env, ...gitEnv }, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw new Error(`${args.join(" ")}: ${p.stderr}`);
  return p.stdout.toString().trim();
}

/** A repo at `path` with one commit "init" of f.txt on main. */
const oneCommit = (path: string) => fixture("unit-tz", (dir) => {
  sh(dir, "git", "init", "-q", "-b", "main");
  writeFileSync(join(dir, "f.txt"), "x\n");
  sh(dir, "git", "add", ".");
  sh(dir, "git", "commit", "-q", "-m", "init");
}, path);

const KEYS =["ALEPH_SANDBOX_CMD", "TZ", "ALEPH_SANDBOX_DIR", "XDG_RUNTIME_DIR", "ALEPH_CHECK_SLOTS"];
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

test("checksInSandbox hands each step's process to onSpawn, so a drop can kill a running check", async () => {
  const path = join(base, "repo");
  oneCommit(path);
  const dir = join(base, "sb");
  for (const d of ["check", "checklog", "home", "tmp", "out"]) mkdirSync(join(dir, d), { recursive: true });
  sh(path, "git", "bundle", "create", join(dir, "out", "in.bundle"), "main");
  const repo = { key: "r", path, setup: [], checks: [{ name: "slow", run: "sleep 60" }] } as unknown as Repo;
  const spawned: ReturnType<typeof Bun.spawn>[] = [];
  const why = await checksInSandbox({
    folder: base, repo, changed: [], phase: () => {},
    onSpawn: (p) => { spawned.push(p); if (spawned.length > 1) setTimeout(() => p.kill("SIGKILL"), 200); },
  }, dir, "out/in.bundle", "refs/heads/main");
  // The setup step, the check, and the check's rerun after the failure.
  expect(spawned).toHaveLength(3);
  // The rerun was killed: a check of `sleep 60` that ran out would pass the test's 20 s limit.
  expect(why).toMatchObject({ cause: "check", checkName: "slow", reason: "slow failed" });
}, 20_000);

/** A repo with one commit and a bundle of it in a fresh sandbox folder. */
function sandboxed(setup: string[], checks: { name: string; run: string }[]) {
  const path = join(base, "repo");
  oneCommit(path);
  const dir = join(base, "sb");
  for (const d of ["check", "checklog", "home", "tmp", "out"]) mkdirSync(join(dir, d), { recursive: true });
  sh(path, "git", "bundle", "create", join(dir, "out", "in.bundle"), "main");
  return { dir, repo: { key: "r", path, setup, checks } as unknown as Repo };
}

test("checksInSandbox states a failed setup as the check `setup`", async () => {
  const { dir, repo } = sandboxed(["false"], [{ name: "a", run: "true" }]);
  const why = await checksInSandbox({ folder: base, repo, changed: [], phase: () => {} }, dir, "out/in.bundle", "refs/heads/main");
  expect(why).toEqual({ cause: "check", checkName: "setup", reason: "setup failed" });
});

/** A repo with one commit and its sha, for runOnCommit. */
function committed(setup: string[] = []) {
  const path = join(base, "repo");
  oneCommit(path);
  return { repo: { key: "r", path, main: "main", setup } as unknown as Repo, sha: sh(path, "git", "rev-parse", "HEAD") };
}

test("runOnCommit runs the command on the commit in a clone, with TZ=UTC, and keeps its exit code and output", async () => {
  const { repo, sha } = committed(["true"]);
  expect(await runOnCommit(repo, sha, "cat f.txt; echo tz=[$TZ]")).toEqual({ code: 0, output: "x\ntz=[UTC]\n" });
  const bad = await runOnCommit(repo, sha, "echo boom; exit 3");
  expect(bad).toEqual({ code: 3, output: "boom\n" });
});

test("runOnCommit puts the hidden files in .hidden", async () => {
  const { repo, sha } = committed();
  expect((await runOnCommit(repo, sha, "cat .hidden/h.test.ts", { "h.test.ts": "sealed" })).output).toBe("sealed");
  expect((await runOnCommit(repo, sha, "ls -a")).output).not.toContain(".hidden");
});

test("runOnCommit: two runs for one repo at the same time do not remove each other's folder", async () => {
  process.env.ALEPH_CHECK_SLOTS = "2";
  const { repo, sha } = committed();
  const [a, b] = await Promise.all([runOnCommit(repo, sha, "true"), runOnCommit(repo, sha, "echo boom; exit 3")]);
  expect([a.code, b.code]).toEqual([0, 3]);
  expect(a.output + b.output).not.toContain("bundle failed");
});

test("runOnCommit: a sandbox that ends before setup.code returns infra with its stdout tail", async () => {
  const { repo, sha } = committed();
  const fake = join(base, "fake-sandbox.sh");
  writeFileSync(fake, "#!/bin/sh\necho sandbox-said-this\nexit 7\n");
  chmodSync(fake, 0o755);
  process.env.ALEPH_SANDBOX_CMD = fake;
  const r = await runOnCommit(repo, sha, "true");
  expect(r).toMatchObject({ code: 7, infra: true });
  expect(r.output).toContain("the command did not start");
  expect(r.output).toContain("sandbox-said-this");
});

test("runOnCommit: a failing setup returns infra with the setup log, and the command does not run", async () => {
  const { repo, sha } = committed(["echo KNOWN-SETUP-TEXT-716; false"]);
  const r = await runOnCommit(repo, sha, "echo boom; exit 3");
  expect(r).toEqual({ code: 1, output: "setup failed\nKNOWN-SETUP-TEXT-716\n", infra: true });
});

test("runOnCommit waits for a check slot, and frees it after a run and after an infra result", async () => {
  const { repo, sha } = committed();
  const free = await checkSlot();
  let done = false;
  const p = runOnCommit(repo, sha, "echo boom; exit 3").then((r) => { done = true; return r; });
  // The bundle is written just before the slot wait; the setup step, which writes setup.log, comes after it.
  const runs = join(base, "runs");
  const folder = () => (existsSync(runs) ? readdirSync(runs).find((d) => d.startsWith("accept-")) : undefined);
  expect(await waitFor(() => { const f = folder(); return !!f && existsSync(join(runs, f, "out", "accept.bundle")); })).toBe(true);
  expect(done).toBe(false);
  expect(existsSync(join(runs, folder()!, "checklog", "setup.log"))).toBe(false);
  free();
  expect((await p).code).toBe(3);
  (await checkSlot())();
  expect((await runOnCommit({ ...repo, setup: ["false"] }, sha, "true")).infra).toBe(true);
  (await checkSlot())();
});
