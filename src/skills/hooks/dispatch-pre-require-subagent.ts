#!/usr/bin/env bun
/**
 * PreToolUse hook: dispatch gate.
 *
 * Always-on gate that blocks Edit/Write in the main session by default.
 *
 * 1. Parse stdin JSON for session_id and tool_name. No session_id → exit 0 (allow).
 * 2. Check signals/inline-override-{session_id} exists → exit 0 (inline override active).
 * 3. Read signals/current-session-id (written by routing-submit-classify.ts).
 *    - File missing → treat as subagent, exit 0 (allow).
 *    - session_id ≠ main session → subagent, exit 0 (allow).
 *    - session_id = main session → exit 2 (hard block, must dispatch via Agent tool).
 */
import { existsSync, readFileSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../data/src/paths.ts";

const TAG = "dispatch-pre-require-subagent";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(1); }
const sessionId = input.session_id ?? "";
const toolName = input.tool_name ?? "";

if (!sessionId) {
  trace(TAG, "no session_id, skip");
  process.exit(0);
}

// Check for inline override signal — if present, always allow
const overridePath = `${dataPaths.signals}/inline-override-${sessionId}`;
if (existsSync(overridePath)) {
  trace(TAG, "inline override active, allow");
  reportHook(`${TAG}:inline-override`, "PreToolUse", sessionId);
  process.exit(0);
}

// Check if this is a subagent — read the recorded main-session ID and compare
const currentSessionIdPath = `${dataPaths.signals}/current-session-id`;
if (existsSync(currentSessionIdPath)) {
  const mainSessionId = readFileSync(currentSessionIdPath, "utf-8").trim();
  if (mainSessionId !== sessionId) {
    trace(TAG, `subagent detected (main=${mainSessionId}, this=${sessionId}), allow`);
    process.exit(0);
  }
  trace(TAG, `main session confirmed (id=${sessionId})`);
} else {
  trace(TAG, "no current-session-id file, treat as subagent, allow");
  process.exit(0);
}

trace(TAG, `BLOCKED: ${toolName} — main session without inline override`);
reportHook(TAG, "PreToolUse", sessionId);
console.log(`[Construct] Dispatch required — this task should be dispatched to a background Agent (run_in_background: true). Use /inline to override for this session.`);
process.exit(2);
