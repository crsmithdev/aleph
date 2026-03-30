#!/usr/bin/env bun
/**
 * PreToolUse gate: blocks Edit/Write when the require-e2e marker exists.
 *
 * The marker is written by quality-stop-check-e2e.ts when a turn has edits
 * but lacks e2e verification evidence. This hook reads the marker and
 * hard-blocks (exit 2) until verification clears it.
 */
import { existsSync, readFileSync } from "fs";
import { trace } from "../../trace.ts";
import { dataPaths } from "../../data/src/paths.ts";

const TAG = "quality-pre-require-e2e";

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
