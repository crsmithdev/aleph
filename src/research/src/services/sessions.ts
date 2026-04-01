import type { Sqlite } from '@construct/data';
import { nanoid } from 'nanoid';
import type { ResearchSession, SessionConfig } from '../types.js';
import { DEFAULT_SESSION_CONFIG } from '../types.js';

function rowToSession(row: Record<string, unknown>): ResearchSession {
  return {
    ...row,
    config: JSON.parse(row.config as string),
  } as ResearchSession;
}

export function createSession(
  sqlite: Sqlite,
  title: string,
  seedQuery: string,
  config?: Partial<SessionConfig>
): ResearchSession {
  const id = nanoid();
  const mergedConfig = { ...DEFAULT_SESSION_CONFIG, ...config };
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_sessions (id, title, seed_query, status, config, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)
  `).run(id, title, seedQuery, JSON.stringify(mergedConfig), now, now);

  return getSession(sqlite, id)!;
}

export function getSession(sqlite: Sqlite, id: string): ResearchSession | null {
  const row = sqlite.prepare('SELECT * FROM research_sessions WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToSession(row) : null;
}

export function listSessions(sqlite: Sqlite, status?: string): ResearchSession[] {
  if (status) {
    return (sqlite.prepare('SELECT * FROM research_sessions WHERE status = ? ORDER BY updated_at DESC').all(status) as Record<string, unknown>[]).map(rowToSession);
  }
  return (sqlite.prepare('SELECT * FROM research_sessions ORDER BY updated_at DESC').all() as Record<string, unknown>[]).map(rowToSession);
}

export function updateSession(
  sqlite: Sqlite,
  id: string,
  updates: Partial<Pick<ResearchSession, 'status' | 'summary' | 'user_notes' | 'title'>>
): ResearchSession | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary); }
  if (updates.user_notes !== undefined) { fields.push('user_notes = ?'); values.push(updates.user_notes); }
  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }

  if (fields.length === 0) return getSession(sqlite, id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  sqlite.prepare(`UPDATE research_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getSession(sqlite, id);
}

export function getSessionCost(sqlite: Sqlite, sessionId: string): { total_cost: number; step_count: number; today_cost: number } {
  const total = sqlite.prepare(
    'SELECT COALESCE(SUM(cost_usd), 0) as total_cost, COUNT(*) as step_count FROM research_steps WHERE session_id = ?'
  ).get(sessionId) as { total_cost: number; step_count: number };

  const today = sqlite.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as today_cost FROM research_steps WHERE session_id = ? AND created_at >= date('now')"
  ).get(sessionId) as { today_cost: number };

  return { ...total, today_cost: today.today_cost };
}
