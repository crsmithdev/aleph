import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor } from "../../tests/wait.ts";
import { base, fakeLog, file, until, remote, repo, sh, state, setup, teardown } from "../cli.helpers";
import { actionJob, drop, issueAdd, issueShow, job, jobView, land } from "../inproc.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own, and so is its review.
// `aleph report --hook` keeps its CLI test in jobs/cli.reviewer-land.test.ts.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const fjob = (name: string, action: string) => actionJob(name, action, {}, "fac");
  const factoryBranch = (name: string) => Bun.spawnSync(["git", "-C", repo, "rev-parse", "--verify", "-q", `factory/${name}`]).exitCode === 0;
  test("a change to an existing test goes to the reviewer; its hold needs a review; drop leaves the item open", async () => {
    const id = (await issueAdd("fac", "tests")).json.added;
    const r = await job("fac", "ftest", "Goal: ftest REVIEW:hold\nACTION: commit old.test.ts\n", { on: String(id) }, { ALEPH_FIX_ROUNDS: "0" });
    expect(state(r.json.run)).toMatchObject({ condition: "awaiting", ask: expect.objectContaining({ kind: "approval", reason: "review" }), reason: expect.stringMatching(/^reviewer: hold|^reviewer: tests do not/) });
    expect(readFileSync(join(fakeLog, "review-prompt"), "utf8")).toContain("The diff changes the test old.test.ts");
    expect((await drop("ftest")).code).toBe(0);
    expect((await issueShow("fac", id)).json.status).toBe("open");
    expect(factoryBranch("ftest")).toBe(false);
  });

  test("a follow-up on a stuck job starts from the job's previous branch", async () => {
    const r = await fjob("fagain", "commit FAIL");
    expect(state(r.json.run)).toMatchObject({ condition: "stuck", reason: "tests failed" });
    expect(state(r.json.run).checks).toEqual([{ name: "tests", ok: false, seconds: expect.any(Number) }]);
    const f = await fjob("fagain", "branchlog");
    expect(readFileSync(join(fakeLog, "branchlog"), "utf8")).toContain("add FAIL");
    expect(state(f.json.run).condition).toBe("passed");
    await drop("fagain");
  });

  test("a held path needs Chris with the rule and the diff stat; his land adds Held-by", async () => {
    const r = await fjob("fheld", "commit held/x.txt");
    const s = state(r.json.run);
    expect(s).toMatchObject({ condition: "awaiting", ask: expect.objectContaining({ kind: "approval", reason: "held-path" }), reason: "held path held/x.txt" });
    expect(s.stat).toContain("held/x.txt");
    const run = r.json.run;
    await waitFor(() => file(run, "call.md").includes("VERDICT"), { timeout: 10_000, every: 100 });
    expect(file(run, "call.md")).toContain("VERDICT: chris decide the held path");
    // `aleph review` records the call on state.json once the reviewer has ended (criterion 17): `chris` reads as `ask`.
    await until(() => state(run).review !== undefined);
    expect(state(run).review).toEqual({ call: "ask", reason: "decide the held path" });
    expect((await jobView("fheld")).json.review).toEqual({ call: "ask", reason: "decide the held path" });
    expect(state(run)).toMatchObject({ condition: "awaiting", ask: { kind: "approval", reason: "held-path" } });
    expect(state(run).needs).toBeUndefined();
    const l = await land("fheld");
    expect(state(l.json.run)).toMatchObject({ condition: "landed", held: true });
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain("Held-by: Chris");
  });

  test("a held run that passes both reviews passes by itself and lands with no Held-by", async () => {
    const r = await job("fac", "fboth", "Goal: fboth REVIEW:land\nACTION: commit held/both.txt\n");
    const run = r.json.run;
    await until(() => state(run).condition === "passed");
    expect(state(run).ask).toBeUndefined();
    expect(state(run).review).toEqual({ call: "land" });
    const l = await land("fboth");
    expect(state(l.json.run).condition).toBe("landed");
    expect(state(l.json.run).held).toBeUndefined();
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).not.toContain("Held-by");
  });

  test("a security path stays with Chris when the review says land", async () => {
    const r = await job("fac", "fsec", "Goal: fsec REVIEW:land\nACTION: commit jobs/lib/gate.ts\n");
    const run = r.json.run;
    await until(() => state(run).review !== undefined);
    expect(state(run)).toMatchObject({ condition: "awaiting", ask: expect.objectContaining({ reason: "held-path" }), review: { call: "land" }, reason: "held path jobs/lib/gate.ts" });
    await drop("fsec");
  });
});
