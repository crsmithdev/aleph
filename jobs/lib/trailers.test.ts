import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { itemOnMain, landedIndex } from "./status.ts";

// The trailer reader: `Issue:` and `Goal:` as well as the legacy `Item:`.
let dir: string;
const git = (...a: string[]) => {
  const p = Bun.spawnSync(["git", "-C", dir, "-c", "user.name=t", "-c", "user.email=t@t", ...a], { stdout: "pipe", stderr: "pipe" });
  return p.stdout.toString().trim();
};
let n = 0;
const commit = (message: string) => { writeFileSync(join(dir, `f${n++}`), "x"); git("add", "-A"); git("commit", "-q", "-m", message); };

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "trailers-"));
  git("init", "-q", "-b", "main");
  commit("start");
  commit("legacy\n\nItem: k-1\nJob: j1");
  commit("an issue\n\nIssue: k-2\nJob: j2");
  commit("a goal\n\nIssue: k-3\nGoal: k-3.1\nJob: j3");
  commit("prose\n\nIssue: k-9 is named here\n\nbut not as a trailer.");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("landedIndex reads Item: and Issue:; a commit that names a goal lands the goal, not its issue", () => {
  const index = landedIndex(dir, "main", "k");
  expect([...index.keys()].sort()).toEqual([1, 2]);
});

test("itemOnMain finds an issue by Issue:, and a goal by Goal:", () => {
  const repo = { path: dir, key: "k", main: "main" };
  git("update-ref", "refs/remotes/origin/main", "main");
  expect(itemOnMain(repo, 2)).toMatch(/^[0-9a-f]{7}$/);
  expect(itemOnMain(repo, "3.1")).toMatch(/^[0-9a-f]{7}$/);
  expect(itemOnMain(repo, 3)).toBeNull();
  expect(itemOnMain(repo, "3.2")).toBeNull();
  expect(itemOnMain(repo, 9)).toBeNull();
});
