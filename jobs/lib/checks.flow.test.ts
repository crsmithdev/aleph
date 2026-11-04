import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noteFlake } from "../../todo/lib/store.ts";
import { aleph, base, items, fakeLog, file, seedItem, state, setup, teardown } from "../cli.helpers";
import { job } from "../inproc.ts";
import { issueNotes, reportText } from "./flow.testkit.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
// `aleph spec-check` keeps its CLI test in jobs/cli.factory-checks.test.ts.
beforeAll(setup);
afterAll(teardown);

describe("a factory run's checks", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, o: { on?: number } = {}) =>
    job("fac", name, `Goal: ${name}\nACTION: ${action}\n`, o.on === undefined ? {} : { on: String(o.on) }, extra);

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
      const PASS = () => fakeSpec("default", "VERDICT: pass");
      const goalWith = (title: string) => seedItem("fac", title, { kind: "goal", issue: "fac-1", after: [] }, "## Goal\nEnd state one.\n\n## Oracle\nORACLE-TEXT\n");
      const notes = (id: number) => issueNotes("fac", id);
      const SCENES = "1. SECRET-SCENARIO one is seen.\n2. Another is seen.\n";
      // The spec check seals the scenarios (spec-check.test.ts); the run then reads them.
      const sealBy = (id: number, env: Record<string, string>) => aleph(["spec-check", `fac-${id}`], env);

      test("the scenarios reach the reviewer and not the worker, and no check runs them", async () => {
        const id = goalWith("sealed goal");
        const env = { ALEPH_REPOS: reg(), ALEPH_SPECCHECK_CMD: PASS(), ALEPH_AUTHOR_CMD: fakeAuthor("a", SCENES) };
        await sealBy(id, env);
        expect(await notes(id)).toMatch(/sealed checks: [0-9a-f]{12} 2 scenarios from a fresh author/);
        const r = await fjob("seal1", "commit sealed-a.txt", env, { on: id });
        expect(state(r.json.run).condition).toBe("passed");
        expect(state(r.json.run).checks.map((c: any) => c.name)).toEqual(["tests", "tree"]);
        expect(file(r.json.run, "prompt.md")).not.toContain("SECRET-SCENARIO");
        expect(readFileSync(join(fakeLog, "prompt"), "utf8")).not.toContain("SECRET-SCENARIO");
        const reviewed = readFileSync(join(fakeLog, "review-prompt"), "utf8");
        expect(reviewed).toContain("## Sealed scenarios");
        expect(reviewed).toContain("SECRET-SCENARIO one is seen.");
        const asked = readFileSync(join(base, "author-a.in"), "utf8");
        expect(asked).toContain("End state one.");
        expect(asked).not.toContain("ORACLE-TEXT");
      }, 60_000);

      test("a scenario the reviewer sets aside goes on the issue's note", async () => {
        const id = goalWith("set aside goal");
        const env = { ALEPH_REPOS: reg(), ALEPH_SPECCHECK_CMD: PASS(), ALEPH_AUTHOR_CMD: fakeAuthor("b", SCENES) };
        await sealBy(id, env);
        await job("fac", "seal2", "Goal: seal2\nACTION: commit seal2.txt\nREVIEW:setaside\n", { on: String(id) }, env);
        expect(await notes(id)).toContain("sealed checks: the reviewer set aside: scenario 2 asks for more than the goal");
      }, 60_000);

      test("the unit seals nothing: a goal with no spec check runs with no scenarios", async () => {
        const id = goalWith("no scenario goal");
        const env = { ALEPH_REPOS: reg(), ALEPH_SPECCHECK_CMD: PASS(), ALEPH_AUTHOR_CMD: fakeAuthor("d", SCENES) };
        await fjob("seal3", "commit seal3.txt", env, { on: id });
        expect(existsSync(join(base, "author-d.in"))).toBe(false);
        expect(await notes(id)).not.toContain("sealed checks:");
        expect(readFileSync(join(fakeLog, "review-prompt"), "utf8")).not.toContain("## Sealed scenarios");
      }, 60_000);
    });
  });

  describe("flaky checks", () => {
    const flaky = () => JSON.parse(readFileSync(join(base, "factory", "flaky.json"), "utf8"));

    test("a check that fails then passes on the same tree passes the run, is recorded and reported; two make a health line", async () => {
      const r = await fjob("flk1", "flaky");
      expect(state(r.json.run).condition).toBe("passed");
      expect(state(r.json.run).checks.find((c: any) => c.name === "flaky")).toMatchObject({ ok: true, rerun: true });
      expect(file(r.json.run, "checks.log")).toContain("## flaky: exit 1, run again");
      expect(flaky()).toHaveLength(1);
      expect(flaky()[0]).toMatchObject({ repo: "fac", check: "flaky", run: r.json.run });
      const out = (await reportText());
      expect(out).toContain("flaky passed on rerun");
      expect(out).not.toContain("on rerun 2 times");
      await fjob("flk2", "flaky");
      expect(flaky()).toHaveLength(2);
      expect((await reportText())).toContain("health: fac check flaky passed on rerun 2 times in 7 days");
      rmSync(join(base, "factory", "flaky.json"));
    }, 60_000);

    test("the report names the test that flaked most in acceptance", async () => {
      const was = process.env.ALEPH_ISSUES;
      process.env.ALEPH_ISSUES = items;
      try {
        noteFlake({ key: "fac" }, "acceptance fac-1: c.test.ts > twice: failed under load, passed on the quiet rerun at abc1234");
        noteFlake({ key: "fac" }, "acceptance fac-2: c.test.ts > twice: failed twice, in a test the goal did not touch, at abc1234");
        noteFlake({ key: "fac" }, "acceptance fac-3: d.test.ts > once: failed under load, passed on the quiet rerun at abc1234");
      } finally {
        if (was === undefined) delete process.env.ALEPH_ISSUES; else process.env.ALEPH_ISSUES = was;
      }
      expect((await reportText())).toContain("health: most flaked in acceptance in 7 days: c.test.ts > twice (2 times)");
    });
  });
});
