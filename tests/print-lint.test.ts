/**
 * No test prints: a test asserts what it would print. This test reads every test file and fails when one starts a
 * line with a console print and is not in EXCEPT, or when a file in EXCEPT no longer does, so the list only shrinks.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const PRINT = /^\s*console\.(?:log|debug|info|dir)\(/m;

/** The prints here are a script's output inside a fixture string, or the report of a live test. */
const EXCEPT = ["issues/cli.test.ts", "jobs/lib/routing/gpt-oss-start.test.ts", "tests/live/judge.test.ts"];

test("no test file prints, except the files in EXCEPT", () => {
  const found = [...new Bun.Glob("**/*.test.ts").scanSync({ cwd: ROOT })]
    .filter((f) => !/^(node_modules|vendor|\.worktrees|acceptance)\//.test(f) && PRINT.test(readFileSync(join(ROOT, f), "utf8")));
  expect([...found.filter((f) => !EXCEPT.includes(f)), ...EXCEPT.filter((f) => !found.includes(f)).map((f) => `${f} no longer prints: remove it from EXCEPT`)].sort()).toEqual([]);
});
