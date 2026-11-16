/**
 * Only lib/usage.ts runs SQL on the `usage` and `openrouter` tables (lib/db.ts holds their schema). ui/usage.ts polls
 * and calls it; jobs/ cannot import ui/, so a raw query there would copy the SQL.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ALLOWED = ["lib/usage.ts", "lib/db.ts"];
const SKIPPED = /\.test\.ts$|\.fixture\.ts$|\.testkit\.ts$|\.helpers\.ts$/;

test("no source file but lib/usage.ts runs SQL on the usage or openrouter table", () => {
  const found = [...new Glob("{jobs,ui,vault,hooks,lib,ideas,issues}/**/*.ts").scanSync(ROOT)]
    .filter((f) => !ALLOWED.includes(f) && !SKIPPED.test(f) && /\b(FROM|INTO|UPDATE)\s+(usage|openrouter)\b/i.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
