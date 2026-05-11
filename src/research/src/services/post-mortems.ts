import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';

export interface PostMortemRecord {
  id: string;
  session_id: string;
  job_id: string | null;
  verdict: 'pass' | 'flag';
  flags: string[];
  notes: string;
  recommendations: string[];
  metrics_snapshot: Record<string, unknown>;
  created_at: string;
}

function rowTo(row: Record<string, unknown>): PostMortemRecord {
  let flags: string[] = [];
  let recs: string[] = [];
  let snap: Record<string, unknown> = {};
  try { flags = JSON.parse((row.flags as string) ?? '[]') as string[]; } catch { /* malformed */ }
  try { recs = JSON.parse((row.recommendations as string) ?? '[]') as string[]; } catch { /* malformed */ }
  try { snap = JSON.parse((row.metrics_snapshot as string) ?? '{}') as Record<string, unknown>; } catch { /* malformed */ }
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    job_id: (row.job_id as string | null) ?? null,
    verdict: row.verdict as PostMortemRecord['verdict'],
    flags,
    notes: (row.notes as string) ?? '',
    recommendations: recs,
    metrics_snapshot: snap,
    created_at: row.created_at as string,
  };
}

export function recordPostMortem(sqlite: Sqlite, input: {
  session_id: string;
  job_id?: string | null;
  verdict: PostMortemRecord['verdict'];
  flags: string[];
  notes: string;
  recommendations: string[];
  metrics_snapshot: Record<string, unknown>;
}): PostMortemRecord {
  const id = generateId();
  sqlite.prepare(`
    INSERT INTO research_post_mortems
      (id, session_id, job_id, verdict, flags, notes, recommendations, metrics_snapshot)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.session_id,
    input.job_id ?? null,
    input.verdict,
    JSON.stringify(input.flags),
    input.notes,
    JSON.stringify(input.recommendations),
    JSON.stringify(input.metrics_snapshot),
  );
  return getPostMortem(sqlite, id)!;
}

export function getPostMortem(sqlite: Sqlite, id: string): PostMortemRecord | null {
  const row = sqlite.prepare('SELECT * FROM research_post_mortems WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowTo(row) : null;
}

export function listPostMortems(sqlite: Sqlite, sessionId: string): PostMortemRecord[] {
  const rows = sqlite.prepare(
    'SELECT * FROM research_post_mortems WHERE session_id = ? ORDER BY created_at DESC'
  ).all(sessionId) as Record<string, unknown>[];
  return rows.map(rowTo);
}
