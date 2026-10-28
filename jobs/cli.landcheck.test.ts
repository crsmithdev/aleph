import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, file, job, jobsDir, moveMain, sh, state, worktree, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a batch of lands", () => {
  const calls = () => existsSync(join(base, "batch-count")) ? readFileSync(join(base, "batch-count"), "utf8").trim().split("\n").filter(Boolean).length : 0;
  const landRuns = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-demo-${name}-`) && d.endsWith("-land")).sort().map((d) => ({ id: d, ...state(d) }));

  test("a run whose checked base is origin/main lands with no check call; one behind main runs the checks", async () => {
    await job("fresh", "commit batch/fresh.txt");
    const base1 = calls();
    const r = await aleph(["land", "fresh"]);
    expect(state(r.json.run).state).toBe("landed");
    expect(calls()).toBe(base1);
    expect(file(r.json.run, "land.log")).toContain("checks skipped: main unchanged since");
    expect(state(r.json.run).checks ?? []).toEqual([]);

    await job("stale", "commit batch/stale.txt");
    moveMain();
    const base2 = calls();
    const r2 = await aleph(["land", "stale"]);
    expect(state(r2.json.run).state).toBe("landed");
    expect(calls() - base2).toBe(1);
    expect(file(r2.json.run, "land.log")).not.toContain("checks skipped");
  }, 60_000);

  test("a commit added to the branch after its checks gets the checks on land", async () => {
    await job("tipped", "commit batch/tipped.txt");
    writeFileSync(join(worktree("tipped"), "batch", "late.txt"), "late\n");
    sh(worktree("tipped"), "git", "add", ".");
    sh(worktree("tipped"), "git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "late file");
    const before = calls();
    const r = await aleph(["land", "tipped"]);
    expect(state(r.json.run).state).toBe("landed");
    expect(calls() - before).toBe(1);
    expect(file(r.json.run, "land.log")).not.toContain("checks skipped");
  }, 60_000);

  test("two lands of one job at once start one land run", async () => {
    await job("twice", "commit batch/twice.txt");
    const rs = await Promise.all([aleph(["land", "twice"]), aleph(["land", "twice"])]);
    expect(rs.filter((r) => r.code === 0).length).toBe(1);
    expect(landRuns("twice").length).toBe(1);
  }, 60_000);
});
