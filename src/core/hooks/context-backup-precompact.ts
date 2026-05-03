#!/usr/bin/env bun
/**
 * PreCompact hook: compaction notes.
 *
 * Fires before Claude compacts context. Parses the last ~120 lines of the
 * transcript and extracts a structured working-state snapshot written to
 * signals/compaction-notes.json. context-restore-start.ts injects these notes
 * at the start of the next session if the file is less than 12 hours old,
 * bridging context across compaction boundaries.
 *
 * Extracted fields:
 *   - recentPrompts: last 2 user prompts (truncated)
 *   - workingFiles:  unique files from recent Edit/Write calls
 *   - recentErrors:  last 3 error messages from tool_results
 *   - lastAssistantSnippet: last 300 chars of last assistant text block
 *
 * Never blocks (always exit 0). All failures are swallowed with trace logging.
 */
import { readFileSync, writeFileSync, mkdirSync } from "fs";
import { dirname } from "path";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../data/src/paths.ts";

const TAG = "context-backup-precompact";
let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }
reportHook(TAG, "PreCompact", input.session_id);

const transcriptPath = input.transcript_path;
if (!transcriptPath) { trace(TAG, "no transcript path"); process.exit(0); }

let transcriptContent: Buffer;
try {
  transcriptContent = readFileSync(transcriptPath);
} catch (e) {
  trace(TAG, `read transcript failed: ${(e as Error).message}`);
  process.exit(0);
}

try {
  const lines = transcriptContent.toString("utf8")
    .split("\n")
    .filter(l => l.trim())
    .slice(-120); // examine last 120 lines

  const recentPrompts: string[] = [];
  const workingFiles = new Map<string, number>(); // file -> last seen index
  const recentErrors: string[] = [];
  let lastAssistantText = "";

  for (let i = 0; i < lines.length; i++) {
    let entry: any;
    try { entry = JSON.parse(lines[i]); } catch { continue; }

    if (entry.type === "user") {
      const content = entry.message?.content;
      // Plain string prompt
      if (typeof content === "string" && content.trim()) {
        recentPrompts.push(content.trim().slice(0, 150));
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text?.trim()) {
            recentPrompts.push(block.text.trim().slice(0, 150));
          }
          // Capture tool errors
          if (block.type === "tool_result" && block.is_error) {
            const errText = typeof block.content === "string"
              ? block.content
              : (block.content as any[])?.[0]?.text ?? "";
            if (errText.trim()) recentErrors.push(errText.trim().slice(0, 120));
          }
        }
      }
    }

    if (entry.type === "assistant") {
      const content = entry.message?.content;
      if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === "text" && block.text?.trim()) {
            lastAssistantText = block.text;
          }
          if (block.type === "tool_use") {
            const name: string = block.name ?? "";
            if (name === "Edit" || name === "Write") {
              const fp: string = block.input?.file_path ?? block.input?.path ?? "";
              if (fp) workingFiles.set(fp, i);
            }
          }
        }
      }
    }
  }

  // Sort working files by recency (last seen index), take up to 10
  const sortedFiles = [...workingFiles.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([fp]) => fp)
    .slice(0, 10);

  const notes = {
    ts: new Date().toISOString(),
    sessionId: input.session_id ?? "unknown",
    recentPrompts: recentPrompts.slice(-2),
    workingFiles: sortedFiles,
    recentErrors: recentErrors.slice(-3),
    lastAssistantSnippet: lastAssistantText.slice(-300).trim(),
  };

  mkdirSync(dirname(dataPaths.compactionNotes), { recursive: true });
  writeFileSync(dataPaths.compactionNotes, JSON.stringify(notes, null, 2));
  trace(TAG, `compaction notes written: ${sortedFiles.length} files, ${recentPrompts.length} prompts, ${recentErrors.length} errors`);
} catch (e) {
  trace(TAG, `compaction notes failed: ${(e as Error).message}`);
}

process.exit(0);
