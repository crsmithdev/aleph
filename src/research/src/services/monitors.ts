import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { Monitor, MonitorSnapshot, MonitorAlert, MatchCriteria, ProposedMonitor } from '../types.js';
import { createHash } from 'crypto';

function rowToMonitor(row: Record<string, unknown>): Monitor {
  return {
    ...row,
    queries: JSON.parse(row.queries as string),
    fetch_urls: JSON.parse(row.fetch_urls as string),
    match_criteria: JSON.parse(row.match_criteria as string),
  } as unknown as Monitor;
}

function rowToSnapshot(row: Record<string, unknown>): MonitorSnapshot {
  return row as unknown as MonitorSnapshot;
}

function rowToAlert(row: Record<string, unknown>): MonitorAlert {
  return {
    ...row,
    matched_criteria: JSON.parse(row.matched_criteria as string),
  } as unknown as MonitorAlert;
}

// === Monitors ===

export function createMonitor(
  sqlite: Sqlite,
  params: {
    title: string;
    queries: string[];
    session_id?: string | null;
    fetch_urls?: string[];
    schedule?: string;
    timezone?: string;
    match_criteria?: MatchCriteria;
    model?: string;
    budget_daily_usd?: number | null;
  }
): Monitor {
  const id = generateId();
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_monitors
      (id, session_id, title, queries, fetch_urls, schedule, timezone,
       match_criteria, model, budget_daily_usd, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.session_id ?? null,
    params.title,
    JSON.stringify(params.queries),
    JSON.stringify(params.fetch_urls ?? []),
    params.schedule ?? '0 8 * * *',
    params.timezone ?? 'America/Los_Angeles',
    JSON.stringify(params.match_criteria ?? {}),
    params.model ?? 'claude-haiku-4-5',
    params.budget_daily_usd ?? null,
    now,
    now
  );

  return getMonitor(sqlite, id)!;
}

export function getMonitor(sqlite: Sqlite, id: string): Monitor | null {
  const row = sqlite.prepare('SELECT * FROM research_monitors WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToMonitor(row) : null;
}

export function listMonitors(sqlite: Sqlite, status?: string): Monitor[] {
  if (status) {
    return (sqlite.prepare('SELECT * FROM research_monitors WHERE status = ? ORDER BY updated_at DESC').all(status) as Record<string, unknown>[]).map(rowToMonitor);
  }
  return (sqlite.prepare('SELECT * FROM research_monitors ORDER BY updated_at DESC').all() as Record<string, unknown>[]).map(rowToMonitor);
}

export function updateMonitor(
  sqlite: Sqlite,
  id: string,
  updates: Partial<Pick<Monitor, 'status' | 'title' | 'schedule' | 'model'>> & { queries?: string[]; match_criteria?: MatchCriteria }
): Monitor | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.title !== undefined) { fields.push('title = ?'); values.push(updates.title); }
  if (updates.schedule !== undefined) { fields.push('schedule = ?'); values.push(updates.schedule); }
  if (updates.model !== undefined) { fields.push('model = ?'); values.push(updates.model); }
  if (updates.queries !== undefined) { fields.push('queries = ?'); values.push(JSON.stringify(updates.queries)); }
  if (updates.match_criteria !== undefined) { fields.push('match_criteria = ?'); values.push(JSON.stringify(updates.match_criteria)); }

  if (fields.length === 0) return getMonitor(sqlite, id);

  fields.push("updated_at = datetime('now')");
  values.push(id);

  sqlite.prepare(`UPDATE research_monitors SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getMonitor(sqlite, id);
}

// === Snapshots ===

export function createSnapshot(
  sqlite: Sqlite,
  monitorId: string,
  rawResults: string,
  itemCount: number,
  costUsd: number
): MonitorSnapshot {
  const id = generateId();
  const resultHash = createHash('sha256').update(rawResults).digest('hex');

  // Get next cycle number
  const prev = sqlite.prepare(
    'SELECT MAX(cycle_number) as max_cycle FROM research_monitor_snapshots WHERE monitor_id = ?'
  ).get(monitorId) as { max_cycle: number | null } | null;
  const cycleNumber = (prev?.max_cycle ?? 0) + 1;

  sqlite.prepare(`
    INSERT INTO research_monitor_snapshots (id, monitor_id, cycle_number, raw_results, result_hash, item_count, cost_usd)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, monitorId, cycleNumber, rawResults, resultHash, itemCount, costUsd);

  return sqlite.prepare('SELECT * FROM research_monitor_snapshots WHERE id = ?').get(id) as unknown as MonitorSnapshot;
}

export function getLatestSnapshot(sqlite: Sqlite, monitorId: string): MonitorSnapshot | null {
  const row = sqlite.prepare(
    'SELECT * FROM research_monitor_snapshots WHERE monitor_id = ? ORDER BY cycle_number DESC LIMIT 1'
  ).get(monitorId) as Record<string, unknown> | null;
  return row ? rowToSnapshot(row) : null;
}

export function listSnapshots(sqlite: Sqlite, monitorId: string, limit = 90): MonitorSnapshot[] {
  return (sqlite.prepare(
    'SELECT * FROM research_monitor_snapshots WHERE monitor_id = ? ORDER BY cycle_number DESC LIMIT ?'
  ).all(monitorId, limit) as Record<string, unknown>[]).map(rowToSnapshot);
}

// === Alerts ===

export function createAlert(
  sqlite: Sqlite,
  params: {
    monitor_id: string;
    snapshot_id: string;
    alert_type: MonitorAlert['alert_type'];
    title: string;
    content?: string;
    source_url?: string | null;
    matched_criteria?: string[];
    severity?: MonitorAlert['severity'];
  }
): MonitorAlert {
  const id = generateId();

  sqlite.prepare(`
    INSERT INTO research_monitor_alerts
      (id, monitor_id, snapshot_id, alert_type, title, content, source_url, matched_criteria, severity)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.monitor_id,
    params.snapshot_id,
    params.alert_type,
    params.title,
    params.content ?? '',
    params.source_url ?? null,
    JSON.stringify(params.matched_criteria ?? []),
    params.severity ?? 'info'
  );

  return sqlite.prepare('SELECT * FROM research_monitor_alerts WHERE id = ?').get(id) as unknown as MonitorAlert;
}

export function listAlerts(
  sqlite: Sqlite,
  monitorId: string,
  opts?: { status?: string; severity?: string; limit?: number }
): MonitorAlert[] {
  let sql = 'SELECT * FROM research_monitor_alerts WHERE monitor_id = ?';
  const params: unknown[] = [monitorId];

  if (opts?.status) { sql += ' AND status = ?'; params.push(opts.status); }
  if (opts?.severity) { sql += ' AND severity = ?'; params.push(opts.severity); }

  sql += ' ORDER BY created_at DESC';
  if (opts?.limit) { sql += ' LIMIT ?'; params.push(opts.limit); }

  return (sqlite.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToAlert);
}

export function updateAlert(
  sqlite: Sqlite,
  id: string,
  updates: Partial<Pick<MonitorAlert, 'status' | 'spawned_thread_id'>>
): MonitorAlert | null {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.status !== undefined) { fields.push('status = ?'); values.push(updates.status); }
  if (updates.spawned_thread_id !== undefined) { fields.push('spawned_thread_id = ?'); values.push(updates.spawned_thread_id); }

  if (fields.length === 0) return null;
  values.push(id);

  sqlite.prepare(`UPDATE research_monitor_alerts SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  const row = sqlite.prepare('SELECT * FROM research_monitor_alerts WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToAlert(row) : null;
}

// === Deduplication ===

export function isAlertDuplicate(
  sqlite: Sqlite,
  monitorId: string,
  title: string,
  sourceUrl: string | null,
  windowDays = 7
): boolean {
  // Check by source URL first (exact match)
  if (sourceUrl) {
    const existing = sqlite.prepare(`
      SELECT COUNT(*) as c FROM research_monitor_alerts
      WHERE monitor_id = ? AND source_url = ?
      AND created_at >= datetime('now', '-' || ? || ' days')
    `).get(monitorId, sourceUrl, windowDays) as { c: number };
    if (existing.c > 0) return true;
  }

  // Fuzzy title match (exact for now, can upgrade to Levenshtein later)
  const existing = sqlite.prepare(`
    SELECT COUNT(*) as c FROM research_monitor_alerts
    WHERE monitor_id = ? AND title = ?
    AND created_at >= datetime('now', '-' || ? || ' days')
  `).get(monitorId, title, windowDays) as { c: number };

  return existing.c > 0;
}

// === Proposed Monitors ===

export function createProposedMonitor(
  sqlite: Sqlite,
  params: {
    session_id: string;
    thread_id: string;
    proposed_queries: string[];
    proposed_fetch_urls?: string[];
    proposed_criteria?: MatchCriteria;
    proposed_schedule?: string;
    rationale: string;
  }
): ProposedMonitor {
  const id = generateId();

  sqlite.prepare(`
    INSERT INTO research_proposed_monitors
      (id, session_id, thread_id, proposed_queries, proposed_fetch_urls, proposed_criteria, proposed_schedule, rationale)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.session_id,
    params.thread_id,
    JSON.stringify(params.proposed_queries),
    JSON.stringify(params.proposed_fetch_urls ?? []),
    JSON.stringify(params.proposed_criteria ?? {}),
    params.proposed_schedule ?? '0 8 * * *',
    params.rationale
  );

  return sqlite.prepare('SELECT * FROM research_proposed_monitors WHERE id = ?').get(id) as unknown as ProposedMonitor;
}

export function listProposedMonitors(sqlite: Sqlite, sessionId: string): ProposedMonitor[] {
  return sqlite.prepare(
    'SELECT * FROM research_proposed_monitors WHERE session_id = ? ORDER BY created_at DESC'
  ).all(sessionId) as unknown as ProposedMonitor[];
}
