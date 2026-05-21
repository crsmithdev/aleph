#!/usr/bin/env bun
/**
 * Per-keyword attribution: for a skill, show which REAL user prompts each
 * keyword fires on, and whether that session actually invoked the skill.
 * Lets us check that a keyword we plan to cut only ever produced false
 * positives (invoked=0, prose/meta hits).
 *
 * Usage: bun scripts/routing-kw.ts <skill> [days=7] [samplesPerKw=2]
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { resolve } from "path";

const skill = process.argv[2];
const days = Number(process.argv[3] ?? 7);
const samplesPerKw = Number(process.argv[4] ?? 2);
if (!skill) { console.error("usage: routing-kw.ts <skill> [days] [samples]"); process.exit(1); }

const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
const sessionsDir = resolve(process.env.HOME!, ".claude/projects/-home-crsmi-construct");
const rulesFile = resolve(import.meta.dir, "../src/skills/skill-rules.json");

const rule = (JSON.parse(readFileSync(rulesFile, "utf8")).rules as any[]).find((r) => r.skill === skill);
if (!rule) { console.error(`no rule for skill "${skill}"`); process.exit(1); }
const keywords: string[] = rule.keywords;

// Mirror the hook's matching logic exactly.
function stem(word: string): string {
  const w = word.toLowerCase();
  const suffixes = ["izing", "ising", "ating", "tion", "sion", "ment", "ness", "ence", "ance", "ible", "able", "ful", "ous", "ive", "ity", "ally", "edly", "ing", "ly", "ed", "es", "er", "s"];
  let best = w;
  for (const suffix of suffixes) {
    if (w.endsWith(suffix) && w.length - suffix.length >= 3) {
      const candidate = w.slice(0, -suffix.length);
      if (candidate.length > best.length || best === w) best = candidate;
    }
  }
  return best;
}
const stemPhrase = (t: string) => t.split(/\s+/).map(stem).join(" ");
function kwMatches(kw: string, lp: string, stemmedPrompt: string): boolean {
  const rx = kw.match(/^\/(.+)\/([gimsuy]*)$/);
  if (rx) { try { return new RegExp(rx[1], rx[2] || "i").test(lp); } catch { return false; } }
  return stemmedPrompt.includes(stemPhrase(kw.toLowerCase()));
}

const files = readdirSync(sessionsDir)
  .filter((f) => f.endsWith(".jsonl"))
  .filter((f) => statSync(resolve(sessionsDir, f)).mtimeMs > cutoff);

type Hit = { prompt: string; invoked: boolean };
const byKw = new Map<string, Hit[]>();
for (const kw of keywords) byKw.set(kw, []);

for (const f of files) {
  const lines = readFileSync(resolve(sessionsDir, f), "utf8").split("\n").filter(Boolean);
  let invoked = false;
  for (const ln of lines) {
    let j: any; try { j = JSON.parse(ln); } catch { continue; }
    if (j.type === "assistant" && !j.isSidechain && Array.isArray(j.message?.content)) {
      for (const b of j.message.content) if (b?.type === "tool_use" && b.name === "Skill" && (b.input as any)?.skill === skill) invoked = true;
    }
  }
  for (const ln of lines) {
    let j: any; try { j = JSON.parse(ln); } catch { continue; }
    if (j.type !== "user" || j.isCompactSummary || j.toolUseResult || j.isSidechain || j.isMeta) continue;
    const c = j.message?.content;
    let text = "";
    if (typeof c === "string") text = c;
    else if (Array.isArray(c)) {
      if (c.some((b: any) => b?.type === "tool_result")) continue;
      text = c.map((b: any) => (typeof b.text === "string" ? b.text : "")).filter(Boolean).join("\n");
    }
    const trimmed = text.trim();
    if (trimmed.length < 3 || trimmed.startsWith("<") || /^#\s+\w/.test(trimmed)) continue;
    const lp = text.toLowerCase();
    const sp = stemPhrase(lp);
    for (const kw of keywords) if (kwMatches(kw, lp, sp)) byKw.get(kw)!.push({ prompt: trimmed, invoked });
  }
}

const rows = keywords
  .map((kw) => ({ kw, hits: byKw.get(kw)!, invoked: byKw.get(kw)!.filter((h) => h.invoked).length }))
  .filter((r) => r.hits.length > 0)
  .sort((a, b) => b.hits.length - a.hits.length);

console.log(`\nskill "${skill}" — real-prompt hits per keyword (last ${days}d, ${files.length} sessions)\n`);
for (const r of rows) {
  console.log(`${String(r.hits.length).padStart(3)} hits  ${String(r.invoked).padStart(2)} in invoked-session   ${r.kw}`);
  for (const h of r.hits.slice(0, samplesPerKw)) {
    console.log(`        ${h.invoked ? "✓" : "·"} ${h.prompt.replace(/\s+/g, " ").slice(0, 110)}`);
  }
}
console.log(`\n(✓ = session invoked ${skill}; · = it did not. Keywords with 0 invoked-session hits and only prose are safe to cut.)`);
