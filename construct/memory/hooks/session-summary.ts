#!/usr/bin/env bun
import { mkdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";
import { parseTranscript } from "../parse-transcript.ts";

const root = resolve(dirname(Bun.main), "../..");
const sessionsDir = resolve(root, "memory/sessions");
mkdirSync(sessionsDir, { recursive: true });

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch { process.exit(1); }
const transcript = parseTranscript(input.transcript_path);

if (!transcript || transcript.totalMessages < 4) {
  trace("session-summary", `skip: ${transcript ? transcript.totalMessages : 0} messages`);
  process.exit(0);
}

trace("session-summary", `messages: ${transcript.totalMessages}`);

const { toolCounts, editedFiles, firstUserText, userTexts, assistantTexts } = transcript;

const editCount = (toolCounts["Edit"] ?? 0) + (toolCounts["Write"] ?? 0);
const toolStr = Object.keys(toolCounts).slice(0, 8).join(", ") || "none";
const fileStr = [...editedFiles].slice(0, 12).join(", ") || "none";
const users = transcript.messages.filter(m => m.role === "user").length;
const assistants = transcript.messages.filter(m => m.role === "assistant").length;

const intent = firstUserText || "none";
const outcome = userTexts.length > 1 ? userTexts[userTexts.length - 1] : intent;
const intermediateMilestones = userTexts.slice(1, -1);
const milestonesStr = intermediateMilestones.slice(0, 4).map(l => `  - ${l}`).join("\n");
const notesStr = assistantTexts.slice(0, 5).map(l => `  - ${l}`).join("\n");

trace("session-summary", `intent: ${intent.slice(0, 80)}`);
trace("session-summary", `tools: ${toolStr}, files: ${fileStr}, edits: ${editCount}`);

const now = new Date();
const date = now.toISOString().slice(0, 10);
const time = now.toISOString().slice(11, 19).replace(/:/g, "");
const file = resolve(sessionsDir, `${date}-${time}.md`);

const content = `# Session: ${date}

- Intent: ${intent}
- Outcome: ${outcome}
${milestonesStr ? `- Milestones:\n${milestonesStr}\n` : ""}- Tools: ${toolStr}; files: ${fileStr}
- Edits: ${editCount} tool calls, ${editedFiles.size} files
- Messages: ${transcript.totalMessages} (${users} user, ${assistants} assistant)
${notesStr ? `- Notes:\n${notesStr}\n` : ""}`;

writeFileSync(file, content);
trace("session-summary", `wrote ${file}`);
