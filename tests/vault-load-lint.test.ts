/**
 * One function loads the wiki and one function ranks a recall. A caller that loads the whole vault to keep its wiki notes
 * reads archive and daily files it drops, and a caller that opens the index itself can leak the sqlite handle.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const sources = () => [...new Glob("**/*.ts").scanSync(ROOT)].filter((f) => !/^(node_modules|vendor|\.worktrees)\/|\.test\.ts$/.test(f));

test("no file filters loadVault to the wiki", () => {
  expect(sources().filter((f) => /wikiNotes\(\s*await loadVault\(/.test(readFileSync(join(ROOT, f), "utf8")))).toEqual([]);
});

test("vault/lib/index.ts exports recall and not the index handle", () => {
  const text = readFileSync(join(ROOT, "vault/lib/index.ts"), "utf8");
  expect(text).toMatch(/export function recall\(/);
  expect(text).not.toMatch(/export function (openIndex|rankNotes)\b/);
});
