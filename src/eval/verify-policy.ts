/**
 * Verification policy — single source of truth for the Stop-hook gate.
 *
 * Two classifications:
 *   - SKIP     : every edited file is docs-only
 *   - REQUIRED : code, config, or any non-doc edit
 *
 * REQUIRED passes if either:
 *   (a) the current turn's tool output contains all three structured markers
 *
 *         [verify-type]     <command/test that ran>
 *         [verify-surface]  <what was exercised: UI button, API endpoint, hook stdin, etc.>
 *         [verify-behavior] <what passing proves about the change>
 *
 *       AND a passing summary — either a numbered "N pass(ed)" with zero
 *       failures, or a generic "all <tests|routes|checks|...> pass(ed)"
 *       phrase (no count needed); OR
 *   (b) the user explicitly said `skip verify[ication]` in the most recent
 *       user message.
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
// Marker scanning
// ---------------------------------------------------------------------------

const VERIFY_TYPE_RE     = /\[verify-type]\s*([^\n]+)/i;
const VERIFY_SURFACE_RE  = /\[verify-surface]\s*([^\n]+)/i;
const VERIFY_BEHAVIOR_RE = /\[verify-behavior]\s*([^\n]+)/i;

// Numbered formats — bun:test's "3 pass" / "0 fail" and the repo harness's
// "30 passed, 0 failed". Trailing -ed is optional.
const PASS_COUNT_RE = /\b(\d+)\s+pass(?:ed)?\b/i;
const FAIL_COUNT_RE = /\b(\d+)\s+fail(?:ed|ures?)?\b/i;
// Generic "all <test-noun> pass(ed)" — for runners whose summary line does
// not include a count. Requires a test-noun (`tests/smoke/routes/checks/
// specs/cases`) between "all" and "pass" to avoid matching prose like
// "I would all but pass on this".
const ALL_PASS_RE = /\ball\b[^\n]{0,30}?\b(?:tests?|smoke|routes?|checks?|specs?|cases?)\b[^\n]{0,30}?\bpass(?:ed)?\b/i;

export interface MarkerStatus {
  /** Each verify-* marker is required; null means "not present in output". */
  type: string | null;
  surface: string | null;
  behavior: string | null;
  /** From numbered "N pass(ed)" summaries. 0 if absent. */
  passCount: number;
  /** From numbered "N fail(ed|ures)" summaries. 0 if absent or zero. */
  failCount: number;
  /** True if the output contained a generic "all <tests|...> pass(ed)" phrase. */
  hasAllPass: boolean;
}

export function scanMarkers(text: string): MarkerStatus {
  const t = text.match(VERIFY_TYPE_RE);
  const s = text.match(VERIFY_SURFACE_RE);
  const b = text.match(VERIFY_BEHAVIOR_RE);
  const p = text.match(PASS_COUNT_RE);
  const f = text.match(FAIL_COUNT_RE);
  return {
    type:     t ? t[1].trim() : null,
    surface:  s ? s[1].trim() : null,
    behavior: b ? b[1].trim() : null,
    passCount: p ? Number(p[1]) : 0,
    failCount: f ? Number(f[1]) : 0,
    hasAllPass: ALL_PASS_RE.test(text),
  };
}

export function hasAllVerifyMarkers(m: MarkerStatus): boolean {
  return !!(m.type && m.surface && m.behavior);
}

export function hasPassEvidence(m: MarkerStatus): boolean {
  return m.failCount === 0 && (m.passCount > 0 || m.hasAllPass);
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
  "Run a test that exercises this change. In its output, declare three things:\n" +
  "  console.log('[verify-type] <what test or command was run, e.g. \"bun run ui:smoke\">');\n" +
  "  console.log('[verify-surface] <what was exercised, e.g. \"24 routes via routes-meta\">');\n" +
  "  console.log('[verify-behavior] <what passing proves, e.g. \"each page mounts with its own testid\">');\n" +
  "Then run it. The hook also needs a passing test summary in the same turn —\n" +
  "a numbered line (e.g. '3 pass, 0 fail' or '24 passed, 0 failed') OR a generic\n" +
  "phrase like 'all 24 smoke routes passed' (no count required).\n" +
  "\n" +
  "If verification is genuinely not appropriate (paid endpoint, non-code change, etc.)," +
  " reply with \"skip verify\" and I will accept it once.";

function missingMarkerList(m: MarkerStatus): string[] {
  const missing: string[] = [];
  if (!m.type) missing.push("[verify-type]");
  if (!m.surface) missing.push("[verify-surface]");
  if (!m.behavior) missing.push("[verify-behavior]");
  return missing;
}

export function decide(ctx: DecisionContext): Decision {
  const klass = classifyChange(ctx.editedFiles);
  if (klass === "skip") {
    return { kind: "pass", reason: "skip: docs-only or no edits" };
  }

  const markers = scanMarkers(ctx.toolResultText);
  if (hasAllVerifyMarkers(markers) && hasPassEvidence(markers)) {
    return { kind: "pass", reason: `verified: ${markers.behavior}` };
  }

  if (userAffirmedSkip(ctx.mostRecentUserText)) {
    return { kind: "pass", reason: "user-affirmed skip" };
  }

  // Tailor the reason if the user *tried* to verify but missed a piece —
  // surface exactly which marker(s) are missing or whether tests failed.
  const partial: string[] = [];
  const missing = missingMarkerList(markers);
  if (missing.length > 0 && missing.length < 3) partial.push(`missing markers: ${missing.join(", ")}`);
  if (markers.failCount > 0) partial.push(`${markers.failCount} test failure(s) in output`);
  if (hasAllVerifyMarkers(markers) && !hasPassEvidence(markers)) {
    partial.push("no passing test summary detected");
  }
  const reason = partial.length ? `${BLOCK_REASON}\n\nDetected: ${partial.join("; ")}.` : BLOCK_REASON;

  return { kind: "block", reason };
}
