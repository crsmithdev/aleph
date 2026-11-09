/**
 * `bun install` runs package.json's prepare script in every job worktree, and every worktree shares the main
 * checkout's .git/config. So the script must write that file only when core.hooksPath is wrong: a write takes
 * .git/config.lock, and a parallel setup's write then fails with "could not lock config file".
 */
import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let dir = "";
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const git = (cwd: string, ...a: string[]) => Bun.spawnSync(["git", ...a], { cwd, stdout: "pipe", stderr: "pipe" });
/** A fresh git repo holding the repo's package.json, so `bun run prepare` runs the script the install runs. */
function repo(): string {
  dir = mkdtempSync(join(tmpdir(), "prepare-"));
  git(dir, "init", "-q", ".");
  writeFileSync(join(dir, "package.json"), readFileSync(join(import.meta.dir, "..", "package.json")));
  return dir;
}
const hooksPath = (cwd: string) => git(cwd, "config", "core.hooksPath").stdout.toString().trim();
const prepare = (cwd: string) => Bun.spawnSync(["bun", "run", "prepare"], { cwd, stdout: "pipe", stderr: "pipe" });

test("prepare sets an unset core.hooksPath to .githooks, then writes nothing while the config lock is held", () => {
  const d = repo();
  expect(prepare(d).exitCode).toBe(0);
  expect(hooksPath(d)).toBe(".githooks");
  // This process holds the lock, as a parallel setup's `git config` write does.
  writeFileSync(join(d, ".git", "config.lock"), "");
  expect(prepare(d).exitCode).toBe(0);
  expect(hooksPath(d)).toBe(".githooks");
});
