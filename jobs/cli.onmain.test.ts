import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, branchExists, file, job, jobsDir, moveMain, other, remote, setOnTell, sh, specFile, state, worktree, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("an item that is already on main", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const runsOf = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));
  const add = async (title: string) => (await aleph(["issue", "add", "demo", title])).json.added as number;
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

  test("a land whose job already pushed (the first land died after the push) still closes the item", async () => {
    const id = await add("pushed by an earlier land");
    await withItem("pushedbefore", "commit pushedbefore.txt", id);
    const [agent] = runsOf("pushedbefore");
    handLand(`pushedbefore\n\nJob: ${agent.job}`, "pushed-before.txt");
    const r = await aleph(["land", "pushedbefore"]);
    expect(state(r.json.run)).toMatchObject({ kind: "land", state: "landed" });
    const item = (await aleph(["issue", "show", "demo", String(id), "--json"])).json;
    expect(item.status).toBe("done");
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

  test("drop keeps the fact that a no-commit run ended with no commit", async () => {
    await job("nocom", "commit nocom.txt");
    const [agent] = runsOf("nocom");
    const f = join(jobsDir, agent.id, "state.json");
    writeFileSync(f, JSON.stringify({ ...JSON.parse(readFileSync(f, "utf8")), state: "stuck", reason: "no commit" }));
    const r = await aleph(["drop", "nocom", "dropped as a duplicate", "--quiet"]);
    expect(r.code).toBe(0);
    const after = JSON.parse(readFileSync(f, "utf8"));
    expect(after.reason).toBe("dropped as a duplicate");
    expect(after.noCommit).toBe(true);
  }, 60_000);

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
