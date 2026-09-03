/**
 * What one prompt's turn did, read from the transcript: edits, commands and
 * their output, other tool calls, the last user text, the final message.
 */
import { readFileSync } from "node:fs";

type Entry = Record<string, any>;

export interface Digest {
  prompt: string;
  edits: string[];
  items: string[];
  finalMessage: string;
  toolCalls: number;
  text: string;
}

const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit", "NotebookEdit"]);
const TAIL = 500;

function tail(value: unknown, max = TAIL): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return text.length <= max ? text : `…${text.slice(-max)}`;
}

function head(value: unknown, max = 200): string {
  const text = typeof value === "string" ? value : JSON.stringify(value) ?? "";
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}

function resultText(entry: Entry): string {
  const tur = entry.toolUseResult;
  if (tur && typeof tur === "object" && !Array.isArray(tur) && ("stdout" in tur || "stderr" in tur)) {
    return [tur.stdout, tur.stderr ? `stderr: ${tur.stderr}` : ""].filter(Boolean).join("\n");
  }
  const block = Array.isArray(entry.message?.content) ? entry.message.content.find((c: Entry) => c.type === "tool_result") : null;
  const content = block?.content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) return content.map((c: Entry) => c.text ?? "").join("\n");
  return "";
}

/**
 * Only user entries carry promptId; assistant entries do not. A prompt's turn
 * is the user entry with that id and everything after it until a user entry
 * with a different id.
 */
export function readEntries(transcriptPath: string, promptId: string): Entry[] {
  let raw: string;
  try { raw = readFileSync(transcriptPath, "utf8"); } catch { return []; }
  const entries: Entry[] = [];
  for (const line of raw.split("\n")) {
    if (!line) continue;
    try { entries.push(JSON.parse(line)); } catch { /* partial last line */ }
  }
  const turn: Entry[] = [];
  let inside = false;
  for (const e of entries) {
    if (e.isSidechain || (e.type !== "user" && e.type !== "assistant")) continue;
    if (e.promptId !== undefined) inside = e.promptId === promptId;
    if (inside) turn.push(e);
  }
  return turn;
}

export function digest(transcriptPath: string, promptId: string, fallbackFinal = "", maxChars = 12_000): Digest {
  const entries = readEntries(transcriptPath, promptId);
  const results = new Map<string, Entry>();
  for (const e of entries) {
    if (e.type !== "user" || !Array.isArray(e.message?.content)) continue;
    for (const block of e.message.content) if (block.type === "tool_result") results.set(block.tool_use_id, e);
  }

  let prompt = "";
  const edits: string[] = [];
  const items: string[] = [];
  let finalMessage = "";
  let toolCalls = 0;

  for (const e of entries) {
    const content = e.message?.content;
    if (e.type === "user") {
      if (e.isMeta) continue;
      if (typeof content === "string") prompt = content;
      else if (Array.isArray(content)) {
        const text = content.filter((c: Entry) => c.type === "text").map((c: Entry) => c.text).join("\n");
        if (text) prompt = text;
      }
      continue;
    }
    if (!Array.isArray(content)) continue;
    const texts: string[] = [];
    for (const block of content) {
      if (block.type === "text" && block.text) texts.push(block.text);
      if (block.type !== "tool_use") continue;
      toolCalls++;
      const name: string = block.name ?? "tool";
      const inp = block.input ?? {};
      const out = results.get(block.id);
      if (EDIT_TOOLS.has(name)) {
        edits.push(inp.file_path ?? "?");
        items.push(`EDIT ${name} ${inp.file_path ?? "?"}`);
      } else if (name === "Bash") {
        items.push(`RUN ${head(inp.command, 400)}\n  → ${out ? tail(resultText(out)) : "(no result)"}`);
      } else {
        items.push(`CALL ${name} ${head(inp)}${out ? `\n  → ${tail(resultText(out), 200)}` : ""}`);
      }
    }
    if (texts.length) finalMessage = texts.join("\n");
  }
  if (!finalMessage) finalMessage = fallbackFinal;

  let body = items.join("\n");
  if (body.length > maxChars) body = `…(${items.length} items, earliest trimmed)\n${body.slice(-maxChars)}`;
  const text = [
    `USER PROMPT:\n${head(prompt, 600)}`,
    `TURN (in order):\n${body || "(no tool calls)"}`,
    `FINAL MESSAGE:\n${finalMessage}`,
  ].join("\n\n");
  return { prompt, edits, items, finalMessage, toolCalls, text };
}

export function userGrantedSkip(prompt: string): boolean {
  return /\bskip\s+verif(y|ication)\b/i.test(prompt);
}
