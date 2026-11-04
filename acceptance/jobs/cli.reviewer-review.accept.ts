// Archived goal tests from jobs/cli.reviewer-review.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, fakeLog, specFile, state, setup, teardown } from "../../jobs/cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];
  describe("the reviewer", () => {
    const rjob = (name: string, mark: string, action = `commit ${name}.txt`, extra: Record<string, string> = {}) =>
      aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name} ${mark}\nACTION: ${action}\n`)], extra);

    test("a pass lands; the prompt holds the item and the diff; the cost adds up", async () => {
      const r = await rjob("rpass", "REVIEW:pass");
      expect(state(r.json.run)).toMatchObject({ condition: "passed", cost: 0.03 });
      const p = readFileSync(join(fakeLog, "review-prompt"), "utf8");
      expect(p).toContain("Goal: rpass REVIEW:pass");
      expect(p).toContain("+++ b/rpass.txt");
      expect(runsLeft()).toEqual([]);
      expect(state((await aleph(["land", "rpass"])).json.run).condition).toBe("landed");
    });

    test("under the default cap the whole diff goes in and no line says it was cut", async () => {
      const r = await rjob("rwhole", "REVIEW:pass", "commit-big rwhole.txt");
      expect(state(r.json.run)).toMatchObject({ condition: "passed" });
      const p = readFileSync(join(fakeLog, "review-prompt"), "utf8");
      expect(p).toContain("line 60 of the big file");
      expect(p).not.toContain("diff cut");
    });
  });
});
