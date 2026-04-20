import { describe, test, expect, beforeEach } from 'bun:test';
import { registerHook, clearHooks, runHooks, firstResult, hasHooks } from './registry.js';
import type { HookHandler, HookPayload, HookResult } from './types.js';

describe('hook registry', () => {
  beforeEach(() => { clearHooks(); });

  test('runHooks returns [] when no handlers registered', async () => {
    const invocations = await runHooks('pre_dispatch', {
      query_id: 'q1', prompt: 'test', hints: {},
    });
    expect(invocations).toEqual([]);
    expect(hasHooks('pre_dispatch')).toBe(false);
  });

  test('registered handler receives payload and returns result', async () => {
    let seenPayload: HookPayload<'pre_dispatch'> | null = null;
    const handler: HookHandler<'pre_dispatch'> = async (payload) => {
      seenPayload = payload;
      return {
        interpretation: {
          intent: 'research the topic',
          shape: 'answer',
          depth: 'normal',
          scope: 'broad',
        },
      };
    };
    registerHook('pre_dispatch', handler, { label: 'test' });
    expect(hasHooks('pre_dispatch')).toBe(true);

    const invocations = await runHooks('pre_dispatch', {
      query_id: 'q1', prompt: 'how do LLMs work', hints: { depth: 'deep' },
    });

    expect(seenPayload).toEqual({
      query_id: 'q1', prompt: 'how do LLMs work', hints: { depth: 'deep' },
    });
    expect(invocations.length).toBe(1);
    expect(invocations[0].status).toBe('ok');
    expect(invocations[0].label).toBe('test');
    expect(invocations[0].result?.interpretation?.intent).toBe('research the topic');
  });

  test('handler returning null is reported as empty', async () => {
    registerHook('pre_dispatch', async () => null, { label: 'nullish' });
    const invocations = await runHooks('pre_dispatch', {
      query_id: 'q1', prompt: 'x', hints: {},
    });
    expect(invocations.length).toBe(1);
    expect(invocations[0].status).toBe('empty');
    expect(invocations[0].result).toBeUndefined();
  });

  test('handler error is captured, not thrown', async () => {
    registerHook('pre_dispatch', async () => { throw new Error('boom'); }, { label: 'broken' });
    const invocations = await runHooks('pre_dispatch', {
      query_id: 'q1', prompt: 'x', hints: {},
    });
    expect(invocations.length).toBe(1);
    expect(invocations[0].status).toBe('error');
    expect(invocations[0].error).toBe('boom');
  });

  test('handler timeout is enforced', async () => {
    registerHook('pre_dispatch', async () => {
      await new Promise(r => setTimeout(r, 500));
      return { interpretation: { intent: 'slow', shape: 'answer', depth: 'normal', scope: 'x' } };
    }, { label: 'slow', timeoutMs: 50 });

    const invocations = await runHooks('pre_dispatch', {
      query_id: 'q1', prompt: 'x', hints: {},
    });
    expect(invocations[0].status).toBe('timeout');
    expect(invocations[0].error).toMatch(/timeout/);
  });

  test('multiple handlers all run; one failing does not cancel others', async () => {
    registerHook('pre_dispatch', async () => { throw new Error('first broke'); }, { label: 'a' });
    registerHook('pre_dispatch', async () => ({
      interpretation: { intent: 'recovered', shape: 'answer', depth: 'normal', scope: 'x' },
    }), { label: 'b' });

    const invocations = await runHooks('pre_dispatch', {
      query_id: 'q1', prompt: 'x', hints: {},
    });
    expect(invocations.length).toBe(2);
    expect(invocations[0].status).toBe('error');
    expect(invocations[1].status).toBe('ok');
    expect(firstResult(invocations)?.interpretation?.intent).toBe('recovered');
  });

  test('clearHooks removes registrations for one event only', async () => {
    registerHook('pre_dispatch', async () => ({}), { label: 'pd' });
    registerHook('post_mortem', async () => ({
      verdict: 'pass', flags: [], notes: '', recommendations: [],
    }), { label: 'pm' });

    clearHooks('pre_dispatch');
    expect(hasHooks('pre_dispatch')).toBe(false);
    expect(hasHooks('post_mortem')).toBe(true);
  });

  test('iteration_check payload is typed correctly', async () => {
    let seen: HookPayload<'iteration_check'> | null = null;
    registerHook('iteration_check', async (p) => {
      seen = p;
      return { verdict: 'on_track', notes: 'looks fine' };
    }, { label: 'ic' });

    const invocations = await runHooks('iteration_check', {
      query_id: 'q1',
      prompt: 'x',
      hints: {},
      iterations_completed: 3,
      metrics: { findings: 5, threads_active: 2, threads_total: 4, cost_usd: 0.012, errors: 0, steps: 10 },
      recent_thread_queries: [],
      recent_finding_summaries: [],
    });

    expect(seen?.iterations_completed).toBe(3);
    expect(seen?.metrics.findings).toBe(5);
    expect(invocations[0].status).toBe('ok');
    const r = invocations[0].result as HookResult<'iteration_check'>;
    expect(r.verdict).toBe('on_track');
  });

  test('post_mortem result carries flags and recommendations', async () => {
    registerHook('post_mortem', async () => ({
      verdict: 'flag',
      flags: ['thread_skew', 'high_error_rate'],
      notes: 'one thread produced 80% of findings',
      recommendations: ['rebalance dispatch', 'retry failed extractions'],
    }), { label: 'pm' });

    const invocations = await runHooks('post_mortem', {
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
    });

    const r = invocations[0].result as HookResult<'post_mortem'>;
    expect(r.verdict).toBe('flag');
    expect(r.flags).toContain('thread_skew');
    expect(r.recommendations).toHaveLength(2);
  });
});
