/**
 * A test puts back each variable it changes: a teardown that deletes one sends every later test in the process to
 * the shell's value or to none. This test fails when a `finally` or an `afterEach`/`afterAll` deletes a process.env
 * variable and the file is not in EXCEPT, or when a file in EXCEPT no longer does, so the list only shrinks.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const DELETE = /^\s*(?:\}\s*)?delete process\.env(?:\.\w+|\[)/;
const TEARDOWN = /\bfinally\s*\{|\bafter(?:Each|All)\(/;

/** Each of these deletes a variable that was unset before the test, so the delete puts it back. */
const EXCEPT = ["hooks/verify-gate.test.ts", "jobs/lib/gates/firefighter.test.ts", "jobs/lib/transitions/tick.test.ts"];

/** True when a line of `text` deletes a variable within three lines of a teardown's start. */
const deletes = (text: string) => text.split("\n").some((l, i, all) => DELETE.test(l) && all.slice(Math.max(0, i - 3), i + 1).some((p) => TEARDOWN.test(p)));

test("no teardown deletes an env variable it should restore, except the files in EXCEPT", () => {
  const found = [...new Bun.Glob("**/*.{test,helpers,fixture,testkit}.ts").scanSync({ cwd: ROOT })]
    .filter((f) => !/^(node_modules|vendor|\.worktrees|acceptance)\//.test(f) && deletes(readFileSync(join(ROOT, f), "utf8")));
  expect([...found.filter((f) => !EXCEPT.includes(f)), ...EXCEPT.filter((f) => !found.includes(f)).map((f) => `${f} no longer deletes: remove it from EXCEPT`)].sort()).toEqual([]);
});
