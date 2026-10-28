import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, job, jobsDir, remote, sh, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a batch of lands", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const landRuns = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`) && d.endsWith("-land") && existsSync(join(jobsDir, d, "state.json"))).sort().map((d) => ({ id: d, ...state(d) }));
  const lockDir = () => join(base, "run", "aleph", "land-demo");

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
    const started: Promise<unknown>[] = [];
    for (const [name] of jobs) {
      started.push(aleph(["land", name]));
      await queued(name);
    }
    rmSync(lockDir(), { recursive: true, force: true });
    await Promise.all(started);
    return jobs.map(([name]) => ({ job: ids[name], run: landRuns(name)[0].id }));
  }

  test("a member that failed its checks in attempt 1 is not in the retry after main moved", async () => {
    const lands = await landTogether([["ra", "commit retry/a.txt"], ["rbad", "commit retry/bad.txt"], ["rr", "commit race/r.txt"]], () => writeFileSync(join(base, "race-once"), ""));
    const s = lands.map((l) => state(l.run));
    expect(s.map((x) => x.state)).toEqual(["landed", "failed", "landed"]);
    const log = file(lands[0].run, "land.log");
    const retry = log.slice(log.indexOf("main moved; merging again"));
    expect(retry).toContain("checks on");
    expect(retry).not.toContain("retrybad failed");
    expect(remoteGit("ls-tree", "--name-only", "main:retry").split("\n")).not.toContain("bad.txt");
    await aleph(["drop", "rbad"]);
  }, 120_000);

  test("a member that failed in attempt 1 does not take the leader out when main moves twice", async () => {
    const lands = await landTogether([["tla", "commit twice/a.txt"], ["tlbad", "commit twice/bad.txt"], ["tlr", "commit race/tl.txt"]], () => writeFileSync(join(base, "race-once"), "2\n"));
    const s = lands.map((l) => state(l.run));
    expect(s.map((x) => x.state)).toEqual(["landed", "failed", "landed"]);
    expect(file(lands[0].run, "land.log").split("main moved; merging again").length - 1).toBe(2);
    expect(remoteGit("ls-tree", "--name-only", "main:twice").split("\n")).toEqual(["a.txt"]);
    await aleph(["drop", "tlbad"]);
  }, 120_000);

  test("a two-member batch [L, B]: B fails in attempt 1, main moves twice, and the leader still lands", async () => {
    const lands = await landTogether([["tl2a", "commit race/l2.txt"], ["tl2bad", "commit race/bad.txt"]], () => writeFileSync(join(base, "race-once"), "2\n"));
    const s = lands.map((l) => state(l.run));
    expect(s.map((x) => x.state)).toEqual(["landed", "failed"]);
    expect(file(lands[0].run, "land.log").split("main moved; merging again").length - 1).toBe(2);
    expect(remoteGit("ls-tree", "--name-only", "main:race").split("\n")).toContain("l2.txt");
    expect(remoteGit("ls-tree", "--name-only", "main:race").split("\n")).not.toContain("bad.txt");
    await aleph(["drop", "tl2bad"]);
  }, 120_000);
});
