import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, itemsRemote, other, remote, repo, sh, state, worktree, setup, teardown } from "./cli.helpers";
import { actionJob, drop, issueAdd, issueShow, job, land } from "./inproc";

// The wiring of `aleph land` on an item, and the jobs list, whose reading of fate from git is in jobs/cli.ts itself.
// The other cases run in-process in jobs/lib/transitions.item.test.ts.
beforeAll(setup);
afterAll(teardown);

const add = async (key: string, title: string) => (await issueAdd(key, title)).json.added as number;
const show = async (key: string, id: number) => { const i = (await issueShow(key, id)).json; return { status: i.status, notes: i.notes as string[] }; };

describe("a job tied to a to-do item", () => {
  test("land marks the item done, naming the job and the landing commit", async () => {
    const landId = await add("demo", "ship the widget");
    const j = await job("demo", "widget", "Goal: widget\nACTION: commit widget.txt\n", { on: String(landId) });
    expect(state(j.json.run)).toMatchObject({ condition: "passed", on: `demo-${landId}` });
    const r = await aleph(["land", "widget"]);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", condition: "landed", on: `demo-${landId}` });
    expect(s.reason).toBeUndefined();
    const item = await show("demo", landId);
    expect(item.status).toBe("done");
    expect(item.notes.at(-1)).toContain("job widget landed");
    expect(file(r.json.run, "land.log")).toContain(`## todo ${landId} done`);
    // The item closes in the work store; the landing commit holds only the work.
    expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", `${s.commit}~1`, s.commit)).toBe("widget.txt");
    expect(sh(base, "git", "--git-dir", itemsRemote, "log", "-1", "--format=%s", "main")).toBe("demo: todo: job widget landed");
    expect(sh(repo, "git", "status", "--porcelain", "--untracked-files=no")).toBe("");
  });
});

describe("fate from git", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const listed = async (name: string) => (await aleph(["jobs"])).json.find((j: any) => j.name === name);

  test("work ported to main by hand reads as landed, and its to-do item closes", async () => {
    const id = await add("demo", "port by hand");
    const j = await job("demo", "ported", "Goal: ported\nACTION: commit ported.txt\n", { on: String(id) });
    const tip = sh(repo, "git", "rev-parse", "job/ported");
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    sh(other, "git", "fetch", "-q", repo, "job/ported");
    sh(other, "git", "cherry-pick", tip);
    sh(other, "git", "push", "-q", "origin", "main");
    const picked = remoteGit("rev-parse", "main");
    expect(await listed("ported")).toMatchObject({ condition: "landed" });
    expect(state(j.json.run)).toMatchObject({ condition: "landed", reason: "found on main (Job trailer)", commit: picked });
    expect(existsSync(worktree("ported"))).toBe(false);
    expect((await show("demo", id)).status).toBe("done");
  });

  test("a branch whose change main already has, under another message, reads as landed", async () => {
    const j = await actionJob("twice", "commit-fixed twice.txt");
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "twice.txt"), "same\n");
    sh(other, "git", "add", "twice.txt");
    sh(other, "git", "commit", "-qm", "the same change, by hand");
    sh(other, "git", "push", "-q", "origin", "main");
    expect(await listed("twice")).toMatchObject({ condition: "landed" });
    expect(state(j.json.run)).toMatchObject({ condition: "landed", reason: "found on main (content)" });
  });

  test("a job with no branch and no worktree reads as gone, and land says the branch is gone", async () => {
    await actionJob("vanished", "commit vanished.txt");
    sh(repo, "git", "worktree", "remove", "--force", worktree("vanished"));
    sh(repo, "git", "branch", "-D", "job/vanished");
    expect(await listed("vanished")).toMatchObject({ condition: "passed", fate: "gone" });
    const r = await land("vanished");
    expect(state(r.json.run)).toMatchObject({ condition: "failed", reason: "branch gone: job/vanished" });
    await drop("vanished");
  });

  test("an open job with its branch reads as unlanded", async () => {
    await actionJob("waiting", "commit waiting.txt");
    expect(await listed("waiting")).toMatchObject({ condition: "passed", fate: "unlanded" });
    await drop("waiting");
  });
});
