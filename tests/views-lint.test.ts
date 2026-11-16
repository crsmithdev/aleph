/**
 * A view reaches another view only through a shared module in ui/views/lib/: a view that imports a sibling couples two pages,
 * and a rename of one breaks the other. This test lists each file in ui/views/ that imports a sibling view, and each import of a view from ui/views/lib/.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI = join(import.meta.dir, "..", "ui");
const read = (f: string) => readFileSync(join(UI, f), "utf8");

test("no ui/views/*.js imports a sibling view", () => {
  const found = [...new Bun.Glob("views/*.js").scanSync({ cwd: UI })].filter((f) => /from "\.\/(?!lib\/)[^"]+"/.test(read(f))).sort();
  expect(found).toEqual([]);
});

test("no ui/views/lib/*.js imports a view", () => {
  const found = [...new Bun.Glob("views/lib/*.js").scanSync({ cwd: UI })].filter((f) => /from "\.\.\/[\w-]+\.js"/.test(read(f))).sort();
  expect(found).toEqual([]);
});
