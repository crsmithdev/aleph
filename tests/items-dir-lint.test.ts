/**
 * Only issues/lib names the items repo's directory: the store reads its history and says which paths to watch
 * (`filed`, `storeLog`, `storeRefDir`, `registryDir`, `projectsOnMain`). The files in READS need the directory itself:
 * the idea files that live beside the issues, the media folder a run reads, and the guard that protects the checkout.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const READS = ["ideas/ideas.ts", "jobs/lib/roles/intake.ts", "hooks/git-guard.ts"];
const SKIPPED = /\.test\.ts$|\.fixture\.ts$|\.testkit\.ts$|\.helpers\.ts$/;

test("no source file outside issues/lib calls itemsDir() but the listed reads", () => {
  const found = [...new Glob("{jobs,ui,vault,hooks,lib,ideas}/**/*.ts").scanSync(ROOT)]
    .filter((f) => !READS.includes(f) && !SKIPPED.test(f) && /\bitemsDir\(\)/.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
