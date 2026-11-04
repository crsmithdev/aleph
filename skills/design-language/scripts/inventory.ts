#!/usr/bin/env bun
/**
 * Lists every design value in the given UI files, one TSV row each:
 *   file:line  group  property  value  kind
 * group: colour | size | type | effect | format
 * kind:  token-def (a `--name:` definition), token-use (`var(--…)`), literal (a raw value), helper-bypass (a format built by hand)
 *
 * Usage: bun inventory.ts <file or dir>... [--summary]
 * --summary prints counts per group and kind, then the 40 most used literals.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const summary = args.includes("--summary");
const roots = args.filter((a) => a !== "--summary");
const EXT = /\.(css|html|js|jsx|ts|tsx|vue|svelte)$/;
const SKIP = /node_modules|\/vendor\/|\.min\.js$|\.test\.|\/fixtures\/|\/shots\//;

function files(p: string): string[] {
  if (statSync(p).isFile()) return [p];
  return readdirSync(p).flatMap((n) => (SKIP.test(join(p, n)) ? [] : statSync(join(p, n)).isDirectory() ? files(join(p, n)) : EXT.test(n) ? [join(p, n)] : []));
}

const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|oklch|color-mix)\([^)]*\)/g;
const SIZE_PROPS = "font-size|padding[a-z-]*|margin[a-z-]*|gap|row-gap|column-gap|width|height|min-width|max-width|min-height|max-height|border-radius|border(?:-[a-z]+)?-width|line-height|top|left|right|bottom|inset";
const SIZE = new RegExp(`(?<![\\w-])(${SIZE_PROPS})\\s*:\\s*([^;"'}\`,]+)`, "g");
/** A CSS size value: a number with a unit, or a token. Bare numbers (chart options) and zero alone are not design values. */
const CSS_SIZE = /\d(px|rem|em|%|vh|vw|ch)\b|var\(--/;
const TYPE = /\b(font-family|font-weight|letter-spacing|text-transform|font-variant-numeric)\s*:\s*([^;"'}`]+)/g;
const EFFECT = /\b(box-shadow|opacity|z-index|transition|animation)\s*:\s*([^;"'}`]+)/g;
const FONT = /(?<![\w-])font\s*:\s*([^;"'}`]+)/g;
// A media query starts a line or follows `}` or `;`; one after `/`, `(` or `|` is regex text.
const MEDIA = /(?<![^\s};])@media\s*([^{]+)/g;
const FORMAT = /\.toFixed\(|\.toLocale\w*\(|\bIntl\.\w+|\.get(?:Hours|Minutes|Seconds|Date|Month|FullYear)\(|\.padStart\(/g;
const TOKEN_DEF = /^\s*(--[\w-]+)\s*:\s*([^;]+);/;

type Row = { at: string; group: string; prop: string; value: string; kind: string };
const rows: Row[] = [];
const kindOf = (v: string) => (/var\(--/.test(v) && !/(#[0-9a-f]{3}|\d+px|rgb)/i.test(v.replace(/var\([^)]*\)/g, "")) ? "token-use" : "literal");

for (const f of roots.flatMap(files)) {
  const lines = readFileSync(f, "utf8").split("\n");
  lines.forEach((line, i) => {
    const at = `${f}:${i + 1}`;
    const def = line.match(TOKEN_DEF);
    if (def) { rows.push({ at, group: COLOUR.test(def[2]) ? "colour" : /\d/.test(def[2]) ? "size" : "type", prop: def[1], value: def[2].trim(), kind: "token-def" }); COLOUR.lastIndex = 0; return; }
    for (const m of line.matchAll(COLOUR)) if (!/\b(?:querySelector(?:All)?|closest|matches)\(\s*["'`][^"'`]*$/.test(line.slice(0, m.index))) rows.push({ at, group: "colour", prop: "", value: m[0], kind: "literal" });
    if (!/@media/.test(line)) for (const m of line.matchAll(SIZE)) if (CSS_SIZE.test(m[2])) rows.push({ at, group: "size", prop: m[1], value: m[2].trim(), kind: kindOf(m[2]) });
    for (const m of line.matchAll(FONT)) {
      const size = m[1].match(/\d*\.?\d+(?:px|rem|em|pt|%)(?=[\s\/]|$)/), weight = m[1].match(/(?<![\w.-])(?:\d{3}|bold(?:er)?|lighter)(?![\w.%])/);
      if (weight) rows.push({ at, group: "type", prop: "font", value: weight[0], kind: "literal" });
      if (size) rows.push({ at, group: "size", prop: "font", value: size[0], kind: "literal" });
    }
    for (const m of line.matchAll(TYPE)) rows.push({ at, group: "type", prop: m[1], value: m[2].trim(), kind: kindOf(m[2]) });
    for (const m of line.matchAll(EFFECT)) rows.push({ at, group: "effect", prop: m[1], value: m[2].trim(), kind: kindOf(m[2]) });
    for (const m of line.matchAll(MEDIA)) rows.push({ at, group: "effect", prop: "@media", value: m[1].trim(), kind: "literal" });
    for (const m of line.matchAll(FORMAT)) rows.push({ at, group: "format", prop: m[0].replace(/\($/, ""), value: line.trim().slice(0, 80), kind: "helper-bypass" });
  });
}

if (!summary) {
  for (const r of rows) console.log([r.at, r.group, r.prop, r.value, r.kind].join("\t"));
} else {
  const count = new Map<string, number>();
  for (const r of rows) count.set(`${r.group}\t${r.kind}`, (count.get(`${r.group}\t${r.kind}`) ?? 0) + 1);
  console.log("group\tkind\tcount");
  for (const [k, n] of [...count].sort()) console.log(`${k}\t${n}`);
  const lit = new Map<string, number>();
  for (const r of rows) if (r.kind === "literal") lit.set(`${r.group}\t${r.prop}\t${r.value}`, (lit.get(`${r.group}\t${r.prop}\t${r.value}`) ?? 0) + 1);
  console.log("\nuses\tgroup\tproperty\tvalue");
  for (const [k, n] of [...lit].sort((a, b) => b[1] - a[1]).slice(0, 40)) console.log(`${n}\t${k}`);
}
