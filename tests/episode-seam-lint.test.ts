/**
 * Only jobs/lib/learning/episode.ts reaches into the episode folder: it lists, reads, edits and removes the pages. A caller of
 * episodesDir() reads or deletes pages by hand, past the file-name rule and the KEEP_DAYS prune that the owner holds.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OWNER = "jobs/lib/learning/episode.ts";
/** ui/updater.ts watches the folder as a whole and lists no page. */
const ALLOWED = ["ui/updater.ts"];

test("no file calls episodesDir() but the owner", () => {
  const found = [...new Glob("{jobs,ui,vault,hooks,lib}/**/*.ts").scanSync(ROOT)]
    .filter((f) => f !== OWNER && !ALLOWED.includes(f) && !/\.test\.ts$/.test(f) && /\bepisodesDir\(/.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
