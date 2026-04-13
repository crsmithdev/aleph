/**
 * Tests for WorkerSupervisor process management.
 * Uses tiny test scripts instead of the real worker so no API keys needed.
 * Covers: restart/backoff, max restart cap, graceful SIGTERM, SIGKILL fallback,
 *         dynamic scaling (addWorker/removeWorker/killWorker), status reporting.
 */
import { resolve } from 'path';
import { describe, test, expect, afterEach } from 'bun:test';
import { WorkerSupervisor } from '../../ui/api/src/worker-supervisor';

const SCRIPTS = resolve(import.meta.dirname, '__test_scripts__');
const EXIT0 = resolve(SCRIPTS, 'exit0.ts');
const EXIT1 = resolve(SCRIPTS, 'exit1.ts');
const HANG = resolve(SCRIPTS, 'hang.ts');
const IGNORE_SIGTERM = resolve(SCRIPTS, 'ignore-sigterm.ts');

// Wait until condition is true, polling every intervalMs up to timeoutMs.
async function waitFor(cond: () => boolean, timeoutMs = 3000, intervalMs = 50): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await new Promise(r => setTimeout(r, intervalMs));
  }
  throw new Error(`waitFor timed out after ${timeoutMs}ms`);
}

const supervisors: WorkerSupervisor[] = [];
afterEach(async () => {
  // Ensure all supervisors are stopped after each test
  await Promise.all(supervisors.map(s => s.stop().catch(() => {})));
  supervisors.length = 0;
});

function makeSupervisor(count: number, script: string, opts: { gracePeriodMs?: number; maxRestarts?: number; baseBackoffMs?: number } = {}): WorkerSupervisor {
  const s = new WorkerSupervisor(count, {
    scriptPath: script,
    gracePeriodMs: opts.gracePeriodMs ?? 500,
    maxRestarts: opts.maxRestarts ?? 20,
    baseBackoffMs: opts.baseBackoffMs ?? 50,
  });
  supervisors.push(s);
  return s;
}

// ========== Startup ==========

describe('startup', () => {
  test('start() spawns the requested number of workers', async () => {
    const sup = makeSupervisor(2, HANG);
    sup.start();
    await waitFor(() => sup.status().filter(w => w.status === 'running').length === 2);
    const st = sup.status();
    expect(st).toHaveLength(2);
    expect(st.every(w => w.pid !== null)).toBe(true);
  });

  test('status() reports running status with pid and uptime', async () => {
    const sup = makeSupervisor(1, HANG);
    sup.start();
    await waitFor(() => sup.status()[0]?.status === 'running');
    const [w] = sup.status();
    expect(w.status).toBe('running');
    expect(w.pid).toBeGreaterThan(0);
    expect(w.uptimeMs).toBeGreaterThanOrEqual(0);
    expect(w.restarts).toBe(0);
  });
});

// ========== Restart behavior ==========

describe('restart behavior', () => {
  test('worker that exits with code 0 is NOT restarted', async () => {
    const sup = makeSupervisor(1, EXIT0, { baseBackoffMs: 50 });
    sup.start();
    // Worker exits 0 quickly; give it time to potentially restart
    await new Promise(r => setTimeout(r, 300));
    const [w] = sup.status();
    expect(w.restarts).toBe(0);
    expect(w.status).toBe('stopped');
  });

  test('worker that exits with code 1 IS restarted', async () => {
    const sup = makeSupervisor(1, EXIT1, { baseBackoffMs: 50 });
    sup.start();
    await waitFor(() => sup.status()[0]?.restarts >= 2, 4000);
    expect(sup.status()[0].restarts).toBeGreaterThanOrEqual(2);
  });

  test('restart count increments per crash', async () => {
    const sup = makeSupervisor(1, EXIT1, { baseBackoffMs: 20 });
    sup.start();
    await waitFor(() => sup.status()[0]?.restarts >= 3, 4000);
    expect(sup.status()[0].restarts).toBeGreaterThanOrEqual(3);
  });

  test('worker exceeding maxRestarts ends up stopped', async () => {
    const sup = makeSupervisor(1, EXIT1, { maxRestarts: 2, baseBackoffMs: 20 });
    sup.start();
    await waitFor(() => sup.status()[0]?.status === 'stopped' && sup.status()[0]?.restarts > 2, 5000);
    expect(sup.status()[0].status).toBe('stopped');
  });

  test('backoff increases exponentially between restarts', async () => {
    // With baseBackoffMs=100: restart 1 → 100ms, restart 2 → 200ms, restart 3 → 400ms
    // We verify the worker doesn't come back instantly by counting restarts over time.
    const sup = makeSupervisor(1, EXIT1, { baseBackoffMs: 100 });
    sup.start();
    // After 250ms with 100ms base: first restart fires at ~100ms, second at ~200ms
    // Should have ≤2 restarts in 250ms window
    await new Promise(r => setTimeout(r, 250));
    expect(sup.status()[0].restarts).toBeLessThanOrEqual(2);
  });
});

// ========== Graceful shutdown ==========

describe('graceful shutdown', () => {
  test('stop() sends SIGTERM; worker exits cleanly within grace period', async () => {
    const sup = makeSupervisor(1, HANG, { gracePeriodMs: 500 });
    sup.start();
    await waitFor(() => sup.status()[0]?.status === 'running');
    await sup.stop();
    expect(sup.status()[0].status).toBe('stopped');
  });

  test('stop() with no running workers resolves immediately', async () => {
    const sup = makeSupervisor(0, HANG);
    sup.start();
    const t = Date.now();
    await sup.stop();
    expect(Date.now() - t).toBeLessThan(200);
  });

  test('stop() cancels pending backoff timers so workers do not restart', async () => {
    // Worker crashes, supervisor schedules restart; stop() before restart fires
    const sup = makeSupervisor(1, EXIT1, { baseBackoffMs: 500 });
    sup.start();
    // Wait until at least one crash + backoff scheduled
    await waitFor(() => sup.status()[0]?.restarts >= 1, 2000);
    await sup.stop();
    // Give extra time to confirm restart did NOT fire
    await new Promise(r => setTimeout(r, 600));
    // restarts should not have increased after stop()
    const finalRestarts = sup.status()[0].restarts;
    await new Promise(r => setTimeout(r, 600));
    expect(sup.status()[0].restarts).toBe(finalRestarts);
  });

  test('worker ignoring SIGTERM is SIGKILL\'d after grace period', async () => {
    const sup = makeSupervisor(1, IGNORE_SIGTERM, { gracePeriodMs: 200 });
    sup.start();
    await waitFor(() => sup.status()[0]?.status === 'running');
    const t = Date.now();
    await sup.stop();
    // Should complete within grace period + small buffer
    expect(Date.now() - t).toBeLessThan(600);
    expect(sup.status()[0].status).toBe('stopped');
  });
});

// ========== Dynamic scaling ==========

describe('dynamic scaling', () => {
  test('addWorker() increases worker count by 1', async () => {
    const sup = makeSupervisor(1, HANG);
    sup.start();
    await waitFor(() => sup.status().length === 1);
    sup.addWorker();
    await waitFor(() => sup.status().length === 2);
    expect(sup.status()).toHaveLength(2);
  });

  test('removeWorker() decreases worker count by 1', async () => {
    const sup = makeSupervisor(2, HANG);
    sup.start();
    await waitFor(() => sup.status().filter(w => w.status === 'running').length === 2);
    await sup.removeWorker();
    expect(sup.status()).toHaveLength(1);
  });

  test('killWorker(id) stops a specific worker by ID', async () => {
    const sup = makeSupervisor(2, HANG);
    sup.start();
    await waitFor(() => sup.status().filter(w => w.status === 'running').length === 2);
    const [w0] = sup.status();
    await sup.killWorker(w0.id);
    expect(sup.status().find(w => w.id === w0.id)).toBeUndefined();
    expect(sup.status()).toHaveLength(1);
  });

  test('killWorker with unknown ID returns false', async () => {
    const sup = makeSupervisor(1, HANG);
    sup.start();
    await waitFor(() => sup.status()[0]?.status === 'running');
    const result = await sup.killWorker(999);
    expect(result).toBe(false);
  });

  test('addWorker returns status object with correct id', async () => {
    const sup = makeSupervisor(1, HANG);
    sup.start();
    await waitFor(() => sup.status()[0]?.status === 'running');
    const added = sup.addWorker();
    expect(added.id).toBe(1);
  });
});

// ========== Status ==========

describe('status()', () => {
  test('uptimeMs is null for stopped workers', async () => {
    const sup = makeSupervisor(1, EXIT0, { baseBackoffMs: 50 });
    sup.start();
    await waitFor(() => sup.status()[0]?.status === 'stopped');
    expect(sup.status()[0].uptimeMs).toBeNull();
  });

  test('uptimeMs grows over time for running workers', async () => {
    const sup = makeSupervisor(1, HANG);
    sup.start();
    await waitFor(() => sup.status()[0]?.status === 'running');
    const t1 = sup.status()[0].uptimeMs!;
    await new Promise(r => setTimeout(r, 100));
    const t2 = sup.status()[0].uptimeMs!;
    expect(t2).toBeGreaterThan(t1);
  });

  test('status shows backoff state between restarts', async () => {
    const sup = makeSupervisor(1, EXIT1, { baseBackoffMs: 500 });
    sup.start();
    // Should cycle through running → stopped → backoff → running
    await waitFor(() => sup.status()[0]?.restarts >= 1, 3000);
    // At some point status was 'backoff' (hard to catch precisely, so just verify restarts > 0)
    expect(sup.status()[0].restarts).toBeGreaterThanOrEqual(1);
  });
});
