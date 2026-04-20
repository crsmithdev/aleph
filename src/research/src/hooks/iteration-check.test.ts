import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../ddl.js';
import * as queries from '../services/queries.js';
import * as threads from '../services/threads.js';
import { listIterationChecks } from '../services/iteration-checks.js';
import {
  createIterationCheckHandler,
  buildIterationCheckPayload,
  applyIterationCorrection,
  runIterationCheck,
} from './iteration-check.js';
import { registerHook, clearHooks } from './registry.js';

function mockFetch(body: unknown, status = 200): typeof fetch {
  return (async () => ({
    ok: status >= 200 && status < 300,
    status,
    statusText: 'OK',
    json: async () => body,
  })) as unknown as typeof fetch;
}
function llmReply(content: string) {
  return { choices: [{ message: { content } }] };
}

describe('iteration_check handler', () => {
  test('parses on_track verdict with no correction', async () => {
    const handler = createIterationCheckHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply(JSON.stringify({
        verdict: 'on_track',
        notes: 'progressing normally',
      }))),
    });
    const result = await handler({
      query_id: 'q1', prompt: 'p', hints: {}, iterations_completed: 5,
      metrics: { findings: 3, threads_active: 2, threads_total: 3, cost_usd: 0.01, errors: 0, steps: 7 },
      recent_thread_queries: ['q'], recent_finding_summaries: ['f'],
    });
    expect(result?.verdict).toBe('on_track');
    expect(result?.notes).toBe('progressing normally');
    expect(result?.correction).toBeUndefined();
  });

  test('parses needs_correction with kill_threads and scope_change', async () => {
    const handler = createIterationCheckHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply(JSON.stringify({
        verdict: 'needs_correction',
        notes: 'drift detected',
        correction: {
          kill_threads: ['off topic query'],
          scope_change: 'narrow to recent papers',
        },
      }))),
    });
    const result = await handler({
      query_id: 'q1', prompt: 'p', hints: {}, iterations_completed: 10,
      metrics: { findings: 1, threads_active: 5, threads_total: 6, cost_usd: 0.5, errors: 2, steps: 30 },
      recent_thread_queries: [], recent_finding_summaries: [],
    });
    expect(result?.verdict).toBe('needs_correction');
    expect(result?.correction?.kill_threads).toEqual(['off topic query']);
    expect(result?.correction?.scope_change).toBe('narrow to recent papers');
  });

  test('rejects invalid verdict value', async () => {
    const handler = createIterationCheckHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply(JSON.stringify({ verdict: 'maybe', notes: 'unclear' }))),
    });
    const result = await handler({
      query_id: 'q1', prompt: 'p', hints: {}, iterations_completed: 1,
      metrics: { findings: 0, threads_active: 1, threads_total: 1, cost_usd: 0, errors: 0, steps: 1 },
      recent_thread_queries: [], recent_finding_summaries: [],
    });
    expect(result).toBeNull();
  });

  test('discards malformed correction entries', async () => {
    const handler = createIterationCheckHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply(JSON.stringify({
        verdict: 'drifting',
        notes: 'x',
        correction: { kill_threads: 'not an array', scope_change: '' },
      }))),
    });
    const result = await handler({
      query_id: 'q1', prompt: 'p', hints: {}, iterations_completed: 1,
      metrics: { findings: 0, threads_active: 1, threads_total: 1, cost_usd: 0, errors: 0, steps: 1 },
      recent_thread_queries: [], recent_finding_summaries: [],
    });
    expect(result?.verdict).toBe('drifting');
    // no valid correction fields present
    expect(result?.correction).toBeUndefined();
  });
});

describe('applyIterationCorrection', () => {
  let sqlite: Database;
  let sessionId: string;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    applyResearchDDL(sqlite);
    const session = queries.createQuery(sqlite, 'Test', 'test prompt');
    sessionId = session.id;
  });

  test('kills a thread whose query matches (case-insensitive, whitespace-tolerant)', () => {
    threads.createThread(sqlite, {
      session_id: sessionId,
      query: 'How does X work',
      short_query: null,
      origin: 'seed',
      priority: 1.0,
      depth: 0,
      max_depth: 3,
      status: 'queued',
    });

    const actions = applyIterationCorrection(sqlite, sessionId, {
      kill_threads: ['  how does x WORK  '],
    });

    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('kill_thread');
    expect(actions[0].ok).toBe(true);

    const updated = threads.listThreads(sqlite, sessionId)[0];
    expect(updated.status).toBe('pruned');
  });

  test('records failure when no matching thread exists', () => {
    const actions = applyIterationCorrection(sqlite, sessionId, {
      kill_threads: ['no such query'],
    });
    expect(actions.length).toBe(1);
    expect(actions[0].ok).toBe(false);
    expect(actions[0].error).toContain('no matching');
  });

  test('does not kill an already-pruned or exhausted thread', () => {
    const t = threads.createThread(sqlite, {
      session_id: sessionId,
      query: 'old query',
      short_query: null,
      origin: 'seed',
      priority: 1.0,
      depth: 0,
      max_depth: 3,
      status: 'queued',
    });
    threads.updateThread(sqlite, t.id, { status: 'exhausted' });

    const actions = applyIterationCorrection(sqlite, sessionId, {
      kill_threads: ['old query'],
    });
    expect(actions[0].ok).toBe(false);
  });

  test('scope_change surfaces as scope_change_proposed, not auto-applied', () => {
    const actions = applyIterationCorrection(sqlite, sessionId, {
      scope_change: 'narrow to X',
    });
    expect(actions.length).toBe(1);
    expect(actions[0].action).toBe('scope_change_proposed');
    expect(actions[0].detail).toBe('narrow to X');
  });

  test('narrow_sources records a note', () => {
    const actions = applyIterationCorrection(sqlite, sessionId, {
      narrow_sources: ['arxiv.org', 'acm.org'],
    });
    expect(actions[0].action).toBe('narrow_sources');
    expect(actions[0].detail).toBe('arxiv.org, acm.org');
  });
});

describe('buildIterationCheckPayload', () => {
  let sqlite: Database;
  let sessionId: string;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    applyResearchDDL(sqlite);
    const session = queries.createQuery(sqlite, 'Test', 'test prompt', undefined, null, null, { shape: 'list' });
    sessionId = session.id;
  });

  test('aggregates metrics and includes recent queries', () => {
    threads.createThread(sqlite, {
      session_id: sessionId, query: 'q1', short_query: null, origin: 'seed',
      priority: 1, depth: 0, max_depth: 3, status: 'queued',
    });
    threads.createThread(sqlite, {
      session_id: sessionId, query: 'q2', short_query: null, origin: 'seed',
      priority: 1, depth: 0, max_depth: 3, status: 'active',
    });

    const session = queries.getQuery(sqlite, sessionId)!;
    const payload = buildIterationCheckPayload(sqlite, {
      id: session.id, prompt: session.prompt, prompt_hints: session.prompt_hints as Record<string, unknown>,
    }, 7);

    expect(payload.iterations_completed).toBe(7);
    expect(payload.metrics.threads_active).toBe(2);
    expect(payload.metrics.threads_total).toBe(2);
    expect(payload.recent_thread_queries.length).toBe(2);
    expect(payload.hints).toEqual({ shape: 'list' });
    expect(payload.prompt).toBe('test prompt');
  });
});

describe('runIterationCheck (end to end)', () => {
  let sqlite: Database;
  let sessionId: string;

  beforeEach(() => {
    clearHooks();
    sqlite = new Database(':memory:');
    applyResearchDDL(sqlite);
    const session = queries.createQuery(sqlite, 'Test', 'understand how transformers work');
    sessionId = session.id;
    threads.createThread(sqlite, {
      session_id: sessionId, query: 'off topic thing', short_query: null, origin: 'seed',
      priority: 1, depth: 0, max_depth: 3, status: 'queued',
    });
  });

  test('records verdict and kills matching thread', async () => {
    registerHook('iteration_check', async () => ({
      verdict: 'needs_correction',
      notes: 'one thread is off topic',
      correction: { kill_threads: ['off topic thing'] },
    }), { label: 'test' });

    const session = queries.getQuery(sqlite, sessionId)!;
    await runIterationCheck(sqlite, {
      id: session.id, prompt: session.prompt, prompt_hints: session.prompt_hints as Record<string, unknown>,
    }, 'job-1', 5);

    const records = listIterationChecks(sqlite, sessionId);
    expect(records.length).toBe(1);
    expect(records[0].verdict).toBe('needs_correction');
    expect(records[0].applied_actions.length).toBe(1);
    expect(records[0].applied_actions[0].ok).toBe(true);

    const t = threads.listThreads(sqlite, sessionId)[0];
    expect(t.status).toBe('pruned');
  });

  test('no-op when handler returns null', async () => {
    registerHook('iteration_check', async () => null, { label: 'nullish' });

    const session = queries.getQuery(sqlite, sessionId)!;
    await runIterationCheck(sqlite, {
      id: session.id, prompt: session.prompt, prompt_hints: session.prompt_hints as Record<string, unknown>,
    }, 'job-1', 5);

    expect(listIterationChecks(sqlite, sessionId).length).toBe(0);
  });

  test('swallows handler errors (does not throw to caller)', async () => {
    registerHook('iteration_check', async () => { throw new Error('boom'); }, { label: 'broken' });

    const session = queries.getQuery(sqlite, sessionId)!;
    // Should not throw
    await runIterationCheck(sqlite, {
      id: session.id, prompt: session.prompt, prompt_hints: session.prompt_hints as Record<string, unknown>,
    }, 'job-1', 5);

    // Hook error means no record persisted — registry recorded it as 'error'
    // but runIterationCheck only persists on a valid result.
    expect(listIterationChecks(sqlite, sessionId).length).toBe(0);
  });
});
