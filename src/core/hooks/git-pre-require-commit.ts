#!/usr/bin/env bun
/**
 * PreToolUse hook: commit advisory.
 *
 * Fires on Edit/Write. Detects when uncommitted changes span too many
 * unrelated areas and emits an advisory suggesting a commit. Never blocks.
 *
 * 1. Run `git status --porcelain` in the session's cwd.
 *    Clean tree → clear marker, exit 0.
 * 2. Group dirty files by first 2 path segments (e.g. "src/telemetry").
 * 3. < WARN_GROUPS (3) → exit 0 silently.
 * 4. ≥ WARN_GROUPS → write marker, emit advisory, exit 0.
 */
import { execSync } from "child_process";
import { writeFileSync, unlinkSync, mkdirSync } from "fs";
import { dirname } from "path";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../data/src/paths.ts";

const TAG = "git-pre-require-commit";
const WARN_GROUPS = 3;

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }
reportHook(TAG, "PreToolUse", input.session_id);

const cwd = input.cwd;
if (!cwd) { trace(TAG, "no cwd, skip"); process.exit(0); }

let statusLines: string[];
try {
  const status = execSync("git status --porcelain", { cwd, encoding: "utf8", timeout: 5000 }).trim();
  if (!status) {
    cleanupMarker(input.session_id);
    trace(TAG, "clean tree, allow");
    process.exit(0);
  }
  statusLines = status.split("\n").filter(Boolean);
} catch (e) {
  trace(TAG, `git status failed: ${(e as Error).message}`);
  process.exit(0);
}

// Group files by logical directory (first 2 path segments, e.g. "src/telemetry")
const groups = new Set<string>();
for (const line of statusLines) {
  // git status --porcelain: XY flags then space(s) then filename
  const file = line.replace(/^[A-Z? !]{1,2}\s+/, "").replace(/^"(.*)"$/, "$1");
  const parts = file.split("/");
  if (parts.length >= 2) {
    groups.add(`${parts[0]}/${parts[1]}`);
  } else {
    groups.add(parts[0]);
  }
}

const groupCount = groups.size;
const fileCount = statusLines.length;
const groupList = [...groups].sort().join(", ");
trace(TAG, `${fileCount} dirty files across ${groupCount} groups: ${groupList}`);

if (groupCount < WARN_GROUPS) {
  process.exit(0);
}

const markerPath = `${dataPaths.signals}/git-pre-require-commit-${input.session_id}`;

// Advisory only — never block
try {
  mkdirSync(dirname(markerPath), { recursive: true });
  writeFileSync(markerPath, JSON.stringify({ ts: new Date().toISOString(), groups: groupCount, files: fileCount, areas: groupList }));
} catch {}
trace(TAG, `advisory: ${groupCount} groups`);
console.log(`[Construct] ${fileCount} uncommitted files across ${groupCount} areas (${groupList}). Consider committing before starting a new logical change.`);
process.exit(0);

function cleanupMarker(sessionId: string) {
  const path = `${dataPaths.signals}/git-pre-require-commit-${sessionId}`;
  try { unlinkSync(path); } catch {}
}
