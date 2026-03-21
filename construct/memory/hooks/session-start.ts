#!/usr/bin/env bun
import { existsSync, readFileSync, readdirSync, writeFileSync, unlinkSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { trace } from "../../trace.ts";

const TAG = "session-start";
const root = resolve(dirname(Bun.main), "../..");
const sessionsDir = resolve(root, "memory/sessions");
const briefingMarker = resolve(sessionsDir, ".last-briefing");

// Clean memory-gate lock from previous session
const gateLock = resolve(Bun.env.HOME ?? "/tmp", ".claude/.memory-gate.lock");
if (existsSync(gateLock)) { unlinkSync(gateLock); trace(TAG, "cleaned memory-gate lock"); }

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

// Morning briefing: detect background sessions since last interactive session
const lastSeen = existsSync(briefingMarker) ? readFileSync(briefingMarker, "utf8").trim() : null;
trace(TAG, `last-briefing marker: ${lastSeen ?? "none"}`);

const newSessions = lastSeen
  ? sessionFiles.filter(f => f > lastSeen)
  : sessionFiles.length > 1
    ? sessionFiles.slice(0, -1) // treat all but the oldest as new when no marker
    : [];

trace(TAG, `new sessions since last briefing: ${newSessions.length}`);

if (newSessions.length > 0) {
  const completed: string[] = [];
  const inProgress: string[] = [];
  const blocked: string[] = [];

  for (const file of newSessions.slice().reverse()) { // chronological order
    const content = readFileSync(resolve(sessionsDir, file), "utf8");
    const lines = content.split("\n");

    const intentLine = lines.find(l => l.startsWith("- Intent:"))?.replace("- Intent:", "").trim() ?? "";
    const outcomeLine = lines.find(l => l.startsWith("- Outcome:"))?.replace("- Outcome:", "").trim() ?? "";
    const notesLines = lines
      .filter(l => l.trim().startsWith("- ") && lines.indexOf(l) > lines.findIndex(l2 => l2 === "- Notes:"))
      .map(l => l.trim().replace(/^- /, ""));

    const lowerOutcome = outcomeLine.toLowerCase();
    const lowerContent = content.toLowerCase();

    // Classify by outcome keywords
    const isBlocked =
      lowerOutcome.includes("blocked") ||
      lowerOutcome.includes("stuck") ||
      lowerContent.includes("blocked");
    const isInProgress =
      !isBlocked && (
        lowerOutcome.includes("pending") ||
        lowerOutcome.includes("failing") ||
        lowerOutcome.includes("wip") ||
        lowerOutcome.includes("in progress") ||
        lowerOutcome.includes("partial") ||
        lowerOutcome.includes("next time") ||
        lowerOutcome.includes("pick that up") ||
        notesLines.some(n => n.toLowerCase().includes("failing") || n.toLowerCase().includes("pending"))
      );

    const entry = `[${file}] ${intentLine || "unknown"}` +
      (outcomeLine ? ` → ${outcomeLine.slice(0, 120)}` : "");

    if (isBlocked) {
      blocked.push(entry);
    } else if (isInProgress) {
      inProgress.push(entry);
    } else {
      completed.push(entry);
    }
  }

  out.push(`\n=== Background Work (${newSessions.length} session${newSessions.length > 1 ? "s" : ""}) ===`);

  if (completed.length > 0) {
    out.push("\nCompleted:");
    for (const e of completed) out.push(`  ✓ ${e}`);
  }

  if (inProgress.length > 0) {
    out.push("\nIn Progress:");
    for (const e of inProgress) out.push(`  ~ ${e}`);
  }

  if (blocked.length > 0) {
    out.push("\nBlocked:");
    for (const e of blocked) out.push(`  ✗ ${e}`);
  }

  out.push("=========================");
}

// Update briefing marker to most recent session
if (sessionFiles.length > 0) {
  writeFileSync(briefingMarker, sessionFiles[0]);
  trace(TAG, `updated last-briefing marker to ${sessionFiles[0]}`);
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

// Fire-and-forget memory snapshot for observability
try {
  const snapshotScript = resolve(root, "memory/obs-snapshot.ts");
  if (existsSync(snapshotScript)) {
    Bun.spawn(["bun", snapshotScript], { stdio: ["ignore", "ignore", "ignore"] });
    trace(TAG, "spawned obs-snapshot");
  }
} catch {
  trace(TAG, "obs-snapshot spawn failed");
}

out.push("[memory] Search semantic memory (memory_search) for relevant project context before starting work.");
out.push("====================");
console.log(out.join("\n"));
