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
 * 6. Compaction notes — if a compaction-notes.json file exists and is <12h old,
 *    inject working-state snapshot (recent prompts, files, errors) to bridge
 *    context across compaction boundaries.
 * 7. Fire-and-forget obs-snapshot.ts for observability.
 * 8. Recall semantic memories — hybrid retrieval: build search terms from cwd +
 *    branch + last session intent, try FTS5 then LIKE fallback, blend with
 *    recency, apply 800-token budget.
 * 9. Emit reminder to search semantic memory for project context.
 *
 * Never blocks (exit 0 normally; exit 1 on malformed stdin). All failures are swallowed with trace logging.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { execSync } from "child_process";
import { Database } from "bun:sqlite";
import { trace } from "../../trace.ts";
import { reportHook } from "../../hook-report.ts";
import { dataPaths, externalPaths } from "../../data/src/paths.ts";

const TAG = "context-restore-start";

let input: any;
try { input = JSON.parse(await Bun.stdin.text()); }
catch (e) { trace(TAG, `stdin parse failed: ${(e as Error).message}`); process.exit(1); }
reportHook(TAG, "SessionStart", input.session_id);

const root = resolve(dirname(Bun.main), "../..");
const sessionsDir = dataPaths.sessions;
const briefingMarker = resolve(sessionsDir, ".last-briefing");

const out: string[] = ["=== Session Start ==="];

// Dev-mode check: remind to install after editing source
const cwd = input.cwd ?? process.cwd();
if (existsSync(resolve(cwd, "src/trace.ts")) && existsSync(resolve(cwd, "install.ts"))) {
  out.push("\n⚠ DEV MODE: Edits to src/ won't take effect until you run /aleph install.\n");
}

// Session count
const sessionFiles = existsSync(sessionsDir)
  ? readdirSync(sessionsDir).filter(f => f.endsWith(".md")).sort().reverse()
  : [];
trace(TAG, `sessions: ${sessionFiles.length}`);
out.push(`Sessions: ${sessionFiles.length}`);

// Worktree detection
let currentBranch = "";
try {
  const gitDir = execSync("git rev-parse --git-dir", { encoding: "utf-8", timeout: 2000 }).trim();
  if (gitDir.includes(".git/worktrees")) {
    currentBranch = execSync("git branch --show-current", { encoding: "utf-8", timeout: 2000 }).trim();
    trace(TAG, `worktree: ${currentBranch}`);
    out.push(`Worktree: ${currentBranch}`);
  } else {
    currentBranch = execSync("git branch --show-current", { encoding: "utf-8", timeout: 2000 }).trim();
  }
} catch {
  trace(TAG, "not in a git repo or branch detection failed");
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

    if (isBlocked) blocked.push(entry);
    else if (isInProgress) inProgress.push(entry);
    else completed.push(entry);
  }

  out.push(`\n=== Background Work (${newSessions.length} session${newSessions.length > 1 ? "s" : ""}) ===`);
  if (completed.length > 0) { out.push("\nCompleted:"); for (const e of completed) out.push(`  ✓ ${e}`); }
  if (inProgress.length > 0) { out.push("\nIn Progress:"); for (const e of inProgress) out.push(`  ~ ${e}`); }
  if (blocked.length > 0) { out.push("\nBlocked:"); for (const e of blocked) out.push(`  ✗ ${e}`); }
  out.push("=========================");
}

// Update briefing marker to most recent session
if (sessionFiles.length > 0) {
  writeFileSync(briefingMarker, sessionFiles[0]);
  trace(TAG, `updated last-briefing marker to ${sessionFiles[0]}`);
}

// Last session summary
let lastSessionIntent = "";
if (sessionFiles.length > 0) {
  const lastFile = resolve(sessionsDir, sessionFiles[0]);
  const lastContent = readFileSync(lastFile, "utf8").trim();
  trace(TAG, `last session: ${sessionFiles[0]}`);
  out.push(`\nLast session (${sessionFiles[0]}):`);
  for (const line of lastContent.split("\n")) {
    if (line.startsWith("# ")) continue;
    if (line.trim()) out.push(`  ${line}`);
  }
  lastSessionIntent = lastContent.split("\n")
    .find(l => l.startsWith("- Intent:"))?.replace("- Intent:", "").trim() ?? "";
} else {
  trace(TAG, "no previous sessions");
}

// Compaction notes injection: bridge context across compaction boundaries
// Only inject if file is less than 12 hours old (stale notes = noise)
const COMPACTION_MAX_AGE_MS = 12 * 60 * 60 * 1000;
try {
  if (existsSync(dataPaths.compactionNotes)) {
    const notes = JSON.parse(readFileSync(dataPaths.compactionNotes, "utf8"));
    const ageMs = Date.now() - new Date(notes.ts).getTime();
    if (ageMs < COMPACTION_MAX_AGE_MS) {
      out.push("\n=== Compaction Notes (prior context) ===");
      if (notes.recentPrompts?.length > 0) {
        out.push(`Context: ${notes.recentPrompts.join(" → ")}`);
      }
      if (notes.workingFiles?.length > 0) {
        out.push(`Files: ${notes.workingFiles.join(", ")}`);
      }
      if (notes.recentErrors?.length > 0) {
        out.push("Errors:");
        for (const e of notes.recentErrors) out.push(`  - ${e}`);
      }
      if (notes.lastAssistantSnippet) {
        out.push(`Last note: ...${notes.lastAssistantSnippet.slice(-200)}`);
      }
      out.push("=========================");
      trace(TAG, `injected compaction notes (age: ${Math.round(ageMs / 60000)}m)`);
    } else {
      trace(TAG, `compaction notes too old (${Math.round(ageMs / 3600000)}h), skipping`);
    }
  }
} catch (e) {
  trace(TAG, `compaction notes injection failed: ${(e as Error).message}`);
}

// Recent user-correction injection: tail-scan events.jsonl for negative
// feedback (≤30 days) and low ratings, inject verbatim. No LLM synthesis.
try {
  if (existsSync(dataPaths.events)) {
    type CorrectionItem = { ts: string; polarity: string; trigger: string; priorText: string; prompt: string };
    type LowRating = { ts: string; rating: number; context: string; priorText: string };
    const cutoffMs = Date.now() - 30 * 24 * 60 * 60 * 1000;
    const corrections: CorrectionItem[] = [];
    const lowRatings: LowRating[] = [];

    // Tail the file to avoid loading megabytes of history every session start.
    // 256 KB is enough for ~1k recent entries.
    const TAIL_BYTES = 256 * 1024;
    let chunk: string;
    try {
      const fd = readFileSync(dataPaths.events);
      chunk = fd.byteLength > TAIL_BYTES
        ? fd.subarray(fd.byteLength - TAIL_BYTES).toString("utf8")
        : fd.toString("utf8");
    } catch {
      chunk = "";
    }

    // Skip the first (likely truncated) line when we sliced into the middle.
    const lines = chunk.split("\n");
    if (chunk.length === TAIL_BYTES) lines.shift();

    for (const line of lines) {
      if (!line) continue;
      try {
        const e = JSON.parse(line) as Record<string, unknown>;
        const ts = e.ts as string | undefined;
        if (!ts || new Date(ts).getTime() < cutoffMs) continue;
        if (e.hook === "feedback-capture-submit" && e.polarity === "negative") {
          corrections.push({
            ts,
            polarity: "negative",
            trigger: (e.trigger as string) ?? "",
            priorText: (e.priorText as string) ?? "",
            prompt: (e.prompt as string) ?? "",
          });
        } else if (e.hook === "rating-capture-submit" && typeof e.rating === "number" && (e.rating as number) <= 3) {
          lowRatings.push({
            ts,
            rating: e.rating as number,
            context: (e.context as string) ?? "",
            priorText: (e.priorText as string) ?? "",
          });
        }
      } catch (err) { trace(TAG, `skipped malformed event: ${(err as Error).message}`); }
    }

    // Newest first, cap at the same 600-char budget as the previous injection.
    corrections.sort((a, b) => b.ts.localeCompare(a.ts));
    lowRatings.sort((a, b) => b.ts.localeCompare(a.ts));
    const BUDGET = 600;
    const injectedLines: string[] = [];
    let used = 0;
    for (const c of corrections) {
      const reactingTo = c.priorText ? ` reacting to: ${c.priorText.slice(0, 60)}` : "";
      const line = `- [avoid] "${c.prompt.slice(0, 100)}"${reactingTo}`;
      if (used + line.length + 1 > BUDGET) break;
      injectedLines.push(line);
      used += line.length + 1;
    }
    for (const r of lowRatings) {
      const reactingTo = r.priorText ? ` reacting to: ${r.priorText.slice(0, 60)}` : "";
      const line = `- [low rating ${r.rating}/10] ${r.context}${reactingTo}`;
      if (used + line.length + 1 > BUDGET) break;
      injectedLines.push(line);
      used += line.length + 1;
    }

    if (injectedLines.length > 0) {
      out.push("\n=== Recent User Corrections ===");
      out.push(injectedLines.join("\n"));
      out.push("=========================");
      trace(TAG, `injected ${injectedLines.length} corrections (${used} chars)`);
    }
  }
} catch (e) { trace(TAG, `correction injection failed: ${(e as Error).message}`); }

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

// Hybrid semantic memory recall
// Build context-aware search terms from: cwd name, branch, last session intent.
// Try FTS5 first, fall back to LIKE multi-term search, supplement with recency.
// Apply 800-token budget (~3200 chars) to keep injection bounded.
const MEMORY_TOKEN_BUDGET = 800;
const CHARS_PER_TOKEN = 4;
const MEMORY_CHAR_BUDGET = MEMORY_TOKEN_BUDGET * CHARS_PER_TOKEN;

const searchTerms = new Set<string>();

// From cwd basename
const cwdName = resolve(cwd).split("/").pop() ?? "";
if (cwdName && cwdName.length > 3) searchTerms.add(cwdName.toLowerCase());

// From git branch (split on separators, keep meaningful segments)
if (currentBranch) {
  for (const part of currentBranch.split(/[-_/]/)) {
    if (part.length > 3 && !/^\d+$/.test(part)) searchTerms.add(part.toLowerCase());
  }
}

// From last session intent (first 5 meaningful words)
if (lastSessionIntent) {
  const words = lastSessionIntent
    .split(/\s+/)
    .filter(w => w.length > 4 && !/^(the|and|for|with|from|that|this|into|have|been|will|were)$/i.test(w));
  for (const w of words.slice(0, 5)) searchTerms.add(w.toLowerCase());
}

// Domain synonym expansion
const synonymMap: Record<string, string[]> = {
  hook: ["middleware", "lifecycle", "pretooluse", "posttooluse"],
  skill: ["playbook", "slash command"],
  db: ["database", "sqlite", "drizzle"],
  research: ["finding", "thread", "session", "investigation"],
  ui: ["interface", "frontend", "react", "component"],
  telemetry: ["observability", "metrics", "aggregator", "jsonl"],
  memory: ["semantic", "recall", "embedding"],
  eval: ["scenario", "harness", "assertion", "sandbox"],
};
for (const term of [...searchTerms]) {
  const synonyms = synonymMap[term];
  if (synonyms) for (const s of synonyms) searchTerms.add(s);
}

trace(TAG, `memory search terms: ${[...searchTerms].join(", ")}`);

const memDbPath = externalPaths.memoryDb;
let memories: Array<{ content: string; memory_type: string; tags: string }> = [];

try {
  if (existsSync(memDbPath)) {
    const memDb = new Database(memDbPath, { readonly: true });

    // Exclude auto_extract-tagged memories until 20+ explicit memories exist
    // (auto-extracted entries are noisy after the post-wipe rebuild period).
    let excludeAutoExtract = false;
    try {
      const clean = memDb.query<{ n: number }, []>(
        `SELECT COUNT(*) AS n FROM memories WHERE deleted_at IS NULL AND tags NOT LIKE '%auto_extract%'`
      ).get();
      excludeAutoExtract = (clean?.n ?? 0) < 20;
      trace(TAG, `auto_extract filter: ${excludeAutoExtract ? "ON" : "OFF"} (${clean?.n ?? 0} clean memories)`);
    } catch { /* tolerate */ }

    const autoExtractFilter = excludeAutoExtract
      ? " AND tags NOT LIKE '%auto_extract%'"
      : "";

    // Attempt 1: FTS5 full-text search (if memories_fts virtual table exists)
    if (searchTerms.size > 0) {
      try {
        const hasFts = (memDb.query(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='memories_fts'"
        ).all() as any[]).length > 0;

        if (hasFts) {
          const ftsQuery = [...searchTerms]
            .slice(0, 8)
            .map(t => `"${t.replace(/"/g, '""')}"`)
            .join(" OR ");
          memories = memDb.query(`
            SELECT m.content, m.memory_type, m.tags
            FROM memories m
            JOIN memories_fts fts ON m.id = fts.rowid
            WHERE fts.content MATCH ? AND m.deleted_at IS NULL${autoExtractFilter}
            ORDER BY rank, m.updated_at DESC
            LIMIT 12
          `).all(ftsQuery) as typeof memories;
          trace(TAG, `FTS5 recall: ${memories.length} results`);
        }
      } catch (e) {
        trace(TAG, `FTS5 query failed: ${(e as Error).message}`);
      }
    }

    // Attempt 2: LIKE multi-term search if FTS produced nothing
    if (memories.length === 0 && searchTerms.size > 0) {
      try {
        const terms = [...searchTerms].slice(0, 6);
        const conditions = terms.map(() => "content LIKE ?").join(" OR ");
        const params = terms.map(t => `%${t}%`);
        memories = memDb.query(`
          SELECT content, memory_type, tags
          FROM memories
          WHERE deleted_at IS NULL${autoExtractFilter} AND (${conditions})
          ORDER BY updated_at DESC
          LIMIT 10
        `).all(...params) as typeof memories;
        trace(TAG, `LIKE recall: ${memories.length} results`);
      } catch (e) {
        trace(TAG, `LIKE query failed: ${(e as Error).message}`);
      }
    }

    // Always supplement with recency to ensure coverage
    const recent = memDb.query(`
      SELECT content, memory_type, tags
      FROM memories
      WHERE deleted_at IS NULL${autoExtractFilter}
      ORDER BY updated_at DESC
      LIMIT 5
    `).all() as typeof memories;

    const seen = new Set(memories.map(m => m.content));
    for (const r of recent) {
      if (!seen.has(r.content)) {
        memories.push(r);
        seen.add(r.content);
      }
    }

    memDb.close();
    trace(TAG, `total candidates before budget: ${memories.length}`);
  }
} catch (e) {
  trace(TAG, `memory recall failed: ${(e as Error).message}`);
}

// Apply token budget: include memories until budget exhausted
if (memories.length > 0) {
  out.push("\n=== Recent Memories ===");
  let usedChars = 0;
  let injected = 0;
  for (const r of memories) {
    const content = r.content.replace(/\n/g, " ").slice(0, 200);
    const line = `  - [${r.memory_type}] ${content}`;
    if (usedChars + line.length > MEMORY_CHAR_BUDGET) break;
    out.push(line);
    usedChars += line.length;
    injected++;
  }
  trace(TAG, `injected ${injected} memories (${usedChars} chars / ${MEMORY_CHAR_BUDGET} budget)`);
}

out.push("[memory] Search semantic memory (memory_search) for relevant project context before starting work.");
out.push("====================");
console.log(out.join("\n"));

process.exit(0);
