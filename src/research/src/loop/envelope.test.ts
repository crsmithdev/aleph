import { describe, test, expect } from 'bun:test';
import { EMPTY_USAGE, consume, crossedThresholds, envelopePercent, exhaustedLimit } from './envelope';

describe('exhaustedLimit', () => {
  test('returns null when nothing is consumed against an unset envelope', () => {
    expect(exhaustedLimit({}, EMPTY_USAGE)).toBeNull();
  });

  test('returns the first limit consumed in order time → cost → cycles → sources', () => {
    expect(exhaustedLimit({ time: { minutes: 1 }, cost: { usd: 1 } }, { ...EMPTY_USAGE, time_minutes: 1, cost_usd: 1 }))
      .toBe('time');
    expect(exhaustedLimit({ cost: { usd: 1 }, cycles: { count: 5 } }, { ...EMPTY_USAGE, cost_usd: 1, cycles_count: 5 }))
      .toBe('cost');
  });

  test('returns null when partway through any limit', () => {
    expect(exhaustedLimit({ cycles: { count: 10 } }, { ...EMPTY_USAGE, cycles_count: 9 })).toBeNull();
  });

  test('returns the limit even at exact equality', () => {
    expect(exhaustedLimit({ cycles: { count: 10 } }, { ...EMPTY_USAGE, cycles_count: 10 })).toBe('cycles');
  });
});

describe('envelopePercent', () => {
  test('returns 0 when no limits are set', () => {
    expect(envelopePercent({}, EMPTY_USAGE)).toBe(0);
  });

  test('reports the most-loaded ratio', () => {
    const env = { cycles: { count: 10 }, cost: { usd: 100 } };
    const usage = { ...EMPTY_USAGE, cycles_count: 5, cost_usd: 80 };
    // cycles = 50%, cost = 80% → reports 80
    expect(envelopePercent(env, usage)).toBe(80);
  });
});

describe('consume', () => {
  test('adds deltas without mutating the input', () => {
    const orig = { ...EMPTY_USAGE };
    const next = consume(orig, { cycles_count: 1, cost_usd: 0.05 });
    expect(orig).toEqual(EMPTY_USAGE);
    expect(next).toEqual({ time_minutes: 0, cost_usd: 0.05, cycles_count: 1, sources_count: 0 });
  });

  test('treats missing deltas as zero', () => {
    expect(consume(EMPTY_USAGE, {})).toEqual(EMPTY_USAGE);
  });
});

describe('crossedThresholds', () => {
  test('fires only the thresholds newly crossed by this transition', () => {
    const env = { cycles: { count: 100 } };
    expect(crossedThresholds(env, { ...EMPTY_USAGE, cycles_count: 20 }, { ...EMPTY_USAGE, cycles_count: 30 })).toEqual([25]);
    expect(crossedThresholds(env, { ...EMPTY_USAGE, cycles_count: 30 }, { ...EMPTY_USAGE, cycles_count: 55 })).toEqual([50]);
    expect(crossedThresholds(env, { ...EMPTY_USAGE, cycles_count: 55 }, { ...EMPTY_USAGE, cycles_count: 80 })).toEqual([75]);
  });

  test('reports multiple thresholds when crossed in one tick', () => {
    expect(crossedThresholds({ cycles: { count: 100 } }, EMPTY_USAGE, { ...EMPTY_USAGE, cycles_count: 80 }))
      .toEqual([25, 50, 75]);
  });

  test('does not re-fire when re-crossing a threshold already past', () => {
    expect(crossedThresholds({ cycles: { count: 100 } }, { ...EMPTY_USAGE, cycles_count: 60 }, { ...EMPTY_USAGE, cycles_count: 70 }))
      .toEqual([]);
  });
});
