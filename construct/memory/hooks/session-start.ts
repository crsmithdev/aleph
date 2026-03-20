#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { trace } from "../../trace.ts";

const TAG = "session-start";
const root = resolve(dirname(Bun.main), "../..");
const sessionsDir = resolve(root, "memory/sessions");

const out: string[] = ["=== Session Start ==="];

// Session count
const sessionFiles = existsSync(sessionsDir)
  ? readdirSync(sessionsDir).filter(f => f.endsWith(".md")).sort().reverse()
  : [];
trace(TAG, `sessions: ${sessionFiles.length}`);
out.push(`Sessions: ${sessionFiles.length}`);

// Worktree detection
try {
  const gitDir = execSync("git rev-parse --git-dir", { encoding: "utf-8", timeout: 2000 }).trim();
  if (gitDir.includes(".git/worktrees")) {
    const branch = execSync("git branch --show-current", { encoding: "utf-8", timeout: 2000 }).trim();
    trace(TAG, `worktree: ${branch}`);
    out.push(`Worktree: ${branch}`);
  }
} catch {
  trace(TAG, "not in a git repo");
}

// Last session summary
if (sessionFiles.length > 0) {
  const lastFile = resolve(sessionsDir, sessionFiles[0]);
  const lastContent = readFileSync(lastFile, "utf8").trim();
  trace(TAG, `last session: ${sessionFiles[0]}`);
  trace(TAG, `last content: ${lastContent.slice(0, 150)}`);
  out.push(`\nLast session (${sessionFiles[0]}):`);
  for (const line of lastContent.split("\n")) {
    if (line.startsWith("# ")) continue;
    if (line.trim()) out.push(`  ${line}`);
  }
} else {
  trace(TAG, "no previous sessions");
}

out.push("[memory] Search semantic memory (memory_search) for relevant project context before starting work.");
out.push("====================");
console.log(out.join("\n"));
