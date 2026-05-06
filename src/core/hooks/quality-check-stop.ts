#!/usr/bin/env bun
/**
 * Stop hook: verification gate.
 *
 * Two outcomes:
 *   - SKIP    : every edited file is docs-only (markdown/text or under docs/) — pass silently
 *   - REQUIRED: any code/config edit — must show a complete `[verify]` block
 *               (scope, method, assertions, failure-mode, gaps) in this turn's
 *               tool output, OR have an explicit user grant via `skip verify[ication]`
 *               in the most recent user message. The hook is shape-only; quality of
 *               the answers is reviewed offline against the JSONL telemetry, where
 *               every field's value is recorded.
 *
 * All classification, scanning, and decision logic lives in `src/eval/verify-policy.ts`
 * so the same rules can be reused (and tested) outside the hook.
 *
 * Block decisions emit JSON-shaped stdout (`{decision:"block",reason:"..."}`) which the
 * Claude Code harness recognises and refuses-to-end on. Pass decisions stay silent.
 */
import { existsSync, readFileSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import {
  classifyChange,
  decide,
  extractTurn,
  missingRequiredFields,
  mostRecentUserText,
  REQUIRED_KEYS,
  scanVerifyBlock,
  turnStartIndex,
} from "../../eval/verify-policy.ts";

/** Truncate long free-text values so the JSONL line stays grep-friendly. */
function clip(s: string | undefined, n = 500): string | undefined {
  if (!s) return s;
  return s.length > n ? s.slice(0, n) + "…" : s;
}

const TAG = "quality-check-stop";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch { process.exit(0); }

// Guards: never block re-fires or non-natural stops
if (input.stop_hook_active) { trace(TAG, "skip: stop_hook_active"); process.exit(0); }
if (input.stop_reason && input.stop_reason !== "end_of_turn") {
  trace(TAG, `skip: stop_reason=${input.stop_reason}`);
  process.exit(0);
}

const transcriptPath = input.transcript_path;
if (!transcriptPath || !existsSync(transcriptPath)) process.exit(0);

const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");
const start = turnStartIndex(lines);
const turn = extractTurn(lines, start);
const userText = mostRecentUserText(lines);

const klass = classifyChange(turn.editedFiles);
const decision = decide({
  editedFiles: turn.editedFiles,
  toolResultText: turn.toolResultText,
  mostRecentUserText: userText,
});

// Telemetry shape preserved for back-compat with eval harness / observability:
//   tier 0 = SKIP, tier 1 = REQUIRED. Existing readers only care that it's a number.
const tier = klass === "skip" ? 0 : 1;
const fileDisplay = [...new Set(turn.editedFiles)]
  .map(f => f.split("/").slice(-2).join("/"))
  .slice(0, 8)
  .join(", ");

trace(TAG, `${decision.kind} class=${klass} files=${turn.editedFiles.length} (${fileDisplay})`);

// Log the parsed [verify] block (truncated per field) so offline analysis
// can spot lazy answers, hallucinated paths, weak failure-modes, etc.
// Empty/missing fields are recorded as null so the JSONL is regular shape.
const block = klass === "required" ? scanVerifyBlock(turn.toolResultText) : null;
const verifyMeta: Record<string, unknown> = {};
if (klass === "required") {
  verifyMeta.editedFiles = [...new Set(turn.editedFiles)].slice(0, 16);
  verifyMeta.verifyPresent = block !== null;
  verifyMeta.verifyMissing = missingRequiredFields(block);
  verifyMeta.verify = block
    ? Object.fromEntries(REQUIRED_KEYS.map(k => [k, clip(block.fields[k]) ?? null]))
    : null;
}

reportHook(TAG, "Stop", input.session_id, {
  decision: decision.kind,
  tier,
  detail: `class=${klass} reason="${decision.reason.split("\n")[0]}"`,
  meta: Object.keys(verifyMeta).length > 0 ? verifyMeta : undefined,
});

if (decision.kind === "block") {
  console.log(JSON.stringify({ decision: "block", reason: decision.reason }));
}

process.exit(0);
