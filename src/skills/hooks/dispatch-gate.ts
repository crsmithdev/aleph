#!/usr/bin/env bun
/**
 * PreToolUse hook: dispatch gate.
 *
 * Blocks Edit/Write in the parent session when format-reminder.ts
 * has flagged the current prompt as requiring dispatch to a background agent.
 *
 * Subagent Edit/Write calls are NOT blocked — PreToolUse hooks are per-process,
 * so this hook only fires in the parent session.
 *
 * Use /inline to override for the current session.
 */
import { existsSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";

const TAG = "dispatch-gate";

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

const markerPath = `/tmp/construct-dispatch-${sessionId}`;

if (!existsSync(markerPath)) {
  trace(TAG, "no dispatch marker, allow");
  process.exit(0);
}

trace(TAG, `BLOCKED: ${toolName} — dispatch marker active for session ${sessionId}`);
console.log(`[Construct] Dispatch required — this task should be dispatched to a background Agent (run_in_background: true). Use /inline to override for this session.`);
process.exit(2);
