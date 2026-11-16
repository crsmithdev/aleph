/**
 * The factory folder and the dispatch log have one definition, in lib/layout.ts. This test lists each source file that defines
 * `factoryDir` itself or names `dispatch.log` in a string, except the owner and the test helpers.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OWNER = "lib/layout.ts";
const SKIPPED = /\.(test|helpers|fixture|testkit)\.ts$/;

test("only lib/layout.ts defines factoryDir or names dispatch.log", () => {
  const found = [...new Bun.Glob("{jobs,ui,vault,hooks,lib,issues}/**/*.ts").scanSync({ cwd: ROOT })]
    .filter((f) => f !== OWNER && !SKIPPED.test(f) && /export (?:const|function) factoryDir\b|["'`]dispatch\.log["'`]/.test(readFileSync(join(ROOT, f), "utf8")))
    .sort();
  expect(found).toEqual([]);
});
