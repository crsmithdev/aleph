import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fetchOrigin, git } from "./lib/git.ts";

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
  Bun.spawn(["sh", "-c", `sleep 0.2; rm ${lock}`], { stdio: ["ignore", "ignore", "ignore"] });
  expect(fetchOrigin(clone).ok).toBe(true);
  expect(git(clone, "rev-parse", "origin/main").out).toBe(git(other, "rev-parse", "HEAD").out);
});

test("fetchOrigin gives up when the lock stays", () => {
  const { clone, lock } = setup();
  writeFileSync(lock, "");
  const r = fetchOrigin(clone);
  expect(r.ok).toBe(false);
  expect(r.out).toContain("cannot lock ref");
});
