/**
 * Only jobs/lib/infra/settings.ts reads or writes a row of the `settings` table: each setting has one name, one
 * default and one parser there. lib/db.ts defines the table and lib/jev.ts keeps the judge row (it sits below jobs/).
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const ALLOWED = ["jobs/lib/infra/settings.ts", "lib/db.ts", "lib/jev.ts"];
const SKIPPED = /\.test\.ts$|\.fixture\.ts$|\.testkit\.ts$|\.helpers\.ts$/;

test("no source file but settings.ts reads or writes the settings table", () => {
  const found = [...new Glob("{jobs,ui,vault,hooks,lib}/**/*.ts").scanSync(ROOT)]
    .filter((f) => !ALLOWED.includes(f) && !SKIPPED.test(f) && /\b(get|put)Json(<[^>]*>)?\(\s*"settings"/.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
