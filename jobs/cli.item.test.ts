import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as issues from "../todo/lib/todo.ts";
import * as verbs from "../todo/lib/issues.ts";
import { aleph, base, env, file, itemsRemote, job, jobsDir, other, remote, repo, sh, specFile, state, worktree, setup, teardown, addOld, patchItem } from "./cli.helpers";

// The issue verbs run in this process; the store reads its paths from the environment, as the child's `env()` sets them.
const STORE_KEYS = ["ALEPH_ISSUES", "ALEPH_REPOS", "ALEPH_DISPATCH"];
const saved: Record<string, string | undefined> = {};
beforeAll(() => {
  setup();
  const e = env();
  for (const k of STORE_KEYS) { saved[k] = process.env[k]; process.env[k] = e[k]; }
});
afterAll(() => {
  for (const k of STORE_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  teardown();
});

const add = async (key: string, title: string, fields: verbs.Fields = {}) => (await verbs.add({ key }, title, fields)).result.added;
const show = (key: string, id: number) => { const { item } = verbs.show({ key }, id); return { status: issues.status(item), notes: item.notes }; };
const closeItem = (key: string, id: number, how: "done" | "drop", text = "") => verbs.close({ key }, id, how, text);

describe("a job tied to a to-do item", () => {
  const list = () => sh(base, "git", "--git-dir", itemsRemote, "rev-parse", "main");
  let landId: number, dropId: number;
  beforeAll(async () => {
    landId = await add("demo", "ship the widget");
    dropId = await add("demo", "paint the shed");
  });

  test("an id the list does not have is refused, and nothing starts", async () => {
    const before = readdirSync(jobsDir).length;
    const r = await aleph(["job", "demo", "badlink", "--spec", specFile("x"), "--on", "99"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("demo has no issue 99");
    expect(readdirSync(jobsDir).length).toBe(before);
  });

  test("a run writes kind build and on, never todo; --todo is refused and starts nothing", async () => {
    const id = await add("demo", "shape check", { spec: "ACTION: commit shape.txt" });
    const j = await aleph(["job", "demo", "shape", "--spec", specFile("Goal: shape\nACTION: commit shape.txt\n"), "--on", `demo-${id}`]);
    const s = state(j.json.run);
    expect(s).toMatchObject({ kind: "build", on: `demo-${id}` });
    expect(s.todo).toBeUndefined();
    await aleph(["drop", "shape"]);
    const before = readdirSync(jobsDir).length;
    const r = await aleph(["job", "demo", "shape2", "--spec", specFile("x"), "--todo", String(id)]);
    expect(r.code).toBe(1);
    expect(readdirSync(jobsDir).length).toBe(before);
  });

  test("--on takes the repo-prefixed form, and refuses another repo's prefix", async () => {
    const id = await add("demo", "prefixed");
    const j = await aleph(["job", "demo", "prefixed", "--spec", specFile("Goal: prefixed\nACTION: commit prefixed.txt\n"), "--on", `demo-${id}`]);
    expect(j.code).toBe(0);
    expect(state(j.json.run).on).toBe(`demo-${id}`);
    const bad = await aleph(["job", "demo", "otherrepo", "--spec", specFile("x"), "--on", `other-${id}`]);
    expect(bad.code).toBe(1);
    expect(bad.stderr).toContain("--on takes an issue number");
  });

  test("land marks the item done, naming the job and the landing commit", async () => {
    const j = await aleph(["job", "demo", "widget", "--spec", specFile("Goal: widget\nACTION: commit widget.txt\n"), "--on", String(landId)]);
    expect(state(j.json.run)).toMatchObject({ condition: "passed", on: `demo-${landId}` });
    const r = await aleph(["land", "widget"]);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", condition: "landed", on: `demo-${landId}` });
    expect(s.reason).toBeUndefined();
    const item = show("demo", landId);
    expect(item.status).toBe("done");
    expect(item.notes.at(-1)).toContain("job widget landed");
    expect(file(r.json.run, "land.log")).toContain(`## todo ${landId} done`);
    // The item closes in the work store; the landing commit holds only the work.
    expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", `${s.commit}~1`, s.commit)).toBe("widget.txt");
    expect(sh(base, "git", "--git-dir", itemsRemote, "log", "-1", "--format=%s", "main")).toBe("demo: todo: job widget landed");
    expect(sh(repo, "git", "status", "--porcelain", "--untracked-files=no")).toBe("");
  });

  test("drop adds a note with the reason and leaves the item open", async () => {
    await aleph(["job", "demo", "shed", "--spec", specFile("Goal: shed\nACTION: commit shed.txt\n"), "--on", String(dropId)]);
    expect((await aleph(["drop", "shed", "wrong", "colour"])).code).toBe(0);
    const item = show("demo", dropId);
    expect(item.status).toBe("open");
    expect(item.notes.at(-1)).toContain("job shed dropped: wrong colour");
  });

  test("a job without --on records none and leaves the list alone", async () => {
    const before = list();
    const j = await job("plainjob", "commit plainjob.txt");
    expect(state(j.json.run).on).toBeUndefined();
    const r = await aleph(["land", "plainjob"]);
    expect(state(r.json.run)).toMatchObject({ condition: "landed" });
    expect(state(r.json.run).on).toBeUndefined();
    expect(list()).toBe(before);
  });
});

describe("fate from git", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const listed = async (name: string) => (await aleph(["jobs"])).json.find((j: any) => j.name === name);

  test("each worker commit carries the job's trailer", async () => {
    const j = await job("stamped", "commit stamped.txt");
    expect(sh(worktree("stamped"), "git", "log", "-1", "--format=%B")).toContain(`Job: ${j.json.job}`);
    await aleph(["drop", "stamped"]);
  });

  test("work ported to main by hand reads as landed, and its to-do item closes", async () => {
    const id = await add("demo", "port by hand");
    const j = await aleph(["job", "demo", "ported", "--spec", specFile("Goal: ported\nACTION: commit ported.txt\n"), "--on", String(id)]);
    const tip = sh(repo, "git", "rev-parse", "job/ported");
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    sh(other, "git", "fetch", "-q", repo, "job/ported");
    sh(other, "git", "cherry-pick", tip);
    sh(other, "git", "push", "-q", "origin", "main");
    const picked = remoteGit("rev-parse", "main");
    expect(await listed("ported")).toMatchObject({ condition: "landed" });
    expect(state(j.json.run)).toMatchObject({ condition: "landed", reason: "found on main (Job trailer)", commit: picked });
    expect(existsSync(worktree("ported"))).toBe(false);
    expect(show("demo", id).status).toBe("done");
  });

  test("a branch whose change main already has, under another message, reads as landed", async () => {
    const j = await job("twice", "commit-fixed twice.txt");
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "twice.txt"), "same\n");
    sh(other, "git", "add", "twice.txt");
    sh(other, "git", "commit", "-qm", "the same change, by hand");
    sh(other, "git", "push", "-q", "origin", "main");
    expect(await listed("twice")).toMatchObject({ condition: "landed" });
    expect(state(j.json.run)).toMatchObject({ condition: "landed", reason: "found on main (content)" });
  });

  test("a job with no branch and no worktree reads as gone, and land says the branch is gone", async () => {
    await job("vanished", "commit vanished.txt");
    sh(repo, "git", "worktree", "remove", "--force", worktree("vanished"));
    sh(repo, "git", "branch", "-D", "job/vanished");
    expect(await listed("vanished")).toMatchObject({ condition: "passed", fate: "gone" });
    const r = await aleph(["land", "vanished"]);
    expect(state(r.json.run)).toMatchObject({ condition: "failed", reason: "branch gone: job/vanished" });
    await aleph(["drop", "vanished"]);
  });

  test("an open job with its branch reads as unlanded", async () => {
    await job("waiting", "commit waiting.txt");
    expect(await listed("waiting")).toMatchObject({ condition: "passed", fate: "unlanded" });
    await aleph(["drop", "waiting"]);
  });
});

describe("prospective memory", () => {
  const NOW = { ALEPH_NOW: "2026-10-27T12:00:00" };
  // A fresh probe, so the tick does not run one.
  beforeAll(() => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
  });
  // Old-shape items, seeded: no verb of `aleph issue` sets `goal` or `after` on an old-shape item now. The tick below does the dispatching.
  const addGoal = (title: string, ...more: string[]) => addOld(title, "", more, { ALEPH_DISPATCH: "off" });

  test("a tick skips an issue that waits on an open item until it is ready", async () => {
    const first = await add("fac", "the first thing", { spec: "ACTION: commit first.txt" });
    const second = await add("fac", "waits on the first", { spec: "ACTION: commit second.txt", after: [`fac-${first}`] });
    const t = await aleph(["tick"], { ...NOW, ALEPH_LIVE_CAP: "0" });
    expect(t.json.skipped).toContain(`fac-${second}: blocked: after fac-${first}`);
    expect(t.json.started).not.toContain(`fac-${second}`);
    patchItem("fac", `${first}`, { status: "done" });
    expect((await aleph(["tick"], NOW)).json.started).toContain(`fac-${second}`);
    // The second goal's run may end stuck, which holds the factory: clear it.
    await aleph(["drop", `fac-${second}`]);
    closeItem("fac", second, "drop", "test over");
    for (const id of [first, second]) closeItem("fac", id, "drop", "test over");
  }, 60_000);

  test("a goal waiting on several items comes due once every one is done", async () => {
    const a = await addGoal("wait a"), b = await addGoal("wait b");
    const w = await addGoal("waits on two", "--after", `fac-${a},fac-${b}`);
    closeItem("fac", a, "done");
    expect((await aleph(["report"])).stdout).not.toContain(`fac-${w} waits on two`);
    closeItem("fac", b, "done");
    expect((await aleph(["report"])).stdout).toContain(`fac-${w} waits on two`);
    closeItem("fac", w, "drop", "test over");
  }, 60_000);
});
