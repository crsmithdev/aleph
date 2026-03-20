#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { trace } from "../../trace.ts";

const TAG = "session-start";
const root = resolve(dirname(Bun.main), "../..");
const sessionsDir = resolve(root, "memory/sessions");

if (!existsSync(sessionsDir)) {
  trace(TAG, `sessions dir missing: ${sessionsDir}`);
}

const sessionFiles = existsSync(sessionsDir)
  ? readdirSync(sessionsDir).filter(f => f.endsWith(".md"))
      .sort().reverse()
  : [];
trace(TAG, `sessions: ${sessionFiles.length}`);
console.log(`=== Session Start ===\nSessions: ${sessionFiles.length}`);

// Surface last session summary for immediate context
if (sessionFiles.length > 0) {
  const lastFile = resolve(sessionsDir, sessionFiles[0]);
  const lastContent = readFileSync(lastFile, "utf8").trim();
  trace(TAG, `last session: ${sessionFiles[0]}`);
  trace(TAG, `last content: ${lastContent.slice(0, 150)}`);
  console.log(`\nLast session (${sessionFiles[0]}):`);
  for (const line of lastContent.split("\n")) {
    if (line.startsWith("# ")) continue;
    if (line.trim()) console.log(`  ${line}`);
  }
} else {
  trace(TAG, "no previous sessions");
}

console.log("[memory] Search semantic memory (memory_search) for relevant project context before starting work.");
console.log("====================");
