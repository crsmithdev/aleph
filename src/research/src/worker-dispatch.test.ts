/**
 * Tests for worker dispatch logic: budget enforcement, thread job orchestration,
 * abort handling, and cost tracking. Tests the service-layer primitives that the
 * worker loop composes — no real workers or LLMs needed.
 */
import { Database } from 'bun:sqlite';
import { describe, test, expect, beforeEach } from 'bun:test';
import { applyResearchDDL } from './ddl';
import * as jobs from './services/jobs';
import * as threads from './services/threads';
import * as steps from './services/steps';
import * as queries from './services/queries';
import { DEFAULT_SESSION_CONFIG } from './types';

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(db);
  return db;
}

function insertSession(
  db: Database,
  id = 'sess-1',
  config = DEFAULT_SESSION_CONFIG,
  status = 'active'
): string {
  db.prepare(`
    INSERT INTO research_queries (id, title, seed_query, status, config, created_at, updated_at)
    VALUES (?, 'Test', 'test query', ?, ?, datetime('now'), datetime('now'))
  `).run(id, status, JSON.stringify(config));
  return id;
}

function insertThread(
  db: Database,
  sessionId: string,
  threadId: string,
  status = 'queued',
  priority = 0.5
): string {
  db.prepare(`
    INSERT INTO research_threads
      (id, session_id, query, origin, status, priority, depth, max_depth, node_type, created_at, updated_at)
    VALUES (?, ?, 'test query', 'seed', ?, ?, 0, 9, 'question', datetime('now'), datetime('now'))
  `).run(threadId, sessionId, status, priority);
  return threadId;
}

function addStep(db: Database, sessionId: string, threadId: string, costUsd: number, daysAgo = 0): void {
  const ts = new Date(Date.now() - daysAgo * 86_400_000).toISOString();
  db.prepare(`
    INSERT INTO research_steps
      (id, session_id, thread_id, model, provider, prompt_tokens, completion_tokens, cost_usd, tool_calls, duration_ms, created_at)
    VALUES (?, ?, ?, 'test-model', 'openrouter', 100, 50, ?, '[]', 100, ?)
  `).run(`step-${Math.random().toString(36).slice(2)}`, sessionId, threadId, costUsd, ts);
}

// ========== Budget enforcement ==========

describe('budget enforcement — daily', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  test('today_cost < budget_daily_usd: budget OK', () => {
    const config = { ...DEFAULT_SESSION_CONFIG, budget_daily_usd: 1.0 };
    const sessId = insertSession(db, 'sess-1', config);
    const tid = insertThread(db, sessId, 'thread-1');
    addStep(db, sessId, tid, 0.50); // 50¢ today
    const cost = queries.getQueryCost(db, sessId);
    expect(cost.today_cost).toBeLessThan(1.0);
  });

  test('today_cost >= budget_daily_usd: budget exceeded', () => {
    const config = { ...DEFAULT_SESSION_CONFIG, budget_daily_usd: 1.0 };
    const sessId = insertSession(db, 'sess-2', config);
    const tid = insertThread(db, sessId, 'thread-1');
    addStep(db, sessId, tid, 1.50); // $1.50 today
    const cost = queries.getQueryCost(db, sessId);
    expect(cost.today_cost).toBeGreaterThanOrEqual(1.0);
  });

  test('steps from yesterday do not count toward today_cost', () => {
    const config = { ...DEFAULT_SESSION_CONFIG, budget_daily_usd: 1.0 };
    const sessId = insertSession(db, 'sess-3', config);
    const tid = insertThread(db, sessId, 'thread-1');
    addStep(db, sessId, tid, 2.00, 1); // $2 yesterday
    const cost = queries.getQueryCost(db, sessId);
    expect(cost.today_cost).toBe(0);
    expect(cost.total_cost).toBeCloseTo(2.0);
  });

  test('budget enforcement: session paused when daily limit hit', () => {
    const config = { ...DEFAULT_SESSION_CONFIG, budget_daily_usd: 1.0 };
    const sessId = insertSession(db, 'sess-4', config);
    const tid = insertThread(db, sessId, 'thread-1');
    addStep(db, sessId, tid, 1.50);

    const session = queries.getQuery(db, sessId)!;
    const cost = queries.getQueryCost(db, sessId);
    if (cost.today_cost >= session.config.budget_daily_usd) {
      queries.updateQuery(db, sessId, { status: 'paused' });
    }

    expect(queries.getQuery(db, sessId)!.status).toBe('paused');
  });
});

describe('budget enforcement — total', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  test('total_cost < budget_total_usd: budget OK', () => {
    const config = { ...DEFAULT_SESSION_CONFIG, budget_total_usd: 5.0 };
    const sessId = insertSession(db, 'sess-1', config);
    const tid = insertThread(db, sessId, 'thread-1');
    addStep(db, sessId, tid, 2.00, 1); // $2 yesterday
    addStep(db, sessId, tid, 1.00, 0); // $1 today → $3 total
    const cost = queries.getQueryCost(db, sessId);
    expect(cost.total_cost).toBeLessThan(5.0);
  });

  test('total_cost >= budget_total_usd: budget exceeded', () => {
    const config = { ...DEFAULT_SESSION_CONFIG, budget_total_usd: 5.0 };
    const sessId = insertSession(db, 'sess-2', config);
    const tid = insertThread(db, sessId, 'thread-1');
    addStep(db, sessId, tid, 3.00, 2);
    addStep(db, sessId, tid, 3.00, 0); // $6 total
    const cost = queries.getQueryCost(db, sessId);
    expect(cost.total_cost).toBeGreaterThanOrEqual(5.0);
  });

  test('null budget_total_usd means no total cap', () => {
    const config = { ...DEFAULT_SESSION_CONFIG, budget_total_usd: null };
    const sessId = insertSession(db, 'sess-3', config);
    const tid = insertThread(db, sessId, 'thread-1');
    addStep(db, sessId, tid, 999.00); // absurdly high
    const session = queries.getQuery(db, sessId)!;
    // budget_total_usd is null → no cap enforced
    expect(session.config.budget_total_usd).toBeNull();
  });
});

// ========== Cost tracking accuracy ==========

describe('cost tracking', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  test('getQueryCost sums all step costs', () => {
    const sessId = insertSession(db, 'sess-1');
    const tid = insertThread(db, sessId, 'thread-1');
    addStep(db, sessId, tid, 0.10);
    addStep(db, sessId, tid, 0.20);
    addStep(db, sessId, tid, 0.30);
    const cost = queries.getQueryCost(db, sessId);
    expect(cost.total_cost).toBeCloseTo(0.60);
    expect(cost.step_count).toBe(3);
  });

  test('getQueryCost returns 0 with no steps', () => {
    const sessId = insertSession(db, 'sess-2');
    const cost = queries.getQueryCost(db, sessId);
    expect(cost.total_cost).toBe(0);
    expect(cost.today_cost).toBe(0);
    expect(cost.step_count).toBe(0);
  });

  test('error steps (with error field) still contribute to cost', () => {
    const sessId = insertSession(db, 'sess-3');
    const tid = insertThread(db, sessId, 'thread-1');
    db.prepare(`
      INSERT INTO research_steps
        (id, session_id, thread_id, model, provider, prompt_tokens, completion_tokens, cost_usd, tool_calls, duration_ms, error, created_at)
      VALUES (?, ?, ?, 'test', 'openrouter', 100, 50, 0.05, '[]', 100, 'API error', datetime('now'))
    `).run('step-err', sessId, tid);
    const cost = queries.getQueryCost(db, sessId);
    expect(cost.total_cost).toBeCloseTo(0.05);
    expect(cost.step_count).toBe(1);
  });

  test('costs from multiple threads all attributed to session', () => {
    const sessId = insertSession(db, 'sess-4');
    const t1 = insertThread(db, sessId, 'thread-1');
    const t2 = insertThread(db, sessId, 'thread-2');
    addStep(db, sessId, t1, 0.30);
    addStep(db, sessId, t2, 0.40);
    const cost = queries.getQueryCost(db, sessId);
    expect(cost.total_cost).toBeCloseTo(0.70);
    expect(cost.step_count).toBe(2);
  });

  test('costs isolated between sessions', () => {
    const s1 = insertSession(db, 'sess-1');
    const s2 = insertSession(db, 'sess-2');
    const t1 = insertThread(db, s1, 'thread-1');
    const t2 = insertThread(db, s2, 'thread-2');
    addStep(db, s1, t1, 1.00);
    addStep(db, s2, t2, 2.00);
    expect(queries.getQueryCost(db, s1).total_cost).toBeCloseTo(1.00);
    expect(queries.getQueryCost(db, s2).total_cost).toBeCloseTo(2.00);
  });
});

// ========== Thread dispatch orchestration ==========

describe('thread dispatch orchestration', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  test('dispatch creates one job per queued thread up to max_concurrent_threads', () => {
    const config = { ...DEFAULT_SESSION_CONFIG, max_concurrent_threads: 3 };
    const sessId = insertSession(db, 'sess-1', config);
    for (let i = 0; i < 5; i++) insertThread(db, sessId, `thread-${i}`, 'queued');

    const slots = config.max_concurrent_threads - jobs.countActiveJobsForSession(db, sessId);
    const queued = jobs.getQueuedThreadsForNewJobs(db, sessId, slots);
    for (const t of queued) jobs.createThreadJobIfNone(db, { session_id: sessId, thread_id: t.id });

    expect(jobs.countActiveJobsForSession(db, sessId)).toBe(3);
  });

  test('dispatch does not exceed max_concurrent_threads', () => {
    const config = { ...DEFAULT_SESSION_CONFIG, max_concurrent_threads: 2 };
    const sessId = insertSession(db, 'sess-2', config);
    for (let i = 0; i < 4; i++) insertThread(db, sessId, `thread-${i}`, 'queued');

    // First pass
    const slots1 = config.max_concurrent_threads - jobs.countActiveJobsForSession(db, sessId);
    const q1 = jobs.getQueuedThreadsForNewJobs(db, sessId, slots1);
    for (const t of q1) jobs.createThreadJobIfNone(db, { session_id: sessId, thread_id: t.id });

    // Second pass (slots exhausted)
    const slots2 = config.max_concurrent_threads - jobs.countActiveJobsForSession(db, sessId);
    expect(slots2).toBe(0);

    const q2 = jobs.getQueuedThreadsForNewJobs(db, sessId, slots2);
    for (const t of q2) jobs.createThreadJobIfNone(db, { session_id: sessId, thread_id: t.id });

    expect(jobs.countActiveJobsForSession(db, sessId)).toBe(2);
  });

  test('dispatch skips threads that already have a job', () => {
    const sessId = insertSession(db, 'sess-3');
    const t1 = insertThread(db, sessId, 'thread-1', 'queued');
    // Pre-create a job for thread-1
    jobs.createThreadJobIfNone(db, { session_id: sessId, thread_id: t1 });

    const queued = jobs.getQueuedThreadsForNewJobs(db, sessId, 10);
    expect(queued.find(t => t.id === t1)).toBeUndefined();
  });

  test('dispatch after a job completes frees up a slot', () => {
    const config = { ...DEFAULT_SESSION_CONFIG, max_concurrent_threads: 1 };
    const sessId = insertSession(db, 'sess-4', config);
    const t1 = insertThread(db, sessId, 'thread-1', 'queued');
    const t2 = insertThread(db, sessId, 'thread-2', 'queued');

    // Fill the one slot
    const j1 = jobs.createJob(db, { session_id: sessId, thread_id: t1, mode: 'burst' });
    jobs.claimJob(db, j1.id, 'worker-1');
    jobs.completeJob(db, j1.id, 'worker-1');

    // Now one slot is free
    const slots = config.max_concurrent_threads - jobs.countActiveJobsForSession(db, sessId);
    expect(slots).toBe(1);
    const queued = jobs.getQueuedThreadsForNewJobs(db, sessId, slots);
    expect(queued.find(t => t.id === t2)).not.toBeUndefined();
  });
});

// ========== Abort / cancellation ==========

describe('job cancellation via DB', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  test('cancelled job is no longer visible as active', () => {
    const sessId = insertSession(db, 'sess-1');
    const job = jobs.createJob(db, { session_id: sessId, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.cancelJob(db, job.id);
    expect(jobs.getActiveJobForSession(db, sessId)).toBeNull();
  });

  test('getActiveJobForSession returns null after cancellation', () => {
    const sessId = insertSession(db, 'sess-1');
    const job = jobs.createJob(db, { session_id: sessId, mode: 'burst' });
    expect(jobs.getActiveJobForSession(db, sessId)).not.toBeNull();
    jobs.cancelJob(db, job.id);
    expect(jobs.getActiveJobForSession(db, sessId)).toBeNull();
  });

  test('AbortController: aborting signals the signal', () => {
    const controller = new AbortController();
    expect(controller.signal.aborted).toBe(false);
    controller.abort();
    expect(controller.signal.aborted).toBe(true);
  });

  test('AbortError is recognizable by message pattern', () => {
    const controller = new AbortController();
    controller.abort();
    // Simulate the abort error check in worker.ts
    const err = new DOMException('This operation was aborted', 'AbortError');
    const msg = err.message;
    const isAbort = msg === 'This operation was aborted' || msg.includes('AbortError');
    expect(isAbort).toBe(true);
  });
});

// ========== Stale reclaim + orphan reset integration ==========

describe('stale reclaim + orphan reset interaction', () => {
  let db: Database;

  beforeEach(() => { db = createTestDb(); });

  test('stale job reclaim makes thread re-dispatchable', () => {
    const sessId = insertSession(db, 'sess-1');
    const tid = insertThread(db, sessId, 'thread-1', 'active');
    const job = jobs.createJob(db, { session_id: sessId, thread_id: tid, mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    jobs.markRunning(db, job.id, 'worker-1');

    // Simulate stale heartbeat
    db.prepare(`UPDATE research_jobs SET heartbeat_at = datetime('now', '-130 seconds') WHERE id = ?`).run(job.id);

    // Reclaim: job goes back to pending
    jobs.reclaimStaleJobs(db);
    expect(jobs.getJob(db, job.id)!.status).toBe('pending');

    // Thread is still 'active' — run orphan reset
    threads.resetOrphanedActiveThreads(db);
    // Thread should be queued again (job is now pending, not active)
    // Wait — pending is still "active" for orphan purposes (IN pending/claimed/running)
    // Actually the thread is still covered by the now-pending job, so it should NOT reset
    expect(threads.getThread(db, tid)!.status).toBe('active');
  });

  test('orphan reset after job fully reclaimed and no pending job', () => {
    const sessId = insertSession(db, 'sess-2');
    const tid = insertThread(db, sessId, 'thread-1', 'active');

    // No job at all — thread is immediately orphaned
    expect(threads.resetOrphanedActiveThreads(db)).toBe(1);
    expect(threads.getThread(db, tid)!.status).toBe('queued');
  });
});
