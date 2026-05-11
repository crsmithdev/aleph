/**
 * Test computeErrorStatus: aggregates recent credit/rate/overload errors
 * per active session for UI banners and indicators.
 */
import { Database } from 'bun:sqlite';
import { describe, test, expect, beforeEach } from 'bun:test';
import { applyResearchDDL } from './ddl';
import { computeErrorStatus } from './services/metrics';
import * as queries from './services/queries';
import * as threads from './services/threads';
import * as steps from './services/steps';

function makeDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(db);
  return db;
}

function seedSession(db: Database, title = 'test', status: 'active' | 'paused' | 'exhausted' = 'active'): { sid: string; tid: string } {
  const session = queries.createQuery(db, title, title);
  if (status !== 'active') queries.updateQuery(db, session.id, { status });
  const t = threads.createThread(db, { session_id: session.id, query: title, origin: 'seed' });
  return { sid: session.id, tid: t.id };
}

describe('computeErrorStatus', () => {
  let db: Database;

  beforeEach(() => { db = makeDb(); });

  test('empty db → no sessions, no worst', () => {
    const r = computeErrorStatus(db);
    expect(r.worst).toBeNull();
    expect(r.sessions).toEqual([]);
  });

  test('credit_exhausted on active session shows up', () => {
    const { sid, tid } = seedSession(db, 'active query');
    steps.createStep(db, {
      thread_id: tid, session_id: sid, model: 'openrouter/x',
      prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, duration_ms: 0,
      error: 'OpenRouter 402: requires more credits',
      error_kind: 'credit_exhausted',
    });

    const r = computeErrorStatus(db);
    expect(r.worst).toBe('credit_exhausted');
    expect(r.sessions).toHaveLength(1);
    expect(r.sessions[0].session_id).toBe(sid);
    expect(r.sessions[0].error_kind).toBe('credit_exhausted');
    expect(r.sessions[0].count).toBe(1);
    expect(r.sessions[0].session_title).toBe('active query');
    expect(r.sessions[0].last_message).toContain('requires more credits');
  });

  test('errors on exhausted sessions are ignored', () => {
    const { sid, tid } = seedSession(db, 'done query', 'exhausted');
    steps.createStep(db, {
      thread_id: tid, session_id: sid, model: 'openrouter/x',
      prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, duration_ms: 0,
      error: '402: credits', error_kind: 'credit_exhausted',
    });
    const r = computeErrorStatus(db);
    expect(r.sessions).toEqual([]);
  });

  test('credit_exhausted ranks worse than rate_limit / overload', () => {
    const { sid: a, tid: at } = seedSession(db, 'rate');
    const { sid: b, tid: bt } = seedSession(db, 'credit');
    const { sid: c, tid: ct } = seedSession(db, 'over');

    steps.createStep(db, {
      thread_id: at, session_id: a, model: 'm', prompt_tokens: 0, completion_tokens: 0,
      cost_usd: 0, duration_ms: 0, error: '429', error_kind: 'rate_limit',
    });
    steps.createStep(db, {
      thread_id: bt, session_id: b, model: 'm', prompt_tokens: 0, completion_tokens: 0,
      cost_usd: 0, duration_ms: 0, error: '402', error_kind: 'credit_exhausted',
    });
    steps.createStep(db, {
      thread_id: ct, session_id: c, model: 'm', prompt_tokens: 0, completion_tokens: 0,
      cost_usd: 0, duration_ms: 0, error: '529', error_kind: 'overload',
    });

    const r = computeErrorStatus(db);
    expect(r.worst).toBe('credit_exhausted');
    expect(r.sessions).toHaveLength(3);
  });

  test('errors outside lookback window are ignored', () => {
    const { sid, tid } = seedSession(db, 'old');
    // Insert a step with created_at an hour ago
    db.prepare(`
      INSERT INTO research_steps (id, thread_id, session_id, model, prompt_tokens, completion_tokens, cost_usd, tool_calls, duration_ms, error, error_kind, created_at)
      VALUES ('stale', ?, ?, 'm', 0, 0, 0, '[]', 0, '402', 'credit_exhausted', datetime('now', '-2 hours'))
    `).run(tid, sid);

    expect(computeErrorStatus(db, 30).sessions).toEqual([]);
    expect(computeErrorStatus(db, 180).sessions).toHaveLength(1);
  });

  test('non-actionable kinds (transient_other) are excluded', () => {
    const { sid, tid } = seedSession(db, 'other');
    steps.createStep(db, {
      thread_id: tid, session_id: sid, model: 'm',
      prompt_tokens: 0, completion_tokens: 0, cost_usd: 0, duration_ms: 0,
      error: 'ECONNRESET', error_kind: 'transient_other',
    });
    expect(computeErrorStatus(db).sessions).toEqual([]);
  });
});
