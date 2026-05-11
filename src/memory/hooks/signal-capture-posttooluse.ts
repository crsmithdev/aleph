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
import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../data/src/paths.ts";

const TAG = "signal-capture";
const RE_EDIT_THRESHOLD = 3;

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }

const sessionId: string = input.session_id ?? "unknown";
const toolName: string = input.tool_name ?? "";
const filePath: string = input.tool_input?.file_path ?? input.tool_input?.path ?? "";

reportHook(TAG, "PostToolUse", sessionId);

if (!filePath) { trace(TAG, "no file_path in input"); process.exit(0); }

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
  const signal = {
    type: "re-edit",
    file: fileKey,
    count: state.fileCounts[fileKey],
    sessionId,
    timestamp: new Date().toISOString(),
  };
  try {
    mkdirSync(dirname(dataPaths.toolSignals), { recursive: true });
    appendFileSync(dataPaths.toolSignals, JSON.stringify(signal) + "\n");
    trace(TAG, `re-edit signal: ${fileKey} (${state.fileCounts[fileKey]}x)`);
    reportHook(TAG, "PostToolUse", sessionId, {
      decision: "advisory",
      detail: `re-edit:${fileKey}:${state.fileCounts[fileKey]}x`,
    });
  } catch (e) {
    trace(TAG, `signal write failed: ${(e as Error).message}`);
  }
}

process.exit(0);
