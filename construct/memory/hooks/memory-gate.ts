#!/usr/bin/env bun
import { existsSync, unlinkSync, writeFileSync } from "fs";
import { resolve } from "path";
import { trace } from "../../trace.ts";
import { parseTranscript } from "../parse-transcript.ts";

const TAG = "memory-gate";
const lockFile = resolve(Bun.env.HOME ?? "/tmp", ".claude/.memory-gate.lock");

let input: any;
const raw = await Bun.stdin.text();
try { input = JSON.parse(raw); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}, raw: ${raw.slice(0, 100)}`); process.exit(1); }

const transcript = parseTranscript(input.transcript_path);
if (!transcript) { trace(TAG, "skip: no transcript"); process.exit(0); }

const edits = (transcript.toolCounts["Edit"] ?? 0) + (transcript.toolCounts["Write"] ?? 0) + (transcript.toolCounts["Bash"] ?? 0);
const substantive = transcript.totalMessages >= 6 && edits >= 1;

if (!substantive) {
  trace(TAG, `skip: not substantive (${transcript.totalMessages} msgs, ${edits} edits)`);
  cleanup();
  process.exit(0);
}

// Find memory_store content from transcript
const storeContent = extractMemoryStore(transcript);
const quality = storeContent ? assessQuality(storeContent) : null;

trace(TAG, `edits: ${edits}, store: ${storeContent ? `yes (${storeContent.length} chars)` : "no"}, quality: ${quality?.pass ? "pass" : quality?.missing.join(",") ?? "n/a"}`);
if (storeContent && !quality?.pass) trace(TAG, `store content: ${storeContent.slice(0, 200)}`);

// Good memory — pass
if (quality?.pass) { trace(TAG, "pass: quality ok"); cleanup(); process.exit(0); }

// Already reminded once — don't loop forever
if (existsSync(lockFile)) {
  trace(TAG, "pass: already reminded once");
  cleanup();
  process.exit(0);
}

// Block once
writeFileSync(lockFile, new Date().toISOString());
trace(TAG, "blocking");

const files = transcript.editedFiles.size > 0
  ? `\nFiles touched: ${[...transcript.editedFiles].slice(0, 6).join(", ")}` : "";
const task = transcript.firstUserText || "[what was the task?]";

const reason = storeContent
  ? `memory_store was called but is too thin. Your content:\n\n> ${storeContent.slice(0, 300)}\n\nMissing: ${quality!.missing.join(", ")}. Rewrite with all of: Task, Outcome (done/in-progress/blocked), Changes, Decisions, Next. 2-4 sentences. memory_type: 'observation'.${files}`
  : `No memory_store call found. Before exiting, call memory_store with tag 'session_context' and content:\n\nTask: ${task}\nOutcome: [done | in-progress | blocked]\nChanges: [what was changed and why]${files}\nDecisions: [key choices made, with reasoning]\nNext: [what a future session should know or do]\n\nCollapse into 2-4 sentences. Use memory_type: 'observation'.`;

trace(TAG, `output: ${reason.slice(0, 120)}`);
console.log(JSON.stringify({ decision: "block", reason }));

// --- helpers ---

function cleanup() {
  if (existsSync(lockFile)) unlinkSync(lockFile);
}

function extractMemoryStore(t: typeof transcript): string | null {
  for (const msg of t!.messages) {
    if (msg.role !== "assistant") continue;
    for (let i = 0; i < msg.toolUses.length; i++) {
      if (msg.toolUses[i].includes("memory_store")) {
        const content = msg.toolInputs[i]?.content ?? "";
        if (content.length > 0) return content;
      }
    }
  }
  return null;
}

function assessQuality(content: string): { pass: boolean; missing: string[] } {
  const lower = content.toLowerCase();
  const required = [
    { label: "Task", test: () => lower.includes("task") || lower.length > 80 },
    { label: "Outcome", test: () => /\b(done|complete|in.progress|blocked|finished|resolved)\b/.test(lower) },
    { label: "Changes", test: () => /\b(change|edit|add|remov|updat|fix|refactor|creat|implement|modif)\w*/.test(lower) },
  ];
  const missing = required.filter(r => !r.test()).map(r => r.label);
  return { pass: missing.length === 0 && content.length >= 50, missing };
}
