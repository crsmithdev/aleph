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
import {
  ruleFingerprint, similarity, effectivenessScore,
  type EffectivenessTable, type EffectivenessRow,
} from "./rule-fingerprint.ts";

// Effectiveness thresholds
const PERSISTENT_THRESHOLD = 0.5;   // effectiveness below → flag with [!!]
const PERSISTENT_MIN_INJECTIONS = 3;
const INTERNALIZED_THRESHOLD = 0.95; // effectiveness above → drop from synthesis
const INTERNALIZED_MIN_INJECTIONS = 8;

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
  session_id?: string;
  timestamp?: string;
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

// --- 3b. Score effectiveness of previously-injected rules ---
// Read injection log + previous effectiveness state, then attribute new
// feedback to past rules by token similarity. Update counts incrementally.
//
// Persistent issues (low effectiveness, many recurrences) bubble to the top
// of the next learned-rules.md with a [!!] marker. Internalized rules
// (high effectiveness, many injections) are dropped from synthesis input.

interface SimpleFeedback { polarity: "positive" | "negative"; text: string; timestamp: string; session_id: string; }
interface Injection { timestamp: string; session_id: string; rule_hash: string; rule_text: string; polarity: "avoid" | "validated"; }

let effState: { lastProcessed: string; table: EffectivenessTable } = {
  lastProcessed: new Date(0).toISOString(),
  table: {},
};
try {
  if (existsSync(dataPaths.ruleEffectiveness)) {
    effState = JSON.parse(readFileSync(dataPaths.ruleEffectiveness, "utf8"));
    if (!effState.table) effState.table = {};
    if (!effState.lastProcessed) effState.lastProcessed = new Date(0).toISOString();
  }
} catch (e) { trace(TAG, `eff state read failed: ${(e as Error).message}`); }

const injections: Injection[] = [];
try {
  if (existsSync(dataPaths.ruleInjections)) {
    const lines = readFileSync(dataPaths.ruleInjections, "utf8").trim().split("\n").filter(Boolean);
    for (const line of lines) {
      try {
        const r = JSON.parse(line);
        if (r.timestamp > effState.lastProcessed) injections.push(r);
      } catch { /* skip */ }
    }
  }
} catch (e) { trace(TAG, `injections read failed: ${(e as Error).message}`); }

// Build feedback index by session for quick lookup
const fbBySession: Record<string, SimpleFeedback[]> = {};
for (const f of feedback) {
  // The full feedback row from §3 was typed FeedbackEntry; reuse a flatter shape
  const sid = f.session_id ?? "unknown";
  const ts = f.timestamp ?? "";
  if (!fbBySession[sid]) fbBySession[sid] = [];
  fbBySession[sid].push({
    polarity: f.polarity,
    text: [f.prompt, f.prior_text].filter(Boolean).join(" "),
    timestamp: ts,
    session_id: sid,
  });
}

const SIM_THRESHOLD = 0.4;
const now = new Date().toISOString();

for (const inj of injections) {
  const row: EffectivenessRow = effState.table[inj.rule_hash] ?? {
    text: inj.rule_text,
    polarity: inj.polarity,
    first_seen: inj.timestamp,
    last_seen: inj.timestamp,
    injections: 0,
    recurrences: 0,
    reaffirmations: 0,
  };
  row.injections += 1;
  row.last_seen = inj.timestamp > row.last_seen ? inj.timestamp : row.last_seen;

  const sessFb = fbBySession[inj.session_id] ?? [];
  for (const fb of sessFb) {
    if (fb.timestamp <= inj.timestamp) continue; // feedback must come after injection
    if (!fb.text) continue;
    const sim = similarity(inj.rule_text, fb.text);
    if (sim < SIM_THRESHOLD) continue;
    if (fb.polarity === "negative" && row.polarity === "avoid") row.recurrences += 1;
    else if (fb.polarity === "positive" && row.polarity === "validated") row.reaffirmations += 1;
  }

  effState.table[inj.rule_hash] = row;
}

effState.lastProcessed = now;

// Garbage-collect rules unseen for >90 days
const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000).toISOString();
for (const [hash, row] of Object.entries(effState.table)) {
  if (row.last_seen < ninetyDaysAgo) delete effState.table[hash];
}

trace(TAG, `effectiveness: ${injections.length} new injections, ${Object.keys(effState.table).length} tracked rules`);

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
let avoidMems = memories.filter(m => !m.tags.includes("validated"));

// Drop memories that map to already-internalized rules — re-deriving them adds noise
const internalizedRules = Object.values(effState.table).filter(row => {
  const score = effectivenessScore(row);
  return score !== null && score >= INTERNALIZED_THRESHOLD && row.injections >= INTERNALIZED_MIN_INJECTIONS;
});
if (internalizedRules.length > 0) {
  const before = avoidMems.length;
  avoidMems = avoidMems.filter(m => !internalizedRules.some(r => similarity(r.text, m.content) >= 0.4));
  trace(TAG, `dropped ${before - avoidMems.length} memories matching ${internalizedRules.length} internalized rules`);
}

// Persistent issues — rules with low effectiveness despite multiple injections
const persistentRules = Object.values(effState.table)
  .filter(row => {
    const score = effectivenessScore(row);
    return score !== null && score < PERSISTENT_THRESHOLD && row.injections >= PERSISTENT_MIN_INJECTIONS;
  })
  .sort((a, b) => (effectivenessScore(a) ?? 1) - (effectivenessScore(b) ?? 1))
  .slice(0, 5);

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

  const persistentBlock = persistentRules.length > 0
    ? [
        "",
        "PERSISTENT ISSUES — these rules were already learned, but the user keeps hitting them. Restate in fresh, sharper language so they land:",
        ...persistentRules.map(r => `- "${r.text}" (${r.recurrences} recurrences in ${r.injections} injections)`),
      ].join("\n")
    : "";

  const userMsg = [
    "Distill the following observations from a developer's interactions with an AI coding assistant into 5-10 short, actionable behavioral rules.",
    "",
    "AVOID — corrections, pushback, things the user did NOT want:",
    ...negObs.map(s => `- ${s}`),
    "",
    "VALIDATED — approaches the user explicitly affirmed:",
    ...posObs.map(s => `- ${s}`),
    toolSignalContext,
    persistentBlock,
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

// --- 5b. Mark persistent issues + sort by effectiveness ---
// Each rule gets its fingerprint resolved against effState. Rules that match
// a persistent fingerprint get [!!] and bubble to the top. Internalized
// matches are dropped — they were filtered from synthesis input but the model
// may have re-derived them anyway.

interface ScoredRule extends Rule { persistent: boolean; effHash: string; }
const scored: ScoredRule[] = [];
for (const r of rules) {
  const hash = ruleFingerprint(r.rule);
  const exact = effState.table[hash];
  let persistent = false;
  if (exact) {
    const s = effectivenessScore(exact);
    if (s !== null && s >= INTERNALIZED_THRESHOLD && exact.injections >= INTERNALIZED_MIN_INJECTIONS) continue;
    if (s !== null && s < PERSISTENT_THRESHOLD && exact.injections >= PERSISTENT_MIN_INJECTIONS) persistent = true;
  } else {
    // No exact fingerprint — check fuzzy match against persistent rules
    const fuzzy = persistentRules.find(p => similarity(p.text, r.rule) >= 0.5);
    if (fuzzy) persistent = true;
  }
  scored.push({ ...r, persistent, effHash: hash });
}

scored.sort((a, b) => {
  // persistent avoid > regular avoid > validated
  const rank = (s: ScoredRule) => (s.persistent ? 0 : (s.polarity === "avoid" ? 1 : 2));
  return rank(a) - rank(b);
});

// --- 6. Write learned-rules.md ---

if (scored.length > 0) {
  const tag = (p: string) => p === "validated" ? "[keep]" : "[avoid]";
  const content = [
    `# Learned Rules`,
    `_Auto-generated ${new Date().toISOString().slice(0, 10)} from ${memories.length} memories + ${feedback.length} feedback (${synthesizer})_`,
    "",
    ...scored.map(r => {
      const prefix = r.persistent ? "[!!] " : "";
      const suffix = r.frequency > 1 ? ` _(${r.frequency}x)_` : "";
      return `- ${prefix}${tag(r.polarity)} ${r.rule}${suffix}`;
    }),
    "",
  ].join("\n");
  try {
    mkdirSync(dirname(dataPaths.learnedRules), { recursive: true });
    writeFileSync(dataPaths.learnedRules, content);
    trace(TAG, `wrote ${scored.length} rules to learned-rules.md (${scored.filter(r => r.persistent).length} persistent)`);
  } catch (e) {
    trace(TAG, `rules write failed: ${(e as Error).message}`);
  }
}

// --- 6b. Persist effectiveness state ---
try {
  mkdirSync(dirname(dataPaths.ruleEffectiveness), { recursive: true });
  writeFileSync(dataPaths.ruleEffectiveness, JSON.stringify(effState, null, 2));
} catch (e) { trace(TAG, `eff state write failed: ${(e as Error).message}`); }

// --- 7. Store summary memory via memory-writer.py ---

const VENV_PYTHON = Bun.env.MEMORY_VENV_PYTHON ?? resolve(
  Bun.env.HOME ?? "/tmp",
  ".local/share/uv/tools/mcp-memory-service/bin/python",
);
const writerScript = resolve(dirname(Bun.main), "memory-writer.py");

const summaryContent = scored.length > 0
  ? `Consolidated ${memories.length}m+${feedback.length}f → ${scored.length} rules (${synthesizer}, ${scored.filter(r => r.persistent).length} persistent): ${scored.map(r => r.rule).join("; ")}`
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
  detail: `${scored.length} rules from ${memories.length}m+${feedback.length}f via ${synthesizer}`,
});

trace(TAG, "consolidator done");
process.exit(0);
