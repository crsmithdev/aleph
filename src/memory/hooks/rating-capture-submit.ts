#!/usr/bin/env bun
/**
 * UserPromptSubmit hook: session rating capture.
 *
 * Scans each user prompt for an explicit numeric rating (1-10). Three patterns,
 * all anchored at prompt start to avoid false positives on incidental mentions
 * (e.g. "rate-limit" in a subagent output, "did not intend to rate you 2/5"):
 *   - Standalone number: prompt is exactly "7"
 *   - Slash notation: prompt is exactly "8/10"
 *   - Rate-keyword at start: "rate 6", "rating 9", "I rate this 8", "rated 10"
 *
 * Skips prompts that look like system-event injections (start with `<task-` or
 * `<system-reminder`) — those go through UserPromptSubmit too in this harness.
 *
 * If matched → append JSON entry to ratings file (timestamp, rating, context).
 * If rating ≤ 3 → emit a reminder to store what went wrong via memory_store.
 * No match → exit 0 silently.
 */
import { appendFileSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths, ensureDataDirs } from "../../data/src/paths.ts";

const TAG = "rating-capture-submit";
const ratingsFile = Bun.env.RATINGS_FILE ?? dataPaths.ratings;
ensureDataDirs();

let input: any;
const raw = await Bun.stdin.text();
try { input = JSON.parse(raw); }
catch (e) {
  const msg = `[${TAG}] stdin parse failed: ${(e as Error).message}, raw: ${raw.slice(0, 100)}`;
  console.error(msg);
  trace(TAG, msg);
  process.exit(0);
}
reportHook(TAG, "UserPromptSubmit", input.session_id);
const prompt = (input.prompt ?? "").trim();
if (!prompt) {
  trace(TAG, "skip: empty prompt");
  process.exit(0);
}

trace(TAG, `prompt: ${prompt.slice(0, 60)}`);

// Skip system-event injections that flow through UserPromptSubmit (task
// notifications, system reminders) — they can contain "rate-limit" + digits
// and produce false-positive ratings.
if (/^<(task-notification|system-reminder)\b/i.test(prompt)) {
  trace(TAG, "skip: system-event prompt");
  process.exit(0);
}

// Match: standalone digit, strict N/10 prompt, or rate-keyword at prompt start.
// All anchored to prompt start so incidental mentions don't trigger.
let rating: string | null = null;
if (/^(10|[1-9])$/.test(prompt)) {
  rating = prompt;
  trace(TAG, `matched standalone: ${rating}`);
} else if (/^(10|[1-9])\s*\/\s*10$/.test(prompt)) {
  rating = prompt.match(/^(10|[1-9])/)![1];
  trace(TAG, `matched N/10: ${rating}`);
} else {
  // "rate 7", "rating: 8", "I rate this 9", "rated 10", "I rated it 6"
  const m = prompt.match(/^(?:i\s+)?rat(?:e|ed|ing)(?:\s+(?:this|it|you|that))?\s*:?\s*(10|[1-9])\b/i);
  if (m) {
    rating = m[1];
    trace(TAG, `matched rate keyword: ${rating}`);
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
