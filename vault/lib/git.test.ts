import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addedDate, commitPaths, tracked } from "./git.ts";

const env = { GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" };
let dir: string;
const g = (date: string, ...args: string[]) =>
  Bun.spawnSync(["git", "-C", dir, "-c", "commit.gpgsign=false", ...args], { env: { ...process.env, ...env, GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } });
const commit = (date: string, msg: string) => { g(date, "add", "-A"); g(date, "commit", "-q", "-m", msg); };

beforeAll(() => { dir = mkdtempSync(join(tmpdir(), "git-test-")); g("2026-01-01T12:00:00", "init", "-q"); });
afterAll(() => rmSync(dir, { recursive: true, force: true }));

const head = "---\ntitle: X\ntype: gotcha\n---\n";

test("a renamed note keeps the date it first entered git", () => {
  writeFileSync(join(dir, "Old.md"), head + "The build fails when the cache is cold and the lock is held.\n");
  commit("2026-01-10T12:00:00", "enter");
  g("2026-03-10T12:00:00", "mv", "Old.md", "New.md");
  commit("2026-03-10T12:00:00", "rename");
  expect(addedDate(dir, join(dir, "New.md"))).toBe("2026-01-10");
});

test("a similar note added later is not taken for the first", () => {
  // Eight identical body lines and one that differs: well over 50% similar, not identical.
  const shared = Array.from({ length: 8 }, (_, i) => `Step ${i + 1} is the same in both notes.\n`).join("");
  writeFileSync(join(dir, "A.md"), head + shared + "Retries stop after three attempts.\n");
  commit("2026-04-01T12:00:00", "a");
  writeFileSync(join(dir, "B.md"), head + shared + "Retries stop after four attempts.\n");
  commit("2026-05-01T12:00:00", "b");
  expect(addedDate(dir, join(dir, "A.md"))).toBe("2026-04-01");
  expect(addedDate(dir, join(dir, "B.md"))).toBe("2026-05-01");
});

test("commitPaths still commits the note when another named path is gone and was never tracked", () => {
  writeFileSync(join(dir, "Draft.md"), head + "A decision.\n");
  // The superseded draft was unlinked and never tracked; git add would fail on it whole.
  const sha = commitPaths(dir, "write: Draft", [join(dir, "Draft.md"), join(dir, "Gone.md")]);
  expect(sha).toBeTruthy();
  expect(tracked(dir, join(dir, "Draft.md"))).toBe(true);
});
