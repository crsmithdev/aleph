/**
 * Tests for the Heartbeat class (scheduler.ts).
 * Covers: immediate fire, interval, isAlive, stop, getLastBeat.
 * No LLM calls or DB needed.
 */
import { describe, test, expect } from 'bun:test';
import { Heartbeat } from './scheduler';

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

// ========== Immediate fire ==========

describe('Heartbeat — immediate callback on start()', () => {
  test('callback fires synchronously before first await', () => {
    let count = 0;
    const hb = new Heartbeat(() => { count++; });
    hb.start(10_000);
    expect(count).toBe(1);
    hb.stop();
  });

  test('isAlive() returns true immediately after start()', () => {
    const hb = new Heartbeat(() => {});
    hb.start(10_000);
    expect(hb.isAlive()).toBe(true);
    hb.stop();
  });

  test('isAlive() returns false before start() is called (lastBeat=0)', () => {
    const hb = new Heartbeat(() => {});
    // lastBeat=0 → Date.now()-0 >> maxStaleness
    expect(hb.isAlive(120_000)).toBe(false);
  });

  test('getLastBeat() is non-zero after start()', () => {
    const hb = new Heartbeat(() => {});
    hb.start(10_000);
    expect(hb.getLastBeat()).toBeGreaterThan(0);
    hb.stop();
  });
});

// ========== Interval firing ==========

describe('Heartbeat — interval', () => {
  test('callback fires again after intervalMs', async () => {
    let count = 0;
    const hb = new Heartbeat(() => { count++; });
    hb.start(50);
    await sleep(130);
    hb.stop();
    // 1 immediate + ~2 interval fires in 130ms with 50ms interval
    expect(count).toBeGreaterThanOrEqual(2);
  });

  test('getLastBeat() advances over time', async () => {
    const hb = new Heartbeat(() => {});
    hb.start(30);
    const t1 = hb.getLastBeat();
    await sleep(80);
    const t2 = hb.getLastBeat();
    hb.stop();
    expect(t2).toBeGreaterThan(t1);
  });
});

// ========== stop() ==========

describe('Heartbeat — stop()', () => {
  test('stop() prevents further interval fires', async () => {
    let count = 0;
    const hb = new Heartbeat(() => { count++; });
    hb.start(30);
    await sleep(50);
    hb.stop();
    const countAtStop = count;
    await sleep(100);
    expect(count).toBe(countAtStop);
  });

  test('stop() is idempotent — calling twice does not throw', () => {
    const hb = new Heartbeat(() => {});
    hb.start(10_000);
    hb.stop();
    expect(() => hb.stop()).not.toThrow();
  });
});

// ========== isAlive staleness ==========

describe('Heartbeat — isAlive()', () => {
  test('isAlive(maxStaleness) returns false when lastBeat is older than threshold', async () => {
    const hb = new Heartbeat(() => {});
    hb.start(10_000);
    await sleep(60);
    hb.stop();
    // With maxStalenessMs=20ms, a 60ms-old beat is stale
    expect(hb.isAlive(20)).toBe(false);
  });

  test('isAlive() returns true with generous staleness window', async () => {
    const hb = new Heartbeat(() => {});
    hb.start(10_000);
    await sleep(10);
    expect(hb.isAlive(120_000)).toBe(true);
    hb.stop();
  });

  test('default maxStalenessMs is 120 000ms', () => {
    const hb = new Heartbeat(() => {});
    hb.start(10_000);
    // Beat just happened — should be alive under default 120s window
    expect(hb.isAlive()).toBe(true);
    hb.stop();
  });
});
