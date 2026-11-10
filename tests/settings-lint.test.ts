import { expect, test } from "bun:test";
import { Glob } from "bun";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");

test("only settings.ts reads a number from process.env", () => {
  const found: string[] = [];
  for (const dir of ["jobs", "lib", "issues", "ui", "vault"]) {
    for (const f of new Glob("**/*.ts").scanSync({ cwd: join(root, dir) })) {
      if (f.includes("node_modules") || /\.test\.ts$/.test(f)) continue;
      const rel = `${dir}/${f}`;
      if (rel === "jobs/lib/infra/settings.ts") continue;
      if (readFileSync(join(root, rel), "utf8").includes("Number(process.env.")) found.push(rel);
    }
  }
  expect(found).toEqual([]);
});
