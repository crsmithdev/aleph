/**
 * Only issues/lib commits into the items repo: the store writes with commit-tree on origin/main and no working tree.
 * A `commitPaths(itemsDir()` call elsewhere commits in the checkout and can diverge from origin/main.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SKIPPED = /\.test\.ts$|\.testkit\.ts$/;

test("no source file outside issues/lib commits into the items repo", () => {
  const found = [...new Glob("{jobs,ui,vault,hooks,lib,ideas}/**/*.ts").scanSync(ROOT)]
    .filter((f) => !SKIPPED.test(f) && /commitPaths\(\s*itemsDir\(\)/.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
