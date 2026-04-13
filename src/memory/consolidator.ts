#!/usr/bin/env bun
/**
 * Memory consolidator — background script, spawned by memory-consolidate-stop.ts
 *
 * Reads preference + error_resolution memories from the last 60 days,
 * synthesizes behavioral patterns via `claude -p` (no external API key needed),
 * writes ~/.construct/signals/learned-rules.md, stores a summary memory,
 * and updates consolidation-state.json.
 *
 * Designed to run fire-and-forget after session end. All errors are handled
 * gracefully — the existing rules file is never corrupted.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync, appendFileSync } from "fs";
import { resolve, dirname } from "path";
import { Database } from "bun:sqlite";
import { trace } from "../trace.ts";
import { reportHook } from "../hook-report.ts";
import { dataPaths, externalPaths } from "../data/src/paths.ts";

const TAG = "consolidator";

reportHook(TAG, "ConsolidationRun", "background");
trace(TAG, "consolidator starting");

// --- helpers ---

function updateState(data: { lastRun: string; lastMemoryCount: number }) {
  try {
    mkdirSync(dirname(dataPaths.consolidationState), { recursive: true });
    writeFileSync(dataPaths.consolidationState, JSON.stringify(data, null, 2));
  } catch (e) {
    trace(TAG, `state write failed: ${(e as Error).message}`);
  }
}

// --- 1. Query DB ---

const memDbPath = externalPaths.memoryDb;
if (!existsSync(memDbPath)) {
  trace(TAG, "memory DB not found, exit");
  updateState({ lastRun: new Date().toISOString(), lastMemoryCount: 0 });
  process.exit(0);
}

const DAYS_60 = 60 * 24 * 60 * 60;
const cutoffSecs = (Date.now() / 1000) - DAYS_60;

let memories: Array<{ content: string; tags: string; memory_type: string }> = [];
try {
  const db = new Database(memDbPath, { readonly: true });
  memories = db.query<{ content: string; tags: string; memory_type: string }, [number]>(`
    SELECT content, tags, memory_type FROM memories
    WHERE deleted_at IS NULL
      AND (tags LIKE '%preference%' OR tags LIKE '%error_resolution%')
      AND tags LIKE '%auto_extract%'
      AND created_at > ?
    ORDER BY updated_at DESC
    LIMIT 50
  `).all(cutoffSecs);
  db.close();
} catch (e) {
  trace(TAG, `DB query failed: ${(e as Error).message}`);
  updateState({ lastRun: new Date().toISOString(), lastMemoryCount: 0 });
  process.exit(0);
}

trace(TAG, `found ${memories.length} qualifying memories`);

if (memories.length < 3) {
  trace(TAG, "insufficient memories for synthesis, skip");
  reportHook(TAG, "ConsolidationRun", "background", {
    decision: "advisory",
    detail: "skip: insufficient memories",
  });
  updateState({ lastRun: new Date().toISOString(), lastMemoryCount: memories.length });
  process.exit(0);
}

// --- 2. Read tool signals (last 7 days) ---

let toolSignalContext = "";
try {
  if (existsSync(dataPaths.toolSignals)) {
    const cutoffISO = new Date(Date.now() - 7 * 86400000).toISOString();
    const lines = readFileSync(dataPaths.toolSignals, "utf8").trim().split("\n").filter(Boolean);
    const fileCounts: Record<string, number> = {};
    for (const line of lines) {
      try {
        const sig = JSON.parse(line);
        if (sig.type === "re-edit" && sig.timestamp > cutoffISO) {
          fileCounts[sig.file] = (fileCounts[sig.file] ?? 0) + 1;
        }
      } catch { /* skip malformed */ }
    }
    const frequent = Object.entries(fileCounts)
      .filter(([, n]) => n >= 2)
      .sort((a, b) => b[1] - a[1])
      .map(([f, n]) => `${f} (${n} sessions)`);
    if (frequent.length > 0) {
      toolSignalContext = `\nFiles requiring repeated edits across sessions: ${frequent.join(", ")}`;
    }
  }
} catch (e) {
  trace(TAG, `tool signals read failed: ${(e as Error).message}`);
}

// --- 3. Deduplicate and surface patterns (no external synthesis) ---
//
// `claude --print` is not usable from a spawned background process (billing mode
// difference). Instead, we do simple frequency-based deduplication: extract keywords
// from each memory, group memories that share a dominant keyword, and surface the
// most-recent representative from each cluster as a "rule". The raw memory text is
// used directly — no rephrasing needed since the corrections were already captured
// in natural language by extract.ts.

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 4 && !/^(the|and|for|with|from|that|this|into|have|been|will|were|session|error|memory|claude|construct|approach|required|needed|multiple|corrections)$/.test(w))
  );
}

function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  const intersection = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : intersection / union;
}

// Cluster memories by similarity (Jaccard ≥ 0.25 → same cluster)
const clusters: Array<Array<typeof memories[0]>> = [];
const tokenized = memories.map(m => ({ mem: m, tokens: tokenize(m.content) }));

for (const item of tokenized) {
  let placed = false;
  for (const cluster of clusters) {
    const rep = tokenize(cluster[0].content);
    if (jaccardSimilarity(item.tokens, rep) >= 0.25) {
      cluster.push(item.mem);
      placed = true;
      break;
    }
  }
  if (!placed) clusters.push([item.mem]);
}

// Surface the most-recent memory from each cluster as a rule
// Clusters of size 1 are single observations — include up to 8 regardless
// (each was already filtered to be a preference/error, so all are relevant)
function extractRuleText(content: string): string {
  // Strip known prefixes, then find the first meaningful sentence or line
  const stripped = content
    .replace(/^(Error:|Re-edit friction:|User correction:)\s*/i, "")
    .replace(/#+\s+\S[^\n]*/g, "") // strip markdown headings anywhere in line
    .replace(/\s{2,}/g, " "); // collapse whitespace

  // Try to find first good sentence (ends with period, 20-150 chars)
  for (const segment of stripped.split(/[.\n]+/)) {
    const clean = segment.trim().replace(/\s+/g, " ");
    if (clean.length >= 20 && clean.length <= 150) {
      return clean;
    }
  }
  // Fallback: first 150 chars
  return stripped.replace(/\s+/g, " ").trim().slice(0, 150);
}

const rules = clusters
  .sort((a, b) => b.length - a.length) // largest clusters first
  .slice(0, 8)
  .map(cluster => ({
    rule: extractRuleText(cluster[0].content),
    frequency: cluster.length,
  }))
  .filter(r => r.rule.length > 10);

trace(TAG, `clustered into ${rules.length} rules from ${clusters.length} clusters`);

// --- 4. Write learned-rules.md ---

if (rules.length > 0) {
  const content = [
    `# Learned Rules`,
    `_Auto-generated ${new Date().toISOString().slice(0, 10)} from ${memories.length} memories_`,
    "",
    ...rules.map(r => r.frequency > 1
      ? `- ${r.rule} _(${r.frequency}x observed)_`
      : `- ${r.rule}`),
    "",
  ].join("\n");
  try {
    mkdirSync(dirname(dataPaths.learnedRules), { recursive: true });
    writeFileSync(dataPaths.learnedRules, content);
    trace(TAG, `wrote ${rules.length} rules to learned-rules.md`);
  } catch (e) {
    trace(TAG, `rules write failed: ${(e as Error).message}`);
  }
}

// --- 5. Store summary memory via memory-writer.py ---

const VENV_PYTHON = Bun.env.MEMORY_VENV_PYTHON ?? resolve(
  Bun.env.HOME ?? "/tmp",
  ".local/share/uv/tools/mcp-memory-service/bin/python",
);
const writerScript = resolve(dirname(Bun.main), "memory-writer.py");

const summaryContent = rules.length > 0
  ? `Consolidated ${memories.length} memories into ${rules.length} behavioral rules: ${rules.map(r => r.rule).join("; ")}`
  : `Consolidation ran on ${memories.length} memories — no clear recurring patterns found`;

if (existsSync(VENV_PYTHON) && existsSync(writerScript)) {
  try {
    const summaryPayload = JSON.stringify([{
      content: summaryContent,
      tags: "consolidated,auto_extract",
      memory_type: "pattern",
    }]);
    const proc = Bun.spawn([VENV_PYTHON, writerScript], {
      stdin: new Blob([summaryPayload]),
      stdout: "ignore",
      stderr: "ignore",
    });
    await proc.exited;
    trace(TAG, "stored summary memory");
  } catch (e) {
    trace(TAG, `memory write failed: ${(e as Error).message}`);
  }
} else {
  trace(TAG, "memory-writer not available, skipping summary memory");
}

// --- 6. Update state ---

updateState({ lastRun: new Date().toISOString(), lastMemoryCount: memories.length });

reportHook(TAG, "ConsolidationRun", "background", {
  decision: "pass",
  detail: `${rules.length} rules from ${memories.length} memories`,
});

trace(TAG, "consolidator done");
process.exit(0);
