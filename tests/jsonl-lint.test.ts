/**
 * lib/jsonl.ts is the only place that parses a transcript line by line. A file that splits text on a newline and then
 * parses each line has made a second reader, with its own rule for a cut-off last line.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");

test("no file but lib/jsonl.ts parses a transcript line by line", () => {
  const found = [...new Glob("{hooks,skills}/**/*.ts").scanSync(ROOT)]
    .filter((f) => !/\.test\.ts$/.test(f) && /for \(const \w+ of [^)]*split\("\\n"\)\)[\s\S]{0,120}JSON\.parse\(/.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
