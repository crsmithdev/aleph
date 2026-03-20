#!/usr/bin/env bun
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { trace } from "../../trace.ts";

const TAG = "format-reminder";
const root = resolve(dirname(Bun.main), "../..");
const rulesFile = resolve(root, "skills/skill-rules.json");

const input = JSON.parse(await Bun.stdin.text());
const prompt = input.prompt ?? "";
const words = prompt.split(/\s+/);
trace(TAG, `prompt: ${words.length} words`);
if (words.length < 3) {
  trace(TAG, "skip: < 3 words");
  process.exit(0);
}

// Depth classification
const archPattern = /architect|redesign|refactor|migrate|schema|structure|plan|propose/i;
if (archPattern.test(prompt)) {
  trace(TAG, "depth: FULL (architectural keywords)");
  console.log("[Construct] Depth: FULL — architectural keywords. Write ISC before proceeding.");
} else if (words.length >= 40) {
  trace(TAG, "depth: FULL (complex, >40 words)");
  console.log("[Construct] Depth: FULL — complex request. Consider ISC.");
} else {
  trace(TAG, "depth: QUICK");
}

// Skill matching
if (!existsSync(rulesFile)) {
  trace(TAG, "no skill-rules.json, skip skill matching");
  process.exit(0);
}
let rules: any[] = [];
try {
  rules = JSON.parse(readFileSync(rulesFile, "utf8")).rules ?? [];
} catch (e) {
  trace(TAG, `failed to parse skill-rules.json: ${(e as Error).message}`);
  console.error(`[Construct] Failed to parse skill-rules.json: ${e}`);
  process.exit(1);
}
const lp = prompt.toLowerCase();
const matched = rules
  .filter((r: any) => r.keywords?.some((kw: string) => lp.includes(kw.toLowerCase())))
  .map((r: any) => r.skill);

trace(TAG, `skill match: ${matched.length ? matched.join(", ") : "none"}`);
if (!matched.length) { trace(TAG, "no skills matched, exiting"); process.exit(0); }

// Check for project-local skill extensions
const projectRoot = findProjectRoot();
trace(TAG, `project root: ${projectRoot ?? "none"}`);
const extensions: string[] = [];
if (projectRoot) {
  for (const skill of matched) {
    const extPath = resolve(projectRoot, `.claude/skills/${skill}.md`);
    if (existsSync(extPath)) {
      const content = readFileSync(extPath, "utf8").trim();
      if (content) {
        extensions.push(`\n## Project-specific: ${skill}\n\n${content}`);
        trace(TAG, `extension found: ${extPath} (${content.length} chars)`);
      }
    } else {
      trace(TAG, `no extension: ${extPath}`);
    }
  }
}

// Auto-activate: emit skill names for Claude to call Skill() on
const out = [`[Construct] Matched skills: ${matched.join(", ")}. Activate via Skill() before proceeding.`];
if (extensions.length) {
  out.push(`\nProject skill extensions (apply IN ADDITION to the base skill):\n${extensions.join("\n")}`);
}
trace(TAG, `output: ${out[0].slice(0, 80)}`);
console.log(out.join(""));

function findProjectRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8", timeout: 2000 }).trim();
  } catch (e) {
    trace(TAG, `git root failed: ${(e as Error).message?.slice(0, 60)}`);
    return Bun.env.PWD ?? null;
  }
}
