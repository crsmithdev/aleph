// Archived goal tests from jobs/lib/review.land.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { base, jobsDir, remote, sh, state, setup, teardown } from "../../../jobs/cli.helpers";
import { actionJob, drop, issueClose, issueList, issueShow, jobView, land } from "../../../jobs/inproc.ts";
import { reportText, statusLine } from "../../../jobs/lib/flow.testkit.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
// `aleph report --hook` keeps its CLI test in jobs/cli.reviewer-land.test.ts.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const remoteGit = (...a: string[]) => sh(base, "git", "--git-dir", remote, ...a);
  const fjob = (name: string, action: string) => actionJob(name, action, {}, "fac");
  // A copy of the land-suite case in jobs/lib/review.land.test.ts: the report test below reads the fheld run it leaves.
  test("a held path needs Chris with the rule and the diff stat; his land adds Held-by", async () => {
    const r = await fjob("fheld", "commit held/x.txt");
    const s = state(r.json.run);
    expect(s).toMatchObject({ condition: "awaiting", ask: expect.objectContaining({ kind: "approval", reason: "held-path" }), reason: "held path held/x.txt" });
    expect(s.stat).toContain("held/x.txt");
    const run = r.json.run;
    // No second review: no call.md, and no review call on the run or the job.
    expect(existsSync(join(jobsDir, run, "call.md"))).toBe(false);
    expect(state(run).review).toBeUndefined();
    expect((await jobView("fheld")).json.review).toBeUndefined();
    expect(state(run)).toMatchObject({ condition: "awaiting", ask: { kind: "approval", reason: "held-path" } });
    expect(state(run).needs).toBeUndefined();
    const l = await land("fheld");
    expect(state(l.json.run)).toMatchObject({ condition: "landed", held: true });
    expect(remoteGit("log", "-1", "--format=%(trailers:only)", "main")).toContain("Held-by: Chris");
  });

  test("DEFAULT lines and the cost reach the report once; FOLLOWUP lines file a worker issue", async () => {
    const r = await fjob("fdefault", "defaults");
    expect(state(r.json.run)).toMatchObject({ condition: "passed", cost: 0.25, defaults: ["which colour? -> blue"] });
    const filed = (await issueList("fac")).json.filter((i: any) => i.title === "paint the fence" && i.source === "worker");
    expect(filed).toHaveLength(1);
    expect((await issueShow("fac", filed[0].id)).json.request).toContain("fdefault");
    expect(await statusLine("fac", filed[0].id)).toContain("new");
    expect(existsSync(join(base, "factory", "followups.log"))).toBe(false);
    const rep = await reportText();
    expect(rep).toContain("fac/fdefault passed");
    expect(rep).toContain("DEFAULT: which colour? -> blue");
    expect(rep).toContain("cost $0.25 at the API price");
    expect(rep).toContain("fac/fheld awaiting (held): held path held/x.txt");
    expect(rep).toContain("aleph land fheld");
    expect(rep).toMatch(/runs in the last 24 hours: \d+, \$\d+\.\d{2} at the API price/);
    expect(state(r.json.run)).toMatchObject({ shown: true, told: true });
    expect(await reportText()).not.toContain("fdefault");
    await drop("fdefault");
  });

  test("FLAKE lines become notes on the flake tracker; FOLLOWUP lines file an issue each", async () => {
    const before = (await issueList("fac")).json.length;
    const r = await fjob("fflake", "flake");
    expect(state(r.json.run)).toMatchObject({ condition: "passed" });
    const items = (await issueList("fac")).json;
    // The tracker and the followup issue; the FLAKE line itself files no issue.
    expect(items.length).toBe(before + 2);
    expect(items.map((i: any) => i.title)).not.toContain("a.test.ts > slow one: timed out, passed alone");
    const tracker = (await issueList("fac", { kind: "flake" })).json;
    expect(tracker).toHaveLength(1);
    const full = (await issueShow("fac", tracker[0].id)).json;
    expect(JSON.stringify(full)).toContain("job fflake: a.test.ts > slow one: timed out, passed alone");
    // An open tracker with fresh notes is a health line: close it, as the CLI test of the report hook wants silence.
    await issueClose("fac", tracker[0].id, "done", "test over");
    await drop("fflake");
  });
});
