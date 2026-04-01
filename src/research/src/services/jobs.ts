import type { Sqlite } from '@construct/data';
import { nanoid } from 'nanoid';
import type { ResearchJob, JobStatus, JobMode } from '../types.js';

function rowToJob(row: Record<string, unknown>): ResearchJob {
  return row as ResearchJob;
}

export function createJob(
  sqlite: Sqlite,
  params: { session_id: string; mode: JobMode; max_iterations?: number }
): ResearchJob {
  const id = nanoid();
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_jobs (id, session_id, status, mode, max_iterations, created_at, updated_at)
    VALUES (?, ?, 'pending', ?, ?, ?, ?)
  `).run(id, params.session_id, params.mode, params.max_iterations ?? null, now, now);

  return getJob(sqlite, id)!;
}

export function getJob(sqlite: Sqlite, id: string): ResearchJob | null {
  const row = sqlite.prepare('SELECT * FROM research_jobs WHERE id = ?').get(id) as Record<string, unknown> | null;
  return row ? rowToJob(row) : null;
}

export function getActiveJobForSession(sqlite: Sqlite, sessionId: string): ResearchJob | null {
  const row = sqlite.prepare(
    "SELECT * FROM research_jobs WHERE session_id = ? AND status IN ('pending', 'claimed', 'running') ORDER BY created_at DESC LIMIT 1"
  ).get(sessionId) as Record<string, unknown> | null;
  return row ? rowToJob(row) : null;
}

export function findPendingJob(sqlite: Sqlite): ResearchJob | null {
  const row = sqlite.prepare(
    "SELECT * FROM research_jobs WHERE status = 'pending' ORDER BY created_at ASC LIMIT 1"
  ).get() as Record<string, unknown> | null;
  return row ? rowToJob(row) : null;
}

export function claimJob(sqlite: Sqlite, jobId: string, workerId: string): ResearchJob | null {
  const result = sqlite.prepare(`
    UPDATE research_jobs
    SET status = 'claimed', claimed_by = ?, claimed_at = datetime('now'), heartbeat_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND status = 'pending'
  `).run(workerId, jobId);

  if (result.changes === 0) return null;
  return getJob(sqlite, jobId);
}

export function markRunning(sqlite: Sqlite, jobId: string, workerId: string): void {
  sqlite.prepare(`
    UPDATE research_jobs
    SET status = 'running', started_at = datetime('now'), heartbeat_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND claimed_by = ?
  `).run(jobId, workerId);
}

export function updateHeartbeat(sqlite: Sqlite, jobId: string, workerId: string, iterationsCompleted: number): void {
  sqlite.prepare(`
    UPDATE research_jobs
    SET heartbeat_at = datetime('now'), iterations_completed = ?, updated_at = datetime('now')
    WHERE id = ? AND claimed_by = ?
  `).run(iterationsCompleted, jobId, workerId);
}

export function completeJob(sqlite: Sqlite, jobId: string, workerId: string): void {
  sqlite.prepare(`
    UPDATE research_jobs
    SET status = 'completed', completed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND claimed_by = ?
  `).run(jobId, workerId);
}

export function failJob(sqlite: Sqlite, jobId: string, workerId: string, error: string): void {
  sqlite.prepare(`
    UPDATE research_jobs
    SET status = 'failed', error = ?, completed_at = datetime('now'), updated_at = datetime('now')
    WHERE id = ? AND claimed_by = ?
  `).run(error, jobId, workerId);
}

export function cancelJob(sqlite: Sqlite, jobId: string): boolean {
  const result = sqlite.prepare(`
    UPDATE research_jobs
    SET status = 'cancelled', updated_at = datetime('now')
    WHERE id = ? AND status IN ('pending', 'claimed', 'running')
  `).run(jobId);
  return result.changes > 0;
}

export function reclaimStaleJobs(sqlite: Sqlite): number {
  const result = sqlite.prepare(`
    UPDATE research_jobs
    SET status = 'pending', claimed_by = NULL, claimed_at = NULL, updated_at = datetime('now')
    WHERE status IN ('claimed', 'running')
    AND heartbeat_at < datetime('now', '-120 seconds')
  `).run();
  return result.changes;
}

export function listJobsForSession(sqlite: Sqlite, sessionId: string): ResearchJob[] {
  const rows = sqlite.prepare(
    'SELECT * FROM research_jobs WHERE session_id = ? ORDER BY created_at DESC'
  ).all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToJob);
}
