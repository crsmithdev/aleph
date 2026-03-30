#!/usr/bin/env bun
/**
 * PreToolUse hook: dispatch gate.
 *
 * Always-on gate that blocks Edit/Write in the main session by default.
 * Two conditions allow the edit through:
 *   1. The /inline override signal is present for this session.
 *   2. The session_id differs from the recorded main-session ID (i.e. this
 *      is a subagent), in which case the gate does not apply.
 *
 * If neither condition is met, the edit is blocked (exit 2).
 */
import { existsSync, readFileSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../paths.ts";

const TAG = "dispatch-pre-require-subagent";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }
reportHook(TAG, "PreToolUse", input.session_id);

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
console.log(`[Construct] Dispatch required — this task should be dispatched to a background Agent (run_in_background: true). Use /inline to override for this session.`);
process.exit(2);
