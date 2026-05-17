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
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

interface SkillRule { skill: string; keywords: string[]; }

const TAG = "routing-classify-submit";
const root = resolve(dirname(Bun.main), "../..");
const rulesFile = resolve(root, "skills/skill-rules.json");

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) {
  const msg = `[${TAG}] stdin parse failed: ${(e as Error).message}`;
  console.error(msg);
  trace(TAG, msg);
  process.exit(1);
}
const prompt = input.prompt ?? "";
const words = prompt.split(/\s+/);
trace(TAG, `prompt: ${words.length} words`);
if (words.length < 3) {
  reportHook(TAG, "UserPromptSubmit", input.session_id);
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
let rules: SkillRule[] = [];
try {
  rules = (JSON.parse(readFileSync(rulesFile, "utf8")).rules ?? []) as SkillRule[];
} catch {
  trace(TAG, "skill-rules.json missing or invalid, skip skill matching");
  process.exit(0);
}
// Lightweight Porter-style stemmer — reduces words to a common root so
// "failing"→"fail", "fonts"→"font", "erroring"→"error", etc.
function stem(word: string): string {
  const w = word.toLowerCase();
  const suffixes = ["izing", "ising", "ating", "tion", "sion", "ment", "ness", "ence", "ance", "ible", "able", "ful", "ous", "ive", "ity", "ally", "edly", "ing", "ly", "ed", "es", "er", "s"];
  // Pick the shortest matching suffix (keeps the longest root).
  // Min remaining length of 3 prevents over-stripping.
  let best = w;
  for (const suffix of suffixes) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      const candidate = w.slice(0, -suffix.length);
      if (candidate.length > best.length || best === w) best = candidate;
    }
  }
  return best;
}

function stemPhrase(text: string): string {
  return text.split(/\s+/).map(stem).join(" ");
}

// Match keywords against prompt. Supports:
// - Plain strings: exact substring match (stemmed)
// - /regex/ patterns: full regex match against raw prompt
const lp = prompt.toLowerCase();
const stemmedPrompt = stemPhrase(lp);
const matched = rules
  .filter((r) => r.keywords?.some((kw: string) => {
    // Regex keyword: /pattern/flags
    const rxMatch = kw.match(/^\/(.+)\/([gimsuy]*)$/);
    if (rxMatch) {
      try { return new RegExp(rxMatch[1], rxMatch[2] || "i").test(lp); }
      catch { return false; }
    }
    // Plain keyword: stemmed substring match
    return stemmedPrompt.includes(stemPhrase(kw.toLowerCase()));
  }))
  .map((r) => r.skill);

// Always inject git for non-question code requests — covers both phases
// (Phase 1: Isolate at start, Phase 2: Land at end)
if (!isQuestion && words.length >= 5 && !matched.includes("git")) {
  matched.push("git");
}

trace(TAG, `skill match: ${matched.length ? matched.join(", ") : "none"}`);

// Write directive signal (before early exit so full is captured even with no skill match)
const directives: string[] = [];
if (isFull) directives.push("full");
for (const skill of matched) directives.push(`skill:${skill}`);
if (directives.length > 0) {
  reportHook(TAG, "UserPromptSubmit", input.session_id, {
    meta: { directives, promptWords: words.length },
  });
  trace(TAG, `directive signal written: ${directives.join(", ")}`);
} else {
  reportHook(TAG, "UserPromptSubmit", input.session_id);
}

// Domain-specific doc reference injection.
// Fires when the prompt clearly targets a specific module — gives Claude a
// direct pointer to the relevant spec/AGENTS.md rather than requiring navigation.
// At most one reference per prompt (first match wins).
const domainRefs: Array<{ pattern: RegExp; doc: string; desc: string }> = [
  { pattern: /\b(research.session|research.worker|seed.query|research.thread|research.finding|research.job|monitor.cycle|perturbat)\b/i, doc: "docs/specs/RESEARCH.md", desc: "engine loop, data model, API, thread lifecycle" },
  { pattern: /\b(telemetry|aggregat\w+|jsonl.pars|session.trace|token.cost|pricing.model)\b/i, doc: "docs/specs/TELEMETRY.md", desc: "parser, aggregator, pricing, API endpoints" },
  { pattern: /\b(eval.scenario|eval.harness|hook.verification|sandbox.isolation|ab.runner)\b/i, doc: "docs/specs/EVAL.md", desc: "harness, sandbox, scenarios, A/B runner" },
  { pattern: /\b(api.route|fastify.route|react.page|react.component|ui.hook|vite.config)\b/i, doc: "src/ui/AGENTS.md", desc: "API routes, React pages, conventions" },
  { pattern: /\b(hook.script|settings.hooks|pretooluse.hook|posttooluse.hook|precompact.hook)\b/i, doc: "docs/specs/HOOKS.md", desc: "events, scripts, fail modes, registration" },
  { pattern: /\b(skill.rules|skill.routing|keyword.trigger|skill.playbook)\b/i, doc: "docs/specs/SKILLS.md", desc: "routing config, keyword triggers, slash commands" },
];

for (const { pattern, doc, desc } of domainRefs) {
  if (pattern.test(prompt)) {
    console.log(`[Construct] Reference: ${doc} — ${desc}`);
    trace(TAG, `domain ref: ${doc}`);
    break;
  }
}

if (!matched.length) { trace(TAG, "no skills matched, exiting"); process.exit(0); }

// Auto-activate: emit skill names for Claude to call Skill() on
const out = `[Construct] Matched skills: ${matched.join(", ")}. Activate via Skill() before proceeding.`;
trace(TAG, `output: ${out.slice(0, 80)}`);
console.log(out);
process.exit(0);
