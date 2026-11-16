/**
 * An old address that a view takes over keeps its whole query, and only `moved` in ui/views/lib/router.js builds the new one.
 * This test lists each view whose arrow-function `redirect` splits the hash itself.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

test("no view's arrow redirect builds its own address but through moved()", () => {
  const found = [...new Glob("ui/views/*.js").scanSync(ROOT)]
    .filter((f) => /export const redirect = \(hash\) =>(?! moved\()/.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
