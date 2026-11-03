// Archived goal tests from jobs/lib/ui-graph.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serverGraph } from "../../../jobs/lib/ui-graph.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aleph-uigraph-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

test("this repo", () => {
  const g = serverGraph(join((import.meta.dir + "/../../../jobs/lib"), "../.."));
  for (const f of ["ui/api/now.ts", "ui/state.ts", "ui/decision.js", "todo/lib/store.ts", "hooks/lib/env.ts", "ui/system-parts.js"]) expect(g.has(f)).toBe(true);
  for (const f of ["ui/lib.js", "ui/index.html", "ui/app.css", "ui/views/now.js", "ui/views/speed.js", "ui/views/cards.js"]) expect(g.has(f)).toBe(false);
  expect(g.has("ui/lib.test.ts")).toBe(false);
  expect([...g].filter((f) => f.endsWith(".test.ts"))).toEqual([]);
});
