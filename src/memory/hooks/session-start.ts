#!/usr/bin/env bun
/**
 * SessionStart hook: session briefing and context loading.
 *
 * Fires once when a new Claude session starts. Assembles a briefing message
 * printed to stdout that Claude reads as initial context.
 *
 * 1. Dev-mode check — if cwd has install.ts + src/, warn about needing /install.
 * 2. Count session files in the sessions directory.
 * 3. Detect git worktree (branch name if in a worktree).
 * 4. Morning briefing — read session summaries since last briefing marker,
 *    classify each as completed/in-progress/blocked by outcome keywords.
 * 5. Print last session summary (intent, outcome, milestones, notes).
 * 6. Fire-and-forget obs-snapshot.ts for observability.
 * 7. Recall 5 most recent semantic memories from SQLite (direct query, no embedding).
 * 8. Emit reminder to search semantic memory for project context.
 *
 * Never blocks (always exit 0). All failures are swallowed with trace logging.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { Database } from "bun:sqlite";
import { trace } from "../../trace.ts";
import { dataPaths, externalPaths } from "../../paths.ts";

const TAG = "session-start";
const root = resolve(dirname(Bun.main), "../..");
const sessionsDir = dataPaths.sessions;
const briefingMarker = resolve(sessionsDir, ".last-briefing");

const out: string[] = ["=== Session Start ==="];

// Dev-mode check: remind to install after editing source
const cwd = process.cwd();
if (existsSync(resolve(cwd, "src/trace.ts")) && existsSync(resolve(cwd, "install.ts"))) {
  out.push("\n⚠ DEV MODE: Edits to src/ won't take effect until you run /construct install.\n");
}

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
    const notesIdx = lines.findIndex(l => l.trimStart() === "- Notes:");
    const notesLines = notesIdx === -1 ? [] : lines
      .slice(notesIdx + 1)
      .filter(l => l.trim().startsWith("- "))
      .map(l => l.trim().replace(/^- /, ""));

    const lowerOutcome = outcomeLine.toLowerCase();

    // Classify by outcome keywords
    const isBlocked =
      lowerOutcome.includes("blocked") ||
      lowerOutcome.includes("stuck");
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

// Recall recent semantic memories (direct SQLite, no embedding model needed)
const memDbPath = externalPaths.memoryDb;
try {
  if (existsSync(memDbPath)) {
    const memDb = new Database(memDbPath, { readonly: true });
    const rows = memDb.query(`
      SELECT content, memory_type, tags
      FROM memories
      WHERE deleted_at IS NULL
      ORDER BY updated_at DESC
      LIMIT 5
    `).all() as Array<{ content: string; memory_type: string; tags: string }>;
    memDb.close();

    if (rows.length > 0) {
      out.push("\n=== Recent Memories ===");
      for (const r of rows) {
        const content = r.content.replace(/\n/g, " ").slice(0, 200);
        out.push(`  - [${r.memory_type}] ${content}`);
      }
    }
    trace(TAG, `recalled ${rows.length} memories`);
  }
} catch (e) {
  trace(TAG, `memory recall failed: ${(e as Error).message}`);
}

out.push("[memory] Search semantic memory (memory_search) for relevant project context before starting work.");
out.push("====================");
console.log(out.join("\n"));
