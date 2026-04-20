import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import { emitResearchEvent } from './events.js';
import type { ResearchFinding, FollowUpAnalysis } from '../types.js';

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
  }
): ResearchFinding {
  const id = generateId();
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_findings
      (id, thread_id, session_id, content, summary, source_urls, source_texts, source_url_meta,
       source_quality, tags, confidence, novelty, actionability, follow_ups, follow_up_analysis, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    params.confidence ?? 0.5,
    params.novelty ?? 0.5,
    params.actionability ?? 0.5,
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

export function countFindings(sqlite: Sqlite, sessionId: string): number {
  const row = sqlite.prepare(
    'SELECT COUNT(*) as count FROM research_findings WHERE session_id = ?'
  ).get(sessionId) as { count: number };
  return row.count;
}
