import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

    const runsOf = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

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
