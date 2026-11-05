import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, jobsDir, other, repo, sh, state, setup, teardown } from "./cli.helpers";
import { job, land } from "./inproc";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}) => job("fac", name, `Goal: ${name}\nACTION: ${action}\n`, {}, extra);
  // `aleph recheck` keeps one CLI test, for its wiring.
  describe("recheck", () => {
    const red = () => {
      sh(other, "git", "pull", "-q", "--rebase", "origin", "main");
      writeFileSync(join(other, "FAIL"), "red\n");
      sh(other, "git", "add", "FAIL"); sh(other, "git", "commit", "-qm", "break main"); sh(other, "git", "push", "-q", "origin", "main");
    };
    const mend = (...extra: [string, string][]) => {
      sh(other, "git", "rm", "-q", "FAIL");
      for (const [f, text] of extra) { writeFileSync(join(other, f), text); sh(other, "git", "add", f); }
      sh(other, "git", "commit", "-qm", "fix main"); sh(other, "git", "push", "-q", "origin", "main");
    };
    const agentRuns = (name: string) => readdirSync(jobsDir).filter((d) => d.endsWith(`-fac-${name}-build`));
    const kinds = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => state(d).kind);
    const NOFIX = { ALEPH_FIX_ROUNDS: "0" };

    test("a job stuck on a failed check passes once main is fixed, keeps the worker's commit and starts no worker", async () => {
      red();
      const r = await fjob("rc1", "commit rc1.txt", NOFIX);
      expect(state(r.json.run)).toMatchObject({ condition: "failed", reason: "tests failed" });
      const worker = sh(repo, "git", "rev-parse", "factory/rc1");
      mend();
      const c = await aleph(["recheck", "rc1"], NOFIX);
      expect(c.code).toBe(0);
      expect(state(c.json.run)).toMatchObject({ kind: "recheck", condition: "passed", job: r.json.job });
      expect(kinds("rc1")).toEqual(["build", "recheck"]);
      expect(agentRuns("rc1")).toHaveLength(1);
      expect(sh(repo, "git", "merge-base", "--is-ancestor", worker, "factory/rc1")).toBe("");
      expect(sh(repo, "git", "log", "--format=%s", "factory/rc1")).toContain("add rc1.txt");
      expect(sh(repo, "git", "ls-tree", "--name-only", "factory/rc1")).not.toContain("FAIL");
      const l = await land("rc1");
      expect(state(l.json.run).condition).toBe("landed");
    }, 60_000);

  });
});
