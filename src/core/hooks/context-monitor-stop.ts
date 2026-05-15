#!/usr/bin/env bun
/**
 * Stop hook: context window usage monitor.
 *
 * Fires after each Claude response. Reads the transcript to find the most
 * recent assistant message with token usage data.
 *
 * 1. Parse transcript, scan from end for assistant message with usage block.
 * 2. Sum input_tokens + cache_read + cache_creation for total context usage.
 * 3. Detect context window: 200k base; if usage already exceeds 200k, session has 1M window.
 * 4. At ≥90% → emit critical warning (compact or new session).
 *    At ≥80% → emit advisory warning.
 *    Below 80% → silent.
 *
 * Never blocks (always exit 0). Informational only.
 */
import { readFileSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

const TAG = "context-monitor-stop";
let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }
reportHook(TAG, "Stop", input.session_id);

const transcriptPath = input.transcript_path;
if (!transcriptPath) { trace(TAG, "no transcript path"); process.exit(0); }

// Read transcript and find the last assistant message with usage data
let content: string;
try { content = readFileSync(transcriptPath, "utf8"); }
catch { trace(TAG, "could not read transcript"); process.exit(0); }

const lines = content.split("\n").filter(Boolean);

const BASE_LIMIT = 200_000;
const EXTENDED_LIMIT = 1_000_000;

// If usage is already above the base limit, the session must have an extended window.
function contextLimit(currentUsage: number): number {
  return currentUsage > BASE_LIMIT ? EXTENDED_LIMIT : BASE_LIMIT;
}

// Scan from the end for the last assistant message with usage
let lastInputTokens = 0;
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const entry = JSON.parse(lines[i]);
    if (entry.type !== "assistant") continue;
    const usage = entry.message?.usage;
    if (!usage) continue;
    lastInputTokens = (usage.input_tokens || 0) + (usage.cache_read_input_tokens || 0) + (usage.cache_creation_input_tokens || 0);
    break;
  } catch { continue; }
}

if (lastInputTokens === 0) {
  trace(TAG, "no usage data found");
  process.exit(0);
}

const CONTEXT_LIMIT = contextLimit(lastInputTokens);
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
