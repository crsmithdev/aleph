/**
 * Loops API — HTTP integration.
 *
 * Closes the Phase 1 telemetry + event-log-source-of-truth gates:
 *  - submits a noop loop through the real HTTP surface
 *  - polls /loops/:id until completion
 *  - downloads /loops/:id/events.ndjson and verifies the engine event sequence
 *  - opens /loops/:id/stream and verifies the snapshot frame
 *
 * Boots the API on an ephemeral port with a real on-disk SQLite file.
 * `:memory:` would skip startResearchLogger() — the subscriber under test —
 * so the on-disk path is required.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createApp } from '../app.js';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { FastifyInstance } from 'fastify';

let app: FastifyInstance;
let port: number;
let tmp: string;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'construct-loops-test-'));
  // research-logger writes to $HOME/.construct/research-logs — point HOME at tmp
  // so the test is hermetic.
  process.env.HOME = tmp;
  const dbUrl = join(tmp, 'db.sqlite');
  app = await createApp({ dbUrl, workerCount: 0, skipStatic: true });
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  port = addr.port;
});

afterAll(async () => {
  await app.close();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function poll<T>(fn: () => Promise<T | null>, predicate: (v: T) => boolean, timeoutMs = 10_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v !== null && predicate(v)) return v;
    await new Promise(r => setTimeout(r, 25));
  }
  throw new Error('poll timeout');
}

describe('Loops API — validation', () => {
  it('POST /api/loops/start unknown template_id → 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/loops/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template_id: 'does-not-exist' }),
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/loops/start missing template_id → 400', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/loops/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
  });

  it('GET /api/loops/:id unknown loop → 404', async () => {
    const res = await fetch(`http://127.0.0.1:${port}/api/loops/no-such-loop`);
    expect(res.status).toBe(404);
  });
});

describe('Loops API — noop end-to-end', () => {
  it('start → poll → events.ndjson reflects the engine timeline', async () => {
    const startRes = await fetch(`http://127.0.0.1:${port}/api/loops/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template_id: 'noop' }),
    });
    expect(startRes.status).toBe(201);
    const { id } = await startRes.json() as { id: string };
    expect(typeof id).toBe('string');

    // Poll until completed.
    const finalState = await poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/loops/${id}`);
        if (res.status !== 200) return null;
        return await res.json() as {
          loop: { id: string; status: string; template_id: string };
          cycles: Array<{ status: string; index: number }>;
          artifacts: Array<{ kind: string }>;
          milestones: unknown[];
        };
      },
      v => v.loop.status === 'completed',
      10_000,
    );

    expect(finalState.loop.template_id).toBe('noop');
    expect(finalState.cycles).toHaveLength(5);
    expect(finalState.cycles.every(c => c.status === 'finalized')).toBe(true);
    expect(finalState.cycles.map(c => c.index)).toEqual([0, 1, 2, 3, 4]);
    expect(finalState.artifacts.filter(a => a.kind === 'cycle_output')).toHaveLength(5);

    // Download the NDJSON event log.
    const ndjsonRes = await fetch(`http://127.0.0.1:${port}/api/loops/${id}/events.ndjson`);
    expect(ndjsonRes.status).toBe(200);
    expect(ndjsonRes.headers.get('content-type')).toMatch(/x-ndjson/);
    const text = await ndjsonRes.text();
    const events = text.split('\n').filter(Boolean).map(l => JSON.parse(l) as {
      type: string; payload: Record<string, unknown>; logged_at: string;
    });

    // Engine event count: 1 loop:running + 5 × (cycle:running + 3 cycle_step + 1 artifact + cycle:finalized) + 1 loop:completed = 32.
    expect(events.length).toBe(32);

    const byType = (t: string) => events.filter(e => e.type === t);
    expect(byType('loop')).toHaveLength(2);
    expect((byType('loop')[0].payload as { status: string }).status).toBe('running');
    expect((byType('loop')[1].payload as { status: string }).status).toBe('completed');
    expect((byType('loop')[1].payload as { cycles_run: number }).cycles_run).toBe(5);

    expect(byType('cycle')).toHaveLength(10); // 5 × (running, finalized)
    expect(byType('cycle_step')).toHaveLength(15); // 5 × 3 steps
    expect(byType('artifact')).toHaveLength(5);    // 5 × cycle_output, one per cycle
    expect(byType('milestone')).toHaveLength(0);   // no envelope set

    // Every cycle_step on a fresh run reports cached=false.
    expect(byType('cycle_step').every(e => e.payload.cached === false)).toBe(true);

    // logged_at is monotonic.
    const stamps = events.map(e => e.logged_at);
    expect([...stamps].sort()).toEqual(stamps);
  });
});

describe('Loops API — stats', () => {
  it('GET /api/loops/stats aggregates loops + artifacts into the legacy shape', async () => {
    // Start a quick noop loop so there's something in the stats window.
    const startRes = await fetch(`http://127.0.0.1:${port}/api/loops/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template_id: 'noop' }),
    });
    const { id } = await startRes.json() as { id: string };
    await poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/loops/${id}`);
        return res.status === 200 ? await res.json() as { loop: { status: string } } : null;
      },
      v => v.loop.status === 'completed',
      10_000,
    );

    const res = await fetch(`http://127.0.0.1:${port}/api/loops/stats?range=30d`);
    expect(res.status).toBe(200);
    const stats = await res.json() as {
      totalSessions: number; activeSessions: number; totalFindings: number;
      totalCost: number; byDay: Array<{ date: string; sessions: number; findings: number; cost: number }>;
      passRate: number; flagRate: number; haltRate: number; byVerdict: unknown[];
    };

    expect(stats.totalSessions).toBeGreaterThanOrEqual(1);
    // The noop template writes 5 cycle_output artifacts per loop.
    expect(stats.totalFindings).toBeGreaterThanOrEqual(5);
    expect(stats.byDay.length).toBeGreaterThanOrEqual(1);
    // Pass/flag/halt fields exist (legacy shape) but are zeroed for the new system.
    expect(stats.passRate).toBe(0);
    expect(stats.byVerdict).toEqual([]);
  });
});

describe('Loops API — SSE snapshot', () => {
  it('GET /api/loops/:id/stream sends an initial snapshot then keeps the connection open', async () => {
    // Use an already-completed loop so the snapshot includes a non-trivial state.
    const startRes = await fetch(`http://127.0.0.1:${port}/api/loops/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ template_id: 'noop' }),
    });
    const { id } = await startRes.json() as { id: string };

    await poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/loops/${id}`);
        return res.status === 200 ? await res.json() as { loop: { status: string } } : null;
      },
      v => v.loop.status === 'completed',
      10_000,
    );

    const ctrl = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/loops/${id}/stream`, { signal: ctrl.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/);

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    const frames: Array<{ type: string; payload: unknown; logged_at: string }> = [];
    let buf = '';
    const readWithTimeout = async (ms: number) => {
      const t = new Promise<{ done: true; value: undefined }>(r => setTimeout(() => r({ done: true, value: undefined }), ms));
      return Promise.race([reader.read(), t]);
    };
    // Pull frames for up to 1s; the snapshot replays the full NDJSON log on
    // connect (loop + cycles + cycle_steps + artifacts), so the frame budget
    // has to cover everything emitted during the noop loop's 5 cycles.
    const deadline = Date.now() + 1000;
    while (Date.now() < deadline && frames.length < 50) {
      const { done, value } = await readWithTimeout(200);
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) !== -1) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const line = frame.split('\n').find(l => l.startsWith('data: '));
        if (!line) continue;
        try { frames.push(JSON.parse(line.slice(6))); } catch { /* skip */ }
      }
    }
    ctrl.abort();
    try { await reader.cancel(); } catch { /* ignore */ }

    // Backfill replays the full NDJSON log: cycle events fire on start AND
    // finalize (2 per cycle), cycle_step fires 3× per cycle, and artifacts
    // get an event on creation (cycle_output × 5, plus any kinds the noop
    // template writes).
    const types = frames.map(f => f.type);
    expect(types).toContain('loop');
    expect(types.filter(t => t === 'cycle')).toHaveLength(10);
    expect(types.filter(t => t === 'cycle_step')).toHaveLength(15);
    expect(types.filter(t => t === 'artifact').length).toBeGreaterThanOrEqual(5);
    // Every frame carries the engine-emit timestamp, not page-load time.
    expect(frames.every(f => typeof f.logged_at === 'string' && f.logged_at.length > 0)).toBe(true);
  });
});
