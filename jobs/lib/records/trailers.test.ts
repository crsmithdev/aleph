import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { landedIndex, revertedIn } from "./status.ts";

// The trailer reader: `Issue: issue.<n>`.
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
  commit("an issue\n\nIssue: issue.1\nJob: job.1");
  commit("another\n\nIssue: issue.2\nJob: job.2");
  commit("an old part\n\nIssue: issue.3.1\nJob: job.3");
  commit("an old form\n\nIssue: k-7\nJob: j4");
  commit("prose\n\nIssue: issue.9 is named here\n\nbut not as a trailer.");
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("landedIndex reads Issue: issue.<n> only: a part's ID, an old k-<n> form and prose land nothing", () => {
  const index = landedIndex(dir, "main", "k");
  expect([...index.keys()].sort()).toEqual(["1", "2"]);
  expect(index.has("3")).toBe(false);
});

test("two issues are separate entries; a reverted issue is in revertedIn and its sibling is not", () => {
  const seed = git("rev-parse", "HEAD");
  try {
    commit("issue two\n\nIssue: issue.4\nJob: job.4");
    const first = git("rev-parse", "HEAD");
    commit("issue two b\n\nIssue: issue.5\nJob: job.5");
    commit(`Revert\n\nThis reverts commit ${first}.`);
    const index = landedIndex(dir, "main", "k");
    expect(index.get("5")?.length).toBe(1);
    expect(index.has("4")).toBe(false);
    expect(revertedIn(index).has("4")).toBe(true);
    expect(revertedIn(index).has("5")).toBe(false);
    expect(index.get("4")).toBeUndefined();
    expect(index.get("2")).not.toEqual(index.get("5"));
  } finally { git("reset", "-q", "--hard", seed); } // the other test reads the seeded commits only
});
