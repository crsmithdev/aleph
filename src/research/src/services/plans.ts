import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { ResearchPlan, ResearchPlanItem, PlanModification } from '../types.js';

function rowToPlan(row: Record<string, unknown>): ResearchPlan {
  return {
    ...row,
    items: JSON.parse(row.items as string),
  } as unknown as ResearchPlan;
}

function rowToMod(row: Record<string, unknown>): PlanModification {
  return row as unknown as PlanModification;
}

export function createPlan(
  sqlite: Sqlite,
  sessionId: string,
  items: ResearchPlanItem[]
): ResearchPlan {
  const id = generateId();
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_plans (id, session_id, items, generated_at, status)
    VALUES (?, ?, ?, ?, 'proposed')
  `).run(id, sessionId, JSON.stringify(items), now);

  return getPlan(sqlite, id)!;
}

export function getPlan(sqlite: Sqlite, id: string): ResearchPlan | null {
  const row = sqlite.prepare('SELECT * FROM research_plans WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToPlan(row) : null;
}

export function getLatestPlan(sqlite: Sqlite, sessionId: string): ResearchPlan | null {
  const row = sqlite.prepare(
    'SELECT * FROM research_plans WHERE session_id = ? ORDER BY generated_at DESC, rowid DESC LIMIT 1'
  ).get(sessionId) as Record<string, unknown> | null;
  return row ? rowToPlan(row) : null;
}

export function addPlanModification(
  sqlite: Sqlite,
  params: {
    plan_id: string;
    action: PlanModification['action'];
    target_item_rank?: number | null;
    target_thread_id?: string | null;
    payload?: string;
    source?: string;
    raw_input?: string | null;
  }
): PlanModification {
  const id = generateId();
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_plan_modifications
      (id, plan_id, action, target_item_rank, target_thread_id, payload, source, raw_input, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    params.plan_id,
    params.action,
    params.target_item_rank ?? null,
    params.target_thread_id ?? null,
    params.payload ?? '',
    params.source ?? 'cli',
    params.raw_input ?? null,
    now
  );

  return sqlite.prepare('SELECT * FROM research_plan_modifications WHERE id = ?').get(id) as unknown as PlanModification;
}

export function getPendingModifications(sqlite: Sqlite, planId: string): PlanModification[] {
  return (sqlite.prepare(
    'SELECT * FROM research_plan_modifications WHERE plan_id = ? AND applied_at IS NULL ORDER BY created_at ASC'
  ).all(planId) as Record<string, unknown>[]).map(rowToMod);
}

export function markModificationsApplied(sqlite: Sqlite, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  sqlite.prepare(
    `UPDATE research_plan_modifications SET applied_at = datetime('now') WHERE id IN (${placeholders})`
  ).run(...ids);
}

export function updatePlanStatus(sqlite: Sqlite, id: string, status: ResearchPlan['status']): void {
  sqlite.prepare('UPDATE research_plans SET status = ? WHERE id = ?').run(status, id);
}
