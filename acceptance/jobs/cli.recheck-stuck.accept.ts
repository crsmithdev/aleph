// Archived goal tests from jobs/cli.recheck-stuck.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { jobsDir, other, sh, state, setup, teardown } from "../../jobs/cli.helpers";
import { drop, job, recheck } from "../../jobs/inproc";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}) => job("fac", name, `Goal: ${name}\nACTION: ${action}\n`, {}, extra);
  // `aleph recheck` keeps one CLI test, for its wiring; the other case calls the transition in-process.
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
    const kinds = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => state(d).kind);
    const NOFIX = { ALEPH_FIX_ROUNDS: "0" };

    test("a merge of main that conflicts ends stuck and names the files", async () => {
      red();
      const r = await fjob("rc4", "commit-fixed rc4.txt", NOFIX);
      expect(state(r.json.run).condition).toBe("stuck");
      mend(["rc4.txt", "different\n"]);
      const c = await recheck("rc4", NOFIX);
      expect(state(c.json.run)).toMatchObject({ kind: "recheck", condition: "stuck", conflicts: ["rc4.txt"] });
      expect(state(c.json.run).reason).toContain("rc4.txt");
      expect(kinds("rc4")).toEqual(["build", "recheck"]);
      await drop("rc4");
    }, 60_000);
  });
});
