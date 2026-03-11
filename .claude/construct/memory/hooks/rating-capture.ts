#!/usr/bin/env bun
import { appendFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";

const root = resolve(dirname(Bun.main), "../..");
const ratingsFile = resolve(root, "memory/signals/ratings.jsonl");
mkdirSync(dirname(ratingsFile), { recursive: true });

const input = JSON.parse(await Bun.stdin.text());
const prompt = (input.prompt ?? "").trim();
if (!prompt) {
  trace("rating-capture", "skip: empty prompt");
  process.exit(0);
}

// Match: standalone 1-10, N/10 pattern, or "rate"/"rating" near a number
let rating: string | null = null;
if (/^(10|[1-9])$/.test(prompt)) {
  rating = prompt;
  trace("rating-capture", `matched standalone: ${rating}`);
} else {
  const slash = prompt.match(/\b(10|[1-9])\s*\/\s*10\b/);
  if (slash) {
    rating = slash[1];
    trace("rating-capture", `matched N/10: ${rating}`);
  } else if (/\brat(e|ing)\b/i.test(prompt)) {
    const m = prompt.match(/\b(10|[1-9])\b/);
    if (m) {
      rating = m[1];
      trace("rating-capture", `matched rate keyword: ${rating}`);
    }
  }
}
if (!rating) {
  trace("rating-capture", "no rating pattern found");
  process.exit(0);
}

const ctx = prompt.slice(0, 100).replace(/"/g, "'");
const entry = JSON.stringify({ timestamp: new Date().toISOString(), rating: Number(rating), type: "explicit", context: ctx });
appendFileSync(ratingsFile, entry + "\n");
trace("rating-capture", `recorded: ${rating}/10`);

if (Number(rating) <= 3) {
  console.log(`[Construct] Low rating (${rating}) — note what went wrong in LEARNED.md`);
}
