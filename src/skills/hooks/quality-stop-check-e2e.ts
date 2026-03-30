#!/usr/bin/env bun
/**
 * Stop hook: verification gate.
 *
 * Checks whether the current turn included e2e verification evidence
 * AND an artifact (screenshot or captured output).
 *
 * 1. Skip if stop_hook_active (already reminded once this turn).
 * 2. Read transcript, find current turn boundary (last real user message with text).
 * 3. Scan assistant messages from turnStart forward:
 *    - Track Edit/Write/NotebookEdit as "edits" (with file paths).
 *    - Track Bash commands matching E2E_CMD (devserver, curl, playwright) as e2e signals.
 *    - Track Bash commands matching ARTIFACT_CMD (output redirect, screenshot) as artifacts.
 *    - Track Chrome DevTools / Playwright MCP calls as e2e signals + artifacts.
 * 4. No edits this turn → clear marker, exit 0.
 * 5. Edits + e2e + artifact → clear marker, exit 0 (verification passed).
 * 6. Edits but missing e2e or artifact → write require-e2e marker with details,
 *    emit instructions. quality-pre-require-e2e.ts reads this to hard-block Edit/Write.
 */
import { readFileSync, writeFileSync, existsSync, unlinkSync } from "fs";
import { trace } from "../../trace.ts";
import { dataPaths, ensureDataDirs } from "../../data/src/paths.ts";
import { E2E_CMD, ARTIFACT_CMD, UNIT_TEST_CMD, HOOK_INVOCATION } from "../../eval/patterns.ts";

const TAG = "quality-stop-check-e2e";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }

if (input.stop_hook_active) {
  trace(TAG, "skip: stop_hook_active (already reminded once)");
  process.exit(0);
}

const transcriptPath = input.transcript_path;
if (!transcriptPath || !existsSync(transcriptPath)) {
  trace(TAG, "skip: no transcript");
  process.exit(0);
}

const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");

// Find current turn (from last real user message onward).
// Tool-result messages also have type "user" but with empty or missing text content —
// skip those so the turn boundary is the actual user prompt.
let turnStart = 0;
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const parsed = JSON.parse(lines[i]);
    if (parsed.type !== "user") continue;
    const content = parsed.message?.content;
    if (!Array.isArray(content) || content.length === 0) continue;
    const hasText = content.some((b: any) => b.type === "text" && b.text?.trim());
    if (hasText) { turnStart = i; break; }
  } catch { continue; }
}

// --- Scan current turn ---

let hasEdits = false;
const editedFiles: string[] = [];
const e2eSignals: string[] = [];
const artifacts: string[] = [];


for (let i = turnStart; i < lines.length; i++) {
  let parsed: any;
  try { parsed = JSON.parse(lines[i]); } catch { continue; }
  if (parsed.type !== "assistant") continue;

  const content: any[] = parsed.message?.content ?? [];
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    const name = block.name as string;
    const blockInput = block.input as Record<string, unknown> | undefined;

    // Track edits
    if (name === "Edit" || name === "Write" || name === "NotebookEdit") {
      hasEdits = true;
      const fp = blockInput?.file_path as string | undefined;
      if (fp) editedFiles.push(fp.split("/").slice(-2).join("/"));
    }

    // E2E signals from Bash commands
    if (name === "Bash") {
      const cmd = (blockInput?.command as string) ?? "";
      if (E2E_CMD.test(cmd) && !UNIT_TEST_CMD.test(cmd.trim()) && !HOOK_INVOCATION.test(cmd)) {
        e2eSignals.push(cmd.slice(0, 80));
      }
      if (ARTIFACT_CMD.test(cmd) && !HOOK_INVOCATION.test(cmd)) {
        artifacts.push("bash:" + cmd.slice(0, 60));
      }
    }

    // Chrome DevTools MCP = real browser interaction
    if (name.startsWith("mcp__chrome-devtools__")) {
      e2eSignals.push(name);
      if (name === "mcp__chrome-devtools__take_screenshot") {
        artifacts.push("screenshot:chrome-devtools");
      }
    }

    // Playwright/browser MCP
    if (name.startsWith("mcp__playwright") || name.startsWith("mcp__browser")) {
      e2eSignals.push(name);
    }
  }
}

const markerPath = `${dataPaths.signals}/require-e2e`;

if (!hasEdits) {
  // No edits this turn — clear any existing marker
  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
    trace(TAG, "cleared marker: no edits this turn");
  }
  trace(TAG, "skip: no edits in current turn");
  process.exit(0);
}

const hasE2E = e2eSignals.length > 0;
const hasArtifact = artifacts.length > 0;

if (hasE2E && hasArtifact) {
  // Verification passed — clear marker if it exists
  if (existsSync(markerPath)) {
    unlinkSync(markerPath);
    trace(TAG, "cleared marker: verification passed");
  }
  trace(TAG, `pass: e2e=[${e2eSignals[0]}] artifact=[${artifacts[0]}]`);
  process.exit(0);
}

// --- Write marker for PreToolUse gate ---

const files = [...new Set(editedFiles)].slice(0, 10).join(", ");
const missing: string[] = [];
if (!hasE2E) missing.push("e2e verification (start the dev server and interact with the running app)");
if (!hasArtifact) missing.push("artifact (screenshot or output saved to a file)");

ensureDataDirs();
writeFileSync(markerPath, JSON.stringify({ files, missing, ts: new Date().toISOString() }));
trace(TAG, `marker written: edits to [${files}] missing [${missing.join(", ")}]`);

console.log(`[Construct] Verification gate: you edited files (${files}) without e2e evidence.

Missing: ${missing.join("; ")}

Before completing, you must:
1. Start the dev server or run the real system
2. Interact with it to confirm your changes work
3. Save a screenshot or capture output to a file as proof

The next Edit/Write will be BLOCKED until verification evidence appears in the transcript.
Unit tests alone (bun test, jest, pytest) do not satisfy the gate.`);
