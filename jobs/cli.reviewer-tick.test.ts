import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, jobsDir, remote, sh, state, setup, teardown, seedItem } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  test("a tick starts one run per open goal, lands it, and then has nothing to start", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const id =seedItem("fac", "ship the goal", { kind: "goal" }, "ACTION: commit goal.txt\n".trim());
    const t = await aleph(["tick"]);
    expect(t.json.skipped).toEqual([]);
    expect(t.json.started).toEqual([`fac-${id}`]);
    const runs = readdirSync(jobsDir).filter((d) => d.includes(`-fac-fac-${id}-`)).sort();
    expect(runs.map((d) => [state(d).kind, state(d).condition])).toEqual([["build", "passed"], ["land", "landed"]]);
    expect((await aleph(["issue", "show", "fac", String(id), "--json"])).json.status).toBe("done");
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain(`Issue: fac-${id}`);
    expect((await aleph(["tick"])).json.started).toEqual([]);
  }, 30_000);

  test("caps.json sets the day cap, and ALEPH_DAY_CAP wins over it", async () => {
    const file = join(base, "factory", "caps.json");
    const own = { ALEPH_JOBS_DIR: join(base, "caps-jobs") };
    mkdirSync(own.ALEPH_JOBS_DIR);
    const ids: number[] = [];
    for (const n of [1, 2, 3]) ids.push(seedItem("fac", `caps goal ${n}`, { kind: "goal" }, "ACTION: error\n".trim()));
    mkdirSync(join(base, "factory"), { recursive: true });
    // A fresh passing probe, so the tick does not run the sandbox probe when this test runs alone.
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    writeFileSync(file, JSON.stringify({ day: 2 }));
    try {
      const t = await aleph(["tick"], { ...own, ALEPH_DAY_CAP: "" });
      expect(t.json.started.length).toBe(2);
      expect(t.json.skipped.some((x: string) => x.includes("cap of 2 runs in 24 hours"))).toBe(true);
      expect((await aleph(["report"], { ...own, ALEPH_DAY_CAP: "" })).stdout).toContain("of 2");
      // the two runs fail and hold the factory; drop them so the next tick can start one
      for (const job of t.json.started) await aleph(["drop", job], own);
      const wins = await aleph(["tick"], { ...own, ALEPH_DAY_CAP: "3" });
      expect(wins.json.started.length).toBe(1);
    } finally {
      rmSync(file, { force: true });
      for (const id of ids) await aleph(["issue", "drop", "fac", String(id), "test over"]);
    }
  }, 60_000);
});
