import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, itemsRemote, job, jobsDir, other, remote, repo, sh, specFile, state, worktree, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a job tied to a to-do item", () => {
  const list = () => sh(base, "git", "--git-dir", itemsRemote, "rev-parse", "main");
  const show = async (id: number) => (await aleph(["todo", "show", "demo", String(id), "--json"])).json;
  let landId: number, dropId: number;
  beforeAll(async () => {
    landId = (await aleph(["todo", "add", "demo", "ship the widget"])).json.added;
    dropId = (await aleph(["todo", "add", "demo", "paint the shed"])).json.added;
  });

  test("an id the list does not have is refused, and nothing starts", async () => {
    const before = readdirSync(jobsDir).length;
    const r = await aleph(["job", "demo", "badlink", "--spec", specFile("x"), "--todo", "99"]);
    expect(r.code).toBe(1);
    expect(r.stderr).toContain("demo has no issue 99");
    expect(readdirSync(jobsDir).length).toBe(before);
  });

  test("land marks the item done, naming the job and the landing commit", async () => {
    const j = await aleph(["job", "demo", "widget", "--spec", specFile("Goal: widget\nACTION: commit widget.txt\n"), "--todo", String(landId)]);
    expect(state(j.json.run)).toMatchObject({ state: "passed", todo: landId });
    const r = await aleph(["land", "widget"]);
    const s = state(r.json.run);
    expect(s).toMatchObject({ kind: "land", state: "landed", todo: landId });
    expect(s.reason).toBeUndefined();
    const item = await show(landId);
    expect(item.status).toBe("done");
    expect(item.notes.at(-1)).toContain("job widget landed");
    expect(file(r.json.run, "land.log")).toContain(`## todo ${landId} done`);
    // The item closes in the work store; the landing commit holds only the work.
    expect(sh(base, "git", "--git-dir", remote, "diff", "--name-only", `${s.commit}~1`, s.commit)).toBe("widget.txt");
    expect(sh(base, "git", "--git-dir", itemsRemote, "log", "-1", "--format=%s", "main")).toBe("demo: todo: job widget landed");
    expect(sh(repo, "git", "status", "--porcelain", "--untracked-files=no")).toBe("");
  });

  test("drop adds a note with the reason and leaves the item open", async () => {
    await aleph(["job", "demo", "shed", "--spec", specFile("Goal: shed\nACTION: commit shed.txt\n"), "--todo", String(dropId)]);
    expect((await aleph(["drop", "shed", "wrong", "colour"])).code).toBe(0);
    const item = await show(dropId);
    expect(item.status).toBe("open");
    expect(item.notes.at(-1)).toContain("job shed dropped: wrong colour");
  });

  test("a job without --todo records none and leaves the list alone", async () => {
    const before = list();
    const j = await job("plainjob", "commit plainjob.txt");
    expect(state(j.json.run).todo).toBeUndefined();
    const r = await aleph(["land", "plainjob"]);
    expect(state(r.json.run)).toMatchObject({ state: "landed" });
    expect(state(r.json.run).todo).toBeUndefined();
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
    const id = (await aleph(["todo", "add", "demo", "port by hand"])).json.added;
    const j = await aleph(["job", "demo", "ported", "--spec", specFile("Goal: ported\nACTION: commit ported.txt\n"), "--todo", String(id)]);
    const tip = sh(repo, "git", "rev-parse", "job/ported");
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    sh(other, "git", "fetch", "-q", repo, "job/ported");
    sh(other, "git", "cherry-pick", tip);
    sh(other, "git", "push", "-q", "origin", "main");
    const picked = remoteGit("rev-parse", "main");
    expect(await listed("ported")).toMatchObject({ state: "landed" });
    expect(state(j.json.run)).toMatchObject({ state: "landed", reason: "found on main (Job trailer)", commit: picked });
    expect(existsSync(worktree("ported"))).toBe(false);
    expect((await aleph(["todo", "show", "demo", String(id), "--json"])).json.status).toBe("done");
  });

  test("a branch whose change main already has, under another message, reads as landed", async () => {
    const j = await job("twice", "commit-fixed twice.txt");
    sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
    writeFileSync(join(other, "twice.txt"), "same\n");
    sh(other, "git", "add", "twice.txt");
    sh(other, "git", "commit", "-qm", "the same change, by hand");
    sh(other, "git", "push", "-q", "origin", "main");
    expect(await listed("twice")).toMatchObject({ state: "landed" });
    expect(state(j.json.run)).toMatchObject({ state: "landed", reason: "found on main (content)" });
  });

  test("a job with no branch and no worktree reads as gone, and land says the branch is gone", async () => {
    await job("vanished", "commit vanished.txt");
    sh(repo, "git", "worktree", "remove", "--force", worktree("vanished"));
    sh(repo, "git", "branch", "-D", "job/vanished");
    expect(await listed("vanished")).toMatchObject({ state: "passed", fate: "gone" });
    const r = await aleph(["land", "vanished"]);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "branch gone: job/vanished" });
    await aleph(["drop", "vanished"]);
  });

  test("an open job with its branch reads as unlanded", async () => {
    await job("waiting", "commit waiting.txt");
    expect(await listed("waiting")).toMatchObject({ state: "passed", fate: "unlanded" });
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
  const add = async (title: string, ...more: string[]) => (await aleph(["todo", "add", "fac", title, ...more])).json.added as number;

  test("a tick skips a goal due tomorrow, and one that waits on an open item, until it is ready", async () => {
    const later = await add("due tomorrow", "--labels", "goal", "--due", "2026-10-28");
    const first = await add("the first thing");
    const second = await add("waits on the first", "--labels", "goal", "--waiting-on", `fac-${first}`);
    const t = await aleph(["tick"], NOW);
    expect(t.json.skipped).toContain(`fac-${later}: due 2026-10-28`);
    expect(t.json.skipped).toContain(`fac-${second}: waiting on fac-${first}`);
    expect(t.json.started).not.toContain(`fac-${later}`);
    expect(t.json.started).not.toContain(`fac-${second}`);
    await aleph(["todo", "done", "fac", String(first)]);
    expect((await aleph(["tick"], NOW)).json.started).toContain(`fac-${second}`);
    // The second goal's run may end stuck, which holds the factory: clear it.
    await aleph(["drop", `fac-${second}`]);
    await aleph(["todo", "drop", "fac", String(second), "test over"]);
    // The day after, the dated goal starts.
    expect((await aleph(["tick"], { ALEPH_NOW: "2026-10-28T08:00:00" })).json.started).toContain(`fac-${later}`);
    for (const id of [later, first, second]) await aleph(["todo", "drop", "fac", String(id), "test over"]);
  }, 60_000);

  test("one report after a gap lists every item that fell due under 'came due', and the next lists none", async () => {
    const ids = [await add("due one", "--due", "2026-11-01"), await add("due two", "--due", "2026-11-10"), await add("due three", "--due", "2026-11-20")];
    const future = await add("due much later", "--due", "2027-01-01");
    const first = await aleph(["report"], { ALEPH_NOW: "2026-12-01T09:00:00" });
    expect(first.stdout).toContain("came due");
    for (const [n, id] of ids.entries()) expect(first.stdout).toContain(`fac-${id} due ${["one", "two", "three"][n]}`);
    expect(first.stdout).not.toContain(`fac-${future}`);
    const second = await aleph(["report"], { ALEPH_NOW: "2026-12-01T09:00:00" });
    expect(second.stdout).not.toContain("came due");
    for (const id of ids) expect(second.stdout).not.toContain(`fac-${id} `);
    expect(readFileSync(join(base, "factory", "seen"), "utf8")).toContain(`fac-${ids[0]}`);
    for (const id of [...ids, future]) await aleph(["todo", "drop", "fac", String(id), "test over"]);
  }, 60_000);

  test("a goal waiting on several items comes due once every one is done", async () => {
    const a = await add("wait a"), b = await add("wait b");
    const w = await add("waits on two", "--waiting-on", `fac-${a},fac-${b}`);
    await aleph(["todo", "done", "fac", String(a)]);
    expect((await aleph(["report"])).stdout).not.toContain(`fac-${w} waits on two`);
    await aleph(["todo", "done", "fac", String(b)]);
    expect((await aleph(["report"])).stdout).toContain(`fac-${w} waits on two`);
    await aleph(["todo", "drop", "fac", String(w), "test over"]);
  }, 60_000);
});
