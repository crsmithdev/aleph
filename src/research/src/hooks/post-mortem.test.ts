import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../ddl.js';
import * as queries from '../services/queries.js';
import * as threads from '../services/threads.js';
import * as findings from '../services/findings.js';
import { listPostMortems } from '../services/post-mortems.js';
import {
  createPostMortemHandler,
  buildPostMortemPayload,
  runPostMortem,
} from './post-mortem.js';
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

const BASE_PAYLOAD = {
  query_id: 'q1',
  job_id: 'j1',
  prompt: 'x',
  hints: {},
  interpretation: null,
  final_summary: 'summary',
  metrics: { findings: 10, threads_active: 0, threads_total: 5, cost_usd: 0.25, errors: 3, steps: 40, duration_ms: 180_000 },
  thread_state: { by_status: { exhausted: 5 }, stuck_count: 0, pruned_count: 0 },
  source_health: { failure_rate: 0.05, total_attempts: 20, top_failing_domains: [] },
  sample_findings: [],
};

describe('post_mortem handler', () => {
  test('parses pass verdict with empty recommendations', async () => {
    const handler = createPostMortemHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply(JSON.stringify({
        verdict: 'pass',
        flags: [],
        notes: 'run proportionate to the ask',
        recommendations: [],
      }))),
    });
    const result = await handler(BASE_PAYLOAD);
    expect(result?.verdict).toBe('pass');
    expect(result?.flags).toEqual([]);
    expect(result?.notes).toContain('proportionate');
    expect(result?.recommendations).toEqual([]);
  });

  test('parses flag verdict with multi-element arrays', async () => {
    const handler = createPostMortemHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply(JSON.stringify({
        verdict: 'flag',
        flags: ['thread_skew', 'low_finding_yield'],
        notes: 'one thread did 80% of work',
        recommendations: ['rebalance dispatch', 'reduce max_total_threads'],
      }))),
    });
    const result = await handler(BASE_PAYLOAD);
    expect(result?.verdict).toBe('flag');
    expect(result?.flags).toHaveLength(2);
    expect(result?.recommendations).toHaveLength(2);
  });

  test('rejects invalid verdict value', async () => {
    const handler = createPostMortemHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply(JSON.stringify({
        verdict: 'warn', flags: [], notes: '', recommendations: [],
      }))),
    });
    const result = await handler(BASE_PAYLOAD);
    expect(result).toBeNull();
  });

  test('handles missing optional fields (defaults empty arrays)', async () => {
    const handler = createPostMortemHandler({
      apiKey: 'test',
      fetchImpl: mockFetch(llmReply(JSON.stringify({
        verdict: 'pass',
        notes: 'ok',
      }))),
    });
    const result = await handler(BASE_PAYLOAD);
    expect(result?.verdict).toBe('pass');
    expect(result?.flags).toEqual([]);
    expect(result?.recommendations).toEqual([]);
  });

  test('user content includes interpretation when present', async () => {
    let seenBody: string | null = null;
    const captureFetch: typeof fetch = (async (_url: string, init?: RequestInit) => {
      seenBody = init?.body as string;
      return {
        ok: true, status: 200, statusText: 'OK',
        json: async () => llmReply(JSON.stringify({
          verdict: 'pass', flags: [], notes: '', recommendations: [],
        })),
      };
    }) as unknown as typeof fetch;

    const handler = createPostMortemHandler({ apiKey: 'test', fetchImpl: captureFetch });
    await handler({
      ...BASE_PAYLOAD,
      interpretation: { intent: 'X', shape: 'answer', depth: 'deep', scope: 'Y' },
    });

    const parsed = JSON.parse(seenBody!) as { messages: Array<{ content: string }> };
    const userMsg = parsed.messages[1].content;
    expect(userMsg).toContain('Interpretation');
    expect(userMsg).toContain('intent: X');
  });
});

describe('buildPostMortemPayload', () => {
  let sqlite: Database;
  let sessionId: string;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    applyResearchDDL(sqlite);
    const s = queries.createQuery(sqlite, 'Test', 'how does X work', undefined, null, null, { depth: 'deep' });
    sessionId = s.id;
  });

  test('aggregates thread state and source health', () => {
    threads.createThread(sqlite, {
      session_id: sessionId, query: 'q1', short_query: null, origin: 'seed',
      priority: 1, depth: 0, max_depth: 3, status: 'exhausted',
    });
    threads.createThread(sqlite, {
      session_id: sessionId, query: 'q2', short_query: null, origin: 'seed',
      priority: 1, depth: 0, max_depth: 3, status: 'pruned',
    });

    findings.createFinding(sqlite, {
      thread_id: 't1', session_id: sessionId,
      content: 'content',
      summary: 'a first finding',
    });

    const payload = buildPostMortemPayload(sqlite, sessionId, 'job-1', 60_000);
    expect(payload).not.toBeNull();
    expect(payload!.job_id).toBe('job-1');
    expect(payload!.metrics.duration_ms).toBe(60_000);
    expect(payload!.metrics.findings).toBe(1);
    expect(payload!.thread_state.by_status.exhausted).toBe(1);
    expect(payload!.thread_state.by_status.pruned).toBe(1);
    expect(payload!.thread_state.pruned_count).toBe(1);
    expect(payload!.hints).toEqual({ depth: 'deep' });
    expect(payload!.sample_findings).toContain('a first finding');
  });

  test('returns null when session does not exist', () => {
    const payload = buildPostMortemPayload(sqlite, 'no-such-session', null, 0);
    expect(payload).toBeNull();
  });
});

describe('runPostMortem (end to end)', () => {
  let sqlite: Database;
  let sessionId: string;

  beforeEach(() => {
    clearHooks();
    sqlite = new Database(':memory:');
    applyResearchDDL(sqlite);
    sessionId = queries.createQuery(sqlite, 'Test', 'test prompt').id;
  });

  test('persists record on flag verdict', async () => {
    registerHook('post_mortem', async () => ({
      verdict: 'flag',
      flags: ['low_finding_yield', 'high_error_rate'],
      notes: 'only one finding in 40 steps',
      recommendations: ['check source mix'],
    }), { label: 'test' });

    await runPostMortem(sqlite, sessionId, 'job-1', 120_000);

    const records = listPostMortems(sqlite, sessionId);
    expect(records.length).toBe(1);
    expect(records[0].verdict).toBe('flag');
    expect(records[0].flags).toEqual(['low_finding_yield', 'high_error_rate']);
    expect(records[0].recommendations).toEqual(['check source mix']);
    expect(records[0].job_id).toBe('job-1');
    expect(records[0].metrics_snapshot.metrics).toBeDefined();
  });

  test('no-op when handler returns null', async () => {
    registerHook('post_mortem', async () => null, { label: 'nullish' });
    await runPostMortem(sqlite, sessionId, 'job-1', 0);
    expect(listPostMortems(sqlite, sessionId).length).toBe(0);
  });

  test('swallows handler errors', async () => {
    registerHook('post_mortem', async () => { throw new Error('boom'); }, { label: 'broken' });
    // Must not throw
    await runPostMortem(sqlite, sessionId, 'job-1', 0);
    expect(listPostMortems(sqlite, sessionId).length).toBe(0);
  });

  test('skips silently when session does not exist', async () => {
    registerHook('post_mortem', async () => ({
      verdict: 'pass', flags: [], notes: '', recommendations: [],
    }), { label: 'would-fire' });
    await runPostMortem(sqlite, 'no-such', null, 0);
    // no throw, no record anywhere
  });
});
