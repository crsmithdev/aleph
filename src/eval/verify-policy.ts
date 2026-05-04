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
 *   (b) the user explicitly said `skip verify[ication]` in the most recent
 *       user message.
 *
 * The hook deliberately does NOT scan tool output for "N pass / M fail" or
 * any other test-runner shape. Pattern-matching can't tell whether a test
 * actually ran or actually exercised the change — only whether the text
 * looks like a test summary. The three markers are the audit trail: the
 * agent commits to *what it tested*, *how*, and *what passing proves*. If
 * the agent fabricates them, that's lying, and no regex can catch lying.
 * Code review is the only real defense against that, and it always was.
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

export interface MarkerStatus {
  /** Each verify-* marker is required; null means "not present in output". */
  type: string | null;
  surface: string | null;
  behavior: string | null;
}

export function scanMarkers(text: string): MarkerStatus {
  const t = text.match(VERIFY_TYPE_RE);
  const s = text.match(VERIFY_SURFACE_RE);
  const b = text.match(VERIFY_BEHAVIOR_RE);
  return {
    type:     t ? t[1].trim() : null,
    surface:  s ? s[1].trim() : null,
    behavior: b ? b[1].trim() : null,
  };
}

export function hasAllVerifyMarkers(m: MarkerStatus): boolean {
  return !!(m.type && m.surface && m.behavior);
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
  "Run something that exercises this change. In its output, declare three things:\n" +
  "  console.log('[verify-type] <what test or command was run, e.g. \"bun run ui:smoke\">');\n" +
  "  console.log('[verify-surface] <what was exercised, e.g. \"24 routes via routes-meta\">');\n" +
  "  console.log('[verify-behavior] <what passing proves, e.g. \"each page mounts with its own testid\">');\n" +
  "All three are required. They become the audit trail; reviewers judge whether\n" +
  "the test was about the right thing.\n" +
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
  if (hasAllVerifyMarkers(markers)) {
    return { kind: "pass", reason: `verified: ${markers.behavior}` };
  }

  if (userAffirmedSkip(ctx.mostRecentUserText)) {
    return { kind: "pass", reason: "user-affirmed skip" };
  }

  // Tailor the reason if the user *tried* to verify but missed a piece.
  const missing = missingMarkerList(markers);
  const reason = (missing.length > 0 && missing.length < 3)
    ? `${BLOCK_REASON}\n\nDetected: missing markers: ${missing.join(", ")}.`
    : BLOCK_REASON;

  return { kind: "block", reason };
}
