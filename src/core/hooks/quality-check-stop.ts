#!/usr/bin/env bun
/**
 * Stop hook: verification gate.
 *
 * Two outcomes:
 *   - SKIP    : every edited file is docs-only (markdown/text or under docs/) — pass silently
 *   - REQUIRED: any code/config edit — must show a complete `[verify]` block
 *               (type, scope, input, output, method) in this turn's tool output,
 *               OR have an explicit user grant via `skip verify[ication]` in the
 *               most recent user message. The hook deliberately does NOT scan for
 *               "N pass / M fail" patterns — see verify-policy.ts for why.
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
  mostRecentUserText,
  turnStartIndex,
} from "../../eval/verify-policy.ts";

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

reportHook(TAG, "Stop", input.session_id, {
  decision: decision.kind,
  tier,
  detail: `class=${klass} reason="${decision.reason.split("\n")[0]}"`,
});

if (decision.kind === "block") {
  console.log(JSON.stringify({ decision: "block", reason: decision.reason }));
}

process.exit(0);
