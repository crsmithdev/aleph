import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, job, jobsDir, other, remote, sh, state, told, worktree, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("land: conflicts", () => {
  const remoteHead = () => sh(base, "git", "--git-dir", remote, "rev-parse", "main");
  function pushFromOther(f: string, content: string): void {
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    mkdirSync(join(other, f, ".."), { recursive: true });
    writeFileSync(join(other, f), content);
    sh(other, "git", "add", f);
    sh(other, "git", "commit", "-qm", `other ${f}`);
    sh(other, "git", "push", "-q", "origin", "main");
  }

  const runsOf = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

  test("a conflict records its paths, sends the job back to the worker, and the passed follow-up lands", async () => {
    await job("mend", "resolve-later mend.txt");
    pushFromOther("mend.txt", "theirs\n");
    const r = await aleph(["land", "mend"]);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "merge conflict", conflicts: ["mend.txt"], next: "worker" });
    expect(file(r.json.run, "land.log")).toContain("## conflicts\nmend.txt");
    expect(told).toContain("demo/mend failed; sent back to the worker");
    const runs = runsOf("mend");
    expect(runs.map((x) => [x.kind, x.state])).toEqual([["build", "passed"], ["land", "failed"], ["build", "passed"], ["land", "landed"]]);
    expect(runs[2].land).toBe(true);
    expect(file(runs[1].id, "next.log")).not.toContain("held:");
    expect(sh(base, "git", "--git-dir", remote, "show", "main:mend.txt")).toBe("mine");
    expect(remoteHead()).toBe(runs[3].commit);
  }, 30_000);

  test("a conflict the worker cannot resolve goes back twice, then stops and leaves the remote alone", async () => {
    await job("clash", "commit-fixed clash.txt");
    pushFromOther("clash.txt", "different\n");
    const before = remoteHead();
    await aleph(["land", "clash"]);
    const runs = runsOf("clash");
    expect(runs.filter((x) => x.kind === "land").map((x) => x.next ?? null)).toEqual(["worker", "worker", null]);
    expect(runs.at(-1)).toMatchObject({ kind: "land", state: "failed", reason: "merge conflict" });
    expect(remoteHead()).toBe(before);
    expect(told).toContain("demo/clash failed");
    expect(sh(worktree("clash"), "git", "status", "--porcelain")).toBe("");
    await aleph(["drop", "clash"]);
  }, 30_000);

  test("a branch that changes the list is refused, goes back to the worker, and lands without the change", async () => {
    await job("byhand", "own-list byhand.txt");
    const r = await aleph(["land", "byhand"]);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "the branch changes docs/todo.md; change the list with aleph issue", conflicts: ["docs/todo.md"], next: "worker" });
    const runs = runsOf("byhand");
    expect(runs.map((x) => [x.kind, x.state])).toEqual([["build", "passed"], ["land", "failed"], ["build", "passed"], ["land", "landed"]]);
    expect(file(runs[2].id, "prompt.md")).toContain("Only aleph issue writes the list");
    expect(Bun.spawnSync(["git", "--git-dir", remote, "cat-file", "-e", "main:docs/todo.md"]).exitCode).not.toBe(0);
    expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", `${runs[3].commit}~1`, runs[3].commit)).toBe("byhand.txt");
  }, 30_000);

  test("a change main already has ends done with no net change", async () => {
    await job("twin", "commit-fixed twin.txt");
    pushFromOther("twin.txt", "same\n");
    const r = await aleph(["land", "twin"]);
    expect(state(r.json.run)).toMatchObject({ state: "done", reason: "no net change" });
    expect(existsSync(worktree("twin"))).toBe(false);
  });
});
