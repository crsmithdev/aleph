// Archived goal tests from jobs/cli.factory-checks.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, seedItem, specFile, state, setup, teardown } from "../../jobs/cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run's checks", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);

  describe("hidden checks", () => {

    describe("a fresh author", () => {
      const reg = () => { const r = JSON.parse(readFileSync(join(base, "repos.json"), "utf8")); r.fac.author = true; const f = join(base, "repos-author.json"); writeFileSync(f, JSON.stringify(r)); return f; };
      const fakeAuthor = (name: string, reply: string) => {
        const f = join(base, `author-${name}.sh`);
        writeFileSync(f, `#!/bin/sh\ncat > ${base}/author-${name}.in\ncat <<'EOF'\n${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: reply, total_cost_usd: 0.25 })}\nEOF\n`);
        chmodSync(f, 0o755);
        return f;
      };
      // A fake spec check: it records its input in specs-<name>.in, one block per call, and prints the reply.
      const fakeSpec = (name: string, reply: string, code = 0) => {
        const f = join(base, `spec-${name}.sh`);
        writeFileSync(f, `#!/bin/sh\ncat >> ${base}/spec-${name}.in\necho '=====CALL' >> ${base}/spec-${name}.in\ncat <<'EOF'\n${JSON.stringify({ type: "result", subtype: "success", is_error: false, result: reply, total_cost_usd: 0.5 })}\nEOF\nexit ${code}\n`);
        chmodSync(f, 0o755);
        return f;
      };
      const calls = (name: string) => existsSync(join(base, `spec-${name}.in`)) ? readFileSync(join(base, `spec-${name}.in`), "utf8").split("=====CALL").length - 1 : 0;
      const goalWith = (title: string) => seedItem("fac", title, { kind: "goal", issue: "fac-1", after: [] }, "## Goal\nEnd state one.\n\n## Oracle\nORACLE-TEXT\n");
      const notes = async (id: number) => (await aleph(["issue", "show", "fac", String(id)])).stdout;
      const SCENES = "1. SECRET-SCENARIO one is seen.\n2. Another is seen.\n";

      // The dispatch runs the spec check (factory-dispatch.spec-check.test.ts); a job started by hand gets none.
      test("a job started by hand with --on runs no spec check", async () => {
        const id = goalWith("hand goal");
        const r = await fjob("spec1", "commit spec1.txt", { ALEPH_REPOS: reg(), ALEPH_AUTHOR_CMD: fakeAuthor("h", SCENES), ALEPH_SPECCHECK_CMD: fakeSpec("h", "VERDICT: hold vague") }, ["--on", String(id)]);
        expect(state(r.json.run).condition).toBe("passed");
        expect(calls("h")).toBe(0);
        expect(existsSync(join(base, "author-h.in"))).toBe(false);
        expect(await notes(id)).not.toContain("spec check:");
      }, 60_000);

      test("aleph spec-check: a stub that exits 1 leaves an error note", async () => {
        const id = goalWith("error goal");
        const r = await aleph(["spec-check", `fac-${id}`], { ALEPH_REPOS: reg(), ALEPH_SPECCHECK_CMD: fakeSpec("e", "oops", 1) });
        expect(r.json).toMatchObject({ verdict: "error" });
        expect(await notes(id)).toMatch(/spec check: [0-9a-f]{12} error:/);
      }, 60_000);
    });

  });
});
