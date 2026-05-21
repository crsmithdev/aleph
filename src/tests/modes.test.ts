#!/usr/bin/env bun
import { readFileSync } from "fs";
import { resolve } from "path";
import {
  createTestEnv, cleanupTestEnv, runHook, check,
  createResults, printAndExit,
} from "../eval/harness.ts";
import { loadModes, parseModeFile, activeModes, buildIndex } from "../modes/modes.ts";

const te = createTestEnv("modes");
const r = createResults();

const modesDir = resolve(import.meta.dir, "../modes");
const modes = loadModes(modesDir);

// ── Loading ──────────────────────────────────────────────────────────────────

console.log("--- mode loading ---");
const slugs = modes.map(m => m.slug);
const expected = ["brainstorming", "comparison", "efficiency", "execution", "focused", "introspection"];
check(r, `load: 6 modes, sorted (${slugs.join(", ")})`, JSON.stringify(slugs) === JSON.stringify(expected));
check(r, "load: every mode has a non-empty body", modes.every(m => m.body.length > 20));
check(r, "load: every mode has triggers", modes.every(m => m.triggers.length > 0));

// ── Parser error paths ─────────────────────────────────────────────────────────

console.log("\n--- parser error paths ---");
function throws(fn: () => unknown): boolean {
  try { fn(); return false; } catch { return true; }
}
check(r, "parse: missing opening --- throws", throws(() => parseModeFile("slug: x\n")));
check(r, "parse: missing closing --- throws", throws(() => parseModeFile("---\nslug: x\n")));
check(r, "parse: missing slug throws", throws(() => parseModeFile("---\nwhenToUse: |\n  hi\ntriggers:\n  - \\bx\\b\n---\nbody")));
check(r, "parse: no triggers throws", throws(() => parseModeFile("---\nslug: x\nwhenToUse: |\n  hi\n---\nbody")));
check(r, "parse: empty body throws", throws(() => parseModeFile("---\nslug: x\nwhenToUse: |\n  hi\ntriggers:\n  - \\bx\\b\n---\n")));
check(r, "parse: well-formed succeeds", !throws(() => parseModeFile("---\nslug: x\nwhenToUse: |\n  hi\ntriggers:\n  - \\bx\\b\n---\nbody")));

// ── Single-mode activation (≥3 fixtures per mode) ──────────────────────────────

console.log("\n--- single-mode activation ---");
const single: Record<string, string[]> = {
  execution: ["go ahead and ship it", "just do it now", "implement it please"],
  brainstorming: ["should we cache this", "what if we tried redis", "not sure how to scope this"],
  introspection: ["why did you choose that", "explain your reasoning here", "walk me through your thinking"],
  efficiency: ["be brief please", "tl;dr the diff", "keep it short for me"],
  focused: ["only change the timeout", "nothing else, just this", "minimal diff to fix it"],
  comparison: ["what is the prior art", "how do others solve this", "compare this to the alternative"],
};
for (const [mode, prompts] of Object.entries(single)) {
  for (const p of prompts) {
    const got = activeModes(p, modes);
    check(r, `${mode}: "${p}" → includes ${mode}`, got.includes(mode));
  }
}

// ── Multi-mode activation (≥3 fixtures) ────────────────────────────────────────

console.log("\n--- multi-mode activation ---");
const multi: Array<[string, string[]]> = [
  ["be brief: how do others handle this", ["comparison", "efficiency"]],
  ["should we ship it now", ["brainstorming", "execution"]],
  ["only change this, and explain your reasoning", ["focused", "introspection"]],
];
for (const [p, want] of multi) {
  const got = activeModes(p, modes).sort();
  check(r, `multi: "${p}" → ${want.join("+")}`, want.every(w => got.includes(w)) && got.length === want.length);
}

// ── No-mode prompts (≥3 fixtures) ──────────────────────────────────────────────

console.log("\n--- no-mode prompts ---");
const none = [
  "what time is the meeting tomorrow",
  "the build is green on main",
  "read the api response handler",
];
for (const p of none) {
  check(r, `none: "${p}" → no modes`, activeModes(p, modes).length === 0);
}

// ── INDEX.md drift guard ───────────────────────────────────────────────────────

console.log("\n--- index drift ---");
const committed = readFileSync(resolve(modesDir, "INDEX.md"), "utf8");
check(r, "index: committed INDEX.md matches buildIndex() output (regenerate if this fails)", committed === buildIndex(modes));

// ── End-to-end hook output ─────────────────────────────────────────────────────

console.log("\n--- hook e2e ---");
function hookOut(prompt: string): string {
  return runHook(te, "core/hooks/routing-classify-submit.ts", JSON.stringify({ prompt })).stdout;
}
const execOut = hookOut("go ahead and implement it");
check(r, "e2e: execution names the mode", execOut.includes("Modes active: execution"));
check(r, "e2e: execution inlines the body", execOut.includes("# Execution Mode"));

const multiOut = hookOut("be brief: how do others handle this");
check(r, "e2e: multi-mode names both", multiOut.includes("Modes active: comparison, efficiency"));
check(r, "e2e: multi-mode inlines both bodies", multiOut.includes("# Comparison Mode") && multiOut.includes("# Efficiency Mode"));

const noneOut = hookOut("what time is the meeting tomorrow");
check(r, "e2e: no-mode prompt prints no mode block", !noneOut.includes("Modes active"));

cleanupTestEnv(te);
printAndExit(r);
