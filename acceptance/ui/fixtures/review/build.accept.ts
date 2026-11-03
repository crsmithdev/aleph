// Archived goal tests from ui/fixtures/review/build.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildReviewFixture } from "../../../../ui/fixtures/review/build.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "ALEPH_JOBS_DIR", "ALEPH_REPOS", "ALEPH_ISSUES", "ALEPH_VAULT"];
let saved: Record<string, string | undefined>;
let dir: string;

beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  dir = mkdtempSync(join(tmpdir(), "review-build-"));
});

afterEach(() => {
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
  rmSync(dir, { recursive: true, force: true });
});

test("every fixture project has a real origin under dest that fetches and matches main", () => {
  const dest = join(dir, "fx");
  buildReviewFixture(dest);
  const git = (key: string, ...args: string[]) => {
    const p = Bun.spawnSync(["git", "-C", join(dest, "repos", key), ...args], { stdout: "pipe", stderr: "pipe" });
    return { code: p.exitCode, out: p.stdout.toString().trim() };
  };
  const keys = Object.keys(JSON.parse(readFileSync(join(join(import.meta.dir, "../../../../ui/fixtures/review"), "repos.json"), "utf8")));
  expect(keys.length).toBeGreaterThan(0);
  for (const key of keys) {
    expect(git(key, "fetch", "-q", "origin").code).toBe(0);
    expect(git(key, "remote", "get-url", "origin").out.startsWith(dir)).toBe(true);
    expect(git(key, "rev-parse", "origin/main").out).toBe(git(key, "rev-parse", "main").out);
  }
});
