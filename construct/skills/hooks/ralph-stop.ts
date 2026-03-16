#!/usr/bin/env bun
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";

const root = resolve(dirname(Bun.main), "../..");
const stateFile = resolve(root, "../ralph-loop.local.md");

// No active loop — allow exit
if (!existsSync(stateFile)) {
  trace("ralph-stop", "no state file, allowing exit");
  process.exit(0);
}

const raw = readFileSync(stateFile, "utf8");

// Parse frontmatter
const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
if (!fmMatch) {
  console.error("⚠️  Ralph loop: State file corrupted (no frontmatter). Stopping.");
  unlinkSync(stateFile);
  process.exit(0);
}

const frontmatter = fmMatch[1];
const promptText = fmMatch[2].trim();

// Parse all frontmatter fields at once
const fields: Record<string, string> = {};
for (const line of frontmatter.split("\n")) {
  const m = line.match(/^(\w+):\s*(.*)$/);
  if (m) fields[m[1]] = m[2].trim();
}

const iteration = parseInt(fields.iteration ?? "", 10);
const maxIterations = parseInt(fields.max_iterations ?? "", 10);
const completionPromise = (fields.completion_promise ?? "").replace(/^"(.*)"$/, "$1");

if (isNaN(iteration)) {
  console.error("⚠️  Ralph loop: iteration field not a number. Stopping.");
  unlinkSync(stateFile);
  process.exit(0);
}

if (isNaN(maxIterations)) {
  console.error("⚠️  Ralph loop: max_iterations field not a number. Stopping.");
  unlinkSync(stateFile);
  process.exit(0);
}

if (!promptText) {
  console.error("⚠️  Ralph loop: No prompt text in state file. Stopping.");
  unlinkSync(stateFile);
  process.exit(0);
}

// Check max iterations
if (maxIterations > 0 && iteration >= maxIterations) {
  trace("ralph-stop", `max iterations (${maxIterations}) reached`);
  console.log(`🛑 Ralph loop: Max iterations (${maxIterations}) reached.`);
  unlinkSync(stateFile);
  process.exit(0);
}

// Read hook input for transcript path
const input = JSON.parse(await Bun.stdin.text());
const transcriptPath = input.transcript_path;

if (!transcriptPath || !existsSync(transcriptPath)) {
  console.error("⚠️  Ralph loop: Transcript not found. Stopping.");
  unlinkSync(stateFile);
  process.exit(0);
}

// Check completion promise in last assistant message
if (completionPromise && completionPromise !== "null") {
  const transcript = readFileSync(transcriptPath, "utf8");
  const assistantLines = transcript.split("\n").filter(l => l.includes('"role":"assistant"'));
  const lastLine = assistantLines.at(-1);

  if (lastLine) {
    try {
      const parsed = JSON.parse(lastLine);
      const texts = (parsed.message?.content ?? [])
        .filter((c: any) => c.type === "text")
        .map((c: any) => c.text)
        .join("\n");

      const promiseMatch = texts.match(/<promise>([\s\S]*?)<\/promise>/);
      if (promiseMatch) {
        const promiseText = promiseMatch[1].trim().replace(/\s+/g, " ");
        if (promiseText === completionPromise) {
          trace("ralph-stop", `completion promise detected: ${completionPromise}`);
          console.log(`✅ Ralph loop: Detected <promise>${completionPromise}</promise>`);
          unlinkSync(stateFile);
          process.exit(0);
        }
      }
    } catch (e) {
      trace("ralph-stop", `warning: failed to parse transcript line: ${e}`);
    }
  }
}

// Continue loop
const nextIteration = iteration + 1;
trace("ralph-stop", `continuing, iteration ${nextIteration}`);

// Update iteration in state file
const updated = raw.replace(/^iteration:\s*\d+/m, `iteration: ${nextIteration}`);
writeFileSync(stateFile, updated);

// Build system message
const promiseInfo = completionPromise && completionPromise !== "null"
  ? `To stop: output <promise>${completionPromise}</promise> (ONLY when TRUE)`
  : "No completion promise set — loop runs until max iterations";

const systemMsg = `🔄 Ralph iteration ${nextIteration} | ${promiseInfo}`;

// Block exit and feed prompt back
console.log(JSON.stringify({
  decision: "block",
  reason: promptText,
  systemMessage: systemMsg,
}));
