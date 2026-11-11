import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landedIndex, revertedIn } from "./status.ts";

// The trailer reader: `Issue:` and `Goal:`.
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
  commit("legacy\n\nIssue: k-1\nJob: j1");
  commit("an issue\n\nIssue: k-2\nJob: j2");
  commit("a goal\n\nIssue: k-3.1\nJob: j3");
  commit("prose\n\nIssue: k-9 is named here\n\nbut not as a trailer.");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("landedIndex reads Issue:; a commit that names a part lands the part, not its issue", () => {
  const index = landedIndex(dir, "main", "k");
  expect([...index.keys()].sort()).toEqual(["1", "2", "3.1"]);
  expect(index.has("3")).toBe(false);
});

test("k-3.1 and k-3.2 are separate entries; a reverted part is in revertedIn and its sibling is not", () => {
  const seed = git("rev-parse", "HEAD");
  try {
    commit("goal two\n\nIssue: k-4.1\nJob: j4");
    const first = git("rev-parse", "HEAD");
    commit("goal two b\n\nIssue: k-4.2\nJob: j5");
    commit(`Revert\n\nThis reverts commit ${first}.`);
    const index = landedIndex(dir, "main", "k");
    expect(index.get("4.2")?.length).toBe(1);
    expect(index.has("4.1")).toBe(false);
    expect(revertedIn(index).has("4.1")).toBe(true);
    expect(revertedIn(index).has("4.2")).toBe(false);
    expect(index.get("4.1")).toBeUndefined();
    expect(index.get("3.1")).not.toEqual(index.get("4.2"));
  } finally { git("reset", "-q", "--hard", seed); } // the other test reads the seeded commits only
});
