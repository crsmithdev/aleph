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
 *    emit matched skill names for Claude to activate via Skill().
 *
 * Writes directive signals (full, skill:{name}) to the directives log.
 */
import { readFileSync, appendFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
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

const isQuestion = /^\s*(what|how|why|when|where|who|is |are |can |does |do |should |could |would |which |tell me|explain|describe)\b/i.test(prompt);

// Skill matching
let rules: any[] = [];
try {
  rules = JSON.parse(readFileSync(rulesFile, "utf8")).rules ?? [];
} catch {
  trace(TAG, "skill-rules.json missing or invalid, skip skill matching");
  process.exit(0);
}
const lp = prompt.toLowerCase();
const matched = rules
  .filter((r: any) => r.keywords?.some((kw: string) => lp.includes(kw.toLowerCase())))
  .map((r: any) => r.skill);

// Always inject worktree lifecycle skills for non-question code requests
if (!isQuestion && words.length >= 5) {
  for (const skill of ["isolate-changes", "land-changes"]) {
    if (!matched.includes(skill)) matched.push(skill);
  }
}

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

// Auto-activate: emit skill names for Claude to call Skill() on
const out = `[Construct] Matched skills: ${matched.join(", ")}. Activate via Skill() before proceeding.`;
trace(TAG, `output: ${out.slice(0, 80)}`);
console.log(out);
process.exit(0);
