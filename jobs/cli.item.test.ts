import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, branchExists, file, itemsRemote, job, jobsDir, moveMain, other, remote, repo, setOnTell, sh, specFile, state, worktree, setup, teardown } from "./cli.helpers";

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

describe("an item that is already on main", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const runsOf = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));
  const add = async (title: string) => (await aleph(["todo", "add", "demo", title])).json.added as number;
  const withItem = (name: string, action: string, id: number) =>
    aleph(["job", "demo", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), "--todo", String(id)]);
  function handLand(message: string, f: string): void {
    sh(other, "git", "fetch", "-q", "origin");
    sh(other, "git", "reset", "-q", "--hard", "origin/main");
    writeFileSync(join(other, f), `${Math.random()}\n`);
    sh(other, "git", "add", f);
    sh(other, "git", "commit", "-qm", message);
    sh(other, "git", "push", "-q", "origin", "main");
  }

  test("a land whose item another commit landed meanwhile ends done and does not push", async () => {
    const id = await add("landed by hand mid-land");
    await withItem("handmid", "commit item-race/x.txt", id);
    moveMain();
    writeFileSync(join(base, "item-once"), `Item: demo-${id}`);
    const r = await aleph(["land", "handmid"]);
    const hand = remoteGit("rev-parse", "main");
    expect(remoteGit("log", "-1", "--format=%s", "main")).toBe("hand");
    expect(state(r.json.run)).toMatchObject({ kind: "land", state: "done", reason: `item landed as ${hand.slice(0, 7)}` });
    expect(remoteGit("log", "-5", "--format=%s", "main")).not.toContain("add item-race/x.txt");
    expect(branchExists("handmid")).toBe(false);
  }, 30_000);

  test("aleph land and a fix-round aleph job refuse when the item is on main", async () => {
    const id = await add("landed by hand first");
    await withItem("handfirst", "commit handfirst.txt", id);
    handLand(`by hand\n\nItem: demo-${id}`, "by-hand.txt");
    const before = remoteGit("rev-parse", "main");
    const l = await aleph(["land", "handfirst"]);
    expect(l.code).toBe(1);
    expect(l.stderr).toContain("the item already landed as");
    const f = await aleph(["job", "demo", "handfirst", "--spec", specFile("fix it\nACTION: commit more.txt\n")]);
    expect(f.code).toBe(1);
    expect(f.stderr).toContain("the item already landed as");
    expect(runsOf("handfirst").length).toBe(1);
    expect(remoteGit("rev-parse", "main")).toBe(before);
    await aleph(["drop", "handfirst"]);
  }, 30_000);

  test("an item whose commit was reverted does not refuse the land", async () => {
    const id = await add("landed then reverted");
    await withItem("reverted", "commit reverted.txt", id);
    handLand(`by hand\n\nItem: demo-${id}`, "to-revert.txt");
    sh(other, "git", "revert", "--no-edit", "HEAD");
    sh(other, "git", "push", "-q", "origin", "main");
    expect(state((await aleph(["land", "reverted"])).json.run)).toMatchObject({ state: "landed" });
  }, 30_000);

  test("a conflicted land of a job with a dropped run starts no worker", async () => {
    await job("dropconf", "resolve-later dropconf.txt");
    const [agent] = runsOf("dropconf");
    // A fix round that was queued and then dropped: an earlier run of the same job.
    const old = join(jobsDir, "20200101-000000-demo-dropconf-agent");
    mkdirSync(old);
    writeFileSync(join(old, "state.json"), JSON.stringify({ kind: "agent", job: old.split("/").pop(), name: "dropconf", repo: "demo", state: "dropped", told: true, started: "2020-01-01T00:00:00Z", ended: "2020-01-01T00:00:01Z" }));
    writeFileSync(join(jobsDir, agent.id, "state.json"), JSON.stringify({ ...state(agent.id), job: old.split("/").pop() }));
    handLand("theirs", "dropconf.txt");
    const r = await aleph(["land", "dropconf"]);
    expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "merge conflict" });
    expect(runsOf("dropconf").map((x) => x.kind)).toEqual(["agent", "agent", "land"]);
    expect(state(r.json.run).next).toBeUndefined();
    expect(file(r.json.run, "next.log")).toContain("dropped: no worker started");
    rmSync(old, { recursive: true });
  }, 30_000);

  test("a conflicted land whose item reached main meanwhile starts no worker", async () => {
    const id = await add("lands while the land fails");
    await withItem("lateitem", "resolve-later lateitem.txt", id);
    handLand("theirs", "lateitem.txt");
    setOnTell((text) => { if (text.startsWith("demo/lateitem failed")) handLand(`by hand\n\nItem: demo-${id}`, "late-hand.txt"); });
    try {
      const r = await aleph(["land", "lateitem"]);
      expect(state(r.json.run)).toMatchObject({ state: "failed", reason: "merge conflict" });
      expect(runsOf("lateitem").map((x) => x.kind)).toEqual(["agent", "land"]);
      expect(state(r.json.run).next).toBeUndefined();
      expect(file(r.json.run, "next.log")).toContain("item landed as");
    } finally {
      setOnTell(undefined);
    }
    await aleph(["drop", "lateitem"]);
  }, 30_000);

  test("drop stops every live run of the job and marks each dropped", async () => {
    await job("twolive", "commit twolive.txt");
    const [agent] = runsOf("twolive");
    const procs: ReturnType<typeof Bun.spawn>[] = [];
    const folders = ["20261027-235958", "20261027-235959"].map((t) => {
      const folder = join(jobsDir, `${t}-demo-twolive-agent`);
      mkdirSync(folder);
      writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "agent", job: agent.id, name: "twolive", repo: "demo", branch: "job/twolive", worktree: worktree("twolive"), state: "running", told: false, started: new Date().toISOString() }));
      const p = Bun.spawn(["bash", "-c", "sleep 60; :", folder], { stdout: "ignore", stderr: "ignore" });
      procs.push(p);
      writeFileSync(join(folder, "pid"), String(p.pid));
      return folder;
    });
    const r = await aleph(["drop", "twolive"]);

    expect(r.code).toBe(0);
    for (const f of folders) {
      expect(JSON.parse(readFileSync(join(f, "state.json"), "utf8")).state).toBe("dropped");
      expect(existsSync(join(f, "exit"))).toBe(true);
    }
    await Promise.all(procs.map((p) => p.exited));
    expect(branchExists("twolive")).toBe(false);
  }, 60_000);
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
});

describe("land follows main", () => {
  const land = async (name: string, action: string, repoKey = "demo", extra: Record<string, string> = {}) => {
    await job(name, action, {}, repoKey);
    return aleph(["land", name], extra);
  };

  test("a clean main checkout moves to the landed commit", async () => {
    const r = await land("follow1", "commit follow1.txt");
    expect(sh(repo, "git", "rev-parse", "HEAD")).toBe(state(r.json.run).commit);
    expect(file(r.json.run, "land.log")).toContain("main checkout updated");
  });

  test("a tracked change in the main checkout keeps it where it is, and the land still lands", async () => {
    writeFileSync(join(repo, "README"), "edited\n");
    const head = sh(repo, "git", "rev-parse", "HEAD");
    const r = await land("follow2", "commit follow2.txt");
    expect(state(r.json.run).state).toBe("landed");
    expect(sh(repo, "git", "rev-parse", "HEAD")).toBe(head);
    expect(file(r.json.run, "land.log")).toContain("README");
    sh(repo, "git", "checkout", "README");
    sh(repo, "git", "merge", "-q", "--ff-only", "origin/main");
  });

  test("a main checkout on another branch is not moved, and the log says which", async () => {
    sh(repo, "git", "checkout", "-q", "-b", "elsewhere");
    const r = await land("follow3", "commit follow3.txt");
    expect(state(r.json.run).state).toBe("landed");
    expect(file(r.json.run, "land.log")).toContain("it is on elsewhere");
    sh(repo, "git", "checkout", "-q", "main");
    sh(repo, "git", "branch", "-q", "-D", "elsewhere");
    sh(repo, "git", "merge", "-q", "--ff-only", "origin/main");
  });

  test("aleph-ui restarts when an aleph land changes ui/, and only then", async () => {
    const bin = join(base, "systemctl-bin");
    const rec = join(base, "systemctl.args");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "systemctl"), `#!/bin/sh\necho "$@" >> ${rec}\n`, { mode: 0o755 });
    const extra = { PATH: `${bin}:${process.env.PATH}` };
    await land("follow4", "commit docs-only.txt", "aleph", extra);
    expect(existsSync(rec)).toBe(false);
    const r = await land("follow5", "commit ui/x", "aleph", extra);
    expect(readFileSync(rec, "utf8")).toBe("--user try-restart --no-block aleph-ui.service\n");
    expect(file(r.json.run, "land.log")).toContain("aleph-ui restarted");
  });

  test("a failed restart leaves the land landed, and a later land restarts for an earlier ui/ commit", async () => {
    const bin = join(base, "systemctl-bin2");
    const rec = join(base, "systemctl2.args");
    mkdirSync(bin, { recursive: true });
    // A PATH with the tools the land needs and no systemctl: spawning it throws.
    const bare = join(base, "bare-bin");
    mkdirSync(bare, { recursive: true });
    for (const tool of ["bun", "git", "sh", "bash", "env", "timeout"]) {
      const found = Bun.which(tool);
      if (found && !existsSync(join(bare, tool))) symlinkSync(found, join(bare, tool));
    }
    const nopath = { PATH: bare };
    // systemctl cannot be spawned: the land still lands.
    sh(repo, "git", "checkout", "-q", "main");
    writeFileSync(join(repo, "README"), "dirty\n");
    const a = await land("follow6", "commit ui/y", "aleph", nopath);
    expect(state(a.json.run).state).toBe("landed");
    sh(repo, "git", "checkout", "README");
    // The checkout was dirty, so it did not move; the next land moves it across ui/y.
    writeFileSync(join(bin, "systemctl"), `#!/bin/sh\necho "$@" >> ${rec}\n`, { mode: 0o755 });
    const b = await land("follow7", "commit other.txt", "aleph", { PATH: `${bin}:${process.env.PATH}` });
    expect(readFileSync(rec, "utf8")).toBe("--user try-restart --no-block aleph-ui.service\n");
    expect(file(b.json.run, "land.log")).toContain("aleph-ui restarted");
  });
});

