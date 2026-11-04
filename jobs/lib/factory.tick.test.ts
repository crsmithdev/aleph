import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, jobsDir, remote, sh, state, setup, teardown, seedItem } from "../cli.helpers";
import { issueShow } from "../inproc.ts";
import { tick } from "./flow.testkit.ts";

// The ticks run in-process, as `aleph tick` runs them; each run's unit is a process of its own.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  test("a tick starts one run per open goal, lands it, and then has nothing to start", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    const id = seedItem("fac", "ship the goal", { kind: "goal" }, "ACTION: commit goal.txt\n".trim());
    const t = await tick();
    expect(t.skipped).toEqual([]);
    expect(t.started).toEqual([`fac-${id}`]);
    const runs = readdirSync(jobsDir).filter((d) => d.includes(`-fac-fac-${id}-`)).sort();
    expect(runs.map((d) => [state(d).kind, state(d).condition])).toEqual([["build", "passed"], ["land", "landed"]]);
    expect((await issueShow("fac", id)).json.status).toBe("done");
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain(`Issue: fac-${id}`);
    expect((await tick()).started).toEqual([]);
  }, 30_000);
});
