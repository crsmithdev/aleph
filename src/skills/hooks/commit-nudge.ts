#!/usr/bin/env bun
/**
 * PreToolUse hook: commit nudge.
 *
 * Fires on Edit/Write. Two-tier enforcement:
 *   - Warn: when dirty files ≥ WARN_THRESHOLD, print a reminder and write a marker.
 *   - Block: when dirty files ≥ BLOCK_THRESHOLD, exit(2) to prevent the edit.
 *
 * A successful `git commit` resets both tiers (marker is stale once the tree shrinks).
 */
import { execSync } from "child_process";
import { existsSync, writeFileSync, readFileSync, unlinkSync, mkdirSync } from "fs";
import { dirname } from "path";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../paths.ts";

const TAG = "commit-nudge";
const WARN_THRESHOLD = 8;
const BLOCK_THRESHOLD = 15;

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }
reportHook(TAG, "PreToolUse", input.session_id);

const cwd = input.cwd;
if (!cwd) { trace(TAG, "no cwd, skip"); process.exit(0); }

// Count dirty files
let dirtyCount = 0;
try {
  const status = execSync("git status --porcelain", { cwd, encoding: "utf8", timeout: 5000 }).trim();
  if (!status) {
    // Clean tree — remove any stale marker
    cleanupMarker(input.session_id);
    trace(TAG, "clean tree, allow");
    process.exit(0);
  }
  dirtyCount = status.split("\n").filter(Boolean).length;
} catch (e) {
  trace(TAG, `git status failed: ${(e as Error).message}`);
  process.exit(0);
}

trace(TAG, `dirty files: ${dirtyCount}`);

if (dirtyCount < WARN_THRESHOLD) {
  process.exit(0);
}

const markerPath = `${dataPaths.signals}/commit-nudge-${input.session_id}`;

if (dirtyCount >= BLOCK_THRESHOLD) {
  trace(TAG, `BLOCKED: ${dirtyCount} dirty files ≥ ${BLOCK_THRESHOLD}`);
  console.log(`[Construct] ${dirtyCount} uncommitted files — commit your current logical change before continuing. This edit is blocked until the working tree is smaller.`);
  process.exit(2);
}

// Warn tier: print reminder, write marker if not already present
if (!existsSync(markerPath)) {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify({ ts: new Date().toISOString(), count: dirtyCount }));
}
trace(TAG, `warn: ${dirtyCount} dirty files`);
console.log(`[Construct] ${dirtyCount} uncommitted files. Consider committing the current logical change before starting the next one.`);
process.exit(0);

function cleanupMarker(sessionId: string) {
  const path = `${dataPaths.signals}/commit-nudge-${sessionId}`;
  try { if (existsSync(path)) unlinkSync(path); } catch {}
}
