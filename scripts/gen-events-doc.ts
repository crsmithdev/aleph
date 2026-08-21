#!/usr/bin/env bun
/**
 * docs/EVENTS.md is GENERATED from the kind registry. Hand-maintained docs drift;
 * a generated doc plus a CI check cannot (aleph commandment 8).
 * Usage: bun scripts/gen-events-doc.ts [--check]
 */
import { KINDS } from "../src/core/envelope.ts";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { z } from "zod";

function describe(schema: z.ZodType): string {
  const shape = (schema as unknown as { def?: { shape?: Record<string, z.ZodType> } }).def?.shape;
  if (!shape) return "_(free-form)_";
  return Object.entries(shape)
    .map(([key, value]) => {
      const def = (value as unknown as { def: { type: string; innerType?: { def: { type: string } } } }).def;
      const optional = def.type === "optional" || def.type === "nullable";
      const inner = optional ? def.innerType?.def.type ?? "unknown" : def.type;
      return `\`${key}\`${optional ? "?" : ""}: ${inner}`;
    })
    .join(", ");
}

const groups = new Map<string, string[]>();
for (const kind of Object.keys(KINDS)) {
  const group = kind.split(".")[0]!;
  groups.set(group, [...(groups.get(group) ?? []), kind]);
}

const lines: string[] = [
  "# Event kinds",
  "",
  "**Generated from `src/core/envelope.ts` — do not edit.** Regenerate with",
  "`bun scripts/gen-events-doc.ts`; `bun run docs:check` fails if this file is stale.",
  "",
  "Every event carries the envelope of `docs/design/phase-1.md` §5.2: `v`, `id`, `ts`,",
  "`kind`, `ids` (the tuple), `caused_by`, `cause`, `payload`, `actor`. The columns below",
  "describe only the per-kind `payload`.",
  "",
  `${Object.keys(KINDS).length} kinds in ${groups.size} groups.`,
  "",
];

for (const [group, kinds] of [...groups.entries()].sort()) {
  lines.push(`## ${group}`, "", "| Kind | Payload |", "|---|---|");
  for (const kind of kinds.sort()) lines.push(`| \`${kind}\` | ${describe(KINDS[kind as keyof typeof KINDS])} |`);
  lines.push("");
}

const rendered = lines.join("\n");
const target = "docs/EVENTS.md";

if (process.argv.includes("--check")) {
  const current = existsSync(target) ? readFileSync(target, "utf8") : "";
  if (current !== rendered) {
    console.error(`${target} is stale — run: bun scripts/gen-events-doc.ts`);
    process.exit(1);
  }
  console.log(`${target} is up to date (${Object.keys(KINDS).length} kinds)`);
} else {
  writeFileSync(target, rendered);
  console.log(`wrote ${target} (${Object.keys(KINDS).length} kinds)`);
}
