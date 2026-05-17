#!/usr/bin/env bun
/**
 * PostToolUse hook: implicit failure signal capture.
 *
 * Tracks per-session file edit counts in /tmp. When the same file is edited
 * 3+ times in one session, emits a re-edit signal to tool-signals.jsonl.
 * These signals are consumed by memory-extract-stop.ts and converted to
 * preference memories for the consolidation pipeline.
 *
 * Never blocks (always exit 0). All errors are swallowed with trace logging.
 */
import { existsSync, readFileSync, writeFileSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

const TAG = "signal-capture";
const RE_EDIT_THRESHOLD = 3;

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }

const sessionId: string = input.session_id ?? "unknown";
const filePath: string = input.tool_input?.file_path ?? input.tool_input?.path ?? "";

if (!filePath) {
  reportHook(TAG, "PostToolUse", sessionId);
  trace(TAG, "no file_path in input");
  process.exit(0);
}

// Use last 2 path segments as the file key (consistent with parse-transcript.ts)
const fileKey = filePath.split("/").filter(Boolean).slice(-2).join("/");

// Per-session state in /tmp
const stateFile = `/tmp/construct-posttool-${sessionId}.json`;
let state: { fileCounts: Record<string, number> } = { fileCounts: {} };
try {
  if (existsSync(stateFile)) {
    state = JSON.parse(readFileSync(stateFile, "utf8"));
  }
} catch {
  state = { fileCounts: {} };
}

const prev = state.fileCounts[fileKey] ?? 0;
state.fileCounts[fileKey] = prev + 1;

try { writeFileSync(stateFile, JSON.stringify(state)); }
catch (e) { trace(TAG, `state write failed: ${(e as Error).message}`); }

// Emit signal exactly at threshold (not every time after)
if (state.fileCounts[fileKey] === RE_EDIT_THRESHOLD) {
  const count = state.fileCounts[fileKey];
  reportHook(TAG, "PostToolUse", sessionId, {
    decision: "advisory",
    detail: `re-edit:${fileKey}:${count}x`,
    meta: { file: fileKey, count },
  });
  trace(TAG, `re-edit signal: ${fileKey} (${count}x)`);
} else {
  reportHook(TAG, "PostToolUse", sessionId);
}

process.exit(0);
