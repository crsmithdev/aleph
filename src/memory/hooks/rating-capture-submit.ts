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
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { ensureDataDirs } from "../../data/src/paths.ts";
import { parseTranscript } from "../parse-transcript.ts";

const TAG = "rating-capture-submit";
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
const prompt = (input.prompt ?? "").trim();
if (!prompt) {
  reportHook(TAG, "UserPromptSubmit", input.session_id);
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

// Match: strict N/10 prompt, or rate-keyword at prompt start.
// Standalone digits intentionally excluded — too many false positives (option selection, counts).
let rating: string | null = null;
if (/^(10|[1-9])\s*\/\s*10$/.test(prompt)) {
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
  reportHook(TAG, "UserPromptSubmit", input.session_id);
  trace(TAG, "no rating pattern found");
  process.exit(0);
}

let priorText = "";
let priorTools: string[] = [];
let priorFiles: string[] = [];
let turnIndex: number | undefined;
if (input.transcript_path) {
  const t = parseTranscript(input.transcript_path, { textLimit: 400 });
  if (t) {
    turnIndex = t.messages.filter((m: { role: string }) => m.role === "user").length;
    for (let i = t.messages.length - 1; i >= 0; i--) {
      const m = t.messages[i];
      if (m.role !== "assistant") continue;
      priorText = m.text.slice(0, 300).replace(/\n/g, " ");
      priorTools = [...new Set(m.toolUses)].slice(0, 5) as string[];
      priorFiles = (m.toolInputs as any[])
        .map((inp: any) => (inp?.file_path ?? inp?.path) as string | undefined)
        .filter((p): p is string => !!p)
        .map((p: string) => p.split("/").slice(-2).join("/"))
        .slice(0, 3);
      break;
    }
  }
}

const ctx = prompt.slice(0, 100).replace(/"/g, "'");
reportHook(TAG, "UserPromptSubmit", input.session_id, {
  meta: {
    rating: Number(rating),
    ratingType: "explicit",
    context: ctx,
    priorText,
    priorTools,
    priorFiles,
    turnIndex,
  },
});
trace(TAG, `recorded: ${rating}/10`);

if (Number(rating) <= 3) {
  console.log(`[Construct] Low rating (${rating}) — store what went wrong via memory_store`);
}
