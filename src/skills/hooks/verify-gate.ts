#!/usr/bin/env bun
/**
 * Stop hook: verification gate.
 * Blocks completion when edits were made without invoking the verification skill.
 * Skips if already re-triggered (stop_hook_active) to prevent loops.
 */
import { readFileSync, existsSync } from "fs";
import { trace } from "../../trace.ts";

const TAG = "verify-gate";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(0); }

// Don't loop: if we already reminded Claude once, let it stop
if (input.stop_hook_active) {
  trace(TAG, "skip: stop_hook_active (already reminded)");
  process.exit(0);
}

const transcriptPath = input.transcript_path;
if (!transcriptPath || !existsSync(transcriptPath)) {
  trace(TAG, "skip: no transcript");
  process.exit(0);
}

// Read transcript from end to find the current turn (last user message → end)
const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");

let turnStart = 0;
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const parsed = JSON.parse(lines[i]);
    if (parsed.type === "user") {
      turnStart = i;
      break;
    }
  } catch { continue; }
}

// Scan the current turn for edits and verification skill invocation
let hasEdits = false;
let hasVerificationSkill = false;
const editedFiles: string[] = [];

for (let i = turnStart; i < lines.length; i++) {
  let parsed: any;
  try { parsed = JSON.parse(lines[i]); } catch { continue; }
  if (parsed.type !== "assistant") continue;

  const content: any[] = parsed.message?.content ?? [];
  for (const block of content) {
    if (block.type !== "tool_use") continue;
    const name = block.name as string;
    const blockInput = block.input as Record<string, unknown> | undefined;

    if (name === "Edit" || name === "Write" || name === "NotebookEdit") {
      hasEdits = true;
      const fp = blockInput?.file_path as string | undefined;
      if (fp) editedFiles.push(fp.split("/").slice(-2).join("/"));
    }

    if (name === "Skill" && blockInput?.skill === "verification") {
      hasVerificationSkill = true;
    }
  }
}

if (!hasEdits) {
  trace(TAG, "skip: no edits in current turn");
  process.exit(0);
}

if (hasVerificationSkill) {
  trace(TAG, "pass: verification skill was invoked");
  process.exit(0);
}

const files = [...new Set(editedFiles)].slice(0, 10).join(", ");
trace(TAG, `BLOCKED: edits to [${files}] without verification skill`);
console.log(`[Construct] Verification gate: you edited files (${files}) but did not invoke the verification skill. Before completing:
1. Call the verification skill: Skill("verification")
2. Follow its process: IDENTIFY the right test command → RUN it → READ the output → VERIFY the claim
3. Do not skip or disable any tests — do not assume failures are pre-existing or unrelated
4. Provide evidence from a user perspective that the change works end-to-end
5. Report results as: ✓ [command] → [result] or ✗ [command] → [actual vs expected]`);
