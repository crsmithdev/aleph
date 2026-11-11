import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { base, issueRuns, remote, sh, state, setup, teardown, seedItem } from "../../cli.helpers";
import { dispatch, issueShow } from "../../flow.testkit.ts";

// Each run's unit is a process of its own.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  test("a dispatch starts one run per open issue, lands it, and then has nothing to start", async () => {
    mkdirSync(join(base, "factory"), { recursive: true });
    const id = seedItem("fac", "ship the goal", { kind: "goal" }, "ACTION: commit goal.txt\n".trim());
    const d = (await dispatch()).json;
    expect(d.skipped).toEqual([]);
    expect(d.started).toEqual([`fac-${id}`]);
    const runs = issueRuns(id).sort();
    expect(runs.map((d) => [state(d).kind, state(d).condition])).toEqual([["build", "passed"], ["land", "landed"]]);
    expect((await issueShow("fac", id)).json.status).toBe("done");
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain(`Issue: fac-${id}`);
    expect((await dispatch()).json.started).toEqual([]);
  }, 30_000);
});
