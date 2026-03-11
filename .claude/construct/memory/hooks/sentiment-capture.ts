#!/usr/bin/env bun
import { appendFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";

const root = resolve(dirname(Bun.main), "../..");
const ratingsFile = resolve(root, "memory/signals/ratings.jsonl");
mkdirSync(dirname(ratingsFile), { recursive: true });

const input = JSON.parse(await Bun.stdin.text());
const msgs = (input.messages ?? []).filter((m: any) => m.role === "user");
if (!msgs.length) {
  trace("sentiment", "skip: no user messages");
  process.exit(0);
}

const msg: string = (msgs[msgs.length - 1].content ?? "").trim();
if (!msg || msg.split(/\s+/).length < 4) {
  trace("sentiment", "skip: message too short");
  process.exit(0);
}

// Skip explicit ratings (handled by rating-capture)
if (/^(10|[1-9])$/.test(msg)) { trace("sentiment", "skip: explicit rating"); process.exit(0); }
if (/\b(10|[1-9])\s*\/\s*10\b/.test(msg)) { trace("sentiment", "skip: explicit rating"); process.exit(0); }

// Heuristic sentiment scoring
const lower = msg.toLowerCase();
let score = 5; // neutral baseline

const positive = ["thanks", "thank you", "perfect", "great", "awesome", "nice", "good job",
  "works", "working", "fixed", "solved", "exactly", "love it", "well done", "nailed"];
const negative = ["wrong", "broken", "doesn't work", "failed", "frustrated", "annoying",
  "stuck", "confused", "not what i", "stop", "undo", "revert", "why did you", "that's not"];
const strong_positive = ["perfect", "exactly", "nailed", "love it", "awesome"];
const strong_negative = ["frustrated", "broken", "stop", "undo", "revert"];

const posHits: string[] = [], negHits: string[] = [];
for (const kw of positive) { if (lower.includes(kw)) { score += 1; posHits.push(kw); } }
for (const kw of negative) { if (lower.includes(kw)) { score -= 1; negHits.push(kw); } }
for (const kw of strong_positive) { if (lower.includes(kw)) { score += 1; posHits.push(`+${kw}`); } }
for (const kw of strong_negative) { if (lower.includes(kw)) { score -= 1; negHits.push(`+${kw}`); } }

// Clamp to 1-10
score = Math.max(1, Math.min(10, score));
trace("sentiment", `score: ${score} (pos: [${posHits}] neg: [${negHits}])`);

// Only record if signal diverges from neutral
if (score === 5) {
  trace("sentiment", "skip: neutral score");
  process.exit(0);
}

const entry = JSON.stringify({
  timestamp: new Date().toISOString(),
  rating: score,
  type: "implicit",
  context: msg.slice(0, 100).replace(/"/g, "'"),
});
appendFileSync(ratingsFile, entry + "\n");
trace("sentiment", `recorded: ${score}/10 implicit`);
