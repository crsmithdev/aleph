import { describe, expect, test } from 'bun:test';
import { applyModeEnvelope, isMode, MODES, MODE_PROFILES } from './modes.js';

describe('isMode', () => {
  test('accepts every member of MODES', () => {
    for (const m of MODES) expect(isMode(m)).toBe(true);
  });
  test('rejects unknown strings', () => {
    expect(isMode('foo')).toBe(false);
    expect(isMode('')).toBe(false);
    expect(isMode('Default')).toBe(false);
  });
});

describe('applyModeEnvelope', () => {
  test('mode undefined → request envelope passes through unchanged', () => {
    expect(applyModeEnvelope(undefined, undefined)).toEqual({});
    expect(applyModeEnvelope(undefined, { cycles: { count: 3 } })).toEqual({ cycles: { count: 3 } });
  });

  test('mode supplied → preset fills missing fields', () => {
    const result = applyModeEnvelope('quick', undefined);
    expect(result).toEqual(MODE_PROFILES.quick.envelope);
  });

  test('mode supplied → request fields win over preset', () => {
    const result = applyModeEnvelope('deep', { cycles: { count: 2 } });
    // cycles came from the request; cost still from preset
    expect(result.cycles).toEqual({ count: 2 });
    expect(result.cost).toEqual(MODE_PROFILES.deep.envelope.cost);
  });

  test('invalid mode → falls back to default preset', () => {
    const result = applyModeEnvelope('garbage' as never, undefined);
    expect(result).toEqual(MODE_PROFILES.default.envelope);
  });

  test('every preset sets both cycles and cost so loops have hard caps', () => {
    for (const m of MODES) {
      const e = MODE_PROFILES[m].envelope;
      expect(e.cycles?.count).toBeGreaterThan(0);
      expect(e.cost?.usd).toBeGreaterThan(0);
    }
  });
});
