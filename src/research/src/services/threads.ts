import type { Sqlite } from '@construct/data';
import { nanoid } from 'nanoid';
import type { ResearchThread, ThreadOrigin, ThreadStatus, PerturbationStrategy } from '../types.js';

function rowToThread(row: Record<string, unknown>): ResearchThread {
  return row as unknown as ResearchThread;
}

export function createThread(
  sqlite: Sqlite,
  params: {
    session_id: string;
    query: string;
    origin: ThreadOrigin;
    parent_thread_id?: string | null;
    spawned_from_finding_id?: string | null;
    perturbation_strategy?: PerturbationStrategy | null;
    priority?: number;
    depth?: number;
    max_depth?: number;
    status?: ThreadStatus;
  }
): ResearchThread {
  const id = nanoid();
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_threads
      (id, session_id, parent_thread_id, spawned_from_finding_id, query, origin,
       perturbation_strategy, status, priority, depth, max_depth, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.session_id,
    params.parent_thread_id ?? null,
    params.spawned_from_finding_id ?? null,
    params.query,
    params.origin,
    params.perturbation_strategy ?? null,
    params.status ?? 'queued',
    params.priority ?? 0.5,
    params.depth ?? 0,
    params.max_depth ?? 8,
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

export function selectNextThread(sqlite: Sqlite, sessionId: string): ResearchThread | null {
  const row = sqlite.prepare(`
    SELECT * FROM research_threads
    WHERE session_id = ? AND status IN ('queued', 'active')
    ORDER BY priority DESC, created_at ASC
    LIMIT 1
  `).get(sessionId) as Record<string, unknown> | null;
  return row ? rowToThread(row) : null;
}

export function updateThread(
  sqlite: Sqlite,
  id: string,
  updates: Partial<Pick<ResearchThread, 'status' | 'priority' | 'max_depth' | 'query'>>
): ResearchThread | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.priority !== undefined) { fields.push('priority = ?'); values.push(updates.priority); }
  if (updates.max_depth !== undefined) { fields.push('max_depth = ?'); values.push(updates.max_depth); }
  if (updates.query !== undefined) { fields.push('query = ?'); values.push(updates.query); }

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
