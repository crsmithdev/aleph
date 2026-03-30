#!/usr/bin/env bun
import { readFileSync } from "fs";
import { trace } from "../../trace.ts";

const TAG = "context-stop-monitor";
let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }

const transcriptPath = input.transcript_path;
if (!transcriptPath) { trace(TAG, "no transcript path"); process.exit(0); }

// Read transcript and find the last assistant message with usage data
let content: string;
try { content = readFileSync(transcriptPath, "utf8"); }
catch { trace(TAG, "could not read transcript"); process.exit(0); }

const lines = content.split("\n").filter(Boolean);

// Default context windows by model. Extended context (1M) is detected
// dynamically: if usage already exceeds 200k, the window must be larger.
const BASE_LIMITS: [RegExp, number][] = [
  [/opus/i, 200_000],
  [/sonnet/i, 200_000],
  [/haiku/i, 200_000],
];
const EXTENDED_LIMIT = 1_000_000;

function contextLimit(model: string, currentUsage: number): number {
  let base = 200_000;
  for (const [pat, limit] of BASE_LIMITS) if (pat.test(model)) { base = limit; break; }
  return currentUsage > base * 0.95 ? EXTENDED_LIMIT : base;
}

// Scan from the end for the last assistant message with usage
let lastInputTokens = 0;
let modelName = "";
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const entry = JSON.parse(lines[i]);
    if (entry.type !== "assistant") continue;
    const usage = entry.message?.usage;
    if (!usage) continue;
    lastInputTokens = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    modelName = entry.message?.model ?? "";
    break;
  } catch { continue; }
}

if (lastInputTokens === 0) {
  trace(TAG, "no usage data found");
  process.exit(0);
}

const CONTEXT_LIMIT = contextLimit(modelName, lastInputTokens);
const WARNING_PCT = 0.80;
const CRITICAL_PCT = 0.90;

const usagePct = lastInputTokens / CONTEXT_LIMIT;
trace(TAG, `context: ${lastInputTokens} / ${CONTEXT_LIMIT} (${(usagePct * 100).toFixed(1)}%)`);

if (usagePct >= CRITICAL_PCT) {
  console.log(`⚠ Context window at ${(usagePct * 100).toFixed(0)}% (${lastInputTokens.toLocaleString()} tokens). You are about to hit the context limit. Consider starting a new session or running /compact to preserve context.`);
  process.exit(0);
} else if (usagePct >= WARNING_PCT) {
  console.log(`Context window at ${(usagePct * 100).toFixed(0)}% (${lastInputTokens.toLocaleString()} tokens). Consider wrapping up or compacting soon.`);
}

process.exit(0);
