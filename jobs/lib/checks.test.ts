import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addedLines, cloneAndSetup, keepGate, mutants, newCases, runChecks, type CheckExec, type Runner, type Source } from "./checks.ts";
import { flakes } from "./factory-status.ts";
import { checkSlot } from "./ledger.ts";
import type { CheckResult, Repo } from "./ledger.ts";

const KEYS = ["ALEPH_FACTORY_DIR", "XDG_RUNTIME_DIR", "ALEPH_CHECK_SLOTS", "ALEPH_CHECK_TIMEOUT"];
let base: string;
let saved: Record<string, string | undefined>;

beforeEach(() => {
  base = mkdtempSync(join(tmpdir(), "checks-"));
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  Object.assign(process.env, { ALEPH_FACTORY_DIR: join(base, "factory"), XDG_RUNTIME_DIR: join(base, "run"), ALEPH_CHECK_SLOTS: "4" });
  delete process.env.ALEPH_CHECK_TIMEOUT;
});

afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(base, { recursive: true, force: true });
});

type Reply = { code: number; timedOut?: boolean; print?: string };
const repo = (...names: string[]) => ({ key: "r", checks: names.map((name) => ({ name, run: name })) }) as unknown as Repo;

/** Runs the repo's checks with a fake exec that gives the replies in order. */
async function run(r: Repo, replies: Reply[], changed: string[] = []) {
  const calls: string[] = [];
  const results: CheckResult[] = [];
  const exec: CheckExec = async (check, out) => {
    calls.push(check.name);
    const reply = replies.shift()!;
    writeFileSync(out, reply.print ?? "");
    return { code: reply.code, timedOut: reply.timedOut ?? false };
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

test("a timeout has no rerun", async () => {
  const r = await run(repo("a"), [{ code: 124, timedOut: true }]);
  expect(r).toMatchObject({ failed: { cause: "check", checkName: "a", reason: "timed out: check a", timedOut: true }, calls: ["a"] });
  expect(r.log).toContain("exit 124 (timed out)");
});

test("a second run that times out is a timeout", async () => {
  const r = await run(repo("a"), [{ code: 1 }, { code: 124, timedOut: true }]);
  expect(r).toMatchObject({ failed: { cause: "check", checkName: "a", reason: "timed out: check a", timedOut: true }, results: [{ ok: false }] });
  expect(flakes()).toEqual([]);
});

test("a check waits for a free slot, and its time limit starts only once it holds one", async () => {
  Object.assign(process.env, { ALEPH_CHECK_SLOTS: "1", ALEPH_CHECK_TIMEOUT: "7" });
  const free = await checkSlot();
  let freed = false;
  const calls: { freed: boolean; limit: number }[] = [];
  const exec: CheckExec = async (_check, out, limit) => { calls.push({ freed, limit }); writeFileSync(out, ""); return { code: 0, timedOut: false }; };
  let reached!: () => void;
  const atCheck = new Promise<void>((r) => { reached = r; });
  const done = runChecks({ folder: base, repo: repo("a"), changed: [], phase: () => reached() }, exec);
  await atCheck;
  // exec, which applies the limit from its own start, is not called while the test holds the only slot.
  expect(calls).toEqual([]);
  freed = true;
  free();
  expect(await done).toBeNull();
  expect(calls).toEqual([{ freed: true, limit: 7 }]);
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

test("the check prelude carries both NO_SUBMODULES lines", async () => {
  const { NO_SUBMODULES } = await import("./git.ts");
  const lines = cloneAndSetup([], "b", "r").split("\n");
  expect(lines.slice(1, 4)).toEqual(["git init -q .", ...NO_SUBMODULES]);
});

test("newCases: the names of the test and it cases on added lines only", () => {
  const diff = `--- a/x.test.ts\n+++ b/x.test.ts\n+test("adds one", () => {});\n+  it.skip('skips', () => {});\n-test("gone", () => {});\n test("kept", () => {});\n+expect(submit("no")).toBe(1);\n`;
  expect(newCases(diff)).toEqual(["adds one", "skips"]);
});

/**
 * The keep-gate with a runner that runs the command in a plain folder: `code` maps a commit to the source of
 * m.ts there, and `hidden` goes to `.hidden` as runOnCommit gives it. The test file is new on the head.
 */
async function gate(code: Record<string, string>, testText: string, sources: Source[] = []) {
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
  const tests = [{ path: "lib/m.test.ts", text: testText, names: ["new", "fixed"] }];
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

  test("new cases that all fail on the base pass the gate", async () => {
    const { result } = await gate({ base: "export const other = 1;\n", head: "export const m = () => 2;\n" }, testText);
    expect(result).toBeNull();
  });

  test("a new case that fails on the head fails the gate after one rerun, and the base does not run", async () => {
    const { result, commands } = await gate({ base: "export const m = () => 1;\n", head: "export const m = () => 3;\n" }, testText);
    expect(result?.reason).toBe("keep-gate: the new tests fail on the head");
    expect(commands.map((c) => c.split(":")[0])).toEqual(["head", "head"]);
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

    test("with no mutant of the changed lines, a case that runs a changed line stays even when another case runs it; one that runs none goes back", async () => {
      const flat = "export const other = 1;\nexport function m(x: number) {\n  return x;\n}\n";
      const flatSources = [{ path: "m.ts", lines: [3], text: flat }];
      const shared = testText.replace("m()).toBe(2)", "m(1)).toBe(1)").replace(`expect(typeof m).toBe("function")`, "expect(m(2)).toBe(2)");
      expect((await gate({ base: "export const other = 1;\n", head: flat }, shared, flatSources)).result).toBeNull();
      const { result } = await gate({ base: "export const other = 1;\n", head: flat }, shared.replace("expect(m(2)).toBe(2)", `expect(typeof m).toBe("function")`), flatSources);
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

test("cloneAndSetup: the clone steps and the setup group with its log and exit code", () => {
  expect(cloneAndSetup(["a", "b c"], "out/x.bundle", "refs/h/it's")).toBe(
    ["set -e", "git init -q .", "git config fetch.recurseSubmodules false", "git config submodule.recurse false", `git fetch -q ../out/x.bundle '+refs/h/it'\\''s:refs/heads/check'`, "git switch -q check", "set +e", "{ a && b c && true; } > ../checklog/setup.log 2>&1; echo $? > ../checklog/setup.code"].join("\n"),
  );
});
