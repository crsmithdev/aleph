#!/usr/bin/env bun
/**
 * PreToolUse gate: blocks Edit/Write when the require-e2e marker exists.
 *
 * 1. Parse stdin JSON for session_id, tool_name, tool_input.
 *    Parse failure → trace and exit 0 (fail open).
 * 2. Check signals/require-e2e marker file.
 *    Missing → exit 0 (allow, no pending verification needed).
 * 3. Read marker JSON for context (which files were edited, what's missing).
 * 4. Emit detailed instructions (start server, interact, save artifact).
 * 5. Exit 2 (hard block). The marker is written by quality-stop-check-e2e.ts
 *    when edits lack e2e evidence, and cleared when evidence appears.
 */
import { existsSync, readFileSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../paths.ts";

const TAG = "quality-pre-require-e2e";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }
reportHook(TAG, "PreToolUse", input.session_id);

const markerPath = `${dataPaths.signals}/require-e2e`;

if (!existsSync(markerPath)) {
  process.exit(0);
}

let marker: { files?: string; missing?: string[] } = {};
try { marker = JSON.parse(readFileSync(markerPath, "utf8")); }
catch { /* marker exists but unreadable — still block */ }

trace(TAG, `BLOCKED: require-e2e marker present (files: ${marker.files ?? "unknown"})`);

console.log(`[Construct] BLOCKED: previous edits (${marker.files ?? "unknown files"}) lack e2e verification.

You must verify before making more edits:
1. Start the dev server or run the real system
2. Interact with it to confirm changes work
3. Save a screenshot or capture output to a file

The marker will clear automatically when quality-stop-check-e2e detects evidence.
Unit tests alone do not satisfy the gate.`);

process.exit(2);
