/**
 * Memory extraction heuristics — pure functions, no side effects.
 * Used by memory-extract.ts hook and tests.
 */
import type { TranscriptSummary } from "./parse-transcript.ts";

export interface ExtractedMemory {
  content: string;
  tags: string;
  memory_type: string;
  // provenance fields
  source?: string;   // trigger text (the correction, the "great", the file+count)
  insight?: string;  // human-readable label for what was extracted
  session_id?: string; // session this came from
  memory_type_detail?: 'correction' | 'validated' | 'friction' | 'session' | 'error';
}

export const CORRECTION_RE = /^(no[,.\s]|don'?t\b|stop\b|not that\b|instead\b|actually[,\s]|wait[,\s]|undo\b|revert\b|wrong\b)/i;

// Positive feedback at start of prompt. Two tiers to manage false-positive risk:
//   tier 1 — high-confidence words that can lead a longer message ("great, now do X")
//   tier 2 — short words that only count when they are the entire prompt ("yes")
export const POSITIVE_FEEDBACK_RE =
  /^(great|perfect|exactly|excellent|awesome|brilliant|nice work|love it|looks good|that'?s (?:right|it|perfect|exactly|great)|works (?:great|perfectly|well)|thanks(?:[,!.\s]|$))\b/i;
export const POSITIVE_STANDALONE_RE = /^(yes|yep|good|nice|cool|sweet|ok|okay|works|thanks)[!.]?$/i;

export function deriveIntentOutcome(t: TranscriptSummary): { intent: string; outcome: string } {
  const intent = t.firstUserText || "unknown task";
  const outcome = t.userTexts.length > 1 ? t.userTexts[t.userTexts.length - 1] : intent;
  return { intent, outcome };
}

export function hasMemoryStore(t: TranscriptSummary): boolean {
  for (const msg of t.messages) {
    if (msg.role !== "assistant") continue;
    for (const tool of msg.toolUses) {
      if (tool.includes("memory_store")) return true;
    }
  }
  return false;
}

export function extractMemories(t: TranscriptSummary): ExtractedMemory[] {
  const result: ExtractedMemory[] = [];
  const summary = buildSessionSummary(t);
  if (summary) result.push(summary);
  result.push(...extractCorrections(t));
  result.push(...extractErrorResolutions(t));
  return result;
}

function buildSessionSummary(t: TranscriptSummary): ExtractedMemory | null {
  const { intent, outcome } = deriveIntentOutcome(t);
  const files = [...t.editedFiles].slice(0, 5).join(", ");
  const fileStr = files ? ` Files: ${files}.` : "";

  const content = `Session: ${intent.slice(0, 150)} → ${outcome.slice(0, 150)}.${fileStr}`;
  if (content.length < 30) return null;

  return {
    content,
    tags: "session_context,auto_extract",
    memory_type: "observation",
    source: intent.slice(0, 200),
    insight: "Session summary",
    memory_type_detail: 'session',
  };
}

function extractCorrections(t: TranscriptSummary): ExtractedMemory[] {
  const results: ExtractedMemory[] = [];
  for (let i = 0; i < t.messages.length; i++) {
    const msg = t.messages[i];
    if (msg.role !== "user" || !msg.text || msg.text.length < 5) continue;
    if (!CORRECTION_RE.test(msg.text)) continue;

    const prev = i > 0 ? t.messages[i - 1] : null;
    const context = prev?.role === "assistant" && prev.text ? prev.text.slice(0, 100) : "";
    const contextStr = context ? ` (after: ${context})` : "";

    const content = `User correction: ${msg.text.slice(0, 250)}${contextStr}`;
    results.push({
      content,
      tags: "preference,auto_extract",
      memory_type: "observation",
      source: msg.text.slice(0, 200),
      insight: "User correction",
      memory_type_detail: 'correction',
    });
  }
  return results.slice(0, 3);
}

/**
 * Pure augmentation pass: turn raw signal files into memories.
 * Inputs are JSONL text contents — caller does the I/O.
 */
export function augmentWithSignals(
  base: ExtractedMemory[],
  toolSignalsText: string,
  feedbackText: string,
  sessionId: string,
): ExtractedMemory[] {
  const out = [...base];

  interface Fb { polarity: "positive" | "negative"; trigger: string; prompt: string; prior_text?: string; prior_tools?: string[]; prior_files?: string[]; }
  const sessFb: Fb[] = [];
  for (const line of feedbackText.trim().split("\n")) {
    if (!line) continue;
    try {
      const sig = JSON.parse(line);
      if (sig.session_id === sessionId) sessFb.push(sig);
    } catch { /* skip */ }
  }

  // Re-edit signals — correlate with negative feedback on the same file
  for (const line of toolSignalsText.trim().split("\n")) {
    if (!line) continue;
    let sig: any;
    try { sig = JSON.parse(line); } catch { continue; }
    if (sig.sessionId !== sessionId || sig.type !== "re-edit") continue;
    const matched = sessFb.find(fb =>
      fb.polarity === "negative" &&
      Array.isArray(fb.prior_files) &&
      fb.prior_files.some(f => f === sig.file || f.endsWith(sig.file) || sig.file.endsWith(f))
    );
    if (matched) {
      const reaction = (matched.prior_text ?? "").slice(0, 100);
      out.push({
        content: `Approach friction on ${sig.file}: ${sig.count}+ edits, user pushed back "${matched.prompt.slice(0, 100)}"${reaction ? ` reacting to: ${reaction}` : ""}`,
        tags: "preference,auto_extract,approach_friction",
        memory_type: "observation",
        source: `Re-edit × ${sig.count} on ${sig.file}`,
        insight: "Approach friction",
        memory_type_detail: 'friction',
      });
    } else {
      out.push({
        content: `Re-edit observation: ${sig.file} edited ${sig.count}+ times this session.`,
        tags: "preference,auto_extract",
        memory_type: "observation",
        source: `Re-edit × ${sig.count} on ${sig.file}`,
        insight: "Approach friction",
        memory_type_detail: 'friction',
      });
    }
  }

  // Positive feedback → validated-approach memories (capped at 3)
  let added = 0;
  for (const sig of sessFb) {
    if (sig.polarity !== "positive") continue;
    if (!sig.prior_tools?.length && !sig.prior_text) continue;
    const what = sig.prior_tools?.length ? sig.prior_tools.join("+") : "approach";
    const where = sig.prior_files?.length ? ` on ${sig.prior_files.join(", ")}` : "";
    const why = sig.prior_text ? `: ${String(sig.prior_text).slice(0, 150)}` : "";
    out.push({
      content: `Validated approach (user said "${sig.trigger}"): ${what}${where}${why}`,
      tags: "preference,auto_extract,validated",
      memory_type: "observation",
      source: `User said "${sig.trigger}"`,
      insight: "Validated approach",
      memory_type_detail: 'validated',
    });
    if (++added >= 3) break;
  }

  return out;
}

function extractErrorResolutions(t: TranscriptSummary): ExtractedMemory[] {
  const results: ExtractedMemory[] = [];

  for (let i = 0; i < t.messages.length - 2; i++) {
    const errorMsg = t.messages[i];
    if (errorMsg.role !== "user") continue;

    const fixMsg = t.messages[i + 1];
    if (!fixMsg || fixMsg.role !== "assistant") continue;

    const hasFix = fixMsg.toolUses.some(tool => tool === "Edit" || tool === "Write" || tool === "Bash");
    if (!hasFix) continue;

    const looksLikeError = errorMsg.text.length > 10 &&
      /\b(error|Error|ERROR|failed|Failed|FAILED|exception|not found|cannot|couldn't|unable)\b/.test(errorMsg.text);
    if (!looksLikeError) continue;

    const confirmMsg = t.messages[i + 2];
    if (confirmMsg && confirmMsg.role === "user" && CORRECTION_RE.test(confirmMsg.text)) continue;

    const errorExcerpt = errorMsg.text.slice(0, 150);
    const fixFiles = fixMsg.toolUses
      .map((tool, idx) => {
        const fp = fixMsg.toolInputs[idx]?.file_path;
        return fp ? `${tool}(${fp.split("/").pop()})` : null;
      })
      .filter(Boolean)
      .slice(0, 3)
      .join(", ");
    const fixExcerpt = fixMsg.text.slice(0, 150);

    const content = `Error: ${errorExcerpt}. Fixed by: ${fixFiles || fixExcerpt}`;
    results.push({
      content,
      tags: "error_resolution,auto_extract",
      memory_type: "error",
      source: "Error detected",
      insight: "Error resolution",
      memory_type_detail: 'error',
    });
  }

  return results.slice(0, 3);
}
