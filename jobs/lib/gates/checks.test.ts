import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addedLines, failedTests, keepGate, mutants, newCases, runChecks, runsBunTest, shell, withJunit, type CheckExec, type Runner, type Source } from "./checks.ts";
import { flakes } from "./factory-status.ts";
import type { CheckResult, Repo } from "../records/ledger.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR", "ALEPH_LOAD_LIMIT", "ALEPH_CHECK_TIMEOUT"];
let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "checks-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { ALEPH_FACTORY_DIR: join(base, "factory"), XDG_RUNTIME_DIR: join(base, "run") });
  delete process.env.ALEPH_CHECK_TIMEOUT;
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

type Reply = { code: number; timedOut?: boolean; killed?: boolean; print?: string };
const repo = (...names: string[]) => ({ key: "r", checks: names.map((name) => ({ name, run: name })) }) as unknown as Repo;

/** Runs the repo's checks with a fake exec that gives the replies in order. */
async function run(r: Repo, replies: Reply[], changed: string[] = []) {
  const calls: string[] = [];
  const results: CheckResult[] = [];
  const exec: CheckExec = async (check, out) => {
    calls.push(check.name);
    const reply = replies.shift()!;
    writeFileSync(out, reply.print ?? "");
    return { code: reply.code, timedOut: reply.timedOut ?? false, killed: reply.killed };
  };
  const failed = await runChecks({ folder: base, repo: r, changed, phase: () => {}, record: (c) => results.push(c) }, exec);
  return { failed, calls, results, log: readFileSync(join(base, "checks.log"), "utf8") };
}

test("a check that passes runs once", async () => {
  const r = await run(repo("a"), [{ code: 0 }]);
  expect(r).toMatchObject({ failed: null, calls: ["a"] });
  expect(r.results[0].rerun).toBeUndefined();
  expect(flakes()).toEqual([]);
});

test("failedTests gives each failed test once, without its duration", () => {
  expect(failedTests("(fail) suite > one [12.50ms]\nok\n(fail) three\n\n(fail) suite > one [12.50ms]")).toEqual(["suite > one", "three"]);
});

test("a pass on the second run is a flake that names the failed tests once each", async () => {
  const print = "x.test.ts:\n(fail) suite > one [12.50ms]\n(pass) two\n\n1 tests failed:\n(fail) suite > one [12.50ms]\n(fail) three\n";
  const r = await run(repo("a"), [{ code: 1, print }, { code: 0, print: "fine\n" }]);
  expect(r).toMatchObject({ failed: null, calls: ["a", "a"], results: [{ name: "a", ok: true, rerun: true }] });
  expect(r.log).toContain("## a: exit 1, run again\nx.test.ts:");
  expect(r.log).toContain("## a: exit 0 (second run)\nfine\n");
  expect(flakes()).toMatchObject([{ repo: "r", check: "a", tests: ["suite > one", "three"] }]);
});

test("a failure on both runs fails the check, records no flake and stops the loop", async () => {
  const r = await run(repo("a", "b"), [{ code: 1 }, { code: 2 }]);
  expect(r).toMatchObject({ failed: { cause: "check", checkName: "a", reason: "a failed" }, calls: ["a", "a"], results: [{ name: "a", ok: false }] });
  expect(flakes()).toEqual([]);
});

test("a timeout gives no verdict and has no rerun", async () => {
  const r = await run(repo("a"), [{ code: 124, timedOut: true }]);
  expect(r).toMatchObject({ failed: { cause: "infra", checkName: "a", reason: "no verdict: check a timed out", timedOut: true }, calls: ["a"], results: [{ name: "a", ok: false, noVerdict: true }] });
  expect(r.log).toContain("exit 124 (timed out)");
});

test("a second run that times out gives no verdict", async () => {
  const r = await run(repo("a"), [{ code: 1 }, { code: 124, timedOut: true }]);
  expect(r).toMatchObject({ failed: { cause: "infra", checkName: "a", reason: "no verdict: check a timed out" }, results: [{ ok: false, noVerdict: true }] });
  expect(flakes()).toEqual([]);
});

test("a check that a signal killed gives no verdict and has no rerun", async () => {
  const r = await run(repo("a", "b"), [{ code: 137, killed: true }]);
  expect(r).toMatchObject({ failed: { cause: "infra", checkName: "a", reason: "no verdict: check a was killed" }, calls: ["a"], results: [{ ok: false, noVerdict: true }] });
  expect(r.log).toContain("exit 137 (killed)");
});

test("a check waits while the load is at or over the limit, its time limit starts after, and the wait is its phase", async () => {
  Object.assign(process.env, { ALEPH_LOAD_LIMIT: "8", ALEPH_CHECK_TIMEOUT: "7" });
  const loads = [12, 8, 3];
  const calls: { limit: number }[] = [];
  const pauses: { ms: number; ran: number }[] = [];
  const phases: string[] = [];
  const exec: CheckExec = async (_check, out, limit) => { calls.push({ limit }); writeFileSync(out, ""); return { code: 0, timedOut: false }; };
  const admission = { load: () => loads.shift()!, pause: async (ms: number) => { pauses.push({ ms, ran: calls.length }); } };
  expect(await runChecks({ folder: base, repo: repo("a"), changed: [], phase: (p) => phases.push(p), admission }, exec)).toBeNull();
  // Two reads at or over the limit: two pauses before the check ran, then the queue's gap after it started.
  expect(pauses).toEqual([{ ms: 5000, ran: 0 }, { ms: 5000, ran: 0 }, { ms: 15000, ran: 0 }]);
  expect(calls).toEqual([{ limit: 7 }]);
  expect(phases).toEqual(["check a", "check a: waiting: load 12.0 is at or over 8", "check a: waiting: load 8.0 is at or over 8", "check a"]);
});

test("exit code 124 without the clock is an ordinary failure", async () => {
  const r = await run(repo("a"), [{ code: 124 }, { code: 124 }]);
  expect(r).toMatchObject({ failed: { cause: "check", checkName: "a", reason: "a failed" }, calls: ["a", "a"] });
});

test("a check with `when` runs only when a changed file matches", async () => {
  const r = { key: "r", checks: [{ name: "android", run: "x", when: ["android/**"] }, { name: "all", run: "y" }] } as unknown as Repo;
  expect((await run(r, [{ code: 0 }], ["ui/a.ts"])).calls).toEqual(["all"]);
  expect((await run(r, [{ code: 0 }, { code: 0 }], ["android/b.kt"])).calls).toEqual(["android", "all"]);
});

describe("the test record of a `bun test` check", () => {
  /** Runs one check `cmd` with the real shell in a folder that holds `files`. */
  async function real(cmd: string, files: Record<string, string>) {
    const cwd = join(base, "repo");
    mkdirSync(cwd, { recursive: true });
    for (const [name, text] of Object.entries(files)) writeFileSync(join(cwd, name), text);
    const results: CheckResult[] = [];
    const r = { key: "r", checks: [{ name: "unit tests", run: cmd }] } as unknown as Repo;
    const exec: CheckExec = (check, out, limit) => shell(check.run, { cwd, env: process.env, out, limit });
    const failed = await runChecks({ folder: base, repo: r, changed: [], phase: () => {}, record: (c) => results.push(c) }, exec);
    return { failed, results };
  }
  const suite = `import { describe, expect, test } from "bun:test";
test("passes", () => expect(1).toBe(1));
test.skip("skipped", () => {});
describe("outer", () => { describe("inner", () => { test("fails <&>", () => { expect(1).toBe(2); }); }); });
`;

  test("records the counts and each failed test with its describe names and its failure", async () => {
    const { failed, results } = await real("bun test", { "a.test.ts": suite });
    expect(failed).toMatchObject({ checkName: "unit tests", reason: "unit tests failed" });
    const tests = results[0].tests!;
    expect({ ...tests, failures: [] }).toEqual({ ran: 2, passed: 1, failed: 1, skipped: 1, failures: [] });
    expect(tests.failures).toMatchObject([{ file: "a.test.ts", name: "outer > inner > fails <&>" }]);
    expect(tests.failures[0].message).toContain("Expected: 2");
    expect(tests.failures[0].message.split("\n").length).toBeLessThanOrEqual(20);
  });

  test("a check that runs 0 tests fails", async () => {
    const { failed, results } = await real("bun test", { "a.test.ts": "export {};\n" });
    expect(failed).toMatchObject({ cause: "check", checkName: "unit tests", reason: "ran 0 tests: check unit tests" });
    expect(results).toMatchObject([{ ok: false, tests: { ran: 0, passed: 0, failed: 0, skipped: 0, failures: [] } }]);
  });

  test("a check that does not run `bun test` has no record", async () => {
    const { failed, results } = await real("true", {});
    expect(failed).toBeNull();
    expect(results[0].tests).toBeUndefined();
  });
});

test("withJunit: the reporter flags go after `bun test` or `bun run test`, and other commands stay as they are", () => {
  expect(withJunit("bun run test './a.test.ts'", "/r/junit-tests.xml")).toBe("bun run test --reporter=junit --reporter-outfile='/r/junit-tests.xml' './a.test.ts'");
  expect(withJunit("bun test app", "/r/j.xml")).toBe("bun test --reporter=junit --reporter-outfile='/r/j.xml' app");
  expect(withJunit("bunx tsc", "/r/j.xml")).toBe("bunx tsc");
  expect(withJunit("bun run test:all", "/r/j.xml")).toBe("bun run test:all --reporter=junit --reporter-outfile='/r/j.xml'");
  expect(withJunit("bun run test:all './a.test.ts'", "/r/j.xml")).toBe("bun run test:all --reporter=junit --reporter-outfile='/r/j.xml' './a.test.ts'");
  expect(runsBunTest("bun run test:all")).toBe(true);
  expect(runsBunTest("bunx tsc")).toBe(false);
});

test("flake rows from parallel processes all survive", async () => {
  const script = join(base, "flake.ts");
  writeFileSync(script, `
import { runChecks } from ${JSON.stringify(join(import.meta.dir, "checks.ts"))};
let n = 0;
const repo = { key: "r", checks: Array.from({ length: 25 }, (_, i) => ({ name: process.argv[2] + "-" + i, run: "x" })) };
await runChecks({ folder: ${JSON.stringify(base)}, repo, changed: [], phase: () => {} }, async () => ({ code: n++ % 2 ? 0 : 1, timedOut: false }));
`);
  const names = Array.from({ length: 8 }, (_, i) => `c${i}`);
  const procs = names.map((n) => Bun.spawn([process.execPath, script, n], { env: process.env, stdout: "ignore", stderr: "pipe" }));
  const codes = await Promise.all(procs.map((p) => p.exited));
  expect(codes).toEqual(names.map(() => 0));
  expect(flakes().length).toBe(names.length * 25);
});

test("newCases: the names of the test and it cases on added lines only", () => {
  const diff = `--- a/x.test.ts\n+++ b/x.test.ts\n+test("adds one", () => {});\n+  it.skip('skips', () => {});\n-test("gone", () => {});\n test("kept", () => {});\n+expect(submit("no")).toBe(1);\n`;
  expect(newCases(diff)).toEqual(["adds one", "skips"]);
});

test("newCases: an added case that pairs with a removed one is a rename, not a new case", () => {
  const diff = `--- a/x.test.ts\n+++ b/x.test.ts\n@@ -3,4 +3,5 @@\n test("kept", () => {});\n-test("old goal title", () => {});\n+test("new objective title", () => {});\n test("kept too", () => {});\n+test("adds one", () => {});\n`;
  expect(newCases(diff)).toEqual(["adds one"]);
});

/**
 * The keep-gate with a runner that runs the command in a plain folder: `code` maps a commit to the source of
 * m.ts there, and `hidden` goes to `.hidden` as runOnCommit gives it. The test file is new on the head.
 */
async function gate(code: Record<string, string>, testText: string, sources: Source[] = [], names = ["new", "fixed"]) {
  const commands: string[] = [];
  const runner: Runner = async (_repo, sha, command, hidden) => {
    commands.push(`${sha}: ${command}`);
    const dir = mkdtempSync(join(base, `${sha}-`));
    writeFileSync(join(dir, "m.ts"), code[sha]);
    if (sha === "head") { mkdirSync(join(dir, "lib")); writeFileSync(join(dir, "lib", "m.test.ts"), testText); }
    if (hidden) { mkdirSync(join(dir, ".hidden")); for (const [n, t] of Object.entries(hidden)) writeFileSync(join(dir, ".hidden", n), t); }
    const p = Bun.spawnSync(["bash", "-c", command], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    return { code: p.exitCode ?? 1, output: p.stdout.toString() + p.stderr.toString() };
  };
  const tests = [{ path: "lib/m.test.ts", text: testText, names }];
  return { result: await keepGate({ key: "r" } as Repo, "base", "head", tests, sources, runner), commands };
}

describe("the keep-gate", () => {
  const testText = `import { expect, test } from "bun:test";\nimport { m } from "../m.ts";\ntest("old", () => expect(1).toBe(1));\ntest("new", () => expect(m()).toBe(2));\ntest("fixed", () => expect(typeof m).toBe("function"));\n`;

  test("a new case that passes on the base sends the branch back with its name; the head's file runs on the base code", async () => {
    const { result, commands } = await gate({ base: "export const m = () => 1;\n", head: "export const m = () => 2;\n" }, testText);
    expect(result?.reason).toBe("keep-gate: 1 new test passes on the base commit: lib/m.test.ts > fixed");
    expect(result?.log).toContain("- lib/m.test.ts > fixed\n");
    expect(commands.map((c) => c.split(":")[0])).toEqual(["head", "base"]);
  });

  test("a case named guard: is not held for passing on the base", async () => {
    const code = { base: "export const m = () => 1;\n", head: "export const m = () => 2;\n" };
    const text = testText.replace('test("fixed"', 'test("guard: fixed"');
    expect((await gate(code, text, [], ["new", "guard: fixed"])).result).toBeNull();
    expect((await gate(code, testText, [], ["new", "fixed"])).result?.reason).toContain("lib/m.test.ts > fixed");
  });

  test("new cases that all fail on the base pass the gate", async () => {
    const { result } = await gate({ base: "export const other = 1;\n", head: "export const m = () => 2;\n" }, testText);
    expect(result).toBeNull();
  });

  test("a new case that fails on the head fails the gate after one rerun, and the base does not run", async () => {
    const { result, commands } = await gate({ base: "export const m = () => 1;\n", head: "export const m = () => 3;\n" }, testText);
    expect(result?.reason).toBe("keep-gate: the new tests fail on the head");
    expect(commands.map((c) => c.split(":")[0])).toEqual(["head", "head"]);
  });

  test("a command that could not run (infra) on the head or the base is no verdict, not a pass", async () => {
    const tests = [{ path: "lib/m.test.ts", text: testText, names: ["new"] }];
    const infraOn = (where: string): Runner => async (_r, sha) => (sha === where ? { code: 124, output: "timed out after 1200 s", infra: true } : { code: sha === "head" ? 0 : 1, output: "" });
    expect(await keepGate({ key: "r" } as Repo, "base", "head", tests, [], infraOn("head"))).toMatchObject({ noVerdict: true, reason: "no verdict: keep-gate: the new tests did not run on the head" });
    expect(await keepGate({ key: "r" } as Repo, "base", "head", tests, [], infraOn("base"))).toMatchObject({ noVerdict: true, reason: "no verdict: keep-gate: the new tests did not run on the base" });
  });

  test("no new case runs nothing", async () => {
    expect(await keepGate({ key: "r" } as Repo, "base", "head", [], [], async () => { throw new Error("ran"); })).toBeNull();
  });

  describe("the second stage: a new case whose file does not load on the base", () => {
    const head = "export const other = 1;\nexport function m(x: number) {\n  if (x > 0) return x + 1;\n  return 0;\n}\n";
    const sources = [{ path: "m.ts", lines: [2, 3, 4, 5], text: head }];
    const code = { base: "export const other = 1;\n", head };

    test("a case that covers no changed line beyond the other cases and kills no mutant goes back with its name; one that covers a changed line stays", async () => {
      const { result, commands } = await gate(code, testText.replace("m()).toBe(2)", "m(1)).toBe(2)"), sources);
      expect(result?.reason).toBe("keep-gate: 1 new test adds no coverage of the changed lines and kills no mutant: lib/m.test.ts > fixed");
      expect(result?.log).toContain("- lib/m.test.ts > fixed\n");
      expect(commands.map((c) => c.split(":")[0])).toEqual(["head", "base", "head"]);
    }, 30_000);

    test("two cases that cover the same changed lines each kill a mutant and stay; a branch with no changed source line runs no second stage", async () => {
      const twin = testText.replace("m()).toBe(2)", "m(1)).toBe(2)").replace(`expect(typeof m).toBe("function")`, "expect(m(2)).toBe(3)");
      expect((await gate(code, twin, sources)).result).toBeNull();
      expect((await gate(code, twin)).commands.map((c) => c.split(":")[0])).toEqual(["head", "base"]);
    }, 30_000);

    test("of more than 10 mutants, the ones run are on the lines the new cases cover, which the even spread of 10 does not pick", async () => {
      const many = "export const other = 1;\n" + Array.from({ length: 12 }, (_, k) => `export function f${k}() {\n  return ${k};\n}\n`).join("");
      const manySources = [{ path: "m.ts", lines: Array.from({ length: 12 }, (_, k) => 3 + 3 * k), text: many }];
      const both = `import { expect, test } from "bun:test";\nimport { f5, f11 } from "../m.ts";\ntest("new", () => expect(f5() + f11()).toBe(16));\ntest("fixed", () => expect(f5() + f11()).toBe(16));\n`;
      expect((await gate({ base: "export const other = 1;\n", head: many }, both, manySources)).result).toBeNull();
    }, 30_000);

    test("with no mutant of the changed lines, a case that runs a changed line stays even when another case runs it; one that runs none goes back", async () => {
      const flat = "export const other = 1;\nexport function m(x: number) {\n  return x;\n}\n";
      const flatSources = [{ path: "m.ts", lines: [3], text: flat }];
      const shared = testText.replace("m()).toBe(2)", "m(1)).toBe(1)").replace(`expect(typeof m).toBe("function")`, "expect(m(2)).toBe(2)");
      expect((await gate({ base: "export const other = 1;\n", head: flat }, shared, flatSources)).result).toBeNull();
      const { result } = await gate({ base: "export const other = 1;\n", head: flat }, shared.replace("expect(m(2)).toBe(2)", `expect(typeof m).toBe("function")`), flatSources);
      expect(result?.reason).toBe("keep-gate: 1 new test covers no changed line: lib/m.test.ts > fixed");
    }, 30_000);

    test("with no mutant, a case that only loads a file of two changed functions runs no changed line and goes back", async () => {
      const two = "export const other = 1;\nexport function m(x: number) {\n  return x;\n}\nexport function n(y: number) {\n  return y;\n}\n";
      const twoSources = [{ path: "m.ts", lines: [3, 6], text: two }];
      const loadOnly = testText.replace("m()).toBe(2)", "m(1)).toBe(1)");
      const { result } = await gate({ base: "export const other = 1;\n", head: two }, loadOnly, twoSources);
      expect(result?.reason).toBe("keep-gate: 1 new test covers no changed line: lib/m.test.ts > fixed");
    }, 30_000);
  });
});

test("addedLines and mutants: the new-side lines of a diff, and one mutant a changed line, at most `max`, spread evenly", () => {
  expect(addedLines("@@ -1,0 +2,3 @@\n+a\n@@ -9 +12 @@\n@@ -20,2 +23,0 @@\n")).toEqual([2, 3, 4, 12]);
  const text = ["// note", "if (a === b && c) go();", "x = n < 3;", "save(x);", "return true;", "const y = 4;", "import { z } from \"z\";"].join("\n");
  const all = mutants([{ path: "a.ts", lines: [1, 2, 3, 4, 5, 6, 7], text }]);
  expect(all.map((m) => m.text)).toEqual(["if (a !== b && c) go();", "x = n >= 3;", "", "return false;", "const y = 5;"]);
  expect(mutants([{ path: "a.ts", lines: [2, 3, 4, 5, 6], text }], 2).map((m) => m.line)).toEqual([2, 4]);
});

