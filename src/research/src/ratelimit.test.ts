/**
 * Tests for rate-limit resilience: thread backoff, retry_after scheduling,
 * model rotation in OpenRouterProvider, and getQueuedThreadsForNewJobs filtering.
 *
 * Covers the bugs fixed in: fix(research): exponential backoff on thread rate-limit errors
 * - 429 errors must requeue threads (not exhaust them)
 * - Consecutive 429s back off exponentially: 30s, 60s, 120s … cap 10 min
 * - Non-rate-limit errors still exhaust after 2 failures
 * - getQueuedThreadsForNewJobs excludes threads whose retry_after is in the future
 * - OpenRouterProvider rotates models on 429/402, pauses only on rate-limit errors
 */
import { Database } from 'bun:sqlite';
import { describe, test, expect, beforeEach, mock, afterEach } from 'bun:test';
import { applyResearchDDL } from './ddl';
import { ResearchEngine, type LLMProvider, type LLMResult, type WebSearchResult } from './engine';
import { OpenRouterProvider } from './providers/openrouter';
import * as queries from './services/queries';
import * as threads from './services/threads';
import * as jobs from './services/jobs';
import { DEFAULT_SESSION_CONFIG } from './types';

// ─── Helpers ────────────────────────────────────────────────────────────────

function createTestDb(): Database {
  const db = new Database(':memory:');
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(db);
  return db;
}

function insertSession(db: Database, id = 'sess-1', config = DEFAULT_SESSION_CONFIG) {
  db.prepare(`
    INSERT INTO research_queries (id, title, seed_query, status, config, created_at, updated_at)
    VALUES (?, 'Test', 'test query', 'active', ?, datetime('now'), datetime('now'))
  `).run(id, JSON.stringify({ ...config, min_delay_between_steps_ms: 0 }));
  return id;
}

function insertThread(db: Database, sessionId: string, threadId: string, status = 'queued', retryAfter: string | null = null) {
  db.prepare(`
    INSERT INTO research_threads
      (id, session_id, query, origin, status, priority, depth, max_depth, node_type, retry_after, created_at, updated_at)
    VALUES (?, ?, 'test query', 'seed', ?, 0.5, 0, 9, 'question', ?, datetime('now'), datetime('now'))
  `).run(threadId, sessionId, status, retryAfter);
  return threadId;
}

/** Provider that throws on every call with the given message. */
class ThrowingProvider implements LLMProvider {
  constructor(private msg: string) {}
  async complete(): Promise<LLMResult> { throw new Error(this.msg); }
  async searchWeb(): Promise<WebSearchResult> { throw new Error(this.msg); }
}

function secondsFromNow(s: number): string {
  return new Date(Date.now() + s * 1000).toISOString().replace('T', ' ').replace('Z', '');
}

function parseRetryAfter(s: string): Date {
  return new Date(s.replace(' ', 'T') + 'Z');
}

// ─── Thread backoff on rate-limit errors ────────────────────────────────────

describe('engine: thread backoff on 429', () => {
  let db: Database;
  let sessionId: string;
  let threadId: string;

  beforeEach(() => {
    db = createTestDb();
    sessionId = insertSession(db);
    const t = threads.createThread(db, { session_id: sessionId, query: 'test', origin: 'seed' });
    threadId = t.id;
  });

  test('first 429: thread stays queued with retry_after ~30s in future', async () => {
    const engine = new ResearchEngine({ sqlite: db, provider: new ThrowingProvider('OpenRouter 429: rate limited') });
    const before = Date.now();

    await expect(engine.runThread(sessionId, threadId)).rejects.toThrow('429');

    const t = threads.getThread(db, threadId)!;
    expect(t.status).toBe('queued');
    expect(t.retry_after).not.toBeNull();

    const retryMs = parseRetryAfter(t.retry_after!).getTime();
    expect(retryMs).toBeGreaterThan(before + 25_000);   // at least 25s out
    expect(retryMs).toBeLessThan(before + 40_000);      // no more than 40s out
  });

  test('second consecutive 429: retry_after doubles to ~60s', async () => {
    const engine = new ResearchEngine({ sqlite: db, provider: new ThrowingProvider('OpenRouter 429: rate limited') });

    await expect(engine.runThread(sessionId, threadId)).rejects.toThrow();
    // Reset status to queued so runThread can run again
    threads.updateThread(db, threadId, { status: 'queued', retry_after: null });

    const before = Date.now();
    await expect(engine.runThread(sessionId, threadId)).rejects.toThrow();

    const t = threads.getThread(db, threadId)!;
    const retryMs = parseRetryAfter(t.retry_after!).getTime();
    expect(retryMs).toBeGreaterThan(before + 55_000);
    expect(retryMs).toBeLessThan(before + 70_000);
  });

  test('third consecutive 429: retry_after grows to ~120s', async () => {
    const engine = new ResearchEngine({ sqlite: db, provider: new ThrowingProvider('OpenRouter 429: upstream rate limit') });
    for (let i = 0; i < 2; i++) {
      await expect(engine.runThread(sessionId, threadId)).rejects.toThrow();
      threads.updateThread(db, threadId, { status: 'queued', retry_after: null });
    }
    const before = Date.now();
    await expect(engine.runThread(sessionId, threadId)).rejects.toThrow();

    const t = threads.getThread(db, threadId)!;
    const retryMs = parseRetryAfter(t.retry_after!).getTime();
    expect(retryMs).toBeGreaterThan(before + 110_000);
    expect(retryMs).toBeLessThan(before + 135_000);
  });

  test('backoff caps at 10 minutes', async () => {
    const engine = new ResearchEngine({ sqlite: db, provider: new ThrowingProvider('OpenRouter 529: overloaded') });
    // Run enough failures to exceed the cap (2^5 * 30s = 960s > 600s)
    for (let i = 0; i < 5; i++) {
      await expect(engine.runThread(sessionId, threadId)).rejects.toThrow();
      threads.updateThread(db, threadId, { status: 'queued', retry_after: null });
    }
    const before = Date.now();
    await expect(engine.runThread(sessionId, threadId)).rejects.toThrow();

    const t = threads.getThread(db, threadId)!;
    const retryMs = parseRetryAfter(t.retry_after!).getTime();
    // Cap is 600s = 10 min
    expect(retryMs).toBeLessThan(before + 610_000);
    expect(retryMs).toBeGreaterThan(before + 590_000);
  });

  test('non-consecutive: a success resets the streak', async () => {
    // Two rate-limit failures, then a success (manually clear errors), then one more 429
    const engine = new ResearchEngine({ sqlite: db, provider: new ThrowingProvider('OpenRouter 429: rate limited') });
    for (let i = 0; i < 2; i++) {
      await expect(engine.runThread(sessionId, threadId)).rejects.toThrow();
      threads.updateThread(db, threadId, { status: 'queued', retry_after: null });
    }

    // Simulate a success by inserting a successful step (no error)
    db.prepare(`
      INSERT INTO research_steps (id, thread_id, session_id, model, prompt_tokens, completion_tokens, cost_usd, duration_ms, created_at)
      VALUES ('step-ok', ?, ?, 'test-model', 100, 100, 0, 100, datetime('now'))
    `).run(threadId, sessionId);

    const before = Date.now();
    await expect(engine.runThread(sessionId, threadId)).rejects.toThrow();

    const t = threads.getThread(db, threadId)!;
    // Streak broken by successful step → back to ~30s
    const retryMs = parseRetryAfter(t.retry_after!).getTime();
    expect(retryMs).toBeLessThan(before + 40_000);
  });

  test('non-rate-limit error: thread goes queued on first, exhausted on third', async () => {
    const engine = new ResearchEngine({ sqlite: db, provider: new ThrowingProvider('Network timeout') });

    // First non-rate-limit error → queued, no retry_after
    await expect(engine.runThread(sessionId, threadId)).rejects.toThrow('Network timeout');
    let t = threads.getThread(db, threadId)!;
    expect(t.status).toBe('queued');
    expect(t.retry_after).toBeNull();

    // Second error → exhausted
    threads.updateThread(db, threadId, { status: 'queued' });
    await expect(engine.runThread(sessionId, threadId)).rejects.toThrow('Network timeout');
    t = threads.getThread(db, threadId)!;
    expect(t.status).toBe('exhausted');
  });

  test('rate-limit message variants are all detected', async () => {
    const variants = [
      'OpenRouter 429: {"code":429}',
      'OpenRouter 529: overloaded',
      'Rate limit exceeded: @ratelimit/too-many-requests',
    ];
    for (const msg of variants) {
      const localDb = createTestDb();
      const sid = insertSession(localDb);
      const t = threads.createThread(localDb, { session_id: sid, query: 'q', origin: 'seed' });
      const eng = new ResearchEngine({ sqlite: localDb, provider: new ThrowingProvider(msg) });
      await expect(eng.runThread(sid, t.id)).rejects.toThrow();
      const updated = threads.getThread(localDb, t.id)!;
      expect(updated.status).toBe('queued');
      expect(updated.retry_after).not.toBeNull();
    }
  });
});

// ─── getQueuedThreadsForNewJobs retry_after filter ──────────────────────────

describe('getQueuedThreadsForNewJobs: retry_after filtering', () => {
  let db: Database;
  let sessionId: string;

  beforeEach(() => {
    db = createTestDb();
    sessionId = insertSession(db);
  });

  test('thread with no retry_after is returned', () => {
    insertThread(db, sessionId, 'thread-a', 'queued', null);
    const result = jobs.getQueuedThreadsForNewJobs(db, sessionId, 10);
    expect(result.map(t => t.id)).toContain('thread-a');
  });

  test('thread with retry_after in the past is returned', () => {
    const past = new Date(Date.now() - 60_000).toISOString().replace('T', ' ').replace('Z', '');
    insertThread(db, sessionId, 'thread-b', 'queued', past);
    const result = jobs.getQueuedThreadsForNewJobs(db, sessionId, 10);
    expect(result.map(t => t.id)).toContain('thread-b');
  });

  test('thread with retry_after in the future is excluded', () => {
    const future = new Date(Date.now() + 60_000).toISOString().replace('T', ' ').replace('Z', '');
    insertThread(db, sessionId, 'thread-c', 'queued', future);
    const result = jobs.getQueuedThreadsForNewJobs(db, sessionId, 10);
    expect(result.map(t => t.id)).not.toContain('thread-c');
  });

  test('only ready threads are returned when mix of future and past retry_after', () => {
    const past = new Date(Date.now() - 1_000).toISOString().replace('T', ' ').replace('Z', '');
    const future = new Date(Date.now() + 60_000).toISOString().replace('T', ' ').replace('Z', '');
    insertThread(db, sessionId, 'ready', 'queued', past);
    insertThread(db, sessionId, 'blocked', 'queued', future);
    insertThread(db, sessionId, 'no-backoff', 'queued', null);
    const result = jobs.getQueuedThreadsForNewJobs(db, sessionId, 10);
    const ids = result.map(t => t.id);
    expect(ids).toContain('ready');
    expect(ids).toContain('no-backoff');
    expect(ids).not.toContain('blocked');
  });

  test('thread with active job is excluded regardless of retry_after', () => {
    insertThread(db, sessionId, 'thread-d', 'queued', null);
    const job = jobs.createJob(db, { session_id: sessionId, thread_id: 'thread-d', mode: 'burst' });
    jobs.claimJob(db, job.id, 'worker-1');
    const result = jobs.getQueuedThreadsForNewJobs(db, sessionId, 10);
    expect(result.map(t => t.id)).not.toContain('thread-d');
  });
});

// ─── OpenRouterProvider model rotation ──────────────────────────────────────

describe('OpenRouterProvider: model rotation on errors', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeOkResponse(model = 'test-model') {
    return new Response(JSON.stringify({
      id: 'test',
      model,
      choices: [{ message: { content: 'answer' } }],
      usage: { prompt_tokens: 10, completion_tokens: 20 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  function makeErrorResponse(status: number, message: string) {
    return new Response(JSON.stringify({ error: { message, code: status } }), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  test('returns result when first model succeeds', async () => {
    globalThis.fetch = async () => makeOkResponse('model-a');
    const provider = new OpenRouterProvider({ apiKey: 'test', models: ['model-a', 'model-b'] });
    const result = await provider.complete('model-a', 'prompt', 100);
    expect(result.text).toBe('answer');
  });

  test('rotates to next model on 429 and succeeds', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return makeErrorResponse(429, 'rate limited');
      return makeOkResponse('model-b');
    };
    const provider = new OpenRouterProvider({ apiKey: 'test', models: ['model-a', 'model-b'] });
    const result = await provider.complete('model-a', 'prompt', 100);
    expect(result.text).toBe('answer');
    expect(calls).toBe(2);
  });

  test('rotates to next model on 402 credit error', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      if (calls === 1) return makeErrorResponse(402, 'insufficient credits');
      return makeOkResponse('model-b');
    };
    const provider = new OpenRouterProvider({ apiKey: 'test', models: ['model-a', 'model-b'] });
    const result = await provider.complete('model-a', 'prompt', 100);
    expect(result.text).toBe('answer');
    expect(calls).toBe(2);
  });

  test('throws after all models are exhausted', async () => {
    globalThis.fetch = async () => makeErrorResponse(429, 'rate limited');
    const provider = new OpenRouterProvider({ apiKey: 'test', models: ['model-a', 'model-b'] });
    await expect(provider.complete('model-a', 'prompt', 100)).rejects.toThrow('429');
  });

  test('non-retriable error (500) throws immediately without rotation', async () => {
    let calls = 0;
    globalThis.fetch = async () => {
      calls++;
      return makeErrorResponse(500, 'internal server error');
    };
    const provider = new OpenRouterProvider({ apiKey: 'test', models: ['model-a', 'model-b', 'model-c'] });
    await expect(provider.complete('model-a', 'prompt', 100)).rejects.toThrow('500');
    expect(calls).toBe(1);
  });
});
