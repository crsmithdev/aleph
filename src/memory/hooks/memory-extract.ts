#!/usr/bin/env bun
/**
 * Automatic memory extraction — non-blocking Stop hook.
 * Parses session transcript, extracts high-value memories via heuristics,
 * spawns memory-writer.py fire-and-forget to store them in semantic memory.
 */
import { existsSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";
import { parseTranscript } from "../parse-transcript.ts";
import { extractMemories, hasMemoryStore } from "../extract.ts";

const TAG = "memory-extract";
const VENV_PYTHON = resolve(
  Bun.env.HOME ?? "/tmp",
  ".local/share/uv/tools/mcp-memory-service/bin/python",
);
const WRITER_SCRIPT = resolve(dirname(Bun.main), "../memory-writer.py");

let input: any;
const raw = await Bun.stdin.text();
try { input = JSON.parse(raw); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }

const transcript = parseTranscript(input.transcript_path, { textLimit: 1000 });
if (!transcript) { trace(TAG, "skip: no transcript"); process.exit(0); }

const edits = (transcript.toolCounts["Edit"] ?? 0) + (transcript.toolCounts["Write"] ?? 0) + (transcript.toolCounts["Bash"] ?? 0);
const substantive = transcript.totalMessages >= 6 && edits >= 1;
if (!substantive) { trace(TAG, `skip: not substantive (${transcript.totalMessages} msgs, ${edits} edits)`); process.exit(0); }

if (hasMemoryStore(transcript)) {
  trace(TAG, "skip: Claude already called memory_store");
  process.exit(0);
}

const memories = extractMemories(transcript);
trace(TAG, `extracted ${memories.length} memories`);

if (memories.length === 0) { process.exit(0); }

if (!existsSync(VENV_PYTHON)) {
  trace(TAG, `skip: python not found at ${VENV_PYTHON}`);
  process.exit(0);
}

const json = JSON.stringify(memories);
trace(TAG, `spawning writer with ${json.length} bytes`);

const proc = Bun.spawn([VENV_PYTHON, WRITER_SCRIPT], {
  stdin: new Blob([json]),
  stdout: "ignore",
  stderr: "ignore",
});
proc.unref();

process.exit(0);
