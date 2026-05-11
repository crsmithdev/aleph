import { describe, test, expect, beforeEach } from 'bun:test';
import { registerHook, clearHooks, runHooks, firstResult, hasHooks } from './registry.js';
import type { HookHandler, HookPayload, HookResult } from './types.js';

// Uses iteration_check as the vehicle for exercising registry mechanics
// (timeouts, error capture, multiple handlers). The shape of the hook doesn't
// matter for these tests — what matters is that the registry dispatches and
// isolates handler failures correctly.
const basePayload: HookPayload<'iteration_check'> = {
  query_id: 'q1',
  prompt: 'how do LLMs work',
  hints: {},
  iterations_completed: 1,
  metrics: { findings: 0, threads_active: 1, threads_total: 1, cost_usd: 0, errors: 0, steps: 1 },
  recent_thread_queries: [],
  recent_finding_summaries: [],
};

describe('hook registry', () => {
  beforeEach(() => { clearHooks(); });

  test('runHooks returns [] when no handlers registered', async () => {
    const invocations = await runHooks('iteration_check', basePayload);
    expect(invocations).toEqual([]);
    expect(hasHooks('iteration_check')).toBe(false);
  });

  test('registered handler receives payload and returns result', async () => {
    const seen: HookPayload<'iteration_check'>[] = [];
    const handler: HookHandler<'iteration_check'> = async (payload) => {
      seen.push(payload);
      return { verdict: 'on_track', notes: 'ok' };
    };
    registerHook('iteration_check', handler, { label: 'test' });
    expect(hasHooks('iteration_check')).toBe(true);

    const invocations = await runHooks('iteration_check', basePayload);

    expect(seen[0]?.query_id).toBe('q1');
    expect(invocations.length).toBe(1);
    expect(invocations[0].status).toBe('ok');
    expect(invocations[0].label).toBe('test');
    expect((invocations[0].result as HookResult<'iteration_check'>)?.verdict).toBe('on_track');
  });

  test('handler returning null is reported as empty', async () => {
    registerHook('iteration_check', async () => null, { label: 'nullish' });
    const invocations = await runHooks('iteration_check', basePayload);
    expect(invocations.length).toBe(1);
    expect(invocations[0].status).toBe('empty');
    expect(invocations[0].result).toBeUndefined();
  });

  test('handler error is captured, not thrown', async () => {
    registerHook('iteration_check', async () => { throw new Error('boom'); }, { label: 'broken' });
    const invocations = await runHooks('iteration_check', basePayload);
    expect(invocations.length).toBe(1);
    expect(invocations[0].status).toBe('error');
    expect(invocations[0].error).toBe('boom');
  });

  test('handler timeout is enforced', async () => {
    registerHook('iteration_check', async () => {
      await new Promise(r => setTimeout(r, 500));
      return { verdict: 'on_track', notes: 'slow' };
    }, { label: 'slow', timeoutMs: 50 });

    const invocations = await runHooks('iteration_check', basePayload);
    expect(invocations[0].status).toBe('timeout');
    expect(invocations[0].error).toMatch(/timeout/);
  });

  test('multiple handlers all run; one failing does not cancel others', async () => {
    registerHook('iteration_check', async () => { throw new Error('first broke'); }, { label: 'a' });
    registerHook('iteration_check', async () => ({
      verdict: 'on_track', notes: 'recovered',
    }), { label: 'b' });

    const invocations = await runHooks('iteration_check', basePayload);
    expect(invocations.length).toBe(2);
    expect(invocations[0].status).toBe('error');
    expect(invocations[1].status).toBe('ok');
    expect((firstResult(invocations) as HookResult<'iteration_check'>)?.notes).toBe('recovered');
  });

  test('clearHooks removes registrations for one event only', async () => {
    registerHook('iteration_check', async () => ({ verdict: 'on_track', notes: '' }), { label: 'ic' });
    registerHook('post_mortem', async () => ({
      verdict: 'pass', flags: [], notes: '', recommendations: [],
    }), { label: 'pm' });

    clearHooks('iteration_check');
    expect(hasHooks('iteration_check')).toBe(false);
    expect(hasHooks('post_mortem')).toBe(true);
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
