// Archived goal tests from jobs/cli.onmain.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, branchExists, file, jobsDir, moveMain, other, remote, setOnTell, sh, state, worktree, setup, teardown } from "../../jobs/cli.helpers";
import { actionJob as job, drop, issueAdd, job as startJob, land } from "../../jobs/inproc";

beforeAll(setup);
afterAll(teardown);

// `aleph drop` keeps one CLI test, for its wiring; the other cases call the transitions in-process.
describe("an item that is already on main", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const runsOf = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));
  const add = async (title: string) => (await issueAdd("demo", title)).json.added as number;
  const withItem = (name: string, action: string, id: number) => startJob("demo", name, `Goal: ${name}\nACTION: ${action}\n`, { on: String(id) });
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
    writeFileSync(join(base, "item-once"), `Issue: demo-${id}`);
    const r = await land("handmid");
    const hand = remoteGit("rev-parse", "main");
    expect(remoteGit("log", "-1", "--format=%s", "main")).toBe("hand");
    expect(state(r.json.run)).toMatchObject({ kind: "land", condition: "done", reason: `item landed as ${hand.slice(0, 7)}` });
    expect(remoteGit("log", "-5", "--format=%s", "main")).not.toContain("add item-race/x.txt");
    expect(branchExists("handmid")).toBe(false);
  }, 30_000);

  test("aleph land and a fix-round aleph job refuse when the item is on main", async () => {
    const id = await add("landed by hand first");
    await withItem("handfirst", "commit handfirst.txt", id);
    handLand(`by hand\n\nIssue: demo-${id}`, "by-hand.txt");
    const before = remoteGit("rev-parse", "main");
    const l = await land("handfirst");
    expect(l.code).toBe(1);
    expect(l.stderr).toContain("the item already landed as");
    const f = await startJob("demo", "handfirst", "fix it\nACTION: commit more.txt\n");
    expect(f.code).toBe(1);
    expect(f.stderr).toContain("the item already landed as");
    expect(runsOf("handfirst").length).toBe(1);
    expect(remoteGit("rev-parse", "main")).toBe(before);
    await drop("handfirst");
  }, 30_000);

  test("an item whose commit was reverted does not refuse the land", async () => {
    const id = await add("landed then reverted");
    await withItem("reverted", "commit reverted.txt", id);
    handLand(`by hand\n\nIssue: demo-${id}`, "to-revert.txt");
    sh(other, "git", "revert", "--no-edit", "HEAD");
    sh(other, "git", "push", "-q", "origin", "main");
    expect(state((await land("reverted")).json.run)).toMatchObject({ condition: "landed" });
  }, 30_000);

  test("a conflicted land of a job with a dropped run starts no worker", async () => {
    await job("dropconf", "resolve-later dropconf.txt");
    const [agent] = runsOf("dropconf");
    // A fix round that was queued and then dropped: an earlier run of the same job.
    const old = join(jobsDir, "20200101-000000-demo-dropconf-agent");
    mkdirSync(old);
    writeFileSync(join(old, "state.json"), JSON.stringify({ kind: "build", job: old.split("/").pop(), name: "dropconf", repo: "demo", condition: "dropped", told: true, started: "2020-01-01T00:00:00Z", ended: "2020-01-01T00:00:01Z" }));
    writeFileSync(join(jobsDir, agent.id, "state.json"), JSON.stringify({ ...state(agent.id), job: old.split("/").pop() }));
    handLand("theirs", "dropconf.txt");
    const r = await land("dropconf");
    expect(state(r.json.run)).toMatchObject({ condition: "failed", reason: "merge conflict" });
    expect(runsOf("dropconf").map((x) => x.kind)).toEqual(["build", "build", "land"]);
    expect(state(r.json.run).next).toBeUndefined();
    expect(file(r.json.run, "next.log")).toContain("dropped: no worker started");
    rmSync(old, { recursive: true });
  }, 30_000);

  test("a conflicted land whose item reached main meanwhile starts no worker", async () => {
    const id = await add("lands while the land fails");
    await withItem("lateitem", "resolve-later lateitem.txt", id);
    handLand("theirs", "lateitem.txt");
    setOnTell((text) => { if (text.startsWith("demo/lateitem failed")) handLand(`by hand\n\nIssue: demo-${id}`, "late-hand.txt"); });
    try {
      const r = await land("lateitem");
      expect(state(r.json.run)).toMatchObject({ condition: "failed", reason: "merge conflict" });
      expect(runsOf("lateitem").map((x) => x.kind)).toEqual(["build", "land"]);
      expect(state(r.json.run).next).toBeUndefined();
      expect(file(r.json.run, "next.log")).toContain("item landed as");
    } finally {
      setOnTell(undefined);
    }
    await drop("lateitem");
  }, 30_000);

  test("drop stops every live run of the job and marks each dropped", async () => {
    await job("twolive", "commit twolive.txt");
    const [agent] = runsOf("twolive");
    const procs: ReturnType<typeof Bun.spawn>[] = [];
    const folders = ["20261027-235958", "20261027-235959"].map((t) => {
      const folder = join(jobsDir, `${t}-demo-twolive-agent`);
      mkdirSync(folder);
      writeFileSync(join(folder, "state.json"), JSON.stringify({ kind: "build", job: agent.id, name: "twolive", repo: "demo", branch: "job/twolive", worktree: worktree("twolive"), condition: "running", told: false, started: new Date().toISOString() }));
      const p = Bun.spawn(["bash", "-c", "sleep 60; :", folder], { stdout: "ignore", stderr: "ignore" });
      procs.push(p);
      writeFileSync(join(folder, "pid"), String(p.pid));
      return folder;
    });
    const r = await drop("twolive");

    expect(r.code).toBe(0);
    for (const f of folders) {
      expect(JSON.parse(readFileSync(join(f, "state.json"), "utf8")).condition).toBe("dropped");
      expect(existsSync(join(f, "exit"))).toBe(true);
    }
    await Promise.all(procs.map((p) => p.exited));
    expect(branchExists("twolive")).toBe(false);
  }, 60_000);
});
