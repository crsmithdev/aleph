#!/usr/bin/env bun
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { resolve } from "path";
import { trace } from "../../trace.ts";
import { parseTranscript } from "../parse-transcript.ts";

const lockFile = resolve(Bun.env.HOME ?? "/tmp", ".claude/.memory-gate.lock");

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch { process.exit(1); }
const transcript = parseTranscript(input.transcript_path);

if (!transcript) {
  trace("memory-gate", "skip: no transcript");
  process.exit(0);
}

const editWriteCount = (transcript.toolCounts["Edit"] ?? 0) + (transcript.toolCounts["Write"] ?? 0) + (transcript.toolCounts["Bash"] ?? 0);
const memoryStoreCount = Object.keys(transcript.toolCounts).filter(k => k.includes("memory_store")).reduce((sum, k) => sum + transcript.toolCounts[k], 0);

trace("memory-gate", `edits: ${editWriteCount}, stores: ${memoryStoreCount}, msgs: ${transcript.totalMessages}`);

// Not a substantive session — allow exit
if (transcript.totalMessages < 6 || editWriteCount < 1) {
  trace("memory-gate", "skip: not substantive");
  if (existsSync(lockFile)) unlinkSync(lockFile);
  process.exit(0);
}

// Memory was stored — allow exit
if (memoryStoreCount > 0) {
  trace("memory-gate", "pass: memory_store found");
  if (existsSync(lockFile)) unlinkSync(lockFile);
  process.exit(0);
}

// Already reminded once — don't loop forever, allow exit
if (existsSync(lockFile)) {
  trace("memory-gate", "pass: already reminded once");
  unlinkSync(lockFile);
  process.exit(0);
}

// Block exit: substantive session with no memory_store
writeFileSync(lockFile, new Date().toISOString());
trace("memory-gate", "blocking: no memory_store in substantive session");

const filesHint = transcript.editedFiles.size > 0
  ? `\nFiles touched: ${[...transcript.editedFiles].slice(0, 6).join(", ")}` : "";

console.log(JSON.stringify({ decision: "block", reason:
  `No memory_store call found. Before exiting, call memory_store with tag 'session_context' and content:

Task: ${transcript.firstUserText || "[what was the task?]"}
Outcome: [done | in-progress | blocked]
Changes: [what was changed and why]${filesHint}
Decisions: [key choices made, with reasoning]
Next: [what a future session should know or do]

Collapse into 2-4 sentences. Use memory_type: 'observation'.` }));
