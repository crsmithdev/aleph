import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const hooks = join(import.meta.dir, "..", ".githooks");
let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) => Bun.spawnSync(["git", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
const main = () => git(join(dir, "origin.git"), "rev-parse", "--verify", "-q", "main").stdout.toString().trim();

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
