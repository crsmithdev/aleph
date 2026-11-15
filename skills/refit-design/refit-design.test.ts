import { expect, test } from "bun:test";
import { join } from "node:path";

const root = join(import.meta.dir, "../..");
/** The `literal` rows of `inventory.ts` over `ui/`: a ratchet, so lower it when a row goes and never raise it. */
const LITERALS = 249;

test("guard: the literal rows of the inventory over ui/ do not rise", () => {
  const out = Bun.spawnSync(["bun", "skills/design-language/scripts/inventory.ts", "ui"], { cwd: root }).stdout.toString();
  const rows = out.split("\n").filter((l) => l.split("\t")[4] === "literal");
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.length).toBeLessThanOrEqual(LITERALS);
});
