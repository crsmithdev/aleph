import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import { emitResearchEvent } from './events.js';
import { getThread } from './threads.js';
import type { ResearchFinding, FollowUpAnalysis, FindingKind, ResearchThread } from '../types.js';

/** Forward-looking phrases that indicate speculation about the future.
 *  These cause `kind = 'speculation'` and cap confidence at 0.5. */
const FORWARD_DATE_RE = /\b(?:by|in)\s+(?:20[3-9]\d|2[1-9]\d{2})\b/i;
const FORWARD_VERB_RE = /\b(?:will\s+(?:be|become|evolve|likely|probably)|projected\s+to|forecast(?:ed)?\s+to|expected\s+to)\b/i;

/** Cap applied to speculation findings — futurist content can't masquerade
 *  as fact regardless of how authoritative the synthesis LLM sounds. */
export const SPECULATION_CONFIDENCE_CAP = 0.5;

/** Classify a finding's kind based on its parent thread and content. Pure
 *  function — no DB access. The caller is expected to look up the thread
 *  once and pass the relevant fields plus the synthesized text.
 *
 *  Speculation is detected from *text*, not from strategy name: if the
 *  finding contains forward-looking phrases (dates ≥2030 or verbs like
 *  "will evolve", "projected to"), it's classified as speculation
 *  regardless of which thread produced it. The `temporal_shift`
 *  perturbation prompt is now constrained to backwards-only, so
 *  legitimate historical findings from it are not speculation; if the
 *  LLM disregards that constraint and produces forward-looking text
 *  anyway, the regex catches it. */
export function classifyFindingKind(args: {
  thread: Pick<ResearchThread, 'origin' | 'perturbation_strategy'> | null;
  text: string;
}): FindingKind {
  const { thread, text } = args;
  if (FORWARD_DATE_RE.test(text) || FORWARD_VERB_RE.test(text)) return 'speculation';
  if (thread?.origin === 'perturbation') return 'perturbation';
  return 'normal';
}

/** Apply the speculation cap. Returns `{ confidence, capped }` where
 *  `capped` is the original value if a cap was applied (so callers can
 *  record `confidence_cap_applied` metadata on the synthesis step). */
export function applySpeculationCap(kind: FindingKind, confidence: number): { confidence: number; capped: number | null } {
  if (kind === 'speculation' && confidence > SPECULATION_CONFIDENCE_CAP) {
    return { confidence: SPECULATION_CONFIDENCE_CAP, capped: confidence };
  }
  return { confidence, capped: null };
}

function migrateFollowUpAnalysis(analysis: FollowUpAnalysis): FollowUpAnalysis {
  return {
    ...analysis,
    candidates: analysis.candidates?.map(c => {
      const legacy = c as unknown as Record<string, unknown>;
      if ('jaccard_similarity' in legacy && !('dedup_similarity' in legacy)) {
        const { jaccard_similarity, ...rest } = legacy;
        return { ...rest, dedup_similarity: jaccard_similarity } as typeof c;
      }
      return c;
    }),
  };
}

function rowToFinding(row: Record<string, unknown>): ResearchFinding {
  return {
    ...row,
    source_urls: JSON.parse(row.source_urls as string),
    source_texts: JSON.parse((row.source_texts as string) ?? '[]'),
    source_url_meta: JSON.parse((row.source_url_meta as string) ?? '[]'),
    tags: JSON.parse(row.tags as string),
    kind: ((row.kind as string) ?? 'normal') as FindingKind,
    follow_ups: JSON.parse((row.follow_ups ?? row.follow_up_questions ?? '[]') as string),
    follow_up_analysis: row.follow_up_analysis ? migrateFollowUpAnalysis(JSON.parse(row.follow_up_analysis as string)) : undefined,
  } as unknown as ResearchFinding;
}

export function createFinding(
  sqlite: Sqlite,
  params: {
    thread_id: string;
    session_id: string;
    content: string;
    summary: string;
    source_urls?: string[];
    source_texts?: string[];
    source_url_meta?: Array<{ url: string; title: string; snippet: string }>;
    source_quality?: number;
    tags?: string[];
    confidence?: number;
    novelty?: number;
    actionability?: number;
    follow_ups?: string[];
    follow_up_analysis?: FollowUpAnalysis;
    /** Override the auto-classified kind. Tests pass this directly; the
     *  engine relies on auto-classification from the parent thread. */
    kind?: FindingKind;
  }
): ResearchFinding {
  const id = generateId();
  const now = new Date().toISOString();

  // Auto-classify based on parent thread + finding text unless caller
  // overrode `kind` explicitly. `getThread` is an indexed PK lookup —
  // cheap, but this is once per finding so even a slow path is fine.
  const classifyText = `${params.summary}\n${params.content}`;
  const parent = params.kind === undefined ? getThread(sqlite, params.thread_id) : null;
  const kind = params.kind ?? classifyFindingKind({ thread: parent, text: classifyText });
  const rawConfidence = params.confidence ?? 0.5;
  const { confidence } = applySpeculationCap(kind, rawConfidence);

  sqlite.prepare(`
    INSERT INTO research_findings
      (id, thread_id, session_id, content, summary, source_urls, source_texts, source_url_meta,
       source_quality, tags, confidence, novelty, actionability, kind, follow_ups, follow_up_analysis, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.thread_id,
    params.session_id,
    params.content,
    params.summary,
    JSON.stringify(params.source_urls ?? []),
    JSON.stringify(params.source_texts ?? []),
    JSON.stringify(params.source_url_meta ?? []),
    params.source_quality ?? 0.5,
    JSON.stringify(params.tags ?? []),
    confidence,
    params.novelty ?? 0.5,
    params.actionability ?? 0.5,
    kind,
    JSON.stringify(params.follow_ups ?? []),
    params.follow_up_analysis ? JSON.stringify(params.follow_up_analysis) : null,
    now
  );

  const finding = getFinding(sqlite, id)!;
  emitResearchEvent(finding.session_id, 'finding', finding);
  return finding;
}

export function getFinding(sqlite: Sqlite, id: string): ResearchFinding | null {
  const row = sqlite.prepare('SELECT * FROM research_findings WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToFinding(row) : null;
}

export function listFindings(
  sqlite: Sqlite,
  sessionId: string,
  opts?: { threadId?: string; limit?: number; sort?: 'created_at' | 'novelty' | 'confidence' }
): ResearchFinding[] {
  let sql = 'SELECT * FROM research_findings WHERE session_id = ?';
  const params: unknown[] = [sessionId];

  if (opts?.threadId) {
    sql += ' AND thread_id = ?';
    params.push(opts.threadId);
  }

  const sortCol = opts?.sort ?? 'created_at';
  sql += ` ORDER BY ${sortCol} DESC`;

  if (opts?.limit) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }

  return (sqlite.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToFinding);
}

export function updateFinding(
  sqlite: Sqlite,
  id: string,
  updates: Partial<Pick<ResearchFinding, 'user_rating' | 'novelty' | 'follow_up_analysis'>>
): ResearchFinding | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.user_rating !== undefined) { fields.push('user_rating = ?'); values.push(updates.user_rating); }
  if (updates.novelty !== undefined) { fields.push('novelty = ?'); values.push(updates.novelty); }
  if (updates.follow_up_analysis !== undefined) {
    fields.push('follow_up_analysis = ?');
    values.push(updates.follow_up_analysis ? JSON.stringify(updates.follow_up_analysis) : null);
  }

  if (fields.length === 0) return getFinding(sqlite, id);
  values.push(id);

  sqlite.prepare(`UPDATE research_findings SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const finding = getFinding(sqlite, id);
  if (finding) emitResearchEvent(finding.session_id, 'finding', finding);
  return finding;
}

export function getRecentFindings(sqlite: Sqlite, sessionId: string, count: number): ResearchFinding[] {
  return (sqlite.prepare(
    'SELECT * FROM research_findings WHERE session_id = ? ORDER BY created_at DESC LIMIT ?'
  ).all(sessionId, count) as Record<string, unknown>[]).map(rowToFinding);
}

export function updateFindingSourceTexts(
  sqlite: Sqlite,
  findingId: string,
  sourceTexts: string[]
): ResearchFinding | null {
  sqlite.prepare('UPDATE research_findings SET source_texts = ? WHERE id = ?')
    .run(JSON.stringify(sourceTexts), findingId);
  return getFinding(sqlite, findingId);
}

export function clearThreadFindings(sqlite: Sqlite, threadId: string): void {
  sqlite.prepare('DELETE FROM research_steps WHERE thread_id = ?').run(threadId);
  sqlite.prepare('DELETE FROM research_findings WHERE thread_id = ?').run(threadId);
}

export function countFindings(sqlite: Sqlite, sessionId: string, opts?: { thread_id?: string }): number {
  if (opts?.thread_id) {
    const row = sqlite.prepare(
      'SELECT COUNT(*) as count FROM research_findings WHERE session_id = ? AND thread_id = ?'
    ).get(sessionId, opts.thread_id) as { count: number };
    return row.count;
  }
  const row = sqlite.prepare(
    'SELECT COUNT(*) as count FROM research_findings WHERE session_id = ?'
  ).get(sessionId) as { count: number };
  return row.count;
}
