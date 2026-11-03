// Archived goal tests from ui/stuck-contrast.test.ts: `bun run accept` runs them, `bun run test` does not.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(join(import.meta.dir, "../../ui"), "app.css"), "utf8");

// Dark theme appears twice: the prefers-color-scheme block and the data-theme block.
function darkBlocks(): { name: string; body: string }[] {
  const starts = [
    { name: "prefers-color-scheme", re: /@media \(prefers-color-scheme:\s*dark\)\s*\{/ },
    { name: "data-theme dark", re: /:root\[data-theme="dark"\]\s*\{/ },
  ];
  return starts.map(({ name, re }) => {
    const m = re.exec(html);
    if (!m) throw new Error(`no ${name} block in app.css`);
    let depth = 1;
    let i = m.index + m[0].length;
    const begin = i;
    for (; i < html.length && depth > 0; i++) {
      if (html[i] === "{") depth++;
      else if (html[i] === "}") depth--;
    }
    return { name, body: html.slice(begin, i - 1) };
  });
}

function token(body: string, name: string): string {
  const m = new RegExp(`--${name}:\\s*(#[0-9A-Fa-f]{6})\\b`).exec(body);
  if (!m) throw new Error(`--${name} not found`);
  return m[1];
}

describe("dark theme --stuck on --stuck-bg", () => {

  test("both dark blocks use the same --stuck-bg", () => {
    const [a, b] = darkBlocks();
    expect(token(a.body, "stuck-bg")).toBe(token(b.body, "stuck-bg"));
  });
});
