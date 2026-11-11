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
  for (const g of ["factory", "claude"]) expect(shown.some((v) => v.group === g)).toBe(true);
  expect(all.filter((v) => v.group === "work")).toEqual([]);
  expect(new Set(shown.map((v) => v.path)).size).toBe(shown.length);
  for (const v of shown) expect([v.title, v.icon]).toEqual([v.title, expect.stringMatching(/^[a-z-]+$/)]);
  // The job list is the Factory Jobs page: no page keeps the /jobs route.
  expect(all.some((v) => v.path === "/jobs")).toBe(false);
  expect(all.some((v) => v.path === "/jobs/:id")).toBe(true);
});

test("the style sheet defines the dim, control, bar and spacing tokens and uses no literal for them", () => {
  const css = readFileSync(new URL("./app.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const root = css.match(/:root\s*\{[^}]*\}/)![0];
  for (const [name, val] of Object.entries({ dim: ".6", "ctl-h": "28px", "bar-h": "10px", "sp-14": "14px", "sp-18": "18px", "sp-20": "20px", "sp-24": "24px", "sp-28": "28px" })) {
    expect(root).toContain(`--${name}: ${val};`);
  }
  const rest = css.replace(root, "");
  expect(rest).not.toMatch(/opacity:\s*\.6\b|(?:min-)?height:\s*28px/);
  expect(rest).not.toMatch(/(?<![\w-])(?:(?:row-|column-)?gap|padding[\w-]*|margin[\w-]*):[^;}]*\b(?:14|18|20|24|28)px/);
  const spacing = [...rest.matchAll(/(?<![\w-])(?:(?:row-|column-)?gap|padding[\w-]*|margin[\w-]*|scroll-padding[\w-]*):([^;}]*)/g)].map((m) => m[1]);
  expect(spacing.filter((v) => /(?<![\w.-])-?\d*\.?\d+px/.test(v.replace(/(?<![\w.-])-?1px/g, "")))).toEqual([]);
});

test("the style sheet defines the dot and measure tokens and draws no circle with 50%", () => {
  const css = readFileSync(new URL("./app.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const root = css.match(/:root\s*\{[^}]*\}/)![0];
  for (const [name, val] of Object.entries({ "dot-s": "6px", "dot-m": "8px", "dot-l": "12px", measure: "76ch" })) expect(root).toContain(`--${name}: ${val};`);
  expect(css).not.toMatch(/border-radius:\s*50%/);
});

test("the Container widths row of the design doc lists exactly the @container widths of the style sheet", () => {
  const css = readFileSync(new URL("./app.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const row = readFileSync(new URL("../docs/design.md", import.meta.url), "utf8").split("\n").find((l) => l.startsWith("| Container widths |"))!;
  const widths = (s: string) => [...new Set([...s.matchAll(/(\d+)px/g)].map((m) => Number(m[1])))].sort((a, b) => a - b);
  const queries = [...css.matchAll(/@container[^{]*\(\s*(?:max|min)-width:\s*(\d+)px/g)].map((m) => `${m[1]}px`).join(" ");
  expect(widths(row)).toEqual(widths(queries));
  expect(widths(row)).toEqual([420, 480, 560]);
});
