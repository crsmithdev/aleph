#!/usr/bin/env bun
/**
 * Stop hook: tiered verification enforcement.
 *
 * Classifies edits by scope (docs → unit → functional → e2e-light → e2e-full),
 * checks for proportional verification evidence, and either passes silently,
 * advises, or blocks (JSON decision) based on tier and session depth.
 *
 * Hard blocks fire when: (isFULL OR multi-file edit) + tier ≥ 2 + zero verification.
 * Single-file non-FULL edits get advisory only. This prevents the "hallucinated
 * test results" failure mode where agents claim tests pass without running them.
 */
import { readFileSync, existsSync } from "fs";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { E2E_CMD, ARTIFACT_CMD, UNIT_TEST_CMD, HOOK_INVOCATION, FUNCTIONAL_CMD } from "../../eval/patterns.ts";
import { dataPaths } from "../../data/src/paths.ts";

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
if (!transcriptPath || !existsSync(transcriptPath)) { process.exit(0); }

// --- File classifiers ---
const isUIFile = (p: string) => /\.(tsx|jsx|css|scss)$/.test(p) || /\/(components|pages|app|web)\//.test(p);
const isDocFile = (p: string) => /(^|\/)docs\//.test(p) || /\.(md|txt)$/i.test(p) || /\b(CLAUDE|README|INSTALL)\b/i.test(p.split("/").pop() ?? "");
const isConfigFile = (p: string) => {
  const name = p.split("/").pop() ?? "";
  if (/^tsconfig.*\.json$/.test(name) || /^package.*\.json$/.test(name)) return false;
  return /\.(json|ya?ml|toml|env)$/i.test(name);
};
const isHookFile = (p: string) => /\/hooks\//.test(p);
const isTestFile = (p: string) => /\.(test|spec)\.(ts|tsx|js|jsx)$/.test(p) || /__tests__\//.test(p);

// --- Read isFULL from directives ---
function sessionIsFull(sessionId: string): boolean {
  try {
    const lines = readFileSync(dataPaths.directives, "utf8").trim().split("\n");
    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        if (entry.sessionId === sessionId && entry.directives?.includes("full")) return true;
      } catch { continue; }
    }
  } catch { /* file missing */ }
  return false;
}

// --- Scan transcript for current turn ---
const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");

let turnStart = 0;
for (let i = lines.length - 1; i >= 0; i--) {
  try {
    const parsed = JSON.parse(lines[i]);
    if (parsed.type !== "user") continue;
    const content = parsed.message?.content;
    if (!Array.isArray(content) || content.length === 0) continue;
    if (content.some((b: any) => b.type === "text" && b.text?.trim())) { turnStart = i; break; }
  } catch { continue; }
}

const editedFiles: string[] = [];
let hasUnitTest = false, hasFunctionalCheck = false, hasE2E = false, hasArtifact = false;

for (let i = turnStart; i < lines.length; i++) {
  let parsed: any;
  try { parsed = JSON.parse(lines[i]); } catch { continue; }
  if (parsed.type !== "assistant") continue;

  for (const block of (parsed.message?.content ?? [])) {
    if (block.type !== "tool_use") continue;
    const name = block.name as string;
    const blockInput = block.input as Record<string, unknown> | undefined;

    if (name === "Edit" || name === "Write" || name === "NotebookEdit") {
      const fp = blockInput?.file_path as string | undefined;
      if (fp) editedFiles.push(fp);
    }

    if (name === "Bash") {
      const cmd = (blockInput?.command as string) ?? "";
      if (UNIT_TEST_CMD.test(cmd.trim())) hasUnitTest = true;
      if (FUNCTIONAL_CMD.test(cmd)) hasFunctionalCheck = true;
      if (E2E_CMD.test(cmd) && !UNIT_TEST_CMD.test(cmd.trim()) && !HOOK_INVOCATION.test(cmd)) hasE2E = true;
      if (ARTIFACT_CMD.test(cmd) && !HOOK_INVOCATION.test(cmd)) hasArtifact = true;
    }

    if (name.startsWith("mcp__playwright") || name.startsWith("mcp__browser")) {
      hasE2E = true;
      if (name.includes("screenshot")) hasArtifact = true;
    }
  }
}

if (editedFiles.length === 0) {
  reportHook(TAG, "Stop", input.session_id, { decision: "pass", tier: 0, detail: "no edits" });
  process.exit(0);
}

// --- Classify tier ---
const unique = [...new Set(editedFiles)];
const fileCount = unique.length;
const dirs = new Set(unique.map(f => f.split("/").slice(0, -1).join("/").split("/").slice(-2).join("/")));
const dirCount = dirs.size;

const allDocs = unique.every(f => isDocFile(f));
const allConfig = unique.every(f => isConfigFile(f) || isDocFile(f));
const allHooks = unique.every(f => isHookFile(f));
const allTests = unique.every(f => isTestFile(f));
const hasUI = unique.some(f => isUIFile(f));
const hasServer = unique.some(f => !isUIFile(f) && !isDocFile(f) && !isConfigFile(f) && !isTestFile(f) && /\.(ts|js|tsx|jsx)$/.test(f));

const isFull = sessionIsFull(input.session_id ?? "");

let tier: number;
if (allDocs || allConfig || allHooks) {
  tier = 0;
} else if (allTests || (fileCount === 1 && !hasUI && !isFull)) {
  tier = 1;
} else if (hasServer && !hasUI) {
  tier = 2;
} else if (hasUI && !hasServer) {
  tier = 3;
} else if ((hasUI && hasServer) || (isFull && fileCount >= 5) || dirCount >= 3) {
  tier = 4;
} else {
  tier = 2; // default: treat as functional
}

const TIER_NAMES = ["SKIP", "UNIT", "FUNCTIONAL", "E2E_LIGHT", "E2E_FULL"];
const anyVerification = hasUnitTest || hasFunctionalCheck || hasE2E || hasArtifact;

trace(TAG, `tier=${TIER_NAMES[tier]} isFull=${isFull} files=${fileCount} dirs=${dirCount} unit=${hasUnitTest} func=${hasFunctionalCheck} e2e=${hasE2E} artifact=${hasArtifact}`);

const display = unique.map(f => f.split("/").slice(-2).join("/")).slice(0, 8);
const fileList = display.join(", ");

function exitWith(decision: "block" | "advisory" | "pass", message?: string) {
  reportHook(TAG, "Stop", input.session_id, {
    decision,
    tier,
    detail: `tier=${TIER_NAMES[tier]} isFull=${isFull} unit=${hasUnitTest} func=${hasFunctionalCheck} e2e=${hasE2E} artifact=${hasArtifact}`,
  });
  if (message) console.log(message);
  process.exit(0);
}

// --- Enforcement ---

// Tier 0: always pass
if (tier === 0) exitWith("pass");

// Tier 1: advisory only
if (tier === 1) {
  if (anyVerification) exitWith("pass");
  exitWith("advisory", `[Construct] You edited ${fileList} without running tests. Quick check: bun test`);
}

// Tier 2: block on multi-file backend changes with zero verification
if (tier === 2) {
  if (anyVerification) exitWith("pass");
  if (isFull || fileCount >= 2) {
    exitWith("block", JSON.stringify({
      decision: "block",
      reason: `Backend change (${fileCount} files: ${fileList}) with no test evidence. Run tests (bun test) or curl the affected endpoint before finishing.`,
    }));
  }
  exitWith("advisory", `[Construct] Backend change (${fileList}) — no verification done. Consider: bun test, or curl the endpoint.`);
}

// Tier 3: advisory only
if (tier === 3) {
  if (hasE2E || hasFunctionalCheck || hasArtifact) exitWith("pass");
  if (hasUnitTest) {
    exitWith("advisory", `[Construct] UI change (${fileList}) — tests ran but no browser check. If the dev server can't be started, this is fine to skip.`);
  }
  exitWith("advisory", `[Construct] UI change (${fileList}) — no verification done. Check in browser if possible, or run bun test. Fine to skip if dev server unavailable.`);
}

// Tier 4: block if isFULL + zero verification
if (hasE2E && hasArtifact) exitWith("pass");

if (!anyVerification && (isFull || fileCount >= 2)) {
  exitWith("block", JSON.stringify({
    decision: "block",
    reason: `Cross-cutting change (${fileCount} files across ${dirCount} dirs: ${fileList}) with no verification. Start the system, exercise the changed behavior, and capture output before finishing.`,
  }));
}

if (hasE2E && !hasArtifact) {
  exitWith("advisory", `[Construct] Full-scope change verified but no artifact captured. Save evidence: screenshot or tee output to a file.`);
} else if (anyVerification) {
  exitWith("advisory", `[Construct] Cross-cutting change (${fileList}) — partial verification done. Consider a browser check for the UI changes.`);
} else {
  exitWith("advisory", `[Construct] Cross-cutting change (${fileList}) — no verification done. Run the system and check both backend and frontend if possible.`);
}
