import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, jobsDir, other, repo, sh, specFile, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
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
      expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "tests failed" });
      const worker = sh(repo, "git", "rev-parse", "factory/rc1");
      mend();
      const c = await aleph(["recheck", "rc1"], NOFIX);
      expect(c.code).toBe(0);
      expect(state(c.json.run)).toMatchObject({ kind: "recheck", state: "passed", job: r.json.job });
      expect(kinds("rc1")).toEqual(["build", "recheck"]);
      expect(agentRuns("rc1")).toHaveLength(1);
      expect(sh(repo, "git", "merge-base", "--is-ancestor", worker, "factory/rc1")).toBe("");
      expect(sh(repo, "git", "log", "--format=%s", "factory/rc1")).toContain("add rc1.txt");
      expect(sh(repo, "git", "ls-tree", "--name-only", "factory/rc1")).not.toContain("FAIL");
      const l = await aleph(["land", "rc1"]);
      expect(state(l.json.run).state).toBe("landed");
    }, 60_000);

    test("refuses a running, passed or landed job, and one whose branch is gone", async () => {
      const p = await fjob("rc2", "commit rc2.txt");
      expect(state(p.json.run).state).toBe("passed");
      const refused = await aleph(["recheck", "rc2"]);
      expect(refused.code).toBe(1);
      expect(refused.stderr).toContain("rc2 is passed, not stuck or failed");
      await aleph(["land", "rc2"]);
      const landed = await aleph(["recheck", "rc2"]);
      expect(landed.code).toBe(1);
      expect(landed.stderr).toContain("no open job named rc2");
      red();
      const s = await fjob("rc3", "commit rc3.txt", NOFIX);
      expect(state(s.json.run).state).toBe("stuck");
      const file = join(jobsDir, s.json.run, "state.json");
      const saved = readFileSync(file, "utf8");
      writeFileSync(file, JSON.stringify({ ...JSON.parse(saved), state: "running" }));
      const running = await aleph(["recheck", "rc3"]);
      expect(running.code).toBe(1);
      expect(running.stderr).toMatch(/rc3 is running/);
      writeFileSync(file, saved);
      sh(repo, "git", "branch", "-D", "factory/rc3");
      const gone = await aleph(["recheck", "rc3"]);
      expect(gone.code).toBe(1);
      expect(gone.stderr).toContain("rc3 has no branch");
      mend();
      await aleph(["drop", "rc3"]);
    }, 60_000);

    test("a merge of main that conflicts ends stuck and names the files", async () => {
      red();
      const r = await fjob("rc4", "commit-fixed rc4.txt", NOFIX);
      expect(state(r.json.run).state).toBe("stuck");
      mend(["rc4.txt", "different\n"]);
      const c = await aleph(["recheck", "rc4"], NOFIX);
      expect(state(c.json.run)).toMatchObject({ kind: "recheck", state: "stuck", conflicts: ["rc4.txt"] });
      expect(state(c.json.run).reason).toContain("rc4.txt");
      expect(kinds("rc4")).toEqual(["build", "recheck"]);
      await aleph(["drop", "rc4"]);
    }, 60_000);
  });
});
