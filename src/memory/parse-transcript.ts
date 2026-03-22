/**
 * Parse a Claude Code session transcript JSONL file into a normalized message list.
 * Transcript lines have `type` (user|assistant|system|progress|file-history-snapshot)
 * and `message.content[]` blocks with tool_use/tool_result/text items.
 */

import { readFileSync, existsSync } from "fs";

export interface ParsedMessage {
  role: "user" | "assistant";
  text: string;           // concatenated text blocks (truncated)
  toolUses: string[];     // tool names used (assistant only)
  toolInputs: Record<string, any>[]; // tool inputs (assistant only)
}

export interface TranscriptSummary {
  messages: ParsedMessage[];
  toolCounts: Record<string, number>;
  editedFiles: Set<string>;
  firstUserText: string;
  userTexts: string[];
  assistantTexts: string[];
  totalMessages: number;
}

export interface ParseOptions {
  textLimit?: number;  // max chars per text block (default 300)
}

export function parseTranscript(transcriptPath: string, opts?: ParseOptions): TranscriptSummary | null {
  if (!transcriptPath || !existsSync(transcriptPath)) return null;
  const limit = opts?.textLimit ?? 300;

  const lines = readFileSync(transcriptPath, "utf8").trim().split("\n");
  const messages: ParsedMessage[] = [];
  const toolCounts: Record<string, number> = {};
  const editedFiles = new Set<string>();
  let firstUserText = "";
  const userTexts: string[] = [];
  const assistantTexts: string[] = [];

  for (const line of lines) {
    let parsed: any;
    try { parsed = JSON.parse(line); } catch { continue; }

    const type = parsed.type;
    if (type !== "user" && type !== "assistant") continue;

    const content: any[] = parsed.message?.content ?? [];
    const texts: string[] = [];
    const toolUses: string[] = [];
    const toolInputs: Record<string, any>[] = [];

    for (const block of content) {
      if (block.type === "text" && typeof block.text === "string") {
        texts.push(block.text.slice(0, limit));
      }
      if (block.type === "tool_use") {
        const name = block.name ?? "";
        toolUses.push(name);
        toolInputs.push(block.input ?? {});
        toolCounts[name] = (toolCounts[name] ?? 0) + 1;
        const fp = block.input?.file_path ?? block.input?.path;
        if (fp && (name === "Edit" || name === "Write")) {
          editedFiles.add(fp.split("/").slice(-2).join("/"));
        }
      }
    }

    const text = texts.join(" ").replace(/\n/g, " ").trim().slice(0, limit);
    const msg: ParsedMessage = { role: type as "user" | "assistant", text, toolUses, toolInputs };
    messages.push(msg);

    if (type === "user" && text.length > 10) {
      if (!firstUserText) firstUserText = text;
      userTexts.push(text);
    }
    if (type === "assistant" && text.length > 20) {
      assistantTexts.push(text);
    }
  }

  return {
    messages,
    toolCounts,
    editedFiles,
    firstUserText,
    userTexts,
    assistantTexts,
    totalMessages: messages.length,
  };
}
