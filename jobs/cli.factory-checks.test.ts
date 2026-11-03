import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noteFlake } from "../todo/lib/store.ts";
import { aleph, base, items, fakeLog, file, jobsDir, seedItem, specFile, state, told, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run's checks", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, more: string[] = []) =>
    aleph(["job", "fac", name, "--spec", specFile(`Goal: ${name}\nACTION: ${action}\n`), ...more], extra);
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];

  describe("hidden checks", () => {
    const SOURCE = `import { expect, test } from "bun:test";\nimport { existsSync } from "node:fs";\n// SECRET-HIDDEN-LINE\ntest("hid file exists", () => { expect(existsSync("hid.txt")).toBe(true); });\n`;
    const hiddenItem = async () => {
      const id = seedItem("fac", "an item with a hidden check", { kind: "goal", issue: "fac-1", after: [] });
      writeFileSync(join(base, "a.test.ts"), SOURCE);
      expect((await aleph(["issue", "hidden", "fac", String(id), join(base, "a.test.ts")])).code).toBe(0);
      return id;
    };
    const runs = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

    test("a run whose code fails the hidden test is stuck with the count, and no source reaches the note", async () => {
      const id = await hiddenItem();
      const r = await fjob("hidbad", "commit hidbad.txt", { ALEPH_FIX_ROUNDS: "0" }, ["--on", String(id)]);
      expect(state(r.json.run)).toMatchObject({ condition: "stuck", reason: "hidden check failed: 1 of 1 tests" });
      expect(state(r.json.run).checks.map((c: any) => c.name)).toEqual(["tests", "tree", "hidden"]);
      expect(file(r.json.run, "hidden.log")).toContain("SECRET-HIDDEN-LINE");
      expect(file(r.json.run, "checks.log")).not.toContain("SECRET-HIDDEN-LINE");
      expect(file(r.json.run, "prompt.md")).not.toContain("SECRET-HIDDEN-LINE");
      expect(runsLeft()).toEqual([]);
      expect((await aleph(["report"])).stdout).toContain("hidden 0/1");
      await aleph(["drop", "hidbad"]);
    }, 30_000);

    test("the same hidden test failing on two runs in a row asks instead of starting a third", async () => {
      const id = await hiddenItem();
      await fjob("hidtwice", "commit hidtwice.txt", {}, ["--on", String(id)]);
      const rs = runs("hidtwice");
      expect(rs.map((x) => [x.kind, x.condition])).toEqual([["build", "stuck"], ["build", "awaiting"]]);
      expect(rs[0]).toMatchObject({ failed: "hidden", next: "worker" });
      const ask = rs[1].ask;
      expect(ask.question).toContain("hid file exists");
      expect(ask.question).toContain("failed the same way on two runs in a row");
      expect(rs[1].failed).toBeUndefined();
      await aleph(["drop", "hidtwice"]);
    }, 60_000);

    test("the fix round's note has the line and the failing test names, and the job lands once it passes", async () => {
      const id = await hiddenItem();
      await fjob("hidfix", "hidden-fix", {}, ["--on", String(id)]);
      const rs = runs("hidfix");
      expect(rs.map((x) => [x.kind, x.condition])).toEqual([["build", "stuck"], ["build", "passed"], ["land", "landed"]]);
      expect(rs[0]).toMatchObject({ reason: "hidden check failed: 1 of 1 tests", failed: "hidden", next: "worker" });
      const p = readFileSync(join(fakeLog, "prompt"), "utf8");
      expect(p).toContain("hidden check failed: 1 of 1 tests");
      expect(p).toContain("hid file exists");
      expect(p).not.toContain("SECRET-HIDDEN-LINE");
      expect(p).not.toContain("expect(existsSync");
      // The run's own checks ran the hidden check; main had not moved, so the land skipped them.
      expect(rs[1].checks.map((c: any) => c.name)).toEqual(["tests", "tree", "hidden"]);
      expect(rs[1].checks.at(-1)).toMatchObject({ ok: true, passed: 1, total: 1 });
      expect(readFileSync(join(jobsDir, rs[2].id, "land.log"), "utf8")).toContain("checks skipped");
      expect(runsLeft()).toEqual([]);
    }, 60_000);

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
      const PASS = () => fakeSpec("default", "VERDICT: pass");
      const goalWith = (title: string) => seedItem("fac", title, { kind: "goal", issue: "fac-1", after: [] }, "## Goal\nEnd state one.\n\n## Oracle\nORACLE-TEXT\n");
      const notes = async (id: number) => (await aleph(["issue", "show", "fac", String(id)])).stdout;
      const SCENES = "1. SECRET-SCENARIO one is seen.\n2. Another is seen.\n";

      test("the scenarios reach the reviewer and not the worker, and no check runs them", async () => {
        const id = goalWith("sealed goal");
        const r = await fjob("seal1", "commit sealed-a.txt", { ALEPH_REPOS: reg(), ALEPH_SPECCHECK_CMD: PASS(), ALEPH_AUTHOR_CMD: fakeAuthor("a", SCENES) }, ["--on", String(id)]);
        expect(state(r.json.run).condition).toBe("passed");
        expect(state(r.json.run).checks.map((c: any) => c.name)).toEqual(["tests", "tree"]);
        expect(state(r.json.run).cost).toBeGreaterThanOrEqual(0.25);
        expect(file(r.json.run, "prompt.md")).not.toContain("SECRET-SCENARIO");
        expect(readFileSync(join(fakeLog, "prompt"), "utf8")).not.toContain("SECRET-SCENARIO");
        const reviewed = readFileSync(join(fakeLog, "review-prompt"), "utf8");
        expect(reviewed).toContain("## Sealed scenarios");
        expect(reviewed).toContain("SECRET-SCENARIO one is seen.");
        expect(await notes(id)).toContain("sealed checks: 2 scenarios from a fresh author");
        const asked = readFileSync(join(base, "author-a.in"), "utf8");
        expect(asked).toContain("End state one.");
        expect(asked).not.toContain("ORACLE-TEXT");
      }, 60_000);

      test("a scenario the reviewer sets aside goes on the issue's note", async () => {
        const id = goalWith("set aside goal");
        await aleph(["job", "fac", "seal2", "--spec", specFile("Goal: seal2\nACTION: commit seal2.txt\nREVIEW:setaside\n"), "--on", String(id)], { ALEPH_REPOS: reg(), ALEPH_SPECCHECK_CMD: PASS(), ALEPH_AUTHOR_CMD: fakeAuthor("b", SCENES) });
        expect(await notes(id)).toContain("sealed checks: the reviewer set aside: scenario 2 asks for more than the goal");
      }, 60_000);

      test("a reply with no scenario leaves its note, the review has no section, and a goal gets one attempt", async () => {
        const id = goalWith("no scenario goal");
        const env = { ALEPH_REPOS: reg(), ALEPH_SPECCHECK_CMD: PASS(), ALEPH_AUTHOR_CMD: fakeAuthor("d", "I cannot write these.") };
        await fjob("seal3", "commit seal3.txt", env, ["--on", String(id)]);
        expect(await notes(id)).toContain("sealed checks: none: the author's reply has no numbered scenario");
        expect(readFileSync(join(fakeLog, "review-prompt"), "utf8")).not.toContain("## Sealed scenarios");
        rmSync(join(base, "author-d.in"));
        await fjob("seal4", "commit seal4.txt", env, ["--on", String(id)]);
        expect(existsSync(join(base, "author-d.in"))).toBe(false);
      }, 60_000);

      // The dispatch runs the spec check (factory-dispatch.test.ts); a job started by hand gets none.
      test("a job started by hand with --on runs no spec check", async () => {
        const id = goalWith("hand goal");
        const r = await fjob("spec1", "commit spec1.txt", { ALEPH_REPOS: reg(), ALEPH_AUTHOR_CMD: fakeAuthor("h", SCENES), ALEPH_SPECCHECK_CMD: fakeSpec("h", "VERDICT: hold vague") }, ["--on", String(id)]);
        expect(state(r.json.run).condition).toBe("passed");
        expect(calls("h")).toBe(0);
        expect(await notes(id)).not.toContain("spec check:");
      }, 60_000);

      test("aleph spec-check: a hold asks and is noted, and the same version is not checked again", async () => {
        const id = goalWith("held goal");
        const env = { ALEPH_REPOS: reg(), ALEPH_SPECCHECK_CMD: fakeSpec("c", "looked.\nVERDICT: hold the Oracle names needHead, which is outside the Edit surface") };
        const r = await aleph(["spec-check", `fac-${id}`], env);
        expect(r.json).toMatchObject({ verdict: "hold", problems: expect.stringContaining("needHead"), cost: 0.5 });
        const shown = JSON.parse((await aleph(["issue", "show", "fac", String(id), "--json"])).stdout);
        const ask = shown.ask ?? shown.item?.ask;
        expect(ask).toMatchObject({ kind: "input", reason: "spec-check" });
        expect(ask.question).toContain("needHead");
        expect(await notes(id)).toMatch(/spec check: [0-9a-f]{12} hold: the Oracle names needHead/);
        expect((await aleph(["spec-check", `fac-${id}`], env)).json).toMatchObject({ verdict: "skip" });
        expect(calls("c")).toBe(1);
      }, 60_000);

      test("aleph spec-check: a stub that exits 1 leaves an error note", async () => {
        const id = goalWith("error goal");
        const r = await aleph(["spec-check", `fac-${id}`], { ALEPH_REPOS: reg(), ALEPH_SPECCHECK_CMD: fakeSpec("e", "oops", 1) });
        expect(r.json).toMatchObject({ verdict: "error" });
        expect(await notes(id)).toMatch(/spec check: [0-9a-f]{12} error:/);
      }, 60_000);
    });

    test("an item with no hidden files runs the same checks as before", async () => {
      const id = (await aleph(["issue", "add", "fac", "no hidden"])).json.added;
      const r = await fjob("hidnone", "commit hidnone.txt", {}, ["--on", String(id)]);
      expect(state(r.json.run).checks.map((c: any) => c.name)).toEqual(["tests", "tree"]);
      expect(existsSync(join(jobsDir, r.json.run, "hidden.log"))).toBe(false);
      await aleph(["drop", "hidnone"]);
    }, 30_000);
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
      const out = (await aleph(["report"])).stdout;
      expect(out).toContain("flaky passed on rerun");
      expect(out).not.toContain("on rerun 2 times");
      await fjob("flk2", "flaky");
      expect(flaky()).toHaveLength(2);
      expect((await aleph(["report"])).stdout).toContain("health: fac check flaky passed on rerun 2 times in 7 days");
      rmSync(join(base, "factory", "flaky.json"));
    }, 60_000);

    describe("health lines by test name", () => {
      const path = () => join(base, "factory", "flaky.json");
      const rows = (specs: { repo?: string; tests?: string[] }[]) =>
        writeFileSync(path(), JSON.stringify(specs.map((s, i) => ({ repo: s.repo ?? "fac", check: "tests", run: `r${i}`, at: new Date().toISOString(), ...(s.tests ? { tests: s.tests } : {}) }))));
      const reruns = async () => (await aleph(["report"])).stdout.split("\n").filter((l) => l.includes("passed on rerun"));
      const done = () => rmSync(path(), { force: true });

      test("rows with tests count under the test name", async () => {
        rows([{ tests: ["a.test.ts > one"] }, { tests: ["a.test.ts > one"] }]);
        try { expect((await aleph(["report"])).stdout).toContain("health: fac test a.test.ts > one passed on rerun 2 times in 7 days"); } finally { done(); }
      });

      test("a row counts once for each test it names", async () => {
        rows([{ tests: ["a.test.ts > one", "b.test.ts > two"] }, { tests: ["b.test.ts > two"] }]);
        try {
          const out = (await aleph(["report"])).stdout;
          expect(out).toContain("health: fac test b.test.ts > two passed on rerun 2 times in 7 days");
          expect(out).not.toContain("a.test.ts > one passed on rerun");
        } finally { done(); }
      });

      test("at most 5 lines, most first", async () => {
        const r: { tests: string[] }[] = [];
        for (let i = 1; i <= 6; i++) for (let j = 0; j < i + 1; j++) r.push({ tests: [`t${i}`] });
        rows(r);
        try {
          const l = await reruns();
          expect(l).toHaveLength(5);
          expect(l[0]).toContain("fac test t6 passed on rerun 7 times");
          expect(l.join("\n")).not.toContain("fac test t1 ");
        } finally { done(); }
      });

      test("two repos with the same test name make two lines", async () => {
        rows([{ repo: "fac", tests: ["x"] }, { repo: "fac", tests: ["x"] }, { repo: "other", tests: ["x"] }, { repo: "other", tests: ["x"] }]);
        try {
          const l = await reruns();
          expect(l.some((s) => s.includes("health: fac test x passed on rerun 2 times"))).toBe(true);
          expect(l.some((s) => s.includes("health: other test x passed on rerun 2 times"))).toBe(true);
        } finally { done(); }
      });
    });

    test("flake notes on a tracker make a health line; a repo with no tracker makes none", async () => {
      expect((await aleph(["report"])).stdout).not.toContain("flake notes in 7 days");
      const was = process.env.ALEPH_ISSUES;
      process.env.ALEPH_ISSUES = items;
      let id: number;
      try {
        const first = noteFlake({ key: "fac" }, "job x: a.test.ts > slow one: timed out");
        noteFlake({ key: "fac" }, "firefighter: b.test.ts > other: failed under load");
        id = (first as { id: number }).id;
      } finally {
        if (was === undefined) delete process.env.ALEPH_ISSUES; else process.env.ALEPH_ISSUES = was;
      }
      expect(typeof id).toBe("number");
      expect((await aleph(["report"])).stdout).toContain(`health: fac-${id} holds 2 flake notes in 7 days, 2 test files`);
    });

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
      expect((await aleph(["report"])).stdout).toContain("health: most flaked in acceptance in 7 days: c.test.ts > twice (2 times)");
    });

    test("a check that always fails is still stuck, with one rerun in its log", async () => {
      const r = await fjob("flk3", "fail-always", { ALEPH_FIX_ROUNDS: "0" });
      expect(state(r.json.run)).toMatchObject({ condition: "stuck", reason: "tests failed" });
      const log = file(r.json.run, "checks.log");
      expect(log.match(/## tests: exit 1/g)).toHaveLength(2);
      expect(log).toContain("run again");
      await aleph(["drop", "flk3"]);
    }, 30_000);
  });

  describe("fix rounds", () => {
    const runs = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

    test("a failed check goes back to the worker, whose note names it with the log; the job passes after 1 fix round", async () => {
      const r = await fjob("fix1", "fail-then-fix");
      const rs = runs("fix1");
      expect(rs.map((x) => [x.kind, x.condition])).toEqual([["build", "stuck"], ["build", "passed"], ["land", "landed"]]);
      expect(rs[0]).toMatchObject({ reason: "tests failed", failed: "tests", next: "worker" });
      expect(rs[1].round).toBe(1);
      const p = readFileSync(join(fakeLog, "prompt"), "utf8");
      expect(p).toContain("The check `tests` failed");
      expect(p).toContain("FAIL is present 3");
      expect(told).toContain("fac/fix1 stuck; sent back to the worker");
      expect(runsLeft()).toEqual([]);
      expect(state(r.json.run).condition).toBe("stuck");
      expect((await aleph(["report"])).stdout).toContain("fac/fix1 passed after 1 fix rounds");
    }, 30_000);

    test("a worker that keeps failing is stuck after 2 fix rounds, in 3 runs", async () => {
      await fjob("fixn", "fail-always");
      const rs = runs("fixn");
      expect(rs.map((x) => x.condition)).toEqual(["stuck", "stuck", "stuck"]);
      expect(rs.at(-1)).toMatchObject({ reason: "tests failed after 2 fix rounds" });
      expect(rs.at(-1).next).toBeUndefined();
      await aleph(["drop", "fixn"]);
    }, 30_000);

    test("ALEPH_FIX_ROUNDS=0 is stuck at once, as before", async () => {
      await fjob("fix0", "fail-always", { ALEPH_FIX_ROUNDS: "0" });
      const rs = runs("fix0");
      expect(rs.length).toBe(1);
      expect(rs[0]).toMatchObject({ condition: "stuck", reason: "tests failed" });
      expect(rs[0].next).toBeUndefined();
      await aleph(["drop", "fix0"]);
    }, 30_000);

    test("the time box and an error result get no fix round", async () => {
      await fjob("fixbox", "sleep", { ALEPH_JOB_TIMEOUT: "1" });
      await fjob("fixerr", "error");
      expect(runs("fixbox").map((x) => x.reason)).toEqual(["time box"]);
      expect(runs("fixerr").map((x) => x.reason)).toEqual(["API Error: 500"]);
      for (const n of ["fixbox", "fixerr"]) await aleph(["drop", n]);
    }, 30_000);
  });
});
