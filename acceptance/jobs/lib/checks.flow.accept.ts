// Archived goal tests from jobs/lib/checks.flow.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { noteFlake } from "../../../todo/lib/store.ts";
import { base, items, fakeLog, file, jobsDir, seedItem, state, told, setup, teardown } from "../../../jobs/cli.helpers";
import { drop, issueHidden, job } from "../../../jobs/inproc.ts";
import { reportText } from "../../../jobs/lib/flow.testkit.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
// `aleph spec-check` keeps its CLI test in jobs/cli.factory-checks.test.ts.
beforeAll(setup);
afterAll(teardown);

describe("a factory run's checks", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}, o: { on?: number } = {}) =>
    job("fac", name, `Goal: ${name}\nACTION: ${action}\n`, o.on === undefined ? {} : { on: String(o.on) }, extra);
  const runsLeft = () => existsSync(join(base, "runs")) ? readdirSync(join(base, "runs")) : [];

  describe("hidden checks", () => {
    const SOURCE = `import { expect, test } from "bun:test";\nimport { existsSync } from "node:fs";\n// SECRET-HIDDEN-LINE\ntest("hid file exists", () => { expect(existsSync("hid.txt")).toBe(true); });\n`;
    const hiddenItem = async () => {
      const id = seedItem("fac", "an item with a hidden check", { kind: "goal", issue: "fac-1", after: [] });
      expect((await issueHidden("fac", id, { "a.test.ts": SOURCE })).code).toBe(0);
      return id;
    };
    const runs = (name: string) => readdirSync(jobsDir).filter((d) => d.includes(`-fac-${name}-`)).sort().map((d) => ({ id: d, ...state(d) }));

    test("the same hidden test failing on two runs in a row asks instead of starting a third", async () => {
      const id = await hiddenItem();
      await fjob("hidtwice", "commit hidtwice.txt", {}, { on: id });
      const rs = runs("hidtwice");
      expect(rs.map((x) => [x.kind, x.condition])).toEqual([["build", "stuck"], ["build", "awaiting"]]);
      expect(rs[0]).toMatchObject({ failed: "hidden", next: "worker" });
      const ask = rs[1].ask;
      expect(ask.question).toContain("hid file exists");
      expect(ask.question).toContain("failed the same way on two runs in a row");
      expect(rs[1].failed).toBeUndefined();
      await drop("hidtwice");
    }, 60_000);

    test("the fix round's note has the line and the failing test names, and the job lands once it passes", async () => {
      const id = await hiddenItem();
      await fjob("hidfix", "hidden-fix", {}, { on: id });
      const rs = runs("hidfix");
      expect(rs.map((x) => [x.kind, x.condition])).toEqual([["build", "stuck"], ["build", "passed"], ["land", "landed"]]);
      expect(rs[0]).toMatchObject({ reason: "hidden check failed: 1 of 1 tests", failed: "hidden", next: "worker" });
      expect(rs[0].checks.map((c: any) => c.name)).toEqual(["tests", "tree", "hidden"]);
      expect(file(rs[0].id, "hidden.log")).toContain("SECRET-HIDDEN-LINE");
      expect(file(rs[0].id, "checks.log")).not.toContain("SECRET-HIDDEN-LINE");
      expect(file(rs[0].id, "prompt.md")).toContain("### .hidden/a.test.ts\n\n```\nimport { expect, test }");
      const p = readFileSync(join(fakeLog, "prompt"), "utf8");
      expect(p).toContain("hidden check failed: 1 of 1 tests");
      expect(p).toContain("hid file exists");
      expect(p).toContain("expect(existsSync");
      // The run's own checks ran the hidden check; main had not moved, so the land skipped them.
      expect(rs[1].checks.map((c: any) => c.name)).toEqual(["tests", "tree", "hidden"]);
      expect(rs[1].checks.at(-1)).toMatchObject({ ok: true, passed: 1, total: 1 });
      expect(readFileSync(join(jobsDir, rs[2].id, "land.log"), "utf8")).toContain("checks skipped");
      expect(runsLeft()).toEqual([]);
      expect((await reportText())).toContain("hidden 1/1");
    }, 60_000);
  });

  describe("flaky checks", () => {
    describe("health lines by test name", () => {
      const path = () => join(base, "factory", "flaky.json");
      beforeAll(() => mkdirSync(join(base, "factory"), { recursive: true }));
      const rows = (specs: { repo?: string; tests?: string[] }[]) =>
        writeFileSync(path(), JSON.stringify(specs.map((s, i) => ({ repo: s.repo ?? "fac", check: "tests", run: `r${i}`, at: new Date().toISOString(), ...(s.tests ? { tests: s.tests } : {}) }))));
      const reruns = async () => (await reportText()).split("\n").filter((l) => l.includes("passed on rerun"));
      const done = () => rmSync(path(), { force: true });

      test("rows with tests count under the test name", async () => {
        rows([{ tests: ["a.test.ts > one"] }, { tests: ["a.test.ts > one"] }]);
        try { expect((await reportText())).toContain("health: fac test a.test.ts > one passed on rerun 2 times in 7 days"); } finally { done(); }
      });

      test("a row counts once for each test it names", async () => {
        rows([{ tests: ["a.test.ts > one", "b.test.ts > two"] }, { tests: ["b.test.ts > two"] }]);
        try {
          const out = (await reportText());
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
      expect((await reportText())).not.toContain("flake notes in 7 days");
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
      expect((await reportText())).toContain(`health: fac-${id} holds 2 flake notes in 7 days, 2 test files`);
    });

    test("a check that always fails is still stuck, with one rerun in its log", async () => {
      const r = await fjob("flk3", "fail-always", { ALEPH_FIX_ROUNDS: "0" });
      expect(state(r.json.run)).toMatchObject({ condition: "stuck", reason: "tests failed" });
      // With ALEPH_FIX_ROUNDS=0 there is no fix round: one run, and no next.
      expect(readdirSync(jobsDir).filter((d) => d.includes("-fac-flk3-"))).toHaveLength(1);
      expect(state(r.json.run).next).toBeUndefined();
      const log = file(r.json.run, "checks.log");
      expect(log.match(/## tests: exit 1/g)).toHaveLength(2);
      expect(log).toContain("run again");
      await drop("flk3");
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
      expect((await reportText())).toContain("fac/fix1 passed after 1 fix rounds");
    }, 30_000);

    test("a worker that keeps failing is stuck after 2 fix rounds, in 3 runs", async () => {
      await fjob("fixn", "fail-always");
      const rs = runs("fixn");
      expect(rs.map((x) => x.condition)).toEqual(["stuck", "stuck", "stuck"]);
      expect(rs.at(-1)).toMatchObject({ reason: "tests failed after 2 fix rounds" });
      expect(rs.at(-1).next).toBeUndefined();
      await drop("fixn");
    }, 30_000);

    test("the time box and an error result get no fix round", async () => {
      await fjob("fixbox", "sleep", { ALEPH_JOB_TIMEOUT: "1" });
      expect(runs("fixbox").map((x) => [x.condition, x.reason])).toEqual([["stuck", "time box"]]);
      expect(runsLeft()).toEqual([]);
      await fjob("fixerr", "error");
      expect(runs("fixbox").map((x) => x.reason)).toEqual(["time box"]);
      expect(runs("fixerr").map((x) => x.reason)).toEqual(["API Error: 500"]);
      for (const n of ["fixbox", "fixerr"]) await drop(n);
    }, 30_000);
  });
});
