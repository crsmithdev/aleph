/**
 * Pure helpers for the rule-effectiveness loop.
 * No side effects — all I/O lives in the hooks/consolidator that import these.
 */
import { createHash } from "crypto";

export interface InjectionRecord {
  timestamp: string;
  session_id: string;
  rule_hash: string;
  rule_text: string;
  polarity: "avoid" | "validated";
}

export interface EffectivenessRow {
  text: string;
  polarity: "avoid" | "validated";
  first_seen: string;
  last_seen: string;
  injections: number;
  recurrences: number;     // negative feedback that matched the rule despite injection
  reaffirmations: number;  // positive feedback that confirmed the rule
}

export type EffectivenessTable = Record<string, EffectivenessRow>;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "that", "this", "have", "been", "were",
  "will", "your", "into", "user", "said", "after", "approach", "session",
  "memory", "needed", "required", "multiple", "corrections", "perfect", "great",
  "thanks", "validated", "avoid",
]);

export function ruleFingerprint(text: string): string {
  const norm = text.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  return createHash("sha1").update(norm).digest("hex").slice(0, 10);
}

export function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 3 && !STOPWORDS.has(w))
  );
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

export function similarity(a: string, b: string): number {
  return jaccard(tokenize(a), tokenize(b));
}

/**
 * Parse a learned-rules.md line into its raw rule text.
 *   "- [avoid] use real db not mocks _(3x)_"  →  "use real db not mocks"
 *   "- [keep] verify with bun test.ts"       →  "verify with bun test.ts"
 *   "- some text"                            →  "some text"
 */
export function parseRuleLine(line: string): { text: string; polarity: "avoid" | "validated" | null } | null {
  const trimmed = line.replace(/^-\s+/, "").trim();
  if (trimmed.length < 5) return null;
  const tagMatch = trimmed.match(/^\[(avoid|keep)\]\s*(.+)$/i);
  let polarity: "avoid" | "validated" | null = null;
  let body = trimmed;
  if (tagMatch) {
    polarity = tagMatch[1].toLowerCase() === "keep" ? "validated" : "avoid";
    body = tagMatch[2];
  }
  body = body.replace(/\s*_\(\d+x[^)]*\)_\s*$/i, "").trim();
  if (body.length < 5) return null;
  return { text: body, polarity };
}

/**
 * Effectiveness ratio in [0,1]. Higher = rule worked.
 *   avoid:    1 - recurrences / injections     (1 = no recurrence after injection)
 *   validated: reaffirmations / injections     (1 = always reaffirmed when injected)
 * Returns null if injections === 0 (insufficient data).
 */
export function effectivenessScore(row: EffectivenessRow): number | null {
  if (row.injections === 0) return null;
  if (row.polarity === "avoid") {
    return Math.max(0, 1 - row.recurrences / row.injections);
  }
  return row.reaffirmations / row.injections;
}
