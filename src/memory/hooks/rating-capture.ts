#!/usr/bin/env bun
/**
 * UserPromptSubmit hook: session rating capture.
 *
 * Scans each user prompt for a numeric rating (1-10). Three patterns:
 *   - Standalone number: "7"
 *   - Slash notation: "8/10"
 *   - Keyword + number: "rate 6", "rating 9"
 *
 * If matched → append JSON entry to ratings file (timestamp, rating, context).
 * If rating ≤ 3 → emit a reminder to store what went wrong via memory_store.
 * No match → exit 0 silently.
 */
import { appendFileSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths, ensureDataDirs } from "../../paths.ts";

const TAG = "rating-capture";
const ratingsFile = Bun.env.RATINGS_FILE ?? dataPaths.ratings;
ensureDataDirs();

let input: any;
const raw = await Bun.stdin.text();
try { input = JSON.parse(raw); }
catch (e) {
  const msg = `[${TAG}] stdin parse failed: ${(e as Error).message}, raw: ${raw.slice(0, 100)}`;
  console.error(msg);
  trace(TAG, msg);
  process.exit(1);
}
reportHook(TAG, "UserPromptSubmit", input.session_id);
const prompt = (input.prompt ?? "").trim();
if (!prompt) {
  trace(TAG, "skip: empty prompt");
  process.exit(0);
}

trace(TAG, `prompt: ${prompt.slice(0, 60)}`);

// Match: standalone 1-10, N/10 pattern, or "rate"/"rating" near a number
let rating: string | null = null;
if (/^(10|[1-9])$/.test(prompt)) {
  rating = prompt;
  trace(TAG, `matched standalone: ${rating}`);
} else {
  const slash = prompt.match(/\b(10|[1-9])\s*\/\s*10\b/);
  if (slash) {
    rating = slash[1];
    trace(TAG, `matched N/10: ${rating}`);
  } else if (/\brat(e|ing)\b/i.test(prompt)) {
    const m = prompt.match(/\b(10|[1-9])\b/);
    if (m) {
      rating = m[1];
      trace(TAG, `matched rate keyword: ${rating}`);
    }
  }
}
if (!rating) {
  trace(TAG, "no rating pattern found");
  process.exit(0);
}

const ctx = prompt.slice(0, 100).replace(/"/g, "'");
const entry = JSON.stringify({ timestamp: new Date().toISOString(), rating: Number(rating), type: "explicit", context: ctx });
appendFileSync(ratingsFile, entry + "\n");
trace(TAG, `recorded: ${rating}/10 → ${ratingsFile}`);

if (Number(rating) <= 3) {
  console.log(`[Construct] Low rating (${rating}) — store what went wrong via memory_store`);
}
