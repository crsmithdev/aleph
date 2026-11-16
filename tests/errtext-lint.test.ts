/**
 * Only lib/errtext.ts turns a thrown value into text. A hand-written `?.message ?? String(` or a `catch (e: any)`
 * types the catch as any and drifts from the owner. This test lists each non-test source file that has either.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OWNER = "lib/errtext.ts";
const SKIPPED = /\.test\.ts$|\.testkit\.ts$/;
const SLOP = /\?\.message \?\? String\(|catch \(\w+: any\)/;

test("no source file hand-writes an error's text or types a catch as any but the owner", () => {
  const found = [...new Glob("{jobs,ui,vault,hooks,lib,issues,herdr}/**/*.ts").scanSync(ROOT)]
    .filter((f) => f !== OWNER && !SKIPPED.test(f) && SLOP.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
