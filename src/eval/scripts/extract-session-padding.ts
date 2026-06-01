#!/usr/bin/env bun
/**
 * Extract a text transcript from a Claude Code session JSONL for use as
 * context padding in evals. Flattens messages, summarizes tool calls and
 * hook attachments, truncates to a target size.
 *
 * Usage:
 *   bun extract-session-padding.ts <session.jsonl> [options] > padding.txt
 *
 * Options:
 *   --max-chars N       cap output size (default 600000)
 *   --until <string>    stop at the first user message containing this string
 *
 * The goal is to reproduce the "context pressure" of a real session as
 * faithfully as possible without feeding raw JSON the model never actually
 * sees. Keep text blocks verbatim; summarize tool I/O that eats tokens.
 */
import { readFileSync } from "fs";

function collapse(s: string, max: number): string {
  const clean = s.replace(/\s+/g, " ").trim();
  return clean.length <= max ? clean : clean.slice(0, max - 3) + "...";
}

interface Flattened {
  text: string;
  tools: string[];
}

type ContentBlock = {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
  content?: string | ContentBlock[];
};

function flatten(content: unknown): Flattened {
  if (typeof content === "string") return { text: content, tools: [] };
  if (!Array.isArray(content)) return { text: "", tools: [] };
  const texts: string[] = [];
  const tools: string[] = [];
  for (const block of content as ContentBlock[]) {
    if (block.type === "text") {
      texts.push(block.text ?? "");
    } else if (block.type === "tool_use") {
      const input = collapse(JSON.stringify(block.input ?? {}), 200);
      tools.push(`[TOOL ${block.name}] ${input}`);
    } else if (block.type === "tool_result") {
      const c = typeof block.content === "string"
        ? block.content
        : Array.isArray(block.content)
          ? block.content.map((b) => b.text ?? "").join(" ")
          : JSON.stringify(block.content ?? "");
      tools.push(`[RESULT] ${collapse(c, 4000)}`);
    }
  }
  return { text: texts.join("\n"), tools };
}

function main() {
  const args = process.argv.slice(2);
  const sessionPath = args[0];
  if (!sessionPath || sessionPath.startsWith("--")) {
    console.error("Usage: extract-session-padding.ts <session.jsonl> [--max-chars N] [--until <string>]");
    process.exit(1);
  }

  let maxChars = 600_000;
  let until: string | null = null;
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--max-chars" && args[i + 1]) maxChars = parseInt(args[++i]);
    else if (args[i] === "--until" && args[i + 1]) until = args[++i];
  }

  const raw = readFileSync(sessionPath, "utf8");
  const events = raw.trim().split("\n").map((l: string) => {
    try { return JSON.parse(l); } catch { return null; }
  }).filter(Boolean);

  type SessionEvent = {
    type?: string;
    isMeta?: boolean;
    message?: { content?: unknown };
    attachment?: { content?: unknown; hookName?: string; type?: string };
  };

  const out: string[] = [];
  let stopped = false;
  for (const j of events as SessionEvent[]) {
    const c = j.message?.content;
    if (until && j.type === "user" && !j.isMeta
        && typeof c === "string" && c.includes(until)) {
      stopped = true;
      break;
    }
    if (j.type === "user" && !j.isMeta) {
      const { text, tools } = flatten(c);
      if (tools.length) out.push(...tools);
      if (text.trim()) out.push(`[USER] ${text}`);
    } else if (j.type === "assistant") {
      const { text, tools } = flatten(c);
      if (text.trim()) out.push(`[ASSISTANT] ${text}`);
      if (tools.length) out.push(...tools);
    } else if (j.attachment?.content) {
      const h = j.attachment.hookName ?? j.attachment.type ?? "hook";
      out.push(`[HOOK ${h}] ${collapse(String(j.attachment.content), 300)}`);
    }
  }

  let joined = out.join("\n");
  let truncated = false;
  if (joined.length > maxChars) {
    const head = joined.slice(0, Math.floor(maxChars * 0.6));
    const tail = joined.slice(joined.length - Math.floor(maxChars * 0.4));
    joined = head + "\n\n[...middle truncated...]\n\n" + tail;
    truncated = true;
  }

  process.stdout.write(joined);
  process.stderr.write(
    `\nExtracted ${joined.length} chars from ${events.length} events`
    + (stopped ? ` (stopped at --until match)` : "")
    + (truncated ? `, truncated to ${maxChars} cap` : "")
    + "\n",
  );
}

main();
