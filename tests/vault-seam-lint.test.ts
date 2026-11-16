/**
 * Only vault/lib reads the vault's files: daily notes, .recall.json, Home.md, MEMORY.md. A file in ui/ that joins a path under
 * vaultDir() or a vault `root` reaches past that interface, so a change of the vault's layout would break the page without a type error.
 * Watching vaultDir() as a whole needs no join, so ui/updater.ts passes the lint as it is.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
/** Files that join under the vault on purpose. None must. */
const ALLOWED: string[] = [];

/** A file that names vaultDir() and joins under `root` or vaultDir() reaches into the vault. */
const reaches = (text: string) => /\bvaultDir\b/.test(text) && /\bjoin\(\s*(root|vaultDir\(\))\s*,/.test(text);

test("no file in ui/ joins a path under vaultDir() or a vault root", () => {
  const found = [...new Glob("ui/**/*.ts").scanSync(ROOT)]
    .filter((f) => !ALLOWED.includes(f) && !/\.test\.ts$/.test(f) && reaches(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
