import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Repo } from "./ledger.ts";
import { checkEnv, checksAt, runOnCommit } from "./checks.ts";
import { fixture } from "../../tests/git-fixture.ts";

// The check path through checksAt: the check's environment must hold TZ=UTC, even when the parent process runs in another zone.
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

const KEYS = ["TZ", "XDG_RUNTIME_DIR"];
let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "unit-tz-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { TZ: "Asia/Tokyo", XDG_RUNTIME_DIR: join(base, "run") });
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

/** A repo with one commit, its sha, and the repo's entry with these setup commands and checks. */
function committed(setup: string[] = [], checks: { name: string; run: string }[] = []) {
  const path = join(base, "repo");
  oneCommit(path);
  const repo = { key: "r", path, main: "main", setup, checks } as unknown as Repo;
  return { repo, sha: sh(path, "git", "rev-parse", "HEAD") };
}

/** The repo's worktrees besides its main checkout. */
const extraTrees = (path: string) => sh(path, "git", "worktree", "list", "--porcelain").split("\n").filter((l) => l.startsWith("worktree ")).length - 1;

test("checksAt hands each check's process to onSpawn, so a drop can kill a running check, and a killed check gives no verdict", async () => {
  const { repo, sha } = committed([], [{ name: "slow", run: "sleep 60" }]);
  const spawned: ReturnType<typeof Bun.spawn>[] = [];
  const why = await checksAt({
    folder: base, repo, changed: [], phase: () => {},
    onSpawn: (p) => { spawned.push(p); setTimeout(() => p.kill("SIGKILL"), 200); },
  }, sha, process.env);
  // A killed check does not run again here.
  expect(spawned).toHaveLength(1);
  expect(why).toMatchObject({ cause: "infra", checkName: "slow", reason: "no verdict: check slow was killed" });
  expect(extraTrees(repo.path)).toBe(0);
}, 20_000);

test("checksAt runs the checks in a detached worktree at the commit, and checkEnv gives them TZ=UTC; the worktree goes after", async () => {
  const { repo, sha } = committed([], [{ name: "a", run: "cat f.txt; echo tz=[$TZ]; git status --porcelain --branch | head -1; exit 3" }]);
  const why = await checksAt({ folder: base, repo, changed: [], phase: () => {} }, sha, checkEnv());
  expect(why).toEqual({ cause: "check", checkName: "a", reason: "a failed" });
  const log = await Bun.file(join(base, "checks.log")).text();
  expect(log).toContain("x\ntz=[UTC]\n## HEAD (no branch)");
  expect(extraTrees(repo.path)).toBe(0);
});

test("checksAt states a failed setup as the check `setup`", async () => {
  const { repo, sha } = committed(["false"], [{ name: "a", run: "true" }]);
  expect(await checksAt({ folder: base, repo, changed: [], phase: () => {} }, sha, process.env)).toEqual({ cause: "check", checkName: "setup", reason: "setup failed" });
});

test("checksAt states a commit that git cannot check out as infra", async () => {
  const { repo } = committed([], [{ name: "a", run: "true" }]);
  expect(await checksAt({ folder: base, repo, changed: [], phase: () => {} }, "0".repeat(40), process.env)).toMatchObject({ cause: "infra" });
});

test("runOnCommit runs the command on the commit in a worktree, with TZ=UTC, and keeps its exit code and output", async () => {
  const { repo, sha } = committed(["true"]);
  expect(await runOnCommit(repo, sha, "cat f.txt; echo tz=[$TZ]")).toEqual({ code: 0, output: "x\ntz=[UTC]\n" });
  const bad = await runOnCommit(repo, sha, "echo boom; exit 3");
  expect(bad).toEqual({ code: 3, output: "boom\n" });
  expect(extraTrees(repo.path)).toBe(0);
});

test("runOnCommit puts the hidden files in .hidden", async () => {
  const { repo, sha } = committed();
  expect((await runOnCommit(repo, sha, "cat .hidden/h.test.ts", { "h.test.ts": "sealed" })).output).toBe("sealed");
  expect((await runOnCommit(repo, sha, "ls -a")).output).not.toContain(".hidden");
});

test("runOnCommit: two runs for one repo at the same time do not remove each other's worktree", async () => {
  const { repo, sha } = committed();
  const [a, b] = await Promise.all([runOnCommit(repo, sha, "sleep 0.3; cat f.txt"), runOnCommit(repo, sha, "cat f.txt; exit 3")]);
  expect([a, b]).toEqual([{ code: 0, output: "x\n" }, { code: 3, output: "x\n" }]);
});

test("runOnCommit: a commit that git cannot check out returns infra", async () => {
  const { repo } = committed();
  const r = await runOnCommit(repo, "0".repeat(40), "true");
  expect(r).toMatchObject({ code: 1, infra: true });
  expect(r.output).toContain("worktree add failed");
});

test("runOnCommit: a failing setup returns infra with the setup log, and the command does not run", async () => {
  const { repo, sha } = committed(["echo KNOWN-SETUP-TEXT-716; false"]);
  const r = await runOnCommit(repo, sha, "echo boom; exit 3");
  expect(r).toMatchObject({ code: 1, infra: true });
  expect(r.output).toStartWith("setup failed\n");
  expect(r.output).toContain("KNOWN-SETUP-TEXT-716\n");
  expect(r.output).not.toContain("boom");
});
