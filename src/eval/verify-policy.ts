/**
 * Verification policy — single source of truth for the Stop-hook gate.
 *
 * Two classifications:
 *   - SKIP     : every edited file is docs-only
 *   - REQUIRED : code, config, or any non-doc edit
 *
 * REQUIRED passes if either:
 *   (a) the current turn produced a `[verify-what] …` marker AND a bun-test
 *       passing summary line (`N pass`, no failures), or
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

const VERIFY_WHAT_RE = /\[verify-what]\s*([^\n]+)/i;
// Matches both bun:test's "3 pass" / "0 fail" and the repo harness's
// "30 passed, 0 failed". Trailing -ed is optional.
const PASS_SUMMARY_RE = /\b(\d+)\s+pass(?:ed)?\b/i;
const FAIL_SUMMARY_RE = /\b(\d+)\s+fail(?:ed)?\b/i;

export interface MarkerStatus {
  hasWhat: boolean;
  whatText: string | null;
  passCount: number;
  failCount: number;
}

export function scanMarkers(text: string): MarkerStatus {
  const what = text.match(VERIFY_WHAT_RE);
  const pass = text.match(PASS_SUMMARY_RE);
  const fail = text.match(FAIL_SUMMARY_RE);
  return {
    hasWhat: !!what,
    whatText: what ? what[1].trim() : null,
    passCount: pass ? Number(pass[1]) : 0,
    failCount: fail ? Number(fail[1]) : 0,
  };
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
  "Run a test that exercises this change. Inside the test, declare intent:\n" +
  "  console.log('[verify-what] <what this test exercises>');\n" +
  "then run it (e.g. via bun test). The hook needs both a [verify-what] line and a passing\n" +
  "test summary (e.g. '3 pass, 0 fail') in this turn's tool output.\n" +
  "\n" +
  "If verification is genuinely not appropriate (paid endpoint, non-code change, etc.)," +
  " reply with \"skip verify\" and I will accept it once.";

export function decide(ctx: DecisionContext): Decision {
  const klass = classifyChange(ctx.editedFiles);
  if (klass === "skip") {
    return { kind: "pass", reason: "skip: docs-only or no edits" };
  }

  const markers = scanMarkers(ctx.toolResultText);
  if (markers.hasWhat && markers.passCount > 0 && markers.failCount === 0) {
    return { kind: "pass", reason: `verified: ${markers.whatText}` };
  }

  if (userAffirmedSkip(ctx.mostRecentUserText)) {
    return { kind: "pass", reason: "user-affirmed skip" };
  }

  return { kind: "block", reason: BLOCK_REASON };
}
