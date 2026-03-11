#!/usr/bin/env bun
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";

const root = resolve(dirname(Bun.main), "../..");
const rulesFile = resolve(root, "skills/skill-rules.json");

const input = JSON.parse(await Bun.stdin.text());
const prompt = input.prompt ?? "";
const words = prompt.split(/\s+/);
trace("format-reminder", `prompt: ${words.length} words`);
if (words.length < 3) {
  trace("format-reminder", "skip: < 3 words");
  process.exit(0);
}

// Depth classification
const archPattern = /architect|redesign|refactor|migrate|schema|structure|plan|design|propose/i;
if (archPattern.test(prompt)) {
  trace("format-reminder", "depth: FULL (architectural keywords)");
  console.log("[Construct] Depth: FULL — architectural keywords. Write ISC before proceeding.");
} else if (words.length > 40) {
  trace("format-reminder", "depth: FULL (complex, >40 words)");
  console.log("[Construct] Depth: FULL — complex request. Consider ISC.");
} else {
  trace("format-reminder", "depth: QUICK");
}

// Skill matching
if (!existsSync(rulesFile)) {
  trace("format-reminder", "no skill-rules.json, skip skill matching");
  process.exit(0);
}
const rules = JSON.parse(readFileSync(rulesFile, "utf8")).rules ?? [];
const lp = prompt.toLowerCase();
const matched = rules
  .filter((r: any) => r.keywords?.some((kw: string) => lp.includes(kw.toLowerCase())))
  .map((r: any) => r.skill);

trace("format-reminder", `skill match: ${matched.length ? matched.join(", ") : "none"}`);
if (!matched.length) process.exit(0);

// Auto-activate: emit skill names for Claude to call Skill() on
console.log(`[Construct] Matched skills: ${matched.join(", ")}. Activate via Skill() before proceeding.`);
