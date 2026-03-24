#!/usr/bin/env bun
/**
 * Stop hook: verification gate.
 *
 * Checks whether the current turn included e2e verification evidence
 * (devserver, Playwright, browser interaction) AND an artifact
 * (screenshot or captured output).
 *
 * This hook gets ONE chance to remind — Stop hooks only retry once.
 * The real enforcement comes from format-reminder.ts (UserPromptSubmit)
 * which injects verification requirements into every actionable prompt.
 * This hook validates compliance and gives a last-chance nudge.
 */
import { readFileSync, existsSync } from "fs";
import { trace } from "../../trace.ts";

const TAG = "verify-gate";

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

// Find current turn (from last user message onward)
let turnStart = 0;
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const parsed = JSON.parse(lines[i]);
    if (parsed.type === "user") { turnStart = i; break; }
  } catch { continue; }
}

// --- Scan current turn ---

let hasEdits = false;
const editedFiles: string[] = [];
const e2eSignals: string[] = [];
const artifacts: string[] = [];

// E2E: devserver startup, Playwright/Cypress, browser automation
const E2E_CMD = /playwright|cypress|puppeteer|(?:bun|npm|npx|yarn|pnpm)\s+(?:run\s+)?(?:e2e|integration|playwright)|(?:bun|npm|npx)\s+(?:run\s+)?dev\b|next\s+dev|vite\s+dev|(?:bun|node)\s+.*server/i;

// Artifact: screenshot or saved output
const ARTIFACT_CMD = /--screenshot|screenshot|\.png|\.jpg|\.jpeg|> .*\.(txt|log|html|json)|tee\s/i;

// Unit test runners — do NOT count as e2e
const UNIT_TEST_CMD = /^(?:bun test|npm test|npx jest|npx vitest|vitest|jest|pytest|cargo test|go test|dotnet test)(?:\s|$)/;

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
      if (E2E_CMD.test(cmd) && !UNIT_TEST_CMD.test(cmd.trim())) {
        e2eSignals.push(cmd.slice(0, 80));
      }
      if (ARTIFACT_CMD.test(cmd)) {
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

if (!hasEdits) {
  trace(TAG, "skip: no edits in current turn");
  process.exit(0);
}

const hasE2E = e2eSignals.length > 0;
const hasArtifact = artifacts.length > 0;

if (hasE2E && hasArtifact) {
  trace(TAG, `pass: e2e=[${e2eSignals[0]}] artifact=[${artifacts[0]}]`);
  process.exit(0);
}

// --- One-shot reminder ---

const files = [...new Set(editedFiles)].slice(0, 10).join(", ");
const missing: string[] = [];
if (!hasE2E) missing.push("e2e verification (start the dev server and interact with the running app)");
if (!hasArtifact) missing.push("artifact (screenshot or output saved to a file)");

trace(TAG, `BLOCKED: edits to [${files}] missing [${missing.join(", ")}]`);

console.log(`[Construct] Verification gate: you edited files (${files}) without e2e evidence.

Missing: ${missing.join("; ")}

Before completing, you must:
1. Start the dev server or run the real system
2. Interact with it to confirm your changes work
3. Save a screenshot or capture output to a file as proof

This is your one reminder — the gate cannot block you again.
Unit tests alone (bun test, jest, pytest) do not satisfy the gate.`);
