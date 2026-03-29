#!/usr/bin/env bun
/**
 * PreToolUse hook: dispatch gate.
 *
 * Blocks Edit/Write in the parent session when the current session has
 * a "dispatch" directive in the directives log AND no inline override.
 *
 * The gate reads the directives log (source of truth) rather than a
 * marker file, so it can't be bypassed with `rm`. The only way through
 * is the /inline command, which writes an explicit override signal.
 */
import { existsSync, readFileSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../paths.ts";

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

// Check for inline override signal — if present, always allow
const overridePath = `${dataPaths.signals}/inline-override-${sessionId}`;
if (existsSync(overridePath)) {
  trace(TAG, "inline override active, allow");
  process.exit(0);
}

// Check directives log for dispatch directive for this session
let hasDispatchDirective = false;
try {
  if (existsSync(dataPaths.directives)) {
    const lines = readFileSync(dataPaths.directives, "utf-8").split("\n");
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const entry = JSON.parse(line);
        if (entry.sessionId === sessionId && Array.isArray(entry.directives) && entry.directives.includes("dispatch")) {
          hasDispatchDirective = true;
          break;
        }
      } catch { continue; }
    }
  }
} catch (e) {
  trace(TAG, `directives read failed: ${(e as Error).message}`);
  process.exit(0);
}

if (!hasDispatchDirective) {
  trace(TAG, "no dispatch directive for this session, allow");
  process.exit(0);
}

trace(TAG, `BLOCKED: ${toolName} — dispatch directive active for session ${sessionId}`);
console.log(`[Construct] Dispatch required — this task should be dispatched to a background Agent (run_in_background: true). Use /inline to override for this session.`);
process.exit(2);
