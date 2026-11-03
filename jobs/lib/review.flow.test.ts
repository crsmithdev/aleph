import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, fakeLog, jobsDir, state, setup, teardown } from "../cli.helpers";
import { drop, job } from "../inproc.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own, and so is its reviewer.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  describe("the reviewer", () => {
    // These runs never meet review: a background review would rewrite the awaiting reason the assertions read.
    const rjob = (name: string, mark: string, action = `commit ${name}.txt`, extra: Record<string, string> = {}) =>
      job("fac", name, `Goal: ${name} ${mark}\nACTION: ${action}\n`, {}, { ALEPH_REVIEW_CMD: "/bin/false", ...extra });
    const calls = () => existsSync(join(fakeLog, "review-calls")) ? readFileSync(join(fakeLog, "review-calls"), "utf8").split("\n").length - 1 : 0;

    test("a diff over ALEPH_REVIEW_DIFF_MAX is cut: the stat, the head of the diff, a line that says so", async () => {
      const r = await rjob("rbig", "REVIEW:pass", "commit-big rbig.txt", { ALEPH_REVIEW_DIFF_MAX: "200" });
      expect(state(r.json.run)).toMatchObject({ condition: "passed" });
      const p = readFileSync(join(fakeLog, "review-prompt"), "utf8");
      const m = p.match(/diff cut at 200 of (\d+) characters/);
      expect(m).not.toBeNull();
      expect(Number(m![1])).toBeGreaterThan(200);
      expect(p).toContain("rbig.txt |");
      const body = p.slice(p.indexOf("diff --git"), p.indexOf("(diff cut at"));
      expect(body.trim().length).toBeLessThanOrEqual(200);
      expect(p).not.toContain("line 60 of the big file");
    });

    const runsOf = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

    test("a finding goes back to the worker as a fix round; the rerun passes", async () => {
      rmSync(join(fakeLog, "holdonce"), { force: true });
      await rjob("rback", "REVIEW:holdonce");
      const rs = runsOf("rback");
      expect(rs.map((x) => [x.condition, x.failed])).toEqual([["stuck", "review"], ["passed", undefined], ["landed", undefined]]);
      expect(rs[0]).toMatchObject({ reason: "reviewer: the flag has no test", next: "worker", round: 0 });
      expect(rs[1].round).toBe(1);
      expect(readFileSync(join(fakeLog, "prompt"), "utf8")).toContain("The reviewer sent this branch back: reviewer: the flag has no test");
    }, 30_000);

    test("a reviewer with no verdict is run again, once; its pass passes the run", async () => {
      rmSync(join(fakeLog, "noneonce"), { force: true });
      const n = calls();
      const r = await rjob("rretry", "REVIEW:noneonce");
      expect(state(r.json.run).condition).toBe("passed");
      expect(runsOf("rretry").length).toBe(1);
      expect(calls() - n).toBe(2);
    }, 30_000);

    test("a second miss is a finding: with no fix rounds, no verdict line or an error result holds the run", async () => {
      const none = { ALEPH_FIX_ROUNDS: "0" };
      const n = calls();
      expect(state((await rjob("rnone", "REVIEW:none", "commit rnone.txt", none)).json.run)).toMatchObject({ condition: "awaiting", ask: expect.objectContaining({ kind: "approval", reason: "review" }), reason: expect.stringMatching(/^reviewer: no verdict/) });
      expect(calls() - n).toBe(2);
      expect(state((await rjob("rerr", "REVIEW:error", "commit rerr.txt", none)).json.run)).toMatchObject({ condition: "awaiting", reason: "reviewer: no verdict (API Error: 529)" });
      for (const n of ["rnone", "rerr"]) await drop(n);
    });

    test("with the default fix rounds, a reviewer with no verdict twice needs Chris and no worker runs again", async () => {
      const slow = join(base, "slow-reviewer");
      writeFileSync(slow, "#!/bin/bash\nsleep 60\n", { mode: 0o755 });
      const t = await job("fac", "rslow3", "Goal: g\nACTION: commit rslow3.txt\n", {}, { ALEPH_REVIEWER_CMD: slow, ALEPH_REVIEW_TIMEOUT: "1" });
      expect(state(t.json.run)).toMatchObject({ condition: "awaiting", ask: expect.objectContaining({ kind: "approval", reason: "review" }), reason: "reviewer: no verdict (time box)" });
      expect(runsOf("rslow3").length).toBe(1);
      await drop("rslow3");
      await rjob("rnone2", "REVIEW:none");
      const rs = runsOf("rnone2");
      expect(rs.length).toBe(1);
      expect(rs[0]).toMatchObject({ condition: "awaiting", ask: expect.objectContaining({ kind: "approval", reason: "review" }), reason: expect.stringMatching(/^reviewer: no verdict/) });
      await drop("rnone2");
    }, 30_000);

    test("a silent reviewer is stopped at ALEPH_STALL_SECONDS and holds the run with no worker rerun", async () => {
      const silent = join(base, "silent-reviewer");
      writeFileSync(silent, "#!/bin/bash\nexec sleep 60\n", { mode: 0o755 });
      const t = await job("fac", "rstall", "Goal: g\nACTION: commit rstall.txt\n", {}, { ALEPH_REVIEWER_CMD: silent, ALEPH_STALL_SECONDS: "2" });
      expect(state(t.json.run)).toMatchObject({ condition: "awaiting", reason: "reviewer: no verdict (stalled: no output for 2 seconds)" });
      expect(runsOf("rstall").length).toBe(1);
      await drop("rstall");
    }, 30_000);

    test("a security path holds without a review", async () => {
      const n = calls();
      const r = await rjob("rsec", "REVIEW:pass", "commit hooks/r.txt");
      expect(state(r.json.run)).toMatchObject({ ask: expect.objectContaining({ kind: "approval", reason: "held-path" }), reason: "held path hooks/r.txt" });
      expect(calls()).toBe(n);
      await drop("rsec");
    });

    test("a held path gets the reviewer first", async () => {
      const n = calls();
      const r = await rjob("rheld", "REVIEW:pass", "commit held/r.txt");
      expect(state(r.json.run)).toMatchObject({ ask: expect.objectContaining({ kind: "approval", reason: "held-path" }) });
      expect(calls()).toBe(n + 1);
      await drop("rheld");
    });
  });
});
