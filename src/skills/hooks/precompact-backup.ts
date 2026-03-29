#!/usr/bin/env bun
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "fs";
import { join, basename } from "path";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { claudePaths } from "../../paths.ts";

const TAG = "precompact-backup";
let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }
reportHook(TAG, "PreCompact", input.session_id);

const transcriptPath = input.transcript_path;
if (!transcriptPath) { trace(TAG, "no transcript path"); process.exit(0); }

const backupDir = join(claudePaths.root, "transcript-backups");
if (!existsSync(backupDir)) {
  mkdirSync(backupDir, { recursive: true });
}

const sessionName = basename(transcriptPath, ".jsonl");
const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
const backupPath = join(backupDir, `${sessionName}_${timestamp}.jsonl`);

try {
  const content = readFileSync(transcriptPath);
  writeFileSync(backupPath, content);
  trace(TAG, `backed up to ${backupPath} (${content.length} bytes)`);
} catch (e) {
  trace(TAG, `backup failed: ${(e as Error).message}`);
}

process.exit(0);
