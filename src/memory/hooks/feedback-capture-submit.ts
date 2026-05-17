#!/usr/bin/env bun
/**
 * UserPromptSubmit hook: sentiment feedback capture.
 *
 * Recognizes positive feedback ("great", "perfect", "thanks") and reuses
 * CORRECTION_RE for negative feedback ("no", "don't", "stop"). On match,
 * stamps the signal with what the prior assistant turn was doing — text
 * excerpt, tool names, files touched — so downstream consolidation knows
 * what the feedback was reacting to.
 *
 * Writes one JSONL row to ~/.construct/signals/feedback.jsonl.
 * No match → exit 0. Cheap regex check before transcript parse.
 */
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { ensureDataDirs } from "../../data/src/paths.ts";
import { parseTranscript } from "../parse-transcript.ts";
import {
  CORRECTION_RE,
  POSITIVE_FEEDBACK_RE,
  POSITIVE_STANDALONE_RE,
} from "../extract.ts";

const TAG = "feedback-capture-submit";
ensureDataDirs();

let input: any;
const raw = await Bun.stdin.text();
try { input = JSON.parse(raw); }
catch (e) {
  console.error(`[${TAG}] stdin parse failed: ${(e as Error).message}`);
  process.exit(0);
}

const prompt: string = (input.prompt ?? "").trim();
if (prompt.length < 2) {
  reportHook(TAG, "UserPromptSubmit", input.session_id);
  trace(TAG, "skip: prompt too short");
  process.exit(0);
}

let polarity: "positive" | "negative" | null = null;
let trigger = "";
const posMatch = prompt.match(POSITIVE_FEEDBACK_RE) ?? prompt.match(POSITIVE_STANDALONE_RE);
if (posMatch) {
  polarity = "positive";
  trigger = posMatch[1].toLowerCase();
} else if (CORRECTION_RE.test(prompt)) {
  polarity = "negative";
  const m = prompt.match(/^(\S+)/);
  trigger = m ? m[1].replace(/[,.\s]+$/, "").toLowerCase() : "";
}

if (!polarity) {
  reportHook(TAG, "UserPromptSubmit", input.session_id);
  trace(TAG, "no sentiment match");
  process.exit(0);
}

let priorText = "";
let priorTools: string[] = [];
let priorFiles: string[] = [];
if (input.transcript_path) {
  const t = parseTranscript(input.transcript_path, { textLimit: 400 });
  if (t) {
    for (let i = t.messages.length - 1; i >= 0; i--) {
      const m = t.messages[i];
      if (m.role !== "assistant") continue;
      priorText = m.text.slice(0, 300);
      priorTools = [...new Set(m.toolUses)].slice(0, 5);
      priorFiles = m.toolInputs
        .map(inp => (inp?.file_path ?? inp?.path) as string | undefined)
        .filter((p): p is string => !!p)
        .map(p => p.split("/").slice(-2).join("/"))
        .slice(0, 3);
      break;
    }
  }
}

let turnIndex: number | undefined;
if (input.transcript_path) {
  const t2 = parseTranscript(input.transcript_path, { textLimit: 10 });
  if (t2) turnIndex = t2.messages.filter((m: { role: string }) => m.role === "user").length;
}

reportHook(TAG, "UserPromptSubmit", input.session_id, {
  meta: {
    polarity,
    trigger,
    prompt: prompt.slice(0, 200).replace(/\n/g, " "),
    priorText: priorText.replace(/\n/g, " "),
    priorTools,
    priorFiles,
    turnIndex,
  },
});
trace(TAG, `${polarity} (${trigger}) → tools=${priorTools.join(",")} files=${priorFiles.join(",")}`);
