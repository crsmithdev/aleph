import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

test("the style sheet has balanced braces", () => {
  const css = readFileSync(new URL("./app.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/"[^"\n]*"|'[^'\n]*'/g, "");
  let depth = 0;
  let min = 0;
  for (const ch of css) {
    if (ch === "{") depth++;
    else if (ch === "}") depth--;
    min = Math.min(min, depth);
  }
  expect(min).toBe(0);
  expect(depth).toBe(0);
});

test("the sidebar: every group has a page, paths are unique, and each page has an icon", async () => {
  const dir = new URL("./views/", import.meta.url);
  const all: any[] = [];
  for (const n of readdirSync(dir).filter((f) => f.endsWith(".js"))) for (const m of Object.values(await import(new URL(n, dir).href))) if (m && typeof (m as any).path === "string") all.push(m);
  const shown = all.filter((v) => !v.path.includes(":") && v.nav !== false);
  for (const g of ["work", "factory", "claude"]) expect(shown.some((v) => v.group === g)).toBe(true);
  expect(new Set(shown.map((v) => v.path)).size).toBe(shown.length);
  for (const v of shown) expect([v.title, v.icon]).toEqual([v.title, expect.stringMatching(/^[a-z-]+$/)]);
  // The job list keeps its route and stay out of the sidebar.
  expect(all.some((v) => v.path === "/jobs" && v.nav === false)).toBe(true);
  expect(all.some((v) => v.path === "/jobs/:name")).toBe(true);
});
