/**
 * The `Job:` and `Issue:` commit trailers have one writer and one reader, in jobs/lib/records/status.ts. This test lists each
 * source file that holds a string starting with `Job:` or `Issue:` elsewhere.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OWNER = "jobs/lib/records/status.ts";
const LITERAL = /[`"'](?:Job|Issue): /;
const SKIPPED = /\.(test|testkit)\.ts$/;

test("only status.ts writes or greps a Job: or Issue: trailer", () => {
  const found = [...new Bun.Glob("{jobs,ui,vault,hooks,lib,issues}/**/*.ts").scanSync({ cwd: ROOT })]
    .filter((f) => f !== OWNER && !SKIPPED.test(f) && LITERAL.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
