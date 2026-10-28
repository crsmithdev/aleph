import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, job, jobsDir, remote, sh, specFile, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a batch of lands", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const calls = () => existsSync(join(base, "batch-count")) ? readFileSync(join(base, "batch-count"), "utf8").trim().split("\n").filter(Boolean).length : 0;
  const pushes = () => existsSync(join(base, "pushes")) ? readFileSync(join(base, "pushes"), "utf8").trim().split("\n").filter(Boolean).length : 0;
  const landRuns = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`) && d.endsWith("-land") && existsSync(join(jobsDir, d, "state.json"))).sort().map((d) => ({ id: d, ...state(d) }));
  const lockDir = () => join(base, "run", "aleph", "land-demo");
  let landCalls = 0;
  /** Until the land run of `name` is queued on the repo's land lock, where a leader's batch can take it. */
  async function queued(name: string): Promise<void> {
    const deadline = Date.now() + 30_000;
    const phase = () => { try { return landRuns(name)[0]?.phase; } catch { return undefined; } };
    // The run folder is there a moment before its state.json.
    while (phase() !== "queued" && Date.now() < deadline) await Bun.sleep(20);
  }

  beforeEach(() => {
    rmSync(join(base, "batch-count"), { force: true });
    rmSync(join(base, "pushes"), { force: true });
    writeFileSync(join(remote, "hooks", "pre-receive"), `#!/bin/sh\necho x >> ${join(base, "pushes")}\ncat > /dev/null\n`, { mode: 0o755 });
  });
  afterAll(() => rmSync(join(remote, "hooks", "pre-receive"), { force: true }));

  /** Passed jobs, then their lands started one by one while another process holds the repo's land lock; returns the lands' results once the lock is let go. */
  async function landTogether(jobs: [string, string][], beforeLand?: () => void): Promise<{ job: string; run: string }[]> {
    const ids: Record<string, string> = {};
    for (const [name, action] of jobs) ids[name] = (await job(name, action)).json.job;
    beforeLand?.();
    mkdirSync(join(base, "run", "aleph"), { recursive: true });
    mkdirSync(lockDir());
    writeFileSync(join(lockDir(), "owner"), String(process.pid));
    const callsBefore = calls();
    const started: Promise<unknown>[] = [];
    for (const [name] of jobs) {
      started.push(aleph(["land", name]));
      await queued(name);
    }
    rmSync(lockDir(), { recursive: true, force: true });
    await Promise.all(started);
    landCalls = calls() - callsBefore;
    return jobs.map(([name]) => ({ job: ids[name], run: landRuns(name)[0].id }));
  }

  test("a batch of three: one check call, one push, three commits, each run landed with its own Item and Job trailers", async () => {
    const items = [] as number[];
    for (const t of ["x1", "x2", "x3"]) items.push((await aleph(["todo", "add", "demo", t])).json.added);
    const ids: string[] = [];
    for (const [i, n] of ["t1", "t2", "t3"].entries()) ids.push((await aleph(["job", "demo", n, "--spec", specFile(`Goal: ${n}\nACTION: commit batch/t${i}.txt\n`), "--todo", String(items[i])])).json.job);
    const before = calls();
    mkdirSync(join(base, "run", "aleph"), { recursive: true });
    mkdirSync(lockDir());
    writeFileSync(join(lockDir(), "owner"), String(process.pid));
    const started: Promise<unknown>[] = [];
    for (const n of ["t1", "t2", "t3"]) {
      started.push(aleph(["land", n]));
      await queued(n);
    }
    rmSync(lockDir(), { recursive: true, force: true });
    await Promise.all(started);
    expect(calls() - before).toBe(1);
    expect(pushes()).toBe(1);
    const log = remoteGit("log", "-3", "--format=%B%x00", "main").split("\0").map((m) => m.trim()).filter(Boolean).reverse();
    expect(log.length).toBe(3);
    for (const [i, n] of ["t1", "t2", "t3"].entries()) {
      expect(log[i]).toContain(`Item: demo-${items[i]}`);
      expect(log[i]).toContain(`Job: ${ids[i]}`);
      const s = state(landRuns(n)[0].id);
      expect(s).toMatchObject({ state: "landed" });
      expect(remoteGit("log", "-1", "--format=%H", `--grep=^Job: ${ids[i]}$`, "main")).toBe(s.commit);
    }
    expect(readFileSync(join(jobsDir, landRuns("t1")[0].id, "land.log"), "utf8")).toContain("batch of 3");
  }, 120_000);

  test("a run that breaks the check fails with the check's name; the others land; at most 1 + 2 + 2 checks", async () => {
    const lands = await landTogether([["a", "commit batch/a.txt"], ["bad", "commit batch/bad.txt"], ["c", "commit batch/c.txt"]]);
    const s = lands.map((l) => state(l.run));
    expect(s.map((x) => x.state)).toEqual(["landed", "failed", "landed"]);
    expect(s[1].reason).toBe("batchbad failed");
    expect(s[1].checks).toContainEqual(expect.objectContaining({ name: "batchbad", ok: false }));
    for (const i of [0, 2]) {
      expect(s[i].checks?.length).toBeGreaterThan(0);
      expect(s[i].checks!.every((c: { ok: boolean }) => c.ok)).toBe(true);
    }
    expect(landCalls).toBeLessThanOrEqual(1 + 2 + 2);
    expect(remoteGit("ls-tree", "--name-only", "main:batch").split("\n")).toEqual(expect.arrayContaining(["a.txt", "c.txt"]));
    expect(remoteGit("ls-tree", "--name-only", "main:batch").split("\n")).not.toContain("bad.txt");
    expect(pushes()).toBe(1);
    await aleph(["drop", "bad"]);
  }, 120_000);

  test("a conflict in one run takes only that run out", async () => {
    const lands = await landTogether([["k1", "commit-fixed batch/k.txt"], ["k2", "commit batch/k.txt"], ["k3", "commit batch/k3.txt"]]);
    const s = lands.map((l) => state(l.run));
    expect(s.map((x) => x.state)).toEqual(["landed", "failed", "landed"]);
    expect(s[1]).toMatchObject({ reason: "merge conflict", conflicts: ["batch/k.txt"] });
    expect(readFileSync(join(jobsDir, lands[1].run, "land.log"), "utf8")).toContain("batch/k.txt");
    expect(remoteGit("ls-tree", "--name-only", "main:batch").split("\n")).toEqual(expect.arrayContaining(["k.txt", "k3.txt"]));
    await aleph(["drop", "k2"]);
  }, 120_000);

});
