#!/usr/bin/env bun
/**
 * UserPromptSubmit hook: request classifier and skill router.
 *
 * Runs on every user prompt submission. Three responsibilities:
 *
 * 1. DEPTH CLASSIFICATION — scan prompt for architectural keywords or length ≥40 words.
 *    FULL → emit design-first pipeline recommendation.
 *    QUICK → no output.
 *
 * 2. VERIFICATION GATE — for non-question prompts ≥5 words, inject e2e verification
 *    requirements into the system message so the Stop hook can enforce them.
 *
 * 3. SKILL MATCHING — load skills/skill-rules.json, match prompt keywords against rules,
 *    emit matched skill names for Claude to activate via Skill(). Also check for
 *    project-local skill extensions at .claude/skills/{skill}.md.
 *
 * Writes directive signals (full, skill:{name}) to the directives log.
 */
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../data/src/paths.ts";

const TAG = "routing-submit-classify";
const root = resolve(dirname(Bun.main), "../..");
const rulesFile = resolve(root, "skills/skill-rules.json");

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) {
  const msg = `[${TAG}] stdin parse failed: ${(e as Error).message}`;
  console.error(msg);
  trace(TAG, msg);
  process.exit(0);
}
reportHook(TAG, "UserPromptSubmit", input.session_id);
const prompt = input.prompt ?? "";
const words = prompt.split(/\s+/);
trace(TAG, `prompt: ${words.length} words`);
if (words.length < 3) {
  trace(TAG, "skip: < 3 words");
  process.exit(0);
}

// Depth classification
const archPattern = /\b(architect|redesign|refactor|migrate|schema|structure|plan|propose|authenticat\w*|authorizat\w*|integrat\w*|api.?endpoint|rename.?all|move.?all|replace.?all|across.?all|every.?file|all.?files|end.to.end|full.?stack)/i;
const isFull = archPattern.test(prompt) || words.length >= 40;
if (archPattern.test(prompt)) {
  trace(TAG, "depth: FULL (architectural keywords)");
  console.log("[Construct] Depth: FULL — architectural keywords. Use design-first pipeline.");
} else if (words.length >= 40) {
  trace(TAG, "depth: FULL (complex, ≥40 words)");
  console.log("[Construct] Depth: FULL — complex request. Consider design-first pipeline.");
} else {
  trace(TAG, "depth: QUICK");
}

// Verification gate — inject e2e requirements for non-questions
const isQuestion = /^\s*(what|how|why|when|where|who|is |are |can |does |do |should |could |would |which |tell me|explain|describe)\b/i.test(prompt);
if (!isQuestion && words.length >= 5) {
  console.log(`[Construct] Tip: after making changes, consider verifying end-to-end:
1. Run the actual system
2. Interact with it (Playwright, Chrome DevTools, or run the CLI)
3. Produce an artifact: screenshot or captured output saved to a file
Unit tests alone are not e2e verification. Use /verification to make e2e a requirement.`);
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
  process.exit(0);
}
const lp = prompt.toLowerCase();
const matched = rules
  .filter((r: any) => r.keywords?.some((kw: string) => lp.includes(kw.toLowerCase())))
  .map((r: any) => r.skill);

trace(TAG, `skill match: ${matched.length ? matched.join(", ") : "none"}`);

// Write directive signal (before early exit so full is captured even with no skill match)
const directives: string[] = [];
if (isFull) directives.push("full");
for (const skill of matched) directives.push(`skill:${skill}`);
if (directives.length > 0) {
  const sessionId = input.session_id ?? "unknown";
  try {
    mkdirSync(dirname(dataPaths.directives), { recursive: true });
    const line = JSON.stringify({ ts: new Date().toISOString(), sessionId, directives, promptWords: words.length });
    appendFileSync(dataPaths.directives, line + "\n");
    trace(TAG, `directive signal written: ${directives.join(", ")}`);
  } catch (e) {
    trace(TAG, `directive signal write failed: ${(e as Error).message}`);
  }
}

if (!matched.length) { trace(TAG, "no skills matched, exiting"); process.exit(0); }

// Check for project-local skill extensions
const projectRoot = findProjectRoot();
trace(TAG, `project root: ${projectRoot ?? "none"}`);
const extensions: string[] = [];
if (projectRoot) {
  for (const skill of matched) {
    const extPath = resolve(projectRoot, `.claude/skill-extensions/${skill}.md`);
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
process.exit(0);

function findProjectRoot(): string | null {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf-8", timeout: 2000 }).trim();
  } catch (e) {
    trace(TAG, `git root failed: ${(e as Error).message?.slice(0, 60)}`);
    return Bun.env.PWD ?? null;
  }
}
