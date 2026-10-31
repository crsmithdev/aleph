import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
      expect((await aleph(["goal", "hidden", "fac", String(id), join(base, "a.test.ts")])).code).toBe(0);
      return id;
    };
    const runs = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

    test("a run whose code fails the hidden test is stuck with the count, and no source reaches the note", async () => {
      const id = await hiddenItem();
      const r = await fjob("hidbad", "commit hidbad.txt", { ALEPH_FIX_ROUNDS: "0" }, ["--on", String(id)]);
      expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "hidden check failed: 1 of 1 tests" });
      expect(state(r.json.run).checks.map((c: any) => c.name)).toEqual(["tests", "tree", "hidden"]);
      expect(file(r.json.run, "hidden.log")).toContain("SECRET-HIDDEN-LINE");
      expect(file(r.json.run, "checks.log")).not.toContain("SECRET-HIDDEN-LINE");
      expect(file(r.json.run, "prompt.md")).not.toContain("SECRET-HIDDEN-LINE");
      expect(runsLeft()).toEqual([]);
      expect((await aleph(["report"])).stdout).toContain("hidden 0/1");
      await aleph(["drop", "hidbad"]);
    }, 30_000);

    test("the fix round's note has the line and the failing test names, and the job lands once it passes", async () => {
      const id = await hiddenItem();
      await fjob("hidfix", "hidden-fix", {}, ["--on", String(id)]);
      const rs = runs("hidfix");
      expect(rs.map((x) => [x.kind, x.state])).toEqual([["build", "stuck"], ["build", "passed"], ["land", "landed"]]);
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
      expect(state(r.json.run).state).toBe("passed");
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
      expect(state(r.json.run)).toMatchObject({ state: "stuck", reason: "tests failed" });
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
      expect(rs.map((x) => [x.kind, x.state])).toEqual([["build", "stuck"], ["build", "passed"], ["land", "landed"]]);
      expect(rs[0]).toMatchObject({ reason: "tests failed", failed: "tests", next: "worker" });
      expect(rs[1].round).toBe(1);
      const p = readFileSync(join(fakeLog, "prompt"), "utf8");
      expect(p).toContain("The check `tests` failed");
      expect(p).toContain("FAIL is present 3");
      expect(told).toContain("fac/fix1 stuck; sent back to the worker");
      expect(runsLeft()).toEqual([]);
      expect(state(r.json.run).state).toBe("stuck");
      expect((await aleph(["report"])).stdout).toContain("fac/fix1 passed after 1 fix rounds");
    }, 30_000);

    test("a worker that keeps failing is stuck after 2 fix rounds, in 3 runs", async () => {
      await fjob("fixn", "fail-always");
      const rs = runs("fixn");
      expect(rs.map((x) => x.state)).toEqual(["stuck", "stuck", "stuck"]);
      expect(rs.at(-1)).toMatchObject({ reason: "tests failed after 2 fix rounds" });
      expect(rs.at(-1).next).toBeUndefined();
      await aleph(["drop", "fixn"]);
    }, 30_000);

    test("ALEPH_FIX_ROUNDS=0 is stuck at once, as before", async () => {
      await fjob("fix0", "fail-always", { ALEPH_FIX_ROUNDS: "0" });
      const rs = runs("fix0");
      expect(rs.length).toBe(1);
      expect(rs[0]).toMatchObject({ state: "stuck", reason: "tests failed" });
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
