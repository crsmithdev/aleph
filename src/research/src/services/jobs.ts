import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { ResearchJob, JobStatus, JobMode } from '../types.js';

function rowToJob(row: Record<string, unknown>): ResearchJob {
  return row as ResearchJob;
}

export function createJob(
  sqlite: Sqlite,
  params: { session_id: string; mode: JobMode; thread_id?: string | null; max_iterations?: number }
): ResearchJob {
  const id = generateId();
  const now = new Date().toISOString();

  sqlite.prepare(`
    INSERT INTO research_jobs (id, session_id, thread_id, status, mode, max_iterations, created_at, updated_at)
    VALUES (?, ?, ?, 'pending', ?, ?, ?, ?)
  `).run(id, params.session_id, params.thread_id ?? null, params.mode, params.max_iterations ?? null, now, now);

  return getJob(sqlite, id)!;
}

/** Atomically create a thread-level job only if no active job already exists for this thread.
 *  Uses INSERT...SELECT so the check and insert are a single atomic SQLite operation,
 *  preventing the race where multiple workers simultaneously create duplicate jobs. */
export function createThreadJobIfNone(
  sqlite: Sqlite,
  params: { session_id: string; thread_id: string }
): ResearchJob | null {
  const id = generateId();
  const now = new Date().toISOString();

  const result = sqlite.prepare(`
    INSERT INTO research_jobs (id, session_id, thread_id, status, mode, max_iterations, created_at, updated_at)
    SELECT ?, ?, ?, 'pending', 'burst', 1, ?, ?
    WHERE NOT EXISTS (
      SELECT 1 FROM research_jobs
      WHERE thread_id = ? AND status IN ('pending', 'claimed', 'running')
    )
  `).run(id, params.session_id, params.thread_id, now, now, params.thread_id);

  if (result.changes === 0) return null;
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
    `SELECT j.* FROM research_jobs j
LEFT JOIN (
  SELECT session_id, MAX(priority) as max_priority
  FROM research_threads WHERE status = 'queued'
  GROUP BY session_id
) t ON j.session_id = t.session_id
WHERE j.status = 'pending'
ORDER BY COALESCE(t.max_priority, 0) DESC, j.created_at ASC
LIMIT 1`
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

/** Reclaim jobs claimed by worker PIDs that are no longer alive.
 *  Handles orphan workers from previous server runs that hold concurrency slots. */
export function reclaimDeadWorkerJobs(sqlite: Sqlite): number {
  const activeJobs = (sqlite.prepare(
    "SELECT id, claimed_by FROM research_jobs WHERE status IN ('claimed', 'running') AND claimed_by IS NOT NULL"
  ).all() as { id: string; claimed_by: string }[]);

  let reclaimed = 0;
  for (const job of activeJobs) {
    const m = job.claimed_by.match(/^worker-(\d+)-/);
    if (!m) continue;
    const pid = parseInt(m[1], 10);
    let alive = false;
    try { process.kill(pid, 0); alive = true; } catch { /* ESRCH = dead */ }
    if (!alive) {
      sqlite.prepare(`
        UPDATE research_jobs
        SET status = 'pending', claimed_by = NULL, claimed_at = NULL, updated_at = datetime('now')
        WHERE id = ? AND status IN ('claimed', 'running')
      `).run(job.id);
      reclaimed++;
    }
  }
  return reclaimed;
}

export function listJobsForSession(sqlite: Sqlite, sessionId: string): ResearchJob[] {
  const rows = sqlite.prepare(
    'SELECT * FROM research_jobs WHERE session_id = ? ORDER BY created_at DESC'
  ).all(sessionId) as Record<string, unknown>[];
  return rows.map(rowToJob);
}

export function cancelAllJobs(sqlite: Sqlite): number {
  const result = sqlite.prepare(`
    UPDATE research_jobs
    SET status = 'cancelled', updated_at = datetime('now')
    WHERE status IN ('pending', 'claimed', 'running')
  `).run();
  return result.changes;
}

export function listAllJobs(sqlite: Sqlite, opts?: { limit?: number; offset?: number; status?: JobStatus }): ResearchJob[] {
  let sql = 'SELECT * FROM research_jobs';
  const params: unknown[] = [];
  if (opts?.status) {
    sql += ' WHERE status = ?';
    params.push(opts.status);
  }
  sql += ' ORDER BY created_at DESC';
  if (opts?.limit) {
    sql += ' LIMIT ?';
    params.push(opts.limit);
  }
  if (opts?.offset) {
    sql += ' OFFSET ?';
    params.push(opts.offset);
  }
  return (sqlite.prepare(sql).all(...params) as Record<string, unknown>[]).map(rowToJob);
}

export function countActiveJobsForSession(sqlite: Sqlite, sessionId: string): number {
  const row = sqlite.prepare(
    "SELECT COUNT(*) as count FROM research_jobs WHERE session_id = ? AND status IN ('pending', 'claimed', 'running')"
  ).get(sessionId) as { count: number };
  return row.count;
}

export function getActiveJobForThread(sqlite: Sqlite, threadId: string): ResearchJob | null {
  const row = sqlite.prepare(
    "SELECT * FROM research_jobs WHERE thread_id = ? AND status IN ('pending', 'claimed', 'running') LIMIT 1"
  ).get(threadId) as Record<string, unknown> | null;
  return row ? rowToJob(row) : null;
}

/** Returns queued threads that have no active job, ordered by priority DESC.
 *  Used by checkQueuedThreads to find threads needing a new job. */
export function getQueuedThreadsForNewJobs(
  sqlite: Sqlite,
  sessionId: string,
  limit: number
): Array<{ id: string; query: string; priority: number }> {
  return sqlite.prepare(`
    SELECT t.id, t.query, t.priority
    FROM research_threads t
    LEFT JOIN research_jobs j ON j.thread_id = t.id AND j.status IN ('pending', 'claimed', 'running')
    WHERE t.session_id = ? AND t.status = 'queued' AND j.id IS NULL
    ORDER BY t.priority DESC, t.created_at ASC
    LIMIT ?
  `).all(sessionId, limit) as Array<{ id: string; query: string; priority: number }>;
}

export function listActiveJobs(sqlite: Sqlite): ResearchJob[] {
  const rows = sqlite.prepare(
    "SELECT * FROM research_jobs WHERE status IN ('running', 'claimed') ORDER BY started_at DESC"
  ).all() as Record<string, unknown>[];
  return rows.map(rowToJob);
}

export function jobStats(sqlite: Sqlite): {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  avgDurationMs: number | null;
  byDay: { date: string; completed: number; failed: number; avgDurationMs: number | null }[];
} {
  const totals = sqlite.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
      AVG(CASE WHEN status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
        THEN (julianday(completed_at) - julianday(started_at)) * 86400000 END) as avgDurationMs
    FROM research_jobs
  `).get() as Record<string, unknown>;

  const days = sqlite.prepare(`
    SELECT
      date(created_at) as date,
      SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) as completed,
      SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) as failed,
      AVG(CASE WHEN status = 'completed' AND started_at IS NOT NULL AND completed_at IS NOT NULL
        THEN (julianday(completed_at) - julianday(started_at)) * 86400000 END) as avgDurationMs
    FROM research_jobs
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all() as Record<string, unknown>[];

  return {
    total: Number(totals.total ?? 0),
    completed: Number(totals.completed ?? 0),
    failed: Number(totals.failed ?? 0),
    cancelled: Number(totals.cancelled ?? 0),
    avgDurationMs: totals.avgDurationMs != null ? Math.round(Number(totals.avgDurationMs)) : null,
    byDay: days.map(d => ({
      date: String(d.date),
      completed: Number(d.completed ?? 0),
      failed: Number(d.failed ?? 0),
      avgDurationMs: d.avgDurationMs != null ? Math.round(Number(d.avgDurationMs)) : null,
    })),
  };
}
