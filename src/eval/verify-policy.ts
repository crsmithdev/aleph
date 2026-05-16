/**
 * Verification policy — single source of truth for the Stop-hook gate.
 *
 * Two classifications:
 *   - SKIP     : every edited file is docs-only
 *   - REQUIRED : code, config, or any non-doc edit
 *
 * REQUIRED passes if either:
 *   (a) the current turn's tool output contains a `[verify]` block with the
 *       three required keys (`scope`, `method`, `assertions`) non-empty.
 *       `failure-mode` and `gaps` are recognised and recorded to telemetry
 *       when present, but no longer required.
 *   (b) the user explicitly said `skip verify[ication]` in the most recent
 *       user message.
 *
 * The gate is shape-only — present + non-empty per required field. Field
 * values are logged to hook-events JSONL for offline quality analysis.
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
export const REQUIRED_KEYS = ["scope", "method", "assertions"] as const;
/** Recognised keys (required + optional). The hook records every recognised
 *  key to telemetry so offline analysis can audit the optional fields when
 *  the LM volunteers them. */
export const RECOGNISED_KEYS = ["scope", "method", "assertions", "failure-mode", "gaps"] as const;

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
  "Code change with no [verify] block. Verify the actual output of this change — do not describe what you expect, confirm what you observe. Then emit:\n" +
  "\n" +
  "  [verify]\n" +
  "  scope:      <what was exercised>\n" +
  "  method:     <how you verified>\n" +
  "  assertions: <what you confirmed>\n" +
  "  [/verify]\n" +
  "\n" +
  "All three keys required and non-empty. The method is yours to choose: navigate the UI, exercise the hook, run the tests — whatever produces observable evidence. Reply \"skip verify\" to bypass once.";

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
