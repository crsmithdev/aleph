#!/usr/bin/env bun
/**
 * UserPromptSubmit hook: behavioral-mode router and skill router.
 *
 * Runs on every user prompt submission. Two responsibilities:
 *
 * 1. MODE ACTIVATION — load modes/MODE_*.md, match each mode's trigger regexes
 *    against the prompt, and inline the body of every active mode into stdout so
 *    its posture reaches the model this turn. Composable: any subset can fire.
 *
 * 2. SKILL MATCHING — load skills/skill-rules.json, match prompt keywords against
 *    rules, emit matched skill names for Claude to activate via Skill().
 *
 * Writes directive signals (mode:{slug}, skill:{name}) to the directives log.
 */
import { readFileSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { loadModes, activeModes } from "../../modes/modes.ts";

interface SkillRule { skill: string; keywords: string[]; }

const TAG = "routing-classify-submit";
const root = resolve(dirname(Bun.main), "../..");
const rulesFile = resolve(root, "skills/skill-rules.json");
const modesDir = resolve(root, "modes");

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
const isSlashCommand = /^\/[a-z][a-z0-9-]*(\s|$)/i.test(prompt.trim());
trace(TAG, `prompt: ${words.length} words${isSlashCommand ? " (slash command)" : ""}`);
// A slash command is an explicit, mandatory skill invocation by the user —
// keyword routing is moot. Skip the hook entirely so these never pollute the
// keyword match→invoke conversion metric (matched but never "converted"
// because the user already chose the skill directly).
if (isSlashCommand) {
  reportHook(TAG, "UserPromptSubmit", input.session_id);
  trace(TAG, "skip: slash command (explicit invocation)");
  process.exit(0);
}
if (words.length < 3) {
  reportHook(TAG, "UserPromptSubmit", input.session_id);
  trace(TAG, "skip: < 3 words");
  process.exit(0);
}

// Mode activation — match each mode's trigger regexes against the prompt.
const modes = loadModes(modesDir);
const active = activeModes(prompt, modes);
trace(TAG, `modes active: ${active.length ? active.join(", ") : "none"}`);

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

trace(TAG, `skill match: ${matched.length ? matched.join(", ") : "none"}`);

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

let docRef: { doc: string; desc: string } | undefined;
for (const { pattern, doc, desc } of domainRefs) {
  if (pattern.test(prompt)) {
    docRef = { doc, desc };
    break;
  }
}

// Write directive signal (before early exit so modes are captured even with no skill match)
const directives: string[] = [];
for (const slug of active) directives.push(`mode:${slug}`);
for (const skill of matched) directives.push(`skill:${skill}`);
const meta: Record<string, unknown> = { directives, promptWords: words.length };
if (active.length) meta.modes = active;
if (docRef) meta.docRef = docRef;
if (directives.length > 0 || docRef) {
  reportHook(TAG, "UserPromptSubmit", input.session_id, { meta });
  trace(TAG, `directive signal written: ${directives.join(", ")}${docRef ? ` ref=${docRef.doc}` : ""}`);
} else {
  reportHook(TAG, "UserPromptSubmit", input.session_id);
}

// Inline the body of every active mode so its posture reaches the model this turn.
if (active.length) {
  const bySlug = new Map(modes.map(m => [m.slug, m]));
  const blocks = active.map(slug => bySlug.get(slug)!.body).join("\n\n---\n\n");
  console.log(`[Construct] Modes active: ${active.join(", ")}\n\n${blocks}`);
}

if (docRef) {
  console.log(`[Construct] Reference: ${docRef.doc} — ${docRef.desc}`);
  trace(TAG, `domain ref: ${docRef.doc}`);
}

if (!matched.length) { trace(TAG, "no skills matched, exiting"); process.exit(0); }

// Auto-activate: emit skill names for Claude to call Skill() on
const out = `[Construct] Matched skills: ${matched.join(", ")}. Activate via Skill() before proceeding.`;
trace(TAG, `output: ${out.slice(0, 80)}`);
console.log(out);
process.exit(0);
