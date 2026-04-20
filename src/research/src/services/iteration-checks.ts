import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { IterationCorrection } from '../hooks/types.js';

export interface IterationCheckRecord {
  id: string;
  session_id: string;
  job_id: string | null;
  iterations_completed: number;
  verdict: 'on_track' | 'drifting' | 'needs_correction';
  notes: string;
  correction: IterationCorrection | null;
  applied_actions: AppliedAction[];
  created_at: string;
}

export interface AppliedAction {
  action: 'kill_thread' | 'narrow_sources' | 'scope_change_proposed';
  target?: string;
  detail?: string;
  ok: boolean;
  error?: string;
}

function rowTo(row: Record<string, unknown>): IterationCheckRecord {
  let correction: IterationCorrection | null = null;
  const cRaw = row.correction as string | null;
  if (cRaw) {
    try { correction = JSON.parse(cRaw) as IterationCorrection; } catch { /* malformed */ }
  }
  let applied: AppliedAction[] = [];
  try { applied = JSON.parse((row.applied_actions as string) ?? '[]') as AppliedAction[]; } catch { /* malformed */ }
  return {
    id: row.id as string,
    session_id: row.session_id as string,
    job_id: (row.job_id as string | null) ?? null,
    iterations_completed: row.iterations_completed as number,
    verdict: row.verdict as IterationCheckRecord['verdict'],
    notes: (row.notes as string) ?? '',
    correction,
    applied_actions: applied,
    created_at: row.created_at as string,
  };
}

export function recordIterationCheck(sqlite: Sqlite, input: {
  session_id: string;
  job_id?: string | null;
  iterations_completed: number;
  verdict: IterationCheckRecord['verdict'];
  notes: string;
  correction: IterationCorrection | null;
  applied_actions: AppliedAction[];
}): IterationCheckRecord {
  const id = generateId();
  sqlite.prepare(`
    INSERT INTO research_iteration_checks
      (id, session_id, job_id, iterations_completed, verdict, notes, correction, applied_actions)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    input.session_id,
    input.job_id ?? null,
    input.iterations_completed,
    input.verdict,
    input.notes,
    input.correction === null ? null : JSON.stringify(input.correction),
    JSON.stringify(input.applied_actions),
  );
  return getIterationCheck(sqlite, id)!;
}

export function getIterationCheck(sqlite: Sqlite, id: string): IterationCheckRecord | null {
  const row = sqlite.prepare('SELECT * FROM research_iteration_checks WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowTo(row) : null;
}

export function listIterationChecks(sqlite: Sqlite, sessionId: string): IterationCheckRecord[] {
  const rows = sqlite.prepare(
    'SELECT * FROM research_iteration_checks WHERE session_id = ? ORDER BY created_at DESC'
  ).all(sessionId) as Record<string, unknown>[];
  return rows.map(rowTo);
}
