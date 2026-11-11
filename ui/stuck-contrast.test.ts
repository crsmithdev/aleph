import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const html = readFileSync(join(import.meta.dir, "app.css"), "utf8");

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

function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const r = channel((n >> 16) & 255);
  const g = channel((n >> 8) & 255);
  const b = channel(n & 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// WCAG 2 contrast ratio.
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

describe("dark theme --stuck on --stuck-bg", () => {
  for (const block of darkBlocks()) {
    test(`${block.name} block meets 4.5:1`, () => {
      const fg = token(block.body, "stuck");
      const bg = token(block.body, "stuck-bg");
      const ratio = contrast(fg, bg);
      expect(ratio).toBeGreaterThanOrEqual(4.5);
    });
  }
});

describe("light theme series on --surface", () => {
  const light = /:root\s*\{([^}]*)\}/.exec(html);
  for (const name of ["series-3", "series-4", "series-5"]) {
    test(`--${name} meets 3:1`, () => {
      if (!light) throw new Error("no light :root block in app.css");
      const ratio = contrast(token(light[1], name), token(light[1], "surface"));
      expect(ratio).toBeGreaterThanOrEqual(3);
    });
  }
});

describe("dark theme --chart-6 and --chart-7 stay inside the --series-1 to --series-5 band", () => {
  for (const block of darkBlocks()) {
    const surface = token(block.body, "surface");
    const band = [1, 2, 3, 4, 5].map((n) => contrast(token(block.body, `series-${n}`), surface));
    for (const name of ["chart-6", "chart-7"]) {
      test(`${block.name} block --${name}`, () => {
        const ratio = contrast(token(block.body, name), surface);
        expect(ratio).toBeGreaterThanOrEqual(Math.min(...band));
        expect(ratio).toBeLessThanOrEqual(Math.max(...band));
      });
    }
  }
});
