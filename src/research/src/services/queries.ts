import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { ResearchQuery, SessionConfig } from '../types.js';
import { DEFAULT_SESSION_CONFIG } from '../types.js';

function rowToQuery(row: Record<string, unknown>): ResearchQuery {
  const stored = JSON.parse(row.config as string) as Partial<SessionConfig>;
  // Deep-merge with defaults so queries created before new config fields were added
  // still get valid defaults (e.g. follow_up added later).
  const config: SessionConfig = {
    ...DEFAULT_SESSION_CONFIG,
    ...stored,
    providers: { ...DEFAULT_SESSION_CONFIG.providers, ...(stored.providers ?? {}) },
    schedule: { ...DEFAULT_SESSION_CONFIG.schedule, ...(stored.schedule ?? {}) },
    perturbation: { ...DEFAULT_SESSION_CONFIG.perturbation, ...(stored.perturbation ?? {}) },
    follow_up: { ...DEFAULT_SESSION_CONFIG.follow_up, ...(stored.follow_up ?? {}) },
  };
  return { ...row, config } as unknown as ResearchQuery;
}

export function createQuery(
  sqlite: Sqlite,
  title: string,
  seedQuery: string,
  config?: Partial<SessionConfig>
): ResearchQuery {
  const id = generateId();
  const mergedConfig = { ...DEFAULT_SESSION_CONFIG, ...config };
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_queries (id, title, seed_query, status, config, created_at, updated_at)
    VALUES (?, ?, ?, 'active', ?, ?, ?)
  `).run(id, title, seedQuery, JSON.stringify(mergedConfig), now, now);

  return getQuery(sqlite, id)!;
}

/** @deprecated Use createQuery */
export const createSession = createQuery;

export function getQuery(sqlite: Sqlite, id: string): ResearchQuery | null {
  const row = sqlite.prepare('SELECT * FROM research_queries WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToQuery(row) : null;
}

/** @deprecated Use getQuery */
export const getSession = getQuery;

export function listQueries(sqlite: Sqlite, status?: string): ResearchQuery[] {
  if (status) {
    return (sqlite.prepare('SELECT * FROM research_queries WHERE status = ? ORDER BY updated_at DESC').all(status) as Record<string, unknown>[]).map(rowToQuery);
  }
  return (sqlite.prepare('SELECT * FROM research_queries ORDER BY updated_at DESC').all() as Record<string, unknown>[]).map(rowToQuery);
}

/** @deprecated Use listQueries */
export const listSessions = listQueries;

export function updateQuery(
  sqlite: Sqlite,
  id: string,
  updates: Partial<Pick<ResearchQuery, 'status' | 'summary' | 'document' | 'user_notes' | 'title'>> & { config?: Partial<SessionConfig> }
): ResearchQuery | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary); }
  if (updates.document !== undefined) { fields.push('document = ?'); values.push(updates.document); }
  if (updates.user_notes !== undefined) { fields.push('user_notes = ?'); values.push(updates.user_notes); }
  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.config !== undefined) {
    const existing = getQuery(sqlite, id);
    if (existing) {
      const merged = { ...existing.config, ...updates.config,
        providers: { ...existing.config.providers, ...(updates.config.providers ?? {}) },
        gap_analysis: { ...existing.config.gap_analysis, ...(updates.config.gap_analysis ?? {}) },
        follow_up: { ...existing.config.follow_up, ...(updates.config.follow_up ?? {}) },
      };
      fields.push('config = ?');
      values.push(JSON.stringify(merged));
    }
  }

  if (fields.length === 0) return getQuery(sqlite, id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  sqlite.prepare(`UPDATE research_queries SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getQuery(sqlite, id);
}

/** @deprecated Use updateQuery */
export const updateSession = updateQuery;

export interface ResearchStats {
  totalSessions: number;
  activeSessions: number;
  totalFindings: number;
  totalThreads: number;
  totalCost: number;
  avgConfidence: number;
  avgNovelty: number;
  byDay: Array<{ date: string; sessions: number; findings: number; cost: number }>;
}

export function getResearchStats(sqlite: Sqlite, range: string, granularity: string): ResearchStats {
  const cutoff = rangeToCutoff(range);
  const dateFn = granularity === 'hour'
    ? "strftime('%Y-%m-%dT%H', created_at)"
    : "date(created_at)";

  const sessions = sqlite.prepare(
    'SELECT COUNT(*) as total, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as active FROM research_queries WHERE created_at >= ?'
  ).get('active', cutoff) as { total: number; active: number };

  const findings = sqlite.prepare(
    'SELECT COUNT(*) as total, AVG(confidence) as avg_confidence, AVG(novelty) as avg_novelty FROM research_findings WHERE created_at >= ?'
  ).get(cutoff) as { total: number; avg_confidence: number | null; avg_novelty: number | null };

  const threads = sqlite.prepare(
    'SELECT COUNT(*) as total FROM research_threads WHERE created_at >= ?'
  ).get(cutoff) as { total: number };

  const cost = sqlite.prepare(
    'SELECT COALESCE(SUM(cost_usd), 0) as total FROM research_steps WHERE created_at >= ?'
  ).get(cutoff) as { total: number };

  const sessionsByDay = sqlite.prepare(`
    SELECT ${dateFn} as date, COUNT(*) as sessions
    FROM research_queries WHERE created_at >= ?
    GROUP BY date ORDER BY date
  `).all(cutoff) as { date: string; sessions: number }[];

  const findingsByDay = sqlite.prepare(`
    SELECT ${dateFn} as date, COUNT(*) as findings
    FROM research_findings WHERE created_at >= ?
    GROUP BY date ORDER BY date
  `).all(cutoff) as { date: string; findings: number }[];

  const costByDay = sqlite.prepare(`
    SELECT ${dateFn} as date, COALESCE(SUM(cost_usd), 0) as cost
    FROM research_steps WHERE created_at >= ?
    GROUP BY date ORDER BY date
  `).all(cutoff) as { date: string; cost: number }[];

  const dayMap = new Map<string, { date: string; sessions: number; findings: number; cost: number }>();
  for (const row of sessionsByDay) dayMap.set(row.date, { date: row.date, sessions: row.sessions, findings: 0, cost: 0 });
  for (const row of findingsByDay) {
    const existing = dayMap.get(row.date);
    if (existing) existing.findings = row.findings;
    else dayMap.set(row.date, { date: row.date, sessions: 0, findings: row.findings, cost: 0 });
  }
  for (const row of costByDay) {
    const existing = dayMap.get(row.date);
    if (existing) existing.cost = row.cost;
    else dayMap.set(row.date, { date: row.date, sessions: 0, findings: 0, cost: row.cost });
  }

  const byDay = [...dayMap.values()].sort((a, b) => a.date.localeCompare(b.date));

  return {
    totalSessions: sessions.total,
    activeSessions: sessions.active,
    totalFindings: findings.total,
    totalThreads: threads.total,
    totalCost: cost.total,
    avgConfidence: (findings.avg_confidence ?? 0) * 100,
    avgNovelty: (findings.avg_novelty ?? 0) * 100,
    byDay,
  };
}

function rangeToCutoff(range: string): string {
  const now = new Date();
  switch (range) {
    case '1h': return new Date(now.getTime() - 3600_000).toISOString();
    case '1d': return new Date(now.getTime() - 86400_000).toISOString();
    case '7d': return new Date(now.getTime() - 7 * 86400_000).toISOString();
    case '30d': return new Date(now.getTime() - 30 * 86400_000).toISOString();
    default: return new Date(0).toISOString();
  }
}

export function deleteQuery(sqlite: Sqlite, queryId: string): boolean {
  // Delete in dependency order
  sqlite.prepare('DELETE FROM research_monitor_alerts WHERE session_id = ?').run(queryId);
  sqlite.prepare('DELETE FROM research_monitor_snapshots WHERE session_id = ?').run(queryId);
  sqlite.prepare('DELETE FROM research_proposed_monitors WHERE session_id = ?').run(queryId);
  sqlite.prepare('DELETE FROM research_plan_modifications WHERE plan_id IN (SELECT id FROM research_plans WHERE session_id = ?)').run(queryId);
  sqlite.prepare('DELETE FROM research_plans WHERE session_id = ?').run(queryId);
  sqlite.prepare('DELETE FROM research_steps WHERE session_id = ?').run(queryId);
  sqlite.prepare('DELETE FROM research_findings WHERE session_id = ?').run(queryId);
  sqlite.prepare('DELETE FROM research_threads WHERE session_id = ?').run(queryId);
  sqlite.prepare('DELETE FROM research_jobs WHERE session_id = ?').run(queryId);
  const result = sqlite.prepare('DELETE FROM research_queries WHERE id = ?').run(queryId);
  return result.changes > 0;
}

/** @deprecated Use deleteQuery */
export const deleteSession = deleteQuery;

export function getQueryCost(sqlite: Sqlite, queryId: string): { total_cost: number; step_count: number; today_cost: number } {
  const total = sqlite.prepare(
    'SELECT COALESCE(SUM(cost_usd), 0) as total_cost, COUNT(*) as step_count FROM research_steps WHERE session_id = ?'
  ).get(queryId) as { total_cost: number; step_count: number };

  const today = sqlite.prepare(
    "SELECT COALESCE(SUM(cost_usd), 0) as today_cost FROM research_steps WHERE session_id = ? AND created_at >= date('now')"
  ).get(queryId) as { today_cost: number };

  return { ...total, today_cost: today.today_cost };
}

/** @deprecated Use getQueryCost */
export const getSessionCost = getQueryCost;
