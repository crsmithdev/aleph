/**
 * Only lib/naming.ts builds an issue key: `issueKey` and `key` there give `issue.<n>`. A copy that writes the template
 * by hand drifts from `parseKey`. This test lists each source file in jobs/, ui/, vault/, issues/, hooks/ and lib/ that
 * writes `issue.${`, except the owner and todo.ts (its own owner has not moved its two sites yet).
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OWNER = "lib/naming.ts";
/** Sites to move: lib/todo.ts builds `issue.${` at one place and parses `^issue\.\d+$` at another. */
const LATER = ["lib/todo.ts"];
const SKIPPED = /\.test\.ts$/;

test("no source file builds an issue key by hand but the owner", () => {
  const found = [...new Glob("{jobs,ui,vault,issues,hooks,lib}/**/*.ts").scanSync(ROOT)]
    .filter((f) => f !== OWNER && !LATER.includes(f) && !SKIPPED.test(f) && /`issue\.\$\{/.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
