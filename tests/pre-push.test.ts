import { afterEach, expect, test } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hooks = join(import.meta.dir, "..", ".githooks");
let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) => Bun.spawnSync(["git", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
const main = () => git(join(dir, "origin.git"), "rev-parse", "--verify", "-q", "main").stdout.toString().trim();
const pushWith = (cwd: string, env: Record<string, string | undefined>, ...a: string[]) =>
  Bun.spawnSync(["git", "push", ...a], { cwd, env, stdout: "pipe", stderr: "pipe" });

/** A `gh` stub first in PATH: it logs its calls to `gh.log`, prints `out` and exits `code`. */
function ghEnv(out: string, code = 0): Record<string, string | undefined> {
  const bin = join(dir, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), `#!/bin/sh\necho "$*" >> ${join(dir, "gh.log")}\nprintf '%s' "${out}"\nexit ${code}\n`);
  chmodSync(join(bin, "gh"), 0o755);
  return { ...process.env, PATH: `${bin}:${process.env.PATH}` };
}

/** A clone with the hook on, whose `test:all` runs `script`. */
function setup(script: string): string {
  dir = mkdtempSync(join(tmpdir(), "prepush-"));
  git(dir, "init", "-q", "--bare", "-b", "main", "origin.git");
  const w = join(dir, "work");
  git(dir, "clone", "-q", "origin.git", "work");
  writeFileSync(join(w, "package.json"), JSON.stringify({ scripts: { typecheck: "true", "test:all": script } }));
  git(w, "add", "."); git(w, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "x");
  git(w, "config", "core.hooksPath", hooks);
  return w;
}

test("a failing test:all refuses a push to main and a push to another branch runs nothing", () => {
  const w = setup("exit 1");
  expect(git(w, "push", "origin", "HEAD:main").exitCode).not.toBe(0);
  expect(main()).toBe("");
  expect(git(w, "push", "origin", "HEAD:refs/heads/feature").exitCode).toBe(0);
});

test("a push to main runs test:all, and a pass moves main", () => {
  const w = setup("touch ran");
  expect(git(w, "push", "origin", "HEAD:main").exitCode).toBe(0);
  expect(existsSync(join(w, "ran"))).toBe(true);
  expect(main()).toBe(git(w, "rev-parse", "HEAD").stdout.toString().trim());
});

test("a failed latest run refuses a push to main, which the named bypass then moves; a feature push passes", () => {
  const w = setup("touch ran");
  const env = ghEnv("failure");
  const refused = pushWith(w, env, "origin", "HEAD:main");
  expect(refused.exitCode).not.toBe(0);
  expect(refused.stderr.toString()).toContain("GitHub CI on main is red");
  expect(main()).toBe("");
  expect(pushWith(w, { ...env, ALEPH_ALLOW_RED_MAIN: "1" }, "origin", "HEAD:main").exitCode).toBe(0);
  expect(main()).toBe(git(w, "rev-parse", "HEAD").stdout.toString().trim());
  expect(pushWith(w, env, "origin", "HEAD:refs/heads/feature").exitCode).toBe(0);
});

test("a passed latest run asks gh and lets a push to main through", () => {
  const w = setup("touch ran");
  expect(pushWith(w, ghEnv("success"), "origin", "HEAD:main").exitCode).toBe(0);
  expect(readFileSync(join(dir, "gh.log"), "utf8")).toContain("run list");
  expect(main()).toBe(git(w, "rev-parse", "HEAD").stdout.toString().trim());
});

test("a gh that cannot read the runs lets a push to main through", () => {
  const w = setup("touch ran");
  expect(pushWith(w, ghEnv("", 1), "origin", "HEAD:main").exitCode).toBe(0);
  expect(readFileSync(join(dir, "gh.log"), "utf8")).toContain("run list");
  expect(main()).toBe(git(w, "rev-parse", "HEAD").stdout.toString().trim());
});

test("a push from a linked worktree runs test:all with none of git's repo env", () => {
  const w = setup("env > env.txt");
  const wt = join(dir, "wt");
  git(w, "worktree", "add", "-q", wt);
  expect(git(wt, "push", "origin", "HEAD:main").exitCode).toBe(0);
  const vars = readFileSync(join(wt, "env.txt"), "utf8").split("\n").map((l) => l.split("=")[0]);
  expect(vars.filter((v) => ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"].includes(v))).toEqual([]);
});
