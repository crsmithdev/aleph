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
  put("ui/server.ts", `import "../jobs/lib/store.ts"; import "./banner.ts"; import "./gone.ts"; import "bun:test";`);
  put("ui/banner.ts", `import "./views/now.js";`);
  put("ui/views/now.js", `export const x = 1;`);
  put("ui/views/other.js", ``);
  put("ui/api/now.ts", `import "../../hooks/lib/env.ts";`);
  put("ui/api/now.test.ts", `import "../other.ts";`);
  put("ui/index.html", ``);
  put("jobs/lib/store.ts", ``);
  put("hooks/lib/env.ts", ``);
  const g = serverGraph(dir);
  for (const f of ["ui/server.ts", "ui/api/now.ts", "ui/banner.ts", "jobs/lib/store.ts", "hooks/lib/env.ts", "ui/views/now.js"]) expect(g.has(f)).toBe(true);
  for (const f of ["ui/api/now.test.ts", "ui/views/other.js", "ui/index.html"]) expect(g.has(f)).toBe(false);
});

test("the server of this repo loads none of the factory's actions", () => {
  const g = serverGraph(join(import.meta.dir, "..", ".."));
  expect(g.has("jobs/lib/factory-status.ts")).toBe(true);
  for (const f of ["factory", "transitions", "unit", "triage", "firefighter", "plan", "acceptance", "launch", "sandbox", "review", "gate"]) expect(g.has(`jobs/lib/${f}.ts`)).toBe(false);
});
