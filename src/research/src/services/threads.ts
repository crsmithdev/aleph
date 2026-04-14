import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { ResearchThread, ThreadOrigin, ThreadStatus, PerturbationStrategy } from '../types.js';

function rowToThread(row: Record<string, unknown>): ResearchThread {
  return {
    ...row,
    fetch_source_text: row.fetch_source_text == null ? null : Boolean(row.fetch_source_text),
  } as unknown as ResearchThread;
}

export function createThread(
  sqlite: Sqlite,
  params: {
    session_id: string;
    query: string;
    short_query?: string | null;
    node_type?: 'question' | 'topic';
    origin: ThreadOrigin;
    parent_thread_id?: string | null;
    spawned_from_finding_id?: string | null;
    perturbation_strategy?: PerturbationStrategy | null;
    priority?: number;
    depth?: number;
    max_depth?: number;
    min_searches?: number | null;
    fetch_source_text?: boolean | null;
    status?: ThreadStatus;
  }
): ResearchThread {
  const id = generateId();
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_threads
      (id, session_id, parent_thread_id, spawned_from_finding_id, query, short_query, node_type, origin,
       perturbation_strategy, status, priority, depth, max_depth, min_searches, fetch_source_text, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.session_id,
    params.parent_thread_id ?? null,
    params.spawned_from_finding_id ?? null,
    params.query,
    params.short_query ?? null,
    params.node_type ?? 'question',
    params.origin,
    params.perturbation_strategy ?? null,
    params.status ?? 'queued',
    params.priority ?? 0.5,
    params.depth ?? 0,
    params.max_depth ?? 9,
    params.min_searches ?? null,
    params.fetch_source_text === undefined ? null : (params.fetch_source_text ? 1 : 0),
    now,
    now
  );

  return getThread(sqlite, id)!;
}

export function getThread(sqlite: Sqlite, id: string): ResearchThread | null {
  const row = sqlite.prepare('SELECT * FROM research_threads WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToThread(row) : null;
}

export function listThreads(sqlite: Sqlite, sessionId: string, status?: ThreadStatus): ResearchThread[] {
  if (status) {
    return (sqlite.prepare(
      'SELECT * FROM research_threads WHERE session_id = ? AND status = ? ORDER BY priority DESC, created_at ASC'
    ).all(sessionId, status) as Record<string, unknown>[]).map(rowToThread);
  }
  return (sqlite.prepare(
    'SELECT * FROM research_threads WHERE session_id = ? ORDER BY priority DESC, created_at ASC'
  ).all(sessionId) as Record<string, unknown>[]).map(rowToThread);
}

export function hasQueuedThreads(sqlite: Sqlite, sessionId: string): boolean {
  const row = sqlite.prepare(
    "SELECT 1 FROM research_threads WHERE session_id = ? AND status = 'queued' LIMIT 1"
  ).get(sessionId);
  return !!row;
}

export function selectNextThread(sqlite: Sqlite, sessionId: string): ResearchThread | null {
  const row = sqlite.prepare(`
    SELECT * FROM research_threads
    WHERE session_id = ? AND status IN ('queued', 'active')
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).get(sessionId) as Record<string, unknown> | null;
  return row ? rowToThread(row) : null;
}

/** Atomically selects the highest-priority queued thread and marks it active.
 *  Safe to call from concurrent async slots — only one caller will get each thread. */
export function claimNextThread(sqlite: Sqlite, sessionId: string): ResearchThread | null {
  const row = sqlite.prepare(`
    SELECT * FROM research_threads
    WHERE session_id = ? AND status = 'queued'
      AND (retry_after IS NULL OR retry_after <= datetime('now'))
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).get(sessionId) as Record<string, unknown> | null;
  if (!row) return null;

  const result = sqlite.prepare(`
    UPDATE research_threads
    SET status = 'active', updated_at = datetime('now')
    WHERE id = ? AND status = 'queued'
  `).run((row as { id: string }).id);

  // Another slot claimed it first — try again
  if (result.changes === 0) return claimNextThread(sqlite, sessionId);

  return getThread(sqlite, (row as { id: string }).id);
}

export function updateThread(
  sqlite: Sqlite,
  id: string,
  updates: Partial<Pick<ResearchThread, 'status' | 'priority' | 'max_depth' | 'query' | 'short_query' | 'min_searches' | 'fetch_source_text' | 'retry_after'>>
): ResearchThread | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
  if (updates.max_depth !== undefined) { fields.push('max_depth = ?'); values.push(updates.max_depth); }
  if (updates.query !== undefined) { fields.push('query = ?'); values.push(updates.query); }
  if (updates.short_query !== undefined) { fields.push('short_query = ?'); values.push(updates.short_query); }
  if (updates.min_searches !== undefined) { fields.push('min_searches = ?'); values.push(updates.min_searches); }
  if (updates.fetch_source_text !== undefined) {
    fields.push('fetch_source_text = ?');
    values.push(updates.fetch_source_text === null ? null : (updates.fetch_source_text ? 1 : 0));
  }
  if (updates.retry_after !== undefined) { fields.push('retry_after = ?'); values.push(updates.retry_after); }

  if (fields.length === 0) return getThread(sqlite, id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  sqlite.prepare(`UPDATE research_threads SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getThread(sqlite, id);
}

export function countThreadsByOrigin(sqlite: Sqlite, sessionId: string): Record<string, number> {
  const rows = sqlite.prepare(
    'SELECT origin, COUNT(*) as count FROM research_threads WHERE session_id = ? GROUP BY origin'
  ).all(sessionId) as { origin: string; count: number }[];
  return Object.fromEntries(rows.map(r => [r.origin, r.count]));
}

export function countExhaustedThreads(sqlite: Sqlite, sessionId: string): number {
  const row = sqlite.prepare(
    "SELECT COUNT(*) as count FROM research_threads WHERE session_id = ? AND status = 'exhausted'"
  ).get(sessionId) as { count: number };
  return row.count;
}

/** Reset threads stuck in 'active' status with no corresponding active job back to 'queued'.
 *  Handles the case where a worker dies mid-execution leaving threads orphaned. */
export function resetOrphanedActiveThreads(sqlite: Sqlite): number {
  const result = sqlite.prepare(`
    UPDATE research_threads
    SET status = 'queued', updated_at = datetime('now')
    WHERE status = 'active'
    AND id NOT IN (
      SELECT thread_id FROM research_jobs
      WHERE thread_id IS NOT NULL
      AND status IN ('pending', 'claimed', 'running')
    )
  `).run();
  return result.changes;
}
