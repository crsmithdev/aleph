/**
 * A skip says why: each test.skip, describe.skip, it.skip or .todo call has a `tests/flaky.md#<anchor>` or an
 * aleph-<n> issue in its line or the two lines before it, so a skipped test is not forgotten.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SKIP = /^\s*(?:test|it|describe)\.(?:skip|todo)\(/;
const WHY = /tests\/flaky\.md#[\w-]+|aleph-\d+/;
/** The skip here is a line of a fixture test file inside a string. */
const EXCEPT = ["jobs/lib/gates/checks.test.ts"];

test("each skip names its tests/flaky.md anchor or issue", () => {
  const found = [...new Bun.Glob("**/*.test.ts").scanSync({ cwd: ROOT })]
    .filter((f) => !/^(node_modules|vendor|\.worktrees|acceptance)\//.test(f) && !EXCEPT.includes(f))
    .flatMap((f) => readFileSync(join(ROOT, f), "utf8").split("\n").flatMap((line, i, all) =>
      SKIP.test(line) && !WHY.test(all.slice(Math.max(0, i - 2), i + 1).join("\n")) ? [`${f}:${i + 1}`] : []));
  expect(found).toEqual([]);
});
