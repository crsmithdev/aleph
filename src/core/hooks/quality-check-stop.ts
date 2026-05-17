#!/usr/bin/env bun
/**
 * Stop hook: verification gate.
 *
 * Enforces the rule in `src/core/CLAUDE.md` Verification section: no completion
 * claims without a `[verify]` block in the same turn.
 *
 * # Outcomes
 *
 *   - SKIP    : every edited file is docs-only (markdown/text or under docs/) — pass silently
 *   - REQUIRED: any code/config edit — must show a `[verify]` block with the
 *               three required keys (scope, method, assertions) non-empty,
 *               OR have an explicit user grant via `skip verify[ication]`
 *               in the most recent user message.
 *
 * # `[verify]` block contract
 *
 * The block must appear in the turn's tool output (Bash printf, not assistant
 * prose). Format:
 *
 *     [verify]
 *     scope:      <files/lines exercised — what the test touched>
 *     method:     <what was run — command, inputs, procedure>
 *     assertions: <what was checked — meaning of the pass, not just "it passed">
 *     [/verify]
 *
 * Three required keys, all non-empty:
 *
 *   1. scope      — files/lines exercised. Answers "what did the test touch?"
 *   2. method     — what you ran. Command, inputs, procedure.
 *   3. assertions — what you checked. The meaning of the pass, not just "it passed."
 *
 * Optional recognised keys (captured to telemetry when present):
 *
 *   - failure-mode — flag a known limitation
 *   - gaps         — note what the test does not exercise
 *
 * # Shape-only — does not judge honesty
 *
 * The gate checks that the required fields are present and non-empty. It does
 * NOT judge whether assertions are sharp, scope is honest, or method actually
 * exercises the change. A fabricated block satisfies the regex. Catching lies
 * is a code-review responsibility, not this hook's.
 *
 * # Skip path — user-authored only
 *
 * If verification is genuinely inappropriate (paid endpoint, doc change
 * misclassified as REQUIRED), the model asks in chat and the user must reply
 * with `skip verify` or `skip verification`. The hook accepts the grant only
 * when it appears in the most recent USER message — the model cannot author
 * the phrase on its own behalf.
 *
 * # Common claims the gate catches
 *
 *   - "Build passes"             → doesn't exercise behavior; run a real test
 *   - "All existing tests pass"  → existing tests cover existing behavior; new
 *                                  change needs a new or extended test
 *   - "I checked it in the browser" → encode the check as a test, then verify
 *   - "I curl'd and got 200"     → for an API change, name the endpoint + test +
 *                                   response-shape claim in the block
 *
 * # Implementation
 *
 * All classification, scanning, and decision logic lives in
 * `src/eval/verify-policy.ts` so the same rules can be reused (and tested)
 * outside the hook.
 *
 * Block decisions emit JSON-shaped stdout (`{decision:"block",reason:"..."}`)
 * which the Claude Code harness recognises and refuses-to-end on. Pass
 * decisions stay silent.
 */
import { existsSync, readFileSync } from "fs";
import { execSync } from "child_process";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import {
  classifyChange,
  decide,
  extractTurn,
  missingRequiredFields,
  mostRecentUserText,
  RECOGNISED_KEYS,
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
catch (e) {
  console.error(`[${TAG}] stdin-parse-error: ${String(e)}`);
  trace(TAG, `stdin-parse-error: ${String(e)}`);
  process.exit(1);
}

// Guards: never block re-fires or non-natural stops
if (input.stop_hook_active) { trace(TAG, "skip: stop_hook_active"); process.exit(0); }
if (input.stop_reason && input.stop_reason !== "end_of_turn") {
  trace(TAG, `skip: stop_reason=${input.stop_reason}`);
  process.exit(0);
}

const transcriptPath = input.transcript_path;
if (!transcriptPath || !existsSync(transcriptPath)) process.exit(0);

// Determine repo root so out-of-project edits (dotfiles, /tmp, /mnt/...) are exempt.
const projectRoot = (() => {
  try {
    return execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
  } catch {
    return process.cwd();
  }
})();

const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");
const start = turnStartIndex(lines);
const rawTurn = extractTurn(lines, start);
const turn = {
  ...rawTurn,
  editedFiles: rawTurn.editedFiles.filter(f => f.startsWith(projectRoot)),
};
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
    ? Object.fromEntries(RECOGNISED_KEYS.map(k => [k, clip(block.fields[k]) ?? null]))
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
