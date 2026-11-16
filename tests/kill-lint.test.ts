/**
 * Only jobs/lib/infra/process.ts signals a process group: `killGroup` there sends the signal to the group and to its pid.
 * A copy that signals the pid only when the group kill throws leaves a child behind. This test lists each source file
 * in jobs/, ui/, vault/ and hooks/ that calls `process.kill(-`, except the owner.
 */
import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OWNER = "jobs/lib/infra/process.ts";
const SKIPPED = /\.test\.ts$|\.fixture\.ts$|\.testkit\.ts$|\.helpers\.ts$/;

test("no source file in jobs/, ui/, vault/ or hooks/ signals a process group but the owner", () => {
  const found = [...new Glob("{jobs,ui,vault,hooks}/**/*.ts").scanSync(ROOT)]
    .filter((f) => f !== OWNER && !SKIPPED.test(f) && readFileSync(join(ROOT, f), "utf8").includes("process.kill(-"))
    .sort();
  expect(found).toEqual([]);
});
