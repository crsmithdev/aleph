import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { ResearchSession, SessionConfig } from '../types.js';
import { DEFAULT_SESSION_CONFIG } from '../types.js';

function rowToSession(row: Record<string, unknown>): ResearchSession {
  const stored = JSON.parse(row.config as string) as Partial<SessionConfig>;
  // Deep-merge with defaults so sessions created before new config fields were added
  // still get valid defaults (e.g. follow_up added later).
  const config: SessionConfig = {
    ...DEFAULT_SESSION_CONFIG,
    ...stored,
    models: { ...DEFAULT_SESSION_CONFIG.models, ...(stored.models ?? {}) },
    providers: { ...DEFAULT_SESSION_CONFIG.providers, ...(stored.providers ?? {}) },
    schedule: { ...DEFAULT_SESSION_CONFIG.schedule, ...(stored.schedule ?? {}) },
    perturbation: { ...DEFAULT_SESSION_CONFIG.perturbation, ...(stored.perturbation ?? {}) },
    follow_up: { ...DEFAULT_SESSION_CONFIG.follow_up, ...(stored.follow_up ?? {}) },
  };
  return { ...row, config } as unknown as ResearchSession;
}

export function createSession(
  sqlite: Sqlite,
  title: string,
  seedQuery: string,
  config?: Partial<SessionConfig>
): ResearchSession {
  const id = generateId();
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
      };
      fields.push('config = ?');
      values.push(JSON.stringify(merged));
    }
  }

  if (fields.length === 0) return getSession(sqlite, id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  sqlite.prepare(`UPDATE research_sessions SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getSession(sqlite, id);
}

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
    'SELECT COUNT(*) as total, SUM(CASE WHEN status = ? THEN 1 ELSE 0 END) as active FROM research_sessions WHERE created_at >= ?'
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
    FROM research_sessions WHERE created_at >= ?
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

export function deleteSession(sqlite: Sqlite, sessionId: string): boolean {
  // Delete in dependency order
  sqlite.prepare('DELETE FROM research_monitor_alerts WHERE session_id = ?').run(sessionId);
  sqlite.prepare('DELETE FROM research_monitor_snapshots WHERE session_id = ?').run(sessionId);
  sqlite.prepare('DELETE FROM research_proposed_monitors WHERE session_id = ?').run(sessionId);
  sqlite.prepare('DELETE FROM research_plan_modifications WHERE plan_id IN (SELECT id FROM research_plans WHERE session_id = ?)').run(sessionId);
  sqlite.prepare('DELETE FROM research_plans WHERE session_id = ?').run(sessionId);
  sqlite.prepare('DELETE FROM research_steps WHERE session_id = ?').run(sessionId);
  sqlite.prepare('DELETE FROM research_findings WHERE session_id = ?').run(sessionId);
  sqlite.prepare('DELETE FROM research_threads WHERE session_id = ?').run(sessionId);
  sqlite.prepare('DELETE FROM research_jobs WHERE session_id = ?').run(sessionId);
  const result = sqlite.prepare('DELETE FROM research_sessions WHERE id = ?').run(sessionId);
  return result.changes > 0;
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
