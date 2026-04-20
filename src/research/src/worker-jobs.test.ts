/**
 * Tests for job queue and thread management service functions.
 * All tests run against in-memory SQLite — no LLM calls, no processes.
 * Covers: job claiming races, stale reclaim, dead PID detection,
 *         orphaned thread reset, thread claiming atomicity, priority ordering.
 */
import { Database } from 'bun:sqlite';
import { describe, test, expect, beforeEach } from 'bun:test';
import { applyResearchDDL } from './ddl';
import * as jobs from './services/jobs';
import * as threads from './services/threads';
import { DEFAULT_SESSION_CONFIG } from './types';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(db);
  return db;
}

function insertSession(db: Database, id = 'sess-1', status = 'active', config = DEFAULT_SESSION_CONFIG): string {
  db.prepare(`
    INSERT INTO research_queries (id, title, prompt, status, config, created_at, updated_at)
    VALUES (?, 'Test', 'test query', ?, ?, datetime('now'), datetime('now'))
  `).run(id, status, JSON.stringify(config));
  return id;
}

function insertThread(db: Database, sessionId: string, threadId: string, status: string = 'queued', priority = 0.5): string {
  db.prepare(`
    INSERT INTO research_threads
      (id, session_id, query, origin, status, priority, depth, max_depth, node_type, created_at, updated_at)
    VALUES (?, ?, 'test query', 'seed', ?, ?, 0, 9, 'question', datetime('now'), datetime('now'))
  `).run(threadId, sessionId, status, priority);
  return threadId;
}

// ========== Job lifecycle ==========

describe('job lifecycle', () => {
  let db: Database;
  let sessionId: string;

  beforeEach(() => {
    db = createTestDb();
    sessionId = insertSession(db);
  });

  test('createJob returns pending job', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    expect(job.status).toBe('pending');
    expect(job.session_id).toBe(sessionId);
    expect(job.claimed_by).toBeNull();
  });

  test('claimJob returns job and sets claimed_by', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    const claimed = jobs.claimJob(db, job.id, 'worker-99-123');
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe('claimed');
    expect(claimed!.claimed_by).toBe('worker-99-123');
  });

  test('claimJob fails on already-claimed job', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-A');
    const second = jobs.claimJob(db, job.id, 'worker-B');
    expect(second).toBeNull();
    expect(jobs.getJob(db, job.id)!.claimed_by).toBe('worker-A');
  });

  test('claimJob fails on completed job', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.completeJob(db, job.id, 'worker-1');
    expect(jobs.claimJob(db, job.id, 'worker-2')).toBeNull();
  });

  test('claimJob fails on failed job', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.failJob(db, job.id, 'worker-1', 'boom');
    expect(jobs.claimJob(db, job.id, 'worker-2')).toBeNull();
  });

  test('only one of two simultaneous claimJob calls wins', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    const r1 = jobs.claimJob(db, job.id, 'worker-A');
    const r2 = jobs.claimJob(db, job.id, 'worker-B');
    const wins = [r1, r2].filter(r => r !== null);
    expect(wins).toHaveLength(1);
    expect(wins[0]!.claimed_by).toMatch(/worker-[AB]/);
  });

  test('markRunning sets status=running and started_at', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.markRunning(db, job.id, 'worker-1');
    const updated = jobs.getJob(db, job.id)!;
    expect(updated.status).toBe('running');
    expect(updated.started_at).not.toBeNull();
  });

  test('markRunning is a no-op for wrong worker', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.markRunning(db, job.id, 'worker-WRONG');
    expect(jobs.getJob(db, job.id)!.status).toBe('claimed');
  });

  test('completeJob sets status=completed and completed_at', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.completeJob(db, job.id, 'worker-1');
    const updated = jobs.getJob(db, job.id)!;
    expect(updated.status).toBe('completed');
    expect(updated.completed_at).not.toBeNull();
  });

  test('failJob sets status=failed, error, and completed_at', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.failJob(db, job.id, 'worker-1', 'API timeout');
    const updated = jobs.getJob(db, job.id)!;
    expect(updated.status).toBe('failed');
    expect(updated.error).toBe('API timeout');
    expect(updated.completed_at).not.toBeNull();
  });

  test('cancelJob cancels pending job', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    expect(jobs.cancelJob(db, job.id)).toBe(true);
    expect(jobs.getJob(db, job.id)!.status).toBe('cancelled');
  });

  test('cancelJob cancels claimed job', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    expect(jobs.cancelJob(db, job.id)).toBe(true);
    expect(jobs.getJob(db, job.id)!.status).toBe('cancelled');
  });

  test('cancelJob returns false for already-completed job', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.completeJob(db, job.id, 'worker-1');
    expect(jobs.cancelJob(db, job.id)).toBe(false);
  });

  test('updateHeartbeat updates heartbeat_at and iterations_completed', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.updateHeartbeat(db, job.id, 'worker-1', 5);
    const updated = jobs.getJob(db, job.id)!;
    expect(updated.iterations_completed).toBe(5);
    expect(updated.heartbeat_at).not.toBeNull();
  });
});

// ========== Stale job reclaim ==========

describe('stale job reclaim', () => {
  let db: Database;
  let sessionId: string;

  beforeEach(() => {
    db = createTestDb();
    sessionId = insertSession(db);
  });

  test('reclaims claimed job with heartbeat older than 120s', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    db.prepare(`UPDATE research_jobs SET heartbeat_at = datetime('now', '-130 seconds') WHERE id = ?`).run(job.id);

    expect(jobs.reclaimStaleJobs(db)).toBe(1);
    const reclaimed = jobs.getJob(db, job.id)!;
    expect(reclaimed.status).toBe('pending');
    expect(reclaimed.claimed_by).toBeNull();
  });

  test('reclaims running job with stale heartbeat', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.markRunning(db, job.id, 'worker-1');
    db.prepare(`UPDATE research_jobs SET heartbeat_at = datetime('now', '-130 seconds') WHERE id = ?`).run(job.id);

    expect(jobs.reclaimStaleJobs(db)).toBe(1);
    expect(jobs.getJob(db, job.id)!.status).toBe('pending');
  });

  test('does not reclaim job with fresh heartbeat (<120s)', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    // heartbeat_at is set by claimJob to now
    expect(jobs.reclaimStaleJobs(db)).toBe(0);
    expect(jobs.getJob(db, job.id)!.status).toBe('claimed');
  });

  test('does not reclaim completed job regardless of heartbeat age', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.completeJob(db, job.id, 'worker-1');
    db.prepare(`UPDATE research_jobs SET heartbeat_at = datetime('now', '-200 seconds') WHERE id = ?`).run(job.id);
    expect(jobs.reclaimStaleJobs(db)).toBe(0);
  });

  test('does not reclaim failed job', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.failJob(db, job.id, 'worker-1', 'err');
    db.prepare(`UPDATE research_jobs SET heartbeat_at = datetime('now', '-200 seconds') WHERE id = ?`).run(job.id);
    expect(jobs.reclaimStaleJobs(db)).toBe(0);
  });

  test('updateHeartbeat prevents stale reclaim', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    db.prepare(`UPDATE research_jobs SET heartbeat_at = datetime('now', '-130 seconds') WHERE id = ?`).run(job.id);
    jobs.updateHeartbeat(db, job.id, 'worker-1', 0);
    expect(jobs.reclaimStaleJobs(db)).toBe(0);
  });
});

// ========== Dead worker PID reclaim ==========

describe('dead worker PID reclaim', () => {
  let db: Database;
  let sessionId: string;

  beforeEach(() => {
    db = createTestDb();
    sessionId = insertSession(db);
  });

  test('reclaims job owned by dead PID', () => {
    const deadPid = 9_999_999; // Near-certain non-existent PID
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    db.prepare(`
      UPDATE research_jobs SET status = 'running', claimed_by = ? WHERE id = ?
    `).run(`worker-${deadPid}-12345`, job.id);

    expect(jobs.reclaimDeadWorkerJobs(db)).toBe(1);
    const reclaimed = jobs.getJob(db, job.id)!;
    expect(reclaimed.status).toBe('pending');
    expect(reclaimed.claimed_by).toBeNull();
  });

  test('does not reclaim job owned by live PID (current process)', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    db.prepare(`
      UPDATE research_jobs SET status = 'running', claimed_by = ? WHERE id = ?
    `).run(`worker-${process.pid}-12345`, job.id);

    expect(jobs.reclaimDeadWorkerJobs(db)).toBe(0);
    expect(jobs.getJob(db, job.id)!.status).toBe('running');
  });

  test('ignores malformed claimed_by (no PID to parse)', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    db.prepare(`
      UPDATE research_jobs SET status = 'running', claimed_by = 'bad-format' WHERE id = ?
    `).run(job.id);

    expect(jobs.reclaimDeadWorkerJobs(db)).toBe(0);
  });

  test('does not reclaim completed job even with dead PID', () => {
    const job = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    db.prepare(`
      UPDATE research_jobs SET status = 'completed', claimed_by = 'worker-9999999-1' WHERE id = ?
    `).run(job.id);

    expect(jobs.reclaimDeadWorkerJobs(db)).toBe(0);
  });
});

// ========== Atomic thread job creation ==========

describe('createThreadJobIfNone', () => {
  let db: Database;
  let sessionId: string;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    sessionId = insertSession(db);
    threadId = insertThread(db, sessionId, 'thread-1');
  });

  test('creates job on first call', () => {
    const job = jobs.createThreadJobIfNone(db, { session_id: sessionId, thread_id: threadId });
    expect(job).not.toBeNull();
    expect(job!.thread_id).toBe(threadId);
    expect(job!.status).toBe('pending');
  });

  test('returns null when pending job already exists', () => {
    jobs.createThreadJobIfNone(db, { session_id: sessionId, thread_id: threadId });
    const second = jobs.createThreadJobIfNone(db, { session_id: sessionId, thread_id: threadId });
    expect(second).toBeNull();
    expect(jobs.listJobsForSession(db, sessionId)).toHaveLength(1);
  });

  test('returns null when claimed job exists', () => {
    const j = jobs.createJob(db, { session_id: sessionId, thread_id: threadId, mode: 'burst' });
    jobs.claimJob(db, j.id, 'worker-1');
    expect(jobs.createThreadJobIfNone(db, { session_id: sessionId, thread_id: threadId })).toBeNull();
  });

  test('returns null when running job exists', () => {
    const j = jobs.createJob(db, { session_id: sessionId, thread_id: threadId, mode: 'burst' });
    jobs.claimJob(db, j.id, 'worker-1');
    jobs.markRunning(db, j.id, 'worker-1');
    expect(jobs.createThreadJobIfNone(db, { session_id: sessionId, thread_id: threadId })).toBeNull();
  });

  test('creates new job after completed job', () => {
    const j = jobs.createJob(db, { session_id: sessionId, thread_id: threadId, mode: 'burst' });
    jobs.claimJob(db, j.id, 'worker-1');
    jobs.completeJob(db, j.id, 'worker-1');
    expect(jobs.createThreadJobIfNone(db, { session_id: sessionId, thread_id: threadId })).not.toBeNull();
  });

  test('creates new job after failed job', () => {
    const j = jobs.createJob(db, { session_id: sessionId, thread_id: threadId, mode: 'burst' });
    jobs.claimJob(db, j.id, 'worker-1');
    jobs.failJob(db, j.id, 'worker-1', 'err');
    expect(jobs.createThreadJobIfNone(db, { session_id: sessionId, thread_id: threadId })).not.toBeNull();
  });
});

// ========== Orphaned thread reset ==========

describe('resetOrphanedActiveThreads', () => {
  let db: Database;
  let sessionId: string;

  beforeEach(() => {
    db = createTestDb();
    sessionId = insertSession(db);
  });

  test('resets active thread with no active job to queued', () => {
    const tid = insertThread(db, sessionId, 'thread-orphan', 'active');
    expect(threads.resetOrphanedActiveThreads(db)).toBe(1);
    expect(threads.getThread(db, tid)!.status).toBe('queued');
  });

  test('does not reset active thread that has an active job', () => {
    const tid = insertThread(db, sessionId, 'thread-active', 'active');
    const j = jobs.createJob(db, { session_id: sessionId, thread_id: tid, mode: 'burst' });
    jobs.claimJob(db, j.id, 'worker-1');
    expect(threads.resetOrphanedActiveThreads(db)).toBe(0);
    expect(threads.getThread(db, tid)!.status).toBe('active');
  });

  test('does not reset active thread with pending job', () => {
    const tid = insertThread(db, sessionId, 'thread-active', 'active');
    jobs.createJob(db, { session_id: sessionId, thread_id: tid, mode: 'burst' });
    expect(threads.resetOrphanedActiveThreads(db)).toBe(0);
  });

  test('treats thread with only completed job as orphaned', () => {
    const tid = insertThread(db, sessionId, 'thread-done', 'active');
    const j = jobs.createJob(db, { session_id: sessionId, thread_id: tid, mode: 'burst' });
    jobs.claimJob(db, j.id, 'worker-1');
    jobs.completeJob(db, j.id, 'worker-1');
    expect(threads.resetOrphanedActiveThreads(db)).toBe(1);
    expect(threads.getThread(db, tid)!.status).toBe('queued');
  });

  test('does not touch queued, exhausted, or pruned threads', () => {
    insertThread(db, sessionId, 'thread-q', 'queued');
    insertThread(db, sessionId, 'thread-e', 'exhausted');
    insertThread(db, sessionId, 'thread-p', 'pruned');
    expect(threads.resetOrphanedActiveThreads(db)).toBe(0);
  });

  test('resets multiple orphaned threads at once', () => {
    insertThread(db, sessionId, 'thread-A', 'active');
    insertThread(db, sessionId, 'thread-B', 'active');
    expect(threads.resetOrphanedActiveThreads(db)).toBe(2);
  });
});

// ========== Thread claiming ==========

describe('thread claiming atomicity', () => {
  let db: Database;
  let sessionId: string;

  beforeEach(() => {
    db = createTestDb();
    sessionId = insertSession(db);
  });

  test('claimNextThread marks thread active', () => {
    insertThread(db, sessionId, 'thread-1', 'queued', 0.5);
    const claimed = threads.claimNextThread(db, sessionId);
    expect(claimed).not.toBeNull();
    expect(claimed!.status).toBe('active');
  });

  test('claimNextThread returns null with no queued threads', () => {
    expect(threads.claimNextThread(db, sessionId)).toBeNull();
  });

  test('claimNextThread returns highest-priority thread first', () => {
    insertThread(db, sessionId, 'thread-low', 'queued', 0.3);
    insertThread(db, sessionId, 'thread-high', 'queued', 0.9);
    expect(threads.claimNextThread(db, sessionId)!.id).toBe('thread-high');
  });

  test('second claimNextThread gets the next thread', () => {
    insertThread(db, sessionId, 'thread-1', 'queued', 0.9);
    insertThread(db, sessionId, 'thread-2', 'queued', 0.5);
    threads.claimNextThread(db, sessionId);
    const second = threads.claimNextThread(db, sessionId);
    expect(second!.id).toBe('thread-2');
  });

  test('no thread returned after all are claimed', () => {
    insertThread(db, sessionId, 'thread-1', 'queued');
    threads.claimNextThread(db, sessionId);
    expect(threads.claimNextThread(db, sessionId)).toBeNull();
  });

  test('does not return pruned threads', () => {
    insertThread(db, sessionId, 'thread-pruned', 'pruned');
    expect(threads.claimNextThread(db, sessionId)).toBeNull();
  });

  test('does not return exhausted threads', () => {
    insertThread(db, sessionId, 'thread-exhausted', 'exhausted');
    expect(threads.claimNextThread(db, sessionId)).toBeNull();
  });
});

// ========== findPendingJob priority ordering ==========

describe('findPendingJob', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  test('returns null when no pending jobs', () => {
    expect(jobs.findPendingJob(db)).toBeNull();
  });

  test('returns the single pending job', () => {
    const sessId = insertSession(db, 'sess-1');
    const job = jobs.createJob(db, { session_id: sessId, mode: 'burst' });
    expect(jobs.findPendingJob(db)!.id).toBe(job.id);
  });

  test('does not return claimed jobs', () => {
    const sessId = insertSession(db, 'sess-1');
    const job = jobs.createJob(db, { session_id: sessId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    expect(jobs.findPendingJob(db)).toBeNull();
  });

  test('does not return running jobs', () => {
    const sessId = insertSession(db, 'sess-1');
    const job = jobs.createJob(db, { session_id: sessId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.markRunning(db, job.id, 'worker-1');
    expect(jobs.findPendingJob(db)).toBeNull();
  });

  test('returns job from session with highest-priority queued thread first', () => {
    const s1 = insertSession(db, 'sess-low');
    const s2 = insertSession(db, 'sess-high');
    insertThread(db, s1, 'thread-low', 'queued', 0.2);
    insertThread(db, s2, 'thread-high', 'queued', 0.9);
    const j1 = jobs.createJob(db, { session_id: s1, mode: 'burst' });
    const j2 = jobs.createJob(db, { session_id: s2, mode: 'burst' });
    expect(jobs.findPendingJob(db)!.id).toBe(j2.id);
  });

  test('among equal priority: returns oldest job first', () => {
    const sessId = insertSession(db, 'sess-1');
    insertThread(db, sessId, 'thread-1', 'queued', 0.5);
    insertThread(db, sessId, 'thread-2', 'queued', 0.5);
    const j1 = jobs.createJob(db, { session_id: sessId, thread_id: 'thread-1', mode: 'burst' });
    const j2 = jobs.createJob(db, { session_id: sessId, thread_id: 'thread-2', mode: 'burst' });
    expect(jobs.findPendingJob(db)!.id).toBe(j1.id);
  });
});

// ========== getQueuedThreadsForNewJobs ==========

describe('getQueuedThreadsForNewJobs', () => {
  let db: Database;
  let sessionId: string;

  beforeEach(() => {
    db = createTestDb();
    sessionId = insertSession(db);
  });

  test('returns queued threads with no active jobs', () => {
    insertThread(db, sessionId, 'thread-1', 'queued', 0.8);
    insertThread(db, sessionId, 'thread-2', 'queued', 0.5);
    expect(jobs.getQueuedThreadsForNewJobs(db, sessionId, 10)).toHaveLength(2);
  });

  test('excludes threads with pending jobs', () => {
    insertThread(db, sessionId, 'thread-1', 'queued');
    jobs.createJob(db, { session_id: sessionId, thread_id: 'thread-1', mode: 'burst' });
    expect(jobs.getQueuedThreadsForNewJobs(db, sessionId, 10)).toHaveLength(0);
  });

  test('excludes threads with claimed jobs', () => {
    insertThread(db, sessionId, 'thread-1', 'queued');
    const j = jobs.createJob(db, { session_id: sessionId, thread_id: 'thread-1', mode: 'burst' });
    jobs.claimJob(db, j.id, 'worker-1');
    expect(jobs.getQueuedThreadsForNewJobs(db, sessionId, 10)).toHaveLength(0);
  });

  test('includes thread whose only job is completed', () => {
    insertThread(db, sessionId, 'thread-1', 'queued');
    const j = jobs.createJob(db, { session_id: sessionId, thread_id: 'thread-1', mode: 'burst' });
    jobs.claimJob(db, j.id, 'worker-1');
    jobs.completeJob(db, j.id, 'worker-1');
    expect(jobs.getQueuedThreadsForNewJobs(db, sessionId, 10)).toHaveLength(1);
  });

  test('respects the limit parameter', () => {
    for (let i = 0; i < 6; i++) insertThread(db, sessionId, `t-${i}`, 'queued', 0.5);
    expect(jobs.getQueuedThreadsForNewJobs(db, sessionId, 3)).toHaveLength(3);
  });

  test('returns threads ordered by priority descending', () => {
    insertThread(db, sessionId, 'thread-lo', 'queued', 0.2);
    insertThread(db, sessionId, 'thread-hi', 'queued', 0.9);
    const result = jobs.getQueuedThreadsForNewJobs(db, sessionId, 10);
    expect(result[0].id).toBe('thread-hi');
  });
});

// ========== countActiveJobsForSession ==========

describe('countActiveJobsForSession', () => {
  let db: Database;
  let sessionId: string;

  beforeEach(() => {
    db = createTestDb();
    sessionId = insertSession(db);
  });

  test('returns 0 when no jobs', () => {
    expect(jobs.countActiveJobsForSession(db, sessionId)).toBe(0);
  });

  test('counts pending jobs', () => {
    jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    expect(jobs.countActiveJobsForSession(db, sessionId)).toBe(1);
  });

  test('counts claimed and running jobs', () => {
    const j1 = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    const j2 = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, j1.id, 'worker-1');
    jobs.claimJob(db, j2.id, 'worker-2');
    jobs.markRunning(db, j2.id, 'worker-2');
    expect(jobs.countActiveJobsForSession(db, sessionId)).toBe(2);
  });

  test('does not count completed or failed jobs', () => {
    const j = jobs.createJob(db, { session_id: sessionId, mode: 'burst' });
    jobs.claimJob(db, j.id, 'worker-1');
    jobs.completeJob(db, j.id, 'worker-1');
    expect(jobs.countActiveJobsForSession(db, sessionId)).toBe(0);
  });
});
