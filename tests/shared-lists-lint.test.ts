/**
 * Only lib/naming.ts writes out a list of the closed statuses, of the priorities or of the sources. A copy of a list drifts when a value is added.
 * This test lists each source file in jobs/, ui/, issues/ and hooks/ that writes one out.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const SKIPPED = /\.test\.ts$|\.fixture\.ts$|\.testkit\.ts$|\.helpers\.ts$/;
const LISTS = {
  closed: /\["done",\s*"dropped"/,
  priorities: /"low",\s*"medium",\s*"high",\s*"critical"|"critical",\s*"high",\s*"medium",\s*"low"/,
  sources: /"chris",\s*"worker",\s*"deps",\s*"memory",\s*"agent"/,
};

for (const [name, re] of Object.entries(LISTS)) {
  test(`no source file but lib/naming.ts writes out the ${name} list`, () => {
    const found = [...new Glob("{jobs,ui,issues,hooks}/**/*.{ts,js}").scanSync(ROOT)]
      .filter((f) => !SKIPPED.test(f) && re.test(readFileSync(join(ROOT, f), "utf8")))
      .sort();
    expect(found).toEqual([]);
  });
}
