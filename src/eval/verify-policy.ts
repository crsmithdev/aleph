/**
 * Verification policy — single source of truth for the Stop-hook gate.
 *
 * Two classifications:
 *   - SKIP     : every edited file is docs-only
 *   - REQUIRED : code, config, or any non-doc edit
 *
 * REQUIRED passes if either:
 *   (a) the current turn's tool output contains a structured `[verify]` block
 *
 *         [verify]
 *         scope:        <specific lines/files touched by the test, full paths>
 *         method:       <what was done — procedure, inputs, outputs>
 *         assertions:   <what state or output was specifically checked>
 *         failure-mode: <if the change were broken, how would this catch it?>
 *         gaps:         <honest limits of this check>
 *         [/verify]
 *
 *       All five keys are required and must be non-empty.
 *   (b) the user explicitly said `skip verify[ication]` in the most recent
 *       user message.
 *
 * Design choice: the gate is shape-only — present + non-empty per field.
 * Quality of the answer (specific scope, sharp failure-mode, real gaps) is
 * a code-review responsibility, not a regex's. Every block decision and the
 * full field values are written to the hook-events JSONL so quality
 * analysis (lazy answers, hallucinated paths, etc.) can run offline against
 * the log instead of via escalating heuristics in the hot path.
 *
 * Anything else blocks. There is no "advisory" outcome — the gate either
 * passes silently or blocks with an actionable reason.
 *
 * Pure functions, no I/O, importable from the hook and from tests.
 */

// ---------------------------------------------------------------------------
// File classification
// ---------------------------------------------------------------------------

/** A path is docs-only iff its filename is markdown/text or it lives under a
 *  top-level `docs/` directory. SKILL.md, CLAUDE.md, README.md, INSTALL.md,
 *  SPEC.md all count. Settings/config JSON deliberately does NOT count —
 *  those ship behavior. */
export function isDocOnly(filePath: string): boolean {
  const name = filePath.split("/").pop() ?? "";
  if (/\.(md|markdown|txt|rst)$/i.test(name)) return true;
  if (/(^|\/)docs\//.test(filePath)) return true;
  return false;
}

export type ChangeClass = "skip" | "required";

export function classifyChange(editedFiles: string[]): ChangeClass {
  const unique = [...new Set(editedFiles)];
  if (unique.length === 0) return "skip";
  return unique.every(isDocOnly) ? "skip" : "required";
}

// ---------------------------------------------------------------------------
// Verify-block scanning
// ---------------------------------------------------------------------------

const VERIFY_BLOCK_RE = /\[verify]\s*\n([\s\S]*?)\n\s*\[\/verify]/i;
const KV_RE = /^\s*([a-z][-a-z]*)\s*:\s*(.+?)\s*$/i;

/** Required keys — every one must be present and non-empty. */
export const REQUIRED_KEYS = ["scope", "method", "assertions", "failure-mode", "gaps"] as const;
/** Recognised keys (required + any future optional). The hook records every
 *  key in REQUIRED_KEYS to telemetry so quality analysis (lazy answers,
 *  short failure-modes, etc.) can run offline against the JSONL log. */
export const RECOGNISED_KEYS = REQUIRED_KEYS;

export interface VerifyBlock {
  /** Lowercased key → trimmed value. */
  fields: Record<string, string>;
}

export function scanVerifyBlock(text: string): VerifyBlock | null {
  const m = text.match(VERIFY_BLOCK_RE);
  if (!m) return null;
  const fields: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(KV_RE);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    const value = kv[2].trim();
    if (value) fields[key] = value;
  }
  return { fields };
}

export function missingRequiredFields(block: VerifyBlock | null): string[] {
  if (!block) return REQUIRED_KEYS.slice();
  return REQUIRED_KEYS.filter(k => !block.fields[k]);
}

// ---------------------------------------------------------------------------
// User-affirmation detection
// ---------------------------------------------------------------------------

const SKIP_AFFIRMATION_RE = /\bskip\s+verif(?:y|ication)\b/i;

export function userAffirmedSkip(mostRecentUserText: string): boolean {
  return SKIP_AFFIRMATION_RE.test(mostRecentUserText);
}

// ---------------------------------------------------------------------------
// Transcript helpers
// ---------------------------------------------------------------------------

interface TranscriptEntry {
  type?: string;
  message?: { content?: unknown };
}

function parseLine(line: string): TranscriptEntry | null {
  try { return JSON.parse(line) as TranscriptEntry; } catch { return null; }
}

/** Index of the most recent user message containing real text (i.e. the
 *  start of the current turn — tool_result-only user messages are skipped). */
export function turnStartIndex(transcriptLines: string[]): number {
  for (let i = transcriptLines.length - 1; i >= 0; i--) {
    const e = parseLine(transcriptLines[i]);
    if (!e || e.type !== "user") continue;
    const content = e.message?.content;
    if (!Array.isArray(content)) continue;
    if (content.some((b: any) => b.type === "text" && typeof b.text === "string" && b.text.trim())) {
      return i;
    }
  }
  return 0;
}

/** Concatenated text of the most recent user-text message. */
export function mostRecentUserText(transcriptLines: string[]): string {
  const idx = turnStartIndex(transcriptLines);
  const e = parseLine(transcriptLines[idx]);
  if (!e || !Array.isArray(e.message?.content)) return "";
  return (e.message!.content as any[])
    .filter(b => b.type === "text" && typeof b.text === "string")
    .map(b => b.text as string)
    .join("\n");
}

export interface TurnArtifacts {
  editedFiles: string[];
  /** Concatenated stdout/stderr text from every Bash tool_result block in the turn. */
  toolResultText: string;
}

export function extractTurn(transcriptLines: string[], turnStart: number): TurnArtifacts {
  const editedFiles: string[] = [];
  const outputs: string[] = [];

  for (let i = turnStart; i < transcriptLines.length; i++) {
    const e = parseLine(transcriptLines[i]);
    if (!e) continue;

    if (e.type === "assistant") {
      const content = e.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content as any[]) {
        if (b.type !== "tool_use") continue;
        if (b.name === "Edit" || b.name === "Write" || b.name === "NotebookEdit") {
          const fp = b.input?.file_path;
          if (typeof fp === "string" && fp) editedFiles.push(fp);
        }
      }
    } else if (e.type === "user") {
      const content = e.message?.content;
      if (!Array.isArray(content)) continue;
      for (const b of content as any[]) {
        if (b.type !== "tool_result") continue;
        const c = b.content;
        if (typeof c === "string") outputs.push(c);
        else if (Array.isArray(c)) {
          for (const item of c) {
            if (item?.type === "text" && typeof item.text === "string") outputs.push(item.text);
          }
        }
      }
    }
  }

  return { editedFiles, toolResultText: outputs.join("\n") };
}

// ---------------------------------------------------------------------------
// Decision
// ---------------------------------------------------------------------------

export type Decision =
  | { kind: "pass"; reason: string }
  | { kind: "block"; reason: string };

export interface DecisionContext {
  editedFiles: string[];
  toolResultText: string;
  mostRecentUserText: string;
}

const BLOCK_REASON =
  "Code change with no verification trace.\n" +
  "Run something that exercises this change, then emit a [verify] block:\n" +
  "\n" +
  "  [verify]\n" +
  "  scope: src/ui/web/src/routes-meta.ts:30-44, src/ui/e2e/ui-smoke.test.ts:140-152\n" +
  "  method: playwright navigates to /research/__smoke_none__ in headless chromium, waits 15s for [data-testid=\"page-research-detail\"] on <main>, then for [data-testid=\"error-state\"]; collects all /api/* responses and console errors during initial mount\n" +
  "  assertions: <main data-testid=\"page-research-detail\"> renders within 15s; [data-testid=\"error-state\"] becomes visible; no /api/ 4xx/5xx outside the allowedApi404 list; no uncaught pageerror; no non-ignored console.error\n" +
  "  failure-mode: if Layout's matchPath sort regressed, no per-page testid renders → first selector times out at 15s; if ErrorState dropped its testid, the second selector times out; if the allowedApi404 list missed a URL, that 404 appears in the apiFailures list and the route fails\n" +
  "  gaps: only exercises the bogus-id 404 path on /research/:id, not the populated/data-loaded path; ToolDetailPage's /observability/tools/:name returns 200-with-empty-data so this also doesn't cover the API's true 404 contract for tool detail\n" +
  "  [/verify]\n" +
  "\n" +
  "All five keys are required and must be non-empty. The gate is shape-only —\n" +
  "humans (and code review) judge whether your answers are honest and specific.\n" +
  "Especially `failure-mode`: if you can't articulate which assertion would\n" +
  "catch a broken change, the test isn't really verifying it.\n" +
  "\n" +
  "If verification is genuinely not appropriate (paid endpoint, non-code change, etc.)," +
  " reply with \"skip verify\" and I will accept it once.";

export function decide(ctx: DecisionContext): Decision {
  const klass = classifyChange(ctx.editedFiles);
  if (klass === "skip") {
    return { kind: "pass", reason: "skip: docs-only or no edits" };
  }

  const block = scanVerifyBlock(ctx.toolResultText);
  const missing = missingRequiredFields(block);
  if (missing.length === 0) {
    return { kind: "pass", reason: `verified: ${block!.fields.method}` };
  }

  if (userAffirmedSkip(ctx.mostRecentUserText)) {
    return { kind: "pass", reason: "user-affirmed skip" };
  }

  const detail = block === null
    ? "no [verify] block found"
    : `[verify] block missing required keys: ${missing.join(", ")}`;
  return { kind: "block", reason: `${BLOCK_REASON}\n\nDetected: ${detail}.` };
}
