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
});

test("the font picker styles use tokens for colour, radius and shadow", () => {
  const rules = readFileSync(new URL("./app.css", import.meta.url), "utf8").split("\n").filter((l) => /^\s*(?:\.fontpick|details\.fontpick|background: var)/.test(l) || l.includes("fontpick"));
  expect(rules.length).toBeGreaterThan(5);
  expect(rules.join("\n")).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(|border-radius:\s*\d/i);
});
