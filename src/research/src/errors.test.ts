/**
 * Tests for classifyError + isTransientError.
 *
 * Classification drives telemetry (which kind of provider failure) and the
 * transient gate (which kinds back off vs. exhaust). 402 stays transient
 * because the user tops up the balance and wants threads to resume
 * automatically — classification just lets the UI surface the distinction.
 */
import { describe, test, expect } from 'bun:test';
import { classifyError, isTransientError, type ErrorKind } from './engine';

describe('classifyError', () => {
  test('402 with credit wording → credit_exhausted', () => {
    expect(classifyError('OpenRouter 402: insufficient credits')).toBe('credit_exhausted');
    expect(classifyError('OpenRouter 402: can only afford 3439 tokens')).toBe('credit_exhausted');
    expect(classifyError('OpenRouter 402: balance too low')).toBe('credit_exhausted');
  });

  test('402 without specific wording still → credit_exhausted', () => {
    // 402 from OpenRouter is effectively always "payment required"
    expect(classifyError('OpenRouter 402: Provider returned error')).toBe('credit_exhausted');
    expect(classifyError('OpenRouter 402: {"code":402}')).toBe('credit_exhausted');
  });

  test('429 and rate-limit text → rate_limit', () => {
    expect(classifyError('OpenRouter 429: rate limited')).toBe('rate_limit');
    expect(classifyError('OpenRouter 429: {"code":429}')).toBe('rate_limit');
    expect(classifyError('Rate limit exceeded: @ratelimit/too-many-requests')).toBe('rate_limit');
    expect(classifyError('Too Many Requests')).toBe('rate_limit');
  });

  test('529 / 503 / overloaded → overload', () => {
    expect(classifyError('OpenRouter 529: overloaded')).toBe('overload');
    expect(classifyError('503 Service Unavailable')).toBe('overload');
    expect(classifyError('upstream overloaded, try again')).toBe('overload');
  });

  test('404 / "no endpoints" / disabled model → model_disabled', () => {
    expect(classifyError('OpenRouter 404: model not found')).toBe('model_disabled');
    expect(classifyError('No endpoints found for this model')).toBe('model_disabled');
    expect(classifyError('Model deepseek/foo is deprecated')).toBe('model_disabled');
    expect(classifyError('Model is not a valid model id')).toBe('model_disabled');
  });

  test('network / timeout / 5xx wrapper → transient_other', () => {
    expect(classifyError('Network timeout after 120s')).toBe('transient_other');
    expect(classifyError('fetch failed')).toBe('transient_other');
    expect(classifyError('ECONNRESET')).toBe('transient_other');
    expect(classifyError('OpenRouter 502 (upstream error): boom')).toBe('transient_other');
    expect(classifyError('504 Gateway Timeout')).toBe('transient_other');
    expect(classifyError('AbortError: The operation was aborted')).toBe('transient_other');
  });

  test('401 / 403 / 400 → permanent', () => {
    expect(classifyError('OpenRouter 401: unauthorized')).toBe('permanent');
    expect(classifyError('OpenRouter 403: forbidden')).toBe('permanent');
    expect(classifyError('OpenRouter 400: invalid_request — bad prompt')).toBe('permanent');
  });

  test('uncategorized → unknown', () => {
    expect(classifyError('something weird happened')).toBe('unknown');
    expect(classifyError('')).toBe('unknown');
  });
});

describe('isTransientError', () => {
  test('402/429/529 kinds trigger backoff', () => {
    const transient: ErrorKind[] = ['credit_exhausted', 'rate_limit', 'overload'];
    for (const k of transient) expect(isTransientError(k)).toBe(true);
  });

  test('transient_other (timeouts/5xx wrappers) does NOT trigger backoff — exhausts like the old matcher', () => {
    // Classified for telemetry but preserves prior thread behavior: queued → exhausted on repeat.
    expect(isTransientError('transient_other')).toBe(false);
  });

  test('non-transient kinds do not trigger backoff', () => {
    const nonTransient: ErrorKind[] = ['model_disabled', 'permanent', 'unknown'];
    for (const k of nonTransient) expect(isTransientError(k)).toBe(false);
  });
});
