#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";

const root = resolve(dirname(Bun.main), "../..");
const sessionsDir = resolve(root, "memory/sessions");
mkdirSync(sessionsDir, { recursive: true });

const input = JSON.parse(await Bun.stdin.text());
const messages = input.messages ?? [];
trace("session-summary", `messages: ${messages.length}`);
if (messages.length < 4) {
  trace("session-summary", "skip: < 4 messages");
  process.exit(0);
}

// Extract signal from messages: tool calls, file paths, key phrases
const toolUses = new Set<string>();
const filesModified = new Set<string>();
const topics: string[] = [];

for (const msg of messages) {
  // Collect tool names
  if (msg.tool_name) toolUses.add(msg.tool_name);
  // Collect file paths from tool inputs
  const fp = msg.tool_input?.file_path ?? msg.tool_input?.path;
  if (fp) filesModified.add(fp.split("/").slice(-2).join("/"));
  // Collect user messages as topic signals
  if (msg.role === "user" && typeof msg.content === "string" && msg.content.length > 10) {
    topics.push(msg.content.slice(0, 120));
  }
}

const now = new Date();
const date = now.toISOString().slice(0, 10);
const time = now.toISOString().slice(11, 19).replace(/:/g, "");
const file = resolve(sessionsDir, `${date}-${time}.md`);

const tools = [...toolUses].slice(0, 5).join(", ") || "none";
const files = [...filesModified].slice(0, 8).join(", ") || "none";
const topicSummary = topics.slice(0, 3).map((t) => t.replace(/\n/g, " ").trim()).join("; ") || "none";

trace("session-summary", `tools: ${tools}`);
trace("session-summary", `files: ${files}`);
trace("session-summary", `topics: ${topicSummary}`);

const content = `# Session: ${date}

- Tools: ${tools}; files: ${files}
- Topics: ${topicSummary}
- Messages: ${messages.length}
`;

writeFileSync(file, content);
trace("session-summary", `wrote ${file}`);
