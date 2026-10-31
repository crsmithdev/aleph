import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { serverGraph } from "./ui-graph.ts";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "aleph-uigraph-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

function put(rel: string, text = "") {
  mkdirSync(dirname(join(dir, rel)), { recursive: true });
  writeFileSync(join(dir, rel), text);
}

test("walks relative imports from the server and api roots", () => {
  put("ui/server.ts", `import "../jobs/lib/store.ts"; import "./attention.ts"; import "./gone.ts"; import "bun:test";`);
  put("ui/attention.ts", `import "./views/now.js";`);
  put("ui/views/now.js", `export const x = 1;`);
  put("ui/views/other.js", ``);
  put("ui/api/now.ts", `import "../../hooks/lib/env.ts";`);
  put("ui/api/now.test.ts", `import "../other.ts";`);
  put("ui/index.html", ``);
  put("jobs/lib/store.ts", ``);
  put("hooks/lib/env.ts", ``);
  const g = serverGraph(dir);
  for (const f of ["ui/server.ts", "ui/api/now.ts", "ui/attention.ts", "jobs/lib/store.ts", "hooks/lib/env.ts", "ui/views/now.js"]) expect(g.has(f)).toBe(true);
  for (const f of ["ui/api/now.test.ts", "ui/views/other.js", "ui/index.html"]) expect(g.has(f)).toBe(false);
});

test("this repo", () => {
  const g = serverGraph(join(import.meta.dir, "../.."));
  for (const f of ["ui/api/now.ts", "ui/state.ts", "ui/views/now.js", "ui/decision.js", "todo/lib/store.ts", "hooks/lib/env.ts"]) expect(g.has(f)).toBe(true);
  expect(g.has("ui/index.html")).toBe(false);
  expect(g.has("ui/lib.test.ts")).toBe(false);
  expect([...g].filter((f) => f.endsWith(".test.ts"))).toEqual([]);
});
