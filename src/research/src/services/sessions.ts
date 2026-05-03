import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { ResearchSession, SessionConfig } from '../types.js';
import { DEFAULT_SESSION_CONFIG } from '../types.js';
import { deleteQuery } from './queries.js';

function rowToSession(row: Record<string, unknown>): ResearchSession {
  const stored = JSON.parse(row.config as string) as Partial<SessionConfig>;
  // Deep-merge with defaults so sessions created before new config fields were added
  // still get valid defaults (e.g. follow_up added later).
  const config: SessionConfig = {
    ...DEFAULT_SESSION_CONFIG,
    ...stored,
    providers: { ...DEFAULT_SESSION_CONFIG.providers, ...(stored.providers ?? {}) },
    schedule: { ...DEFAULT_SESSION_CONFIG.schedule, ...(stored.schedule ?? {}) },
    perturbation: { ...DEFAULT_SESSION_CONFIG.perturbation, ...(stored.perturbation ?? {}) },
    follow_up: { ...DEFAULT_SESSION_CONFIG.follow_up, ...(stored.follow_up ?? {}) },
    topic_coherence: { ...DEFAULT_SESSION_CONFIG.topic_coherence, ...(stored.topic_coherence ?? {}) },
  };
  return { ...row, config } as unknown as ResearchSession;
}

export function createSession(
  sqlite: Sqlite,
  title: string,
  prompt: string,
  config?: Partial<SessionConfig>
): ResearchSession {
  const id = generateId();
  const mergedConfig = { ...DEFAULT_SESSION_CONFIG, ...config };
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_queries (id, title, prompt, status, config, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)
  `).run(id, title, prompt, JSON.stringify(mergedConfig), now, now);

  return getSession(sqlite, id)!;
}

export function getSession(sqlite: Sqlite, id: string): ResearchSession | null {
  const row = sqlite.prepare('SELECT * FROM research_queries WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToSession(row) : null;
}

export function listSessions(sqlite: Sqlite, status?: string): ResearchSession[] {
  if (status) {
    return (sqlite.prepare('SELECT * FROM research_queries WHERE status = ? ORDER BY updated_at DESC').all(status) as Record<string, unknown>[]).map(rowToSession);
  }
  return (sqlite.prepare('SELECT * FROM research_queries ORDER BY updated_at DESC').all() as Record<string, unknown>[]).map(rowToSession);
}

export function updateSession(
  sqlite: Sqlite,
  id: string,
  updates: Partial<Pick<ResearchSession, 'status' | 'summary' | 'user_notes' | 'title'>> & { config?: Partial<SessionConfig> }
): ResearchSession | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary); }
  if (updates.user_notes !== undefined) { fields.push('user_notes = ?'); values.push(updates.user_notes); }
  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.config !== undefined) {
    const existing = getSession(sqlite, id);
    if (existing) {
      const merged = { ...existing.config, ...updates.config,
        providers: { ...existing.config.providers, ...(updates.config.providers ?? {}) },
        gap_analysis: { ...existing.config.gap_analysis, ...(updates.config.gap_analysis ?? {}) },
        follow_up: { ...existing.config.follow_up, ...(updates.config.follow_up ?? {}) },
        topic_coherence: { ...existing.config.topic_coherence, ...(updates.config.topic_coherence ?? {}) },
      };
      fields.push('config = ?');
      values.push(JSON.stringify(merged));
    }
  }

  if (fields.length === 0) return getSession(sqlite, id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  sqlite.prepare(`UPDATE research_queries SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getSession(sqlite, id);
}

/** @deprecated Use deleteQuery from services/queries */
export function deleteSession(sqlite: Sqlite, sessionId: string): boolean {
  return deleteQuery(sqlite, sessionId);
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
