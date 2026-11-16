/**
 * Only issues/lib reads or writes an issue's frontmatter: callers use the store's named reads and writes
 * (`afterOf`, `setAfter`, `planSet`, `setPlan`, `priorityOf`, `closedWhy`). A caller that edits `item.fm.x` skips the
 * store's rules for that field. This test lists each source file outside issues/lib that does.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SKIPPED = /\.test\.ts$|\.testkit\.ts$|^ui\/fixtures\//;

test("no source file outside issues/lib reads or writes an issue's `fm` field", () => {
  const found = [...new Glob("{jobs,ui,vault,hooks,lib}/**/*.ts").scanSync(ROOT)]
    .filter((f) => !SKIPPED.test(f) && /\b(item|issue|i)\.fm[.[]/.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
