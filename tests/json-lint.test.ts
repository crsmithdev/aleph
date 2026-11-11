/**
 * Only lib/json.ts parses a JSON file it reads: a missing file is the fallback, a bad one throws.
 * A copy that catches the parse turns a corrupt file into the default. This test lists each source file in jobs/, ui/, vault/ and hooks/ that
 * parses a file it reads, except the files in READS, which read a file that must be there.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OWNER = "lib/json.ts";
/** Reads of a file that must be there: a missing one throws too. */
const READS = ["jobs/lib/gates/keep-earn.ts"];
const SKIPPED = /\.test\.ts$|\.fixture\.ts$|\.testkit\.ts$|\.helpers\.ts$/;

test("no source file in jobs/, ui/, vault/ or hooks/ parses a JSON file but the owner", () => {
  const found = [...new Glob("{jobs,ui,vault,hooks}/**/*.ts").scanSync(ROOT)]
    .filter((f) => f !== OWNER && !READS.includes(f) && !SKIPPED.test(f) && /JSON\.parse\(\s*readFileSync\(/.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
