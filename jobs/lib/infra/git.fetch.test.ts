import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addWorktree, fetchOrigin, git, lockRetry } from "./git.ts";

const pause = lockRetry.pause;
afterEach(() => { lockRetry.pause = pause; });
/** The pause before the next try frees `lock`, so the step met it at least once and then got past it. */
function freeOnPause(lock: string): () => number {
  let pauses = 0;
  lockRetry.pause = () => { pauses++; rmSync(lock); };
  return () => pauses;
}

function setup() {
  const d = mkdtempSync(join(tmpdir(), "fetch-"));
  const origin = join(d, "origin.git"), clone = join(d, "clone"), other = join(d, "other");
  git(d, "init", "-q", "--bare", "-b", "main", origin);
  git(d, "clone", "-q", origin, other);
  git(other, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "one");
  git(other, "push", "-q", "origin", "HEAD:main");
  git(d, "clone", "-q", origin, clone);
  git(other, "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "two");
  git(other, "push", "-q", "origin", "HEAD:main");
  return { clone, other, lock: join(clone, ".git/refs/remotes/origin/main.lock") };
}

test("fetchOrigin waits out a ref lock that goes away", () => {
  const { clone, other, lock } = setup();
  writeFileSync(lock, "");
  const pauses = freeOnPause(lock);
  expect(fetchOrigin(clone).ok).toBe(true);
  expect(pauses()).toBe(1);
  expect(git(clone, "rev-parse", "origin/main").out).toBe(git(other, "rev-parse", "HEAD").out);
});

test("addWorktree waits out a config lock that goes away", () => {
  const { clone } = setup();
  const cfg = join(clone, ".git/config.lock");
  writeFileSync(cfg, "");
  const pauses = freeOnPause(cfg);
  const wt = join(clone, "..", "wt");
  const r = addWorktree(clone, wt, "job", "origin/main");
  expect(r.ok).toBe(true);
  expect(pauses()).toBe(1);
  expect(git(clone, "rev-parse", "--verify", "job").ok).toBe(true);
  expect(git(wt, "rev-parse", "--abbrev-ref", "HEAD").out).toBe("job");
});
