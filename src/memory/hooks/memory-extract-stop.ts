#!/usr/bin/env bun
/**
 * Stop hook: automatic memory extraction.
 *
 * Non-blocking. Extracts high-value memories from the session transcript
 * and persists them to semantic memory via a Python subprocess.
 *
 * 1. Parse transcript via parseTranscript().
 * 2. Skip if not substantive (< 6 messages or < 1 edit).
 * 3. Skip if Claude already called memory_store (avoid duplicates).
 * 4. Run extractMemories() heuristics to find decisions, corrections, patterns.
 * 5. If memories found and Python venv exists → spawn memory-writer.py
 *    fire-and-forget with JSON on stdin. Unref the process so it doesn't block exit.
 *
 * Never blocks (always exit 0). Missing Python or empty transcript → silent skip.
 */
import { existsSync, readFileSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths } from "../../data/src/paths.ts";
import { parseTranscript } from "../parse-transcript.ts";
import { extractMemories, hasMemoryStore } from "../extract.ts";

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
reportHook(TAG, "Stop", input.session_id);

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

// Augment with re-edit signals from this session
if (existsSync(dataPaths.toolSignals)) {
  try {
    const lines = readFileSync(dataPaths.toolSignals, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      const sig = JSON.parse(line);
      if (sig.sessionId !== input.session_id || sig.type !== "re-edit") continue;
      memories.push({
        content: `Re-edit friction: ${sig.file} required ${sig.count}+ edits in one session — approach needed multiple corrections.`,
        tags: "preference,auto_extract",
        memory_type: "observation",
      });
    }
  } catch (e) { trace(TAG, `tool signals read failed: ${(e as Error).message}`); }
}

// Augment with positive-feedback signals from this session.
// Each "great"/"perfect"/"thanks" gets stamped with the prior assistant turn
// (tools, files, text excerpt) at capture time — convert that into a
// "validated approach" memory so consolidation has an explicit positive corpus.
if (existsSync(dataPaths.feedback)) {
  try {
    const lines = readFileSync(dataPaths.feedback, "utf8").trim().split("\n").filter(Boolean);
    let added = 0;
    for (const line of lines) {
      const sig = JSON.parse(line);
      if (sig.session_id !== input.session_id || sig.polarity !== "positive") continue;
      if (!sig.prior_tools?.length && !sig.prior_text) continue;
      const what = sig.prior_tools?.length ? sig.prior_tools.join("+") : "approach";
      const where = sig.prior_files?.length ? ` on ${sig.prior_files.join(", ")}` : "";
      const why = sig.prior_text ? `: ${String(sig.prior_text).slice(0, 150)}` : "";
      memories.push({
        content: `Validated approach (user said "${sig.trigger}"): ${what}${where}${why}`,
        tags: "preference,auto_extract,validated",
        memory_type: "observation",
      });
      if (++added >= 3) break;
    }
  } catch (e) { trace(TAG, `feedback signals read failed: ${(e as Error).message}`); }
}

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
