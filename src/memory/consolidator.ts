#!/usr/bin/env bun
/**
 * Memory consolidator — background script, spawned by memory-consolidate-stop.ts
 *
 * Pulls preference + error_resolution memories from the last 60 days, joins
 * them with feedback.jsonl signals (positive vs negative sentiment with
 * prior-turn context), distills into 5–10 polarity-labelled rules, writes
 * ~/.construct/signals/learned-rules.md, stores a summary memory, and updates
 * consolidation-state.json.
 *
 * Synthesis path:
 *   - If OPENROUTER_API_KEY set → call CONSTRUCT_SYNTH_MODEL (default
 *     google/gemini-2.0-flash-001) for semantic distillation.
 *   - Otherwise → frequency-based Jaccard clustering, partitioned by polarity.
 *
 * Designed to run fire-and-forget after session end. All errors are handled
 * gracefully — the existing rules file is never corrupted.
 */
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { Database } from "bun:sqlite";
import { trace } from "../trace.ts";
import { reportHook } from "../hook-report.ts";
import { dataPaths, externalPaths } from "../data/src/paths.ts";

const TAG = "consolidator";

reportHook(TAG, "ConsolidationRun", "background");
trace(TAG, "consolidator starting");

function updateState(data: { lastRun: string; lastMemoryCount: number }) {
  try {
    mkdirSync(dirname(dataPaths.consolidationState), { recursive: true });
    writeFileSync(dataPaths.consolidationState, JSON.stringify(data, null, 2));
  } catch (e) {
    trace(TAG, `state write failed: ${(e as Error).message}`);
  }
}

// --- 1. Query memory DB ---

const memDbPath = externalPaths.memoryDb;
if (!existsSync(memDbPath)) {
  trace(TAG, "memory DB not found, exit");
  updateState({ lastRun: new Date().toISOString(), lastMemoryCount: 0 });
  process.exit(0);
}

const DAYS_60 = 60 * 24 * 60 * 60;
const cutoffSecs = (Date.now() / 1000) - DAYS_60;

interface MemRow { content: string; tags: string; memory_type: string; }
let memories: MemRow[] = [];
try {
  const db = new Database(memDbPath, { readonly: true });
  memories = db.query<MemRow, [number]>(`
    SELECT content, tags, memory_type FROM memories
    WHERE deleted_at IS NULL
      AND (tags LIKE '%preference%' OR tags LIKE '%error_resolution%')
      AND tags LIKE '%auto_extract%'
      AND created_at > ?
    ORDER BY updated_at DESC
    LIMIT 80
  `).all(cutoffSecs);
  db.close();
} catch (e) {
  trace(TAG, `DB query failed: ${(e as Error).message}`);
  updateState({ lastRun: new Date().toISOString(), lastMemoryCount: 0 });
  process.exit(0);
}

trace(TAG, `found ${memories.length} qualifying memories`);

// --- 2. Tool-signal context (re-edits) ---

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
} catch (e) { trace(TAG, `tool signals read failed: ${(e as Error).message}`); }

// --- 3. Feedback signals (last 60 days, polarity-labelled) ---

interface FeedbackEntry {
  polarity: "positive" | "negative";
  trigger: string;
  prompt: string;
  prior_text?: string;
  prior_tools?: string[];
  prior_files?: string[];
}
const feedback: FeedbackEntry[] = [];
try {
  if (existsSync(dataPaths.feedback)) {
    const cutoffISO = new Date(Date.now() - 60 * 86400000).toISOString();
    const lines = readFileSync(dataPaths.feedback, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const sig = JSON.parse(line);
        if (sig.timestamp >= cutoffISO && (sig.polarity === "positive" || sig.polarity === "negative")) {
          feedback.push(sig);
        }
      } catch { /* skip malformed */ }
    }
  }
} catch (e) { trace(TAG, `feedback read failed: ${(e as Error).message}`); }

trace(TAG, `loaded ${feedback.length} feedback entries (60d)`);

// Need *some* signal to consolidate
if (memories.length + feedback.length < 3) {
  trace(TAG, "insufficient signal for synthesis, skip");
  reportHook(TAG, "ConsolidationRun", "background", {
    decision: "advisory",
    detail: `skip: ${memories.length} memories, ${feedback.length} feedback`,
  });
  updateState({ lastRun: new Date().toISOString(), lastMemoryCount: memories.length });
  process.exit(0);
}

// Partition memories by polarity (validated tag → keep, otherwise → avoid)
const validatedMems = memories.filter(m => m.tags.includes("validated"));
const avoidMems = memories.filter(m => !m.tags.includes("validated"));

// --- 4. Synthesis ---

interface Rule { rule: string; polarity: "avoid" | "validated"; frequency: number; }

function fmtFeedback(f: FeedbackEntry): string {
  const what = (f.prior_tools ?? []).join("+") || "approach";
  const where = (f.prior_files ?? []).length ? " on " + (f.prior_files ?? []).join(",") : "";
  const why = (f.prior_text ?? "").slice(0, 120);
  const prefix = f.polarity === "positive"
    ? `User affirmed "${f.trigger}" after`
    : `User pushed back "${f.prompt.slice(0, 80)}" after`;
  return `${prefix} ${what}${where}${why ? ": " + why : ""}`;
}

async function llmSynthesize(): Promise<Rule[] | null> {
  const apiKey = Bun.env.OPENROUTER_API_KEY;
  if (!apiKey) return null;
  const model = Bun.env.CONSTRUCT_SYNTH_MODEL ?? "google/gemini-2.0-flash-001";

  const negObs = [
    ...avoidMems.map(m => m.content),
    ...feedback.filter(f => f.polarity === "negative").map(fmtFeedback),
  ].slice(0, 60);

  const posObs = [
    ...validatedMems.map(m => m.content),
    ...feedback.filter(f => f.polarity === "positive").map(fmtFeedback),
  ].slice(0, 60);

  if (negObs.length + posObs.length < 3) return null;

  const userMsg = [
    "Distill the following observations from a developer's interactions with an AI coding assistant into 5-10 short, actionable behavioral rules.",
    "",
    "AVOID — corrections, pushback, things the user did NOT want:",
    ...negObs.map(s => `- ${s}`),
    "",
    "VALIDATED — approaches the user explicitly affirmed:",
    ...posObs.map(s => `- ${s}`),
    toolSignalContext,
    "",
    "Each rule must:",
    "- be specific (mention concrete tools, files, or approaches when present)",
    "- be one sentence under 130 characters",
    "- drop one-off observations unlikely to recur",
    "",
    `Reply with JSON only: {"rules": [{"text": "...", "polarity": "avoid" | "validated", "frequency": <int>}]}`,
  ].join("\n");

  try {
    const abort = new AbortController();
    const t = setTimeout(() => abort.abort(), 30_000);
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: abort.signal,
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${apiKey}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: "You distill developer interaction patterns into concise behavioral rules. Reply with valid JSON only." },
          { role: "user", content: userMsg },
        ],
        max_tokens: 1500,
        response_format: { type: "json_object" },
      }),
    });
    clearTimeout(t);
    if (!res.ok) { trace(TAG, `synth http ${res.status}`); return null; }
    const data = await res.json() as any;
    const text = data?.choices?.[0]?.message?.content;
    if (!text) return null;
    const parsed = JSON.parse(text);
    const raw = Array.isArray(parsed?.rules) ? parsed.rules : [];
    const rules: Rule[] = raw
      .filter((r: any) => typeof r?.text === "string" && r.text.length > 10)
      .map((r: any) => ({
        rule: String(r.text).trim().slice(0, 200),
        polarity: r.polarity === "validated" ? "validated" : "avoid",
        frequency: Math.max(1, Number(r.frequency) || 1),
      }))
      .slice(0, 10);
    trace(TAG, `llm synth: ${rules.length} rules from ${negObs.length}+${posObs.length} observations`);
    return rules.length ? rules : null;
  } catch (e) {
    trace(TAG, `llm synth failed: ${(e as Error).message}`);
    return null;
  }
}

// --- 4b. Jaccard fallback (no API key) — cluster within each polarity ---

function tokenize(text: string): Set<string> {
  return new Set(
    text.toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter(w => w.length > 4 && !/^(the|and|for|with|from|that|this|into|have|been|will|were|session|error|memory|claude|construct|approach|required|needed|multiple|corrections)$/.test(w))
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const inter = [...a].filter(x => b.has(x)).length;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 0 : inter / union;
}

function extractRuleText(content: string): string {
  const stripped = content
    .replace(/^(Error:|Re-edit friction:|User correction:|Validated approach[^:]*:)\s*/i, "")
    .replace(/#+\s+\S[^\n]*/g, "")
    .replace(/\s{2,}/g, " ");
  for (const segment of stripped.split(/[.\n]+/)) {
    const clean = segment.trim().replace(/\s+/g, " ");
    if (clean.length >= 20 && clean.length <= 150) return clean;
  }
  return stripped.replace(/\s+/g, " ").trim().slice(0, 150);
}

function jaccardCluster(rows: MemRow[], polarity: "avoid" | "validated", limit: number): Rule[] {
  if (rows.length === 0) return [];
  const clusters: MemRow[][] = [];
  for (const row of rows) {
    const tokens = tokenize(row.content);
    let placed = false;
    for (const cluster of clusters) {
      if (jaccard(tokens, tokenize(cluster[0].content)) >= 0.25) {
        cluster.push(row); placed = true; break;
      }
    }
    if (!placed) clusters.push([row]);
  }
  return clusters
    .sort((a, b) => b.length - a.length)
    .slice(0, limit)
    .map(c => ({ rule: extractRuleText(c[0].content), polarity, frequency: c.length }))
    .filter(r => r.rule.length > 10);
}

// --- 5. Run synthesis ---

let rules: Rule[] = (await llmSynthesize()) ?? [];
let synthesizer: "llm" | "jaccard" = "llm";
if (rules.length === 0) {
  synthesizer = "jaccard";
  rules = [
    ...jaccardCluster(avoidMems, "avoid", 6),
    ...jaccardCluster(validatedMems, "validated", 4),
  ];
  trace(TAG, `jaccard fallback: ${rules.length} rules (${avoidMems.length} avoid, ${validatedMems.length} validated)`);
}

// --- 6. Write learned-rules.md ---

if (rules.length > 0) {
  const tag = (p: string) => p === "validated" ? "[keep]" : "[avoid]";
  const content = [
    `# Learned Rules`,
    `_Auto-generated ${new Date().toISOString().slice(0, 10)} from ${memories.length} memories + ${feedback.length} feedback (${synthesizer})_`,
    "",
    ...rules.map(r => r.frequency > 1
      ? `- ${tag(r.polarity)} ${r.rule} _(${r.frequency}x)_`
      : `- ${tag(r.polarity)} ${r.rule}`),
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

// --- 7. Store summary memory via memory-writer.py ---

const VENV_PYTHON = Bun.env.MEMORY_VENV_PYTHON ?? resolve(
  Bun.env.HOME ?? "/tmp",
  ".local/share/uv/tools/mcp-memory-service/bin/python",
);
const writerScript = resolve(dirname(Bun.main), "memory-writer.py");

const summaryContent = rules.length > 0
  ? `Consolidated ${memories.length}m+${feedback.length}f → ${rules.length} rules (${synthesizer}): ${rules.map(r => r.rule).join("; ")}`
  : `Consolidation ran on ${memories.length} memories — no recurring patterns found`;

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

// --- 8. Update state ---

updateState({ lastRun: new Date().toISOString(), lastMemoryCount: memories.length });

reportHook(TAG, "ConsolidationRun", "background", {
  decision: "pass",
  detail: `${rules.length} rules from ${memories.length}m+${feedback.length}f via ${synthesizer}`,
});

trace(TAG, "consolidator done");
process.exit(0);
