#!/usr/bin/env bun
import { writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";
import { dataPaths, ensureDataDirs } from "../../paths.ts";
import { parseTranscript } from "../parse-transcript.ts";

const TAG = "session-summary";
const root = resolve(dirname(Bun.main), "../..");
const sessionsDir = dataPaths.sessions;
ensureDataDirs();

let input: any;
const raw = await Bun.stdin.text();
try { input = JSON.parse(raw); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}, raw: ${raw.slice(0, 100)}`); process.exit(1); }
const transcript = parseTranscript(input.transcript_path);

if (!transcript || transcript.totalMessages < 4) {
  trace(TAG, `skip: ${transcript ? transcript.totalMessages : 0} messages`);
  process.exit(0);
}

trace(TAG, `messages: ${transcript.totalMessages}`);

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

trace(TAG, `intent: ${intent.slice(0, 80)}`);
trace(TAG, `outcome: ${outcome.slice(0, 80)}`);
trace(TAG, `tools: ${toolStr}, files: ${fileStr}, edits: ${editCount}`);

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
trace(TAG, `wrote ${file}`);
