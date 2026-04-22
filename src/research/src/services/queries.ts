import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { ResearchQuery, SessionConfig, PromptHints } from '../types.js';
import { getDefaults } from './defaults.js';

function rowToQuery(sqlite: Sqlite, row: Record<string, unknown>): ResearchQuery {
  const stored = JSON.parse(row.config as string) as Partial<SessionConfig>;
  // Deep-merge with persisted defaults so queries created before new config
  // fields were added still get valid defaults, and default changes propagate
  // to existing queries that haven't overridden them.
  const defaults = getDefaults(sqlite);
  const config: SessionConfig = {
    ...defaults,
    ...stored,
    providers: { ...defaults.providers, ...(stored.providers ?? {}) },
    schedule: { ...defaults.schedule, ...(stored.schedule ?? {}) },
    perturbation: { ...defaults.perturbation, ...(stored.perturbation ?? {}) },
    follow_up: { ...defaults.follow_up, ...(stored.follow_up ?? {}) },
    topic_coherence: { ...defaults.topic_coherence, ...(stored.topic_coherence ?? {}) },
    gap_analysis: { ...defaults.gap_analysis, ...(stored.gap_analysis ?? {}) },
  };
  let prompt_hints: PromptHints = {};
  try { prompt_hints = JSON.parse((row.prompt_hints as string) ?? '{}') as PromptHints; } catch { /* malformed */ }
  return { ...row, config, prompt_hints } as unknown as ResearchQuery;
}

export function createQuery(
  sqlite: Sqlite,
  title: string,
  prompt: string,
  config?: Partial<SessionConfig>,
  promptShort?: string | null,
  promptSuperShort?: string | null,
  promptHints?: PromptHints,
): ResearchQuery {
  const id = generateId();
  const mergedConfig = { ...getDefaults(sqlite), ...config };
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_queries (id, title, prompt, prompt_short, prompt_super_short, prompt_hints, status, config, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
  `).run(
    id, title, prompt, promptShort ?? null, promptSuperShort ?? null,
    JSON.stringify(promptHints ?? {}),
    JSON.stringify(mergedConfig),
    now, now,
  );

  return getQuery(sqlite, id)!;
}

/** @deprecated Use createQuery */
export const createSession = createQuery;

export function getQuery(sqlite: Sqlite, id: string): ResearchQuery | null {
  const row = sqlite.prepare('SELECT * FROM research_queries WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToQuery(sqlite, row) : null;
}

/** @deprecated Use getQuery */
export const getSession = getQuery;

export function listQueries(sqlite: Sqlite, status?: string): ResearchQuery[] {
  const rows = status
    ? sqlite.prepare('SELECT * FROM research_queries WHERE status = ? ORDER BY updated_at DESC').all(status) as Record<string, unknown>[]
    : sqlite.prepare('SELECT * FROM research_queries ORDER BY updated_at DESC').all() as Record<string, unknown>[];
  return rows.map(row => rowToQuery(sqlite, row));
}

/** @deprecated Use listQueries */
export const listSessions = listQueries;

export interface QueryStats {
  findings: number;
  concepts: number;
  sources: number;
  threads: number;
  cost: number;
  last_step_at: string | null;
  findings_by_day: number[]; // length 7, oldest → newest; today is last
}

function emptyStats(): QueryStats {
  return { findings: 0, concepts: 0, sources: 0, threads: 0, cost: 0, last_step_at: null, findings_by_day: [0, 0, 0, 0, 0, 0, 0] };
}

/**
 * Compute per-session aggregates for the given query ids in one DB roundtrip per metric.
 * Returns a Map keyed by session id; every requested id is present (zero-filled if missing).
 */
export function computeQueryStats(sqlite: Sqlite, ids: string[]): Map<string, QueryStats> {
  const map = new Map<string, QueryStats>();
  for (const id of ids) map.set(id, emptyStats());
  if (ids.length === 0) return map;

  const placeholders = ids.map(() => '?').join(',');

  const countRows = (table: string, field: keyof QueryStats) => {
    const rows = sqlite.prepare(
      `SELECT session_id, COUNT(*) as n FROM ${table} WHERE session_id IN (${placeholders}) GROUP BY session_id`
    ).all(...ids) as { session_id: string; n: number }[];
    for (const r of rows) {
      const s = map.get(r.session_id);
      if (s) (s[field] as number) = r.n;
    }
  };

  countRows('research_findings', 'findings');
  countRows('research_concepts', 'concepts');
  countRows('research_sources', 'sources');
  countRows('research_threads', 'threads');

  const stepRows = sqlite.prepare(
    `SELECT session_id, COALESCE(SUM(cost_usd), 0) as cost, MAX(created_at) as last_step_at
     FROM research_steps WHERE session_id IN (${placeholders}) GROUP BY session_id`
  ).all(...ids) as { session_id: string; cost: number; last_step_at: string | null }[];
  for (const r of stepRows) {
    const s = map.get(r.session_id);
    if (s) { s.cost = r.cost; s.last_step_at = r.last_step_at; }
  }

  // 7-day findings series, aligned to today as the last bucket
  const now = new Date();
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
  const cutoffIso = cutoff.toISOString();
  const dayIdx = new Map<string, number>();
  for (let i = 0; i < 7; i++) {
    const d = new Date(cutoff);
    d.setDate(d.getDate() + i);
    dayIdx.set(d.toISOString().slice(0, 10), i);
  }
  const byDay = sqlite.prepare(
    `SELECT session_id, date(created_at) as d, COUNT(*) as n
     FROM research_findings
     WHERE session_id IN (${placeholders}) AND created_at >= ?
     GROUP BY session_id, d`
  ).all(...ids, cutoffIso) as { session_id: string; d: string; n: number }[];
  for (const r of byDay) {
    const idx = dayIdx.get(r.d);
    if (idx === undefined) continue;
    const s = map.get(r.session_id);
    if (s) s.findings_by_day[idx] = r.n;
  }

  return map;
}

export type ResearchQueryWithStats = ResearchQuery & { stats: QueryStats };

export function listQueriesWithStats(sqlite: Sqlite, status?: string): ResearchQueryWithStats[] {
  const queries = listQueries(sqlite, status);
  const stats = computeQueryStats(sqlite, queries.map(q => q.id));
  return queries.map(q => ({ ...q, stats: stats.get(q.id) ?? emptyStats() }));
}

export function updateQuery(
  sqlite: Sqlite,
  id: string,
  updates: Partial<Pick<ResearchQuery, 'status' | 'summary' | 'document' | 'user_notes' | 'title' | 'prompt_short' | 'prompt_super_short' | 'prompt_hints'>> & { config?: Partial<SessionConfig> }
): ResearchQuery | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.summary !== undefined) { fields.push('summary = ?'); values.push(updates.summary); }
  if (updates.document !== undefined) { fields.push('document = ?'); values.push(updates.document); }
  if (updates.user_notes !== undefined) { fields.push('user_notes = ?'); values.push(updates.user_notes); }
  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.prompt_short !== undefined) { fields.push('prompt_short = ?'); values.push(updates.prompt_short); }
  if (updates.prompt_super_short !== undefined) { fields.push('prompt_super_short = ?'); values.push(updates.prompt_super_short); }
  if (updates.prompt_hints !== undefined) { fields.push('prompt_hints = ?'); values.push(JSON.stringify(updates.prompt_hints)); }
  if (updates.config !== undefined) {
    const existing = getQuery(sqlite, id);
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

export interface ResearchSummary {
  topConcepts: Array<{
    name: string;
    session_count: number;
    finding_count: number;
  }>;
  extractionQueue: {
    running: number;
    pending: number;
    failed: number;
    total: number;
  };
  stepsPerHour: number;
  recentConcepts: Array<{
    name: string;
    session_id: string;
    session_title: string;
    created_at: string;
  }>;
}

export function getResearchSummary(sqlite: Sqlite): ResearchSummary {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400_000).toISOString();
  const oneHourAgo = new Date(Date.now() - 3600_000).toISOString();

  const topConceptRows = sqlite.prepare(`
    SELECT
      c.canonical_name AS name,
      COUNT(DISTINCT c.session_id) AS session_count,
      COUNT(fc.finding_id) AS finding_count
    FROM research_concepts c
    LEFT JOIN research_finding_concepts fc ON fc.concept_id = c.id
    WHERE c.created_at >= ?
    GROUP BY c.canonical_name
    ORDER BY finding_count DESC, session_count DESC, c.canonical_name ASC
    LIMIT 10
  `).all(thirtyDaysAgo) as Array<{ name: string; session_count: number; finding_count: number }>;

  const queueRows = sqlite.prepare(`
    SELECT extraction_status, COUNT(*) AS n
    FROM research_sources
    GROUP BY extraction_status
  `).all() as Array<{ extraction_status: string; n: number }>;
  const queueByStatus: Record<string, number> = {};
  for (const r of queueRows) queueByStatus[r.extraction_status] = r.n;
  const running = queueByStatus.claimed ?? 0;
  const pending = queueByStatus.pending ?? 0;
  const failed = queueByStatus.failed ?? 0;
  const extractionQueue = { running, pending, failed, total: running + pending + failed };

  const stepsRow = sqlite.prepare(
    'SELECT COUNT(*) AS n FROM research_steps WHERE created_at >= ?'
  ).get(oneHourAgo) as { n: number };

  const recentConceptRows = sqlite.prepare(`
    SELECT c.canonical_name AS name, c.session_id, q.title AS session_title, c.created_at
    FROM research_concepts c
    LEFT JOIN research_queries q ON q.id = c.session_id
    ORDER BY c.created_at DESC
    LIMIT 10
  `).all() as Array<{ name: string; session_id: string; session_title: string | null; created_at: string }>;

  return {
    topConcepts: topConceptRows,
    extractionQueue,
    stepsPerHour: stepsRow.n,
    recentConcepts: recentConceptRows.map(r => ({
      name: r.name,
      session_id: r.session_id,
      session_title: r.session_title ?? '',
      created_at: r.created_at,
    })),
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
  sqlite.prepare('DELETE FROM research_monitor_alerts WHERE monitor_id IN (SELECT id FROM research_monitors WHERE session_id = ?)').run(queryId);
  sqlite.prepare('DELETE FROM research_monitor_snapshots WHERE monitor_id IN (SELECT id FROM research_monitors WHERE session_id = ?)').run(queryId);
  sqlite.prepare('DELETE FROM research_monitors WHERE session_id = ?').run(queryId);
  sqlite.prepare('DELETE FROM research_proposed_monitors WHERE session_id = ?').run(queryId);
  sqlite.prepare('DELETE FROM research_plan_modifications WHERE plan_id IN (SELECT id FROM research_plans WHERE session_id = ?)').run(queryId);
  sqlite.prepare('DELETE FROM research_plans WHERE session_id = ?').run(queryId);
  sqlite.prepare('DELETE FROM research_steering_notes WHERE session_id = ?').run(queryId);
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
