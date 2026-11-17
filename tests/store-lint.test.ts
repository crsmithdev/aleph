/**
 * Only the store (lib/store.ts, lib/todo.ts) and the issue verbs (issues/) read or write an issue's frontmatter:
 * callers use the store's named reads and writes (`afterOf`, `setAfter`, `planSet`, `setPlan`, `priorityOf`,
 * `closedWhy`). A caller that edits `item.fm.x` skips the store's rules for that field. This test lists each other
 * source file that does.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OWNERS = ["lib/store.ts", "lib/todo.ts"];
const SKIPPED = /\.test\.ts$|\.testkit\.ts$|^ui\/fixtures\//;

test("no source file outside the store and the issue verbs reads or writes an issue's `fm` field", () => {
  const found = [...new Glob("{jobs,ui,vault,hooks,lib}/**/*.ts").scanSync(ROOT)]
    .filter((f) => !OWNERS.includes(f) && !SKIPPED.test(f) && /\b(item|issue|i)\.fm[.[]/.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
