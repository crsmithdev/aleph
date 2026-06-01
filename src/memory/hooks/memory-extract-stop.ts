#!/usr/bin/env bun
/**
 * Stop hook: automatic memory extraction.
 *
 * Non-blocking. Extracts high-value memories from the session transcript
 * and persists them to semantic memory via a Python subprocess.
 *
 * 1. Parse transcript via parseTranscript().
 * 2. Skip if not substantive (< 6 messages or < 1 edit).
 * 3. Run extractMemories() heuristics to find decisions, corrections, patterns.
 * 4. If memories found and Python venv exists → spawn memory-writer.py
 *    fire-and-forget with JSON on stdin. Unref the process so it doesn't block exit.
 *
 * Never blocks (always exit 0). Missing Python or empty transcript → silent skip.
 */
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { createHash } from "crypto";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../data/src/paths.ts";
import { parseTranscript } from "../parse-transcript.ts";
import { extractMemories, augmentWithSignals } from "../extract.ts";

const TAG = "memory-extract-stop";
const VENV_PYTHON = Bun.env.MEMORY_VENV_PYTHON ?? resolve(
  Bun.env.HOME ?? "/tmp",
  ".local/share/uv/tools/mcp-memory-service/bin/python",
);
const WRITER_SCRIPT = resolve(dirname(Bun.main), "../memory-writer.py");

let input: any;
const raw = await Bun.stdin.text();
try { input = JSON.parse(raw); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }

const sessionId: string = input.session_id ?? "unknown";

const transcript = parseTranscript(input.transcript_path, { textLimit: 1000 });
if (!transcript) {
  reportHook(TAG, "Stop", sessionId);
  trace(TAG, "skip: no transcript");
  process.exit(0);
}

const edits = (transcript.toolCounts["Edit"] ?? 0) + (transcript.toolCounts["Write"] ?? 0) + (transcript.toolCounts["Bash"] ?? 0);
const substantive = transcript.totalMessages >= 6 && edits >= 1;
if (!substantive) {
  reportHook(TAG, "Stop", sessionId);
  trace(TAG, `skip: not substantive (${transcript.totalMessages} msgs, ${edits} edits)`);
  process.exit(0);
}

// Pull this session's feedback + re-edit signals from events.jsonl
interface SessFeedback {
  polarity?: "positive" | "negative";
  trigger?: string;
  prompt?: string;
  prior_text?: string;
  prior_tools?: string[];
  prior_files?: string[];
  session_id: string;
}
interface SessReEdit { type: "re-edit"; file: string; count: number; sessionId: string; }
const sessFeedback: SessFeedback[] = [];
const sessReEdits: SessReEdit[] = [];
try {
  if (existsSync(dataPaths.events)) {
    const lines = readFileSync(dataPaths.events, "utf8").trim().split("\n");
    for (const line of lines) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        if (e.sessionId !== sessionId) continue;
        if (e.hook === "feedback-capture-submit" && e.polarity) {
          sessFeedback.push({
            polarity: e.polarity as "positive" | "negative",
            trigger: e.trigger as string,
            prompt: e.prompt as string,
            prior_text: e.priorText as string,
            prior_tools: e.priorTools as string[],
            prior_files: e.priorFiles as string[],
            session_id: sessionId,
          });
        } else if (e.hook === "signal-capture" && e.file && e.count) {
          sessReEdits.push({
            type: "re-edit",
            file: e.file as string,
            count: e.count as number,
            sessionId,
          });
        }
      } catch (err) { trace(TAG, `skipped malformed event: ${(err as Error).message}`); }
    }
  }
} catch (e) { trace(TAG, `events read failed: ${(e as Error).message}`); }

const baseMemories = extractMemories(transcript);
const memories = augmentWithSignals(baseMemories, sessReEdits, sessFeedback, sessionId);
trace(TAG, `extracted ${baseMemories.length} base + augmented to ${memories.length}`);

if (memories.length === 0) {
  reportHook(TAG, "Stop", sessionId);
  trace(TAG, "skip: no memories extracted");
  process.exit(0);
}

// Emit a memory_write provenance event per memory before spawning Python.
// The memoryId matches mcp-memory's content_hash (sha256(content)) so the
// observability layer can correlate to rows in the memory DB.
for (const m of memories) {
  const memoryId = createHash("sha256").update(m.content).digest("hex");
  reportHook(TAG, "Stop", sessionId, {
    meta: {
      memoryId,
      memoryType: m.memory_type_detail ?? "session",
      source: m.source ?? "",
      insight: m.insight ?? "",
      content: m.content,
      tags: m.tags,
    },
  });
}

if (!existsSync(VENV_PYTHON)) {
  trace(TAG, `skip: python not found at ${VENV_PYTHON}`);
  process.exit(0);
}

const memoriesWithSession = memories.map(m => ({ ...m, session_id: sessionId }));
const json = JSON.stringify(memoriesWithSession);
trace(TAG, `spawning writer with ${json.length} bytes`);

const proc = Bun.spawn([VENV_PYTHON, WRITER_SCRIPT], {
  stdin: new Blob([json]),
  stdout: "ignore",
  stderr: "ignore",
});
proc.unref();

process.exit(0);
