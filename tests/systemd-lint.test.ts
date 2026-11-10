/**
 * Only jobs/lib/infra/systemd.ts calls systemctl, and only unitDir() in jobs/lib/infra/settings.ts names the unit
 * folder: a second wrapper skips ALEPH_SYSTEMCTL, and a second path writes where doctor does not read.
 */
import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const OWNERS = new Set(["jobs/lib/infra/systemd.ts", "jobs/lib/infra/settings.ts"]);
const RULE = /spawn(?:Sync)?\(\s*\[\s*["']systemctl["']|systemd\/user|["']systemd["'],\s*["']user["']/;

test("no file outside jobs/lib/infra/systemd.ts spawns systemctl or names the unit folder", () => {
  const found: string[] = [];
  for (const f of new Bun.Glob("**/*.{ts,js}").scanSync({ cwd: ROOT })) {
    if (/^(node_modules|vendor|\.worktrees|acceptance)\//.test(f) || f.endsWith(".test.ts") || OWNERS.has(f)) continue;
    readFileSync(join(ROOT, f), "utf8").split("\n").forEach((line, i) => { if (RULE.test(line)) found.push(`${f}:${i + 1}`); });
  }
  expect(found).toEqual([]);
});
