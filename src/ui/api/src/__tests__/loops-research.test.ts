/**
 * Research-template HTTP integration — Phase 2.
 *
 * Drives the full API + supervisor + child-process + ledger path against a
 * fake OpenRouter / Tavily server. Verifies:
 *  - POST /api/loops/start with template_id='research' returns 201 + id
 *  - the child loop runs cycles_target cycles to completion
 *  - cycle_step events on the NDJSON log include processor / derivation /
 *    renderer for each cycle
 *  - the fake LLM server was actually hit (search + complete counts > 0),
 *    confirming env-based provider redirection works end-to-end
 *
 * The fake-llm-server lives in src/ui/e2e/. We import it from there so the
 * two integration paths (API-direct and Playwright) share canned responses.
 *
 * Env vars must be set BEFORE app boot because Bun.spawn snapshots the
 * parent env at spawn time — the child run.ts can't read changes made
 * later in this process.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import type { FastifyInstance } from 'fastify';
import { startFakeProviderServer, type FakeServerHandle } from '../../../e2e/fake-llm-server.js';

let app: FastifyInstance;
let port: number;
let tmp: string;
let fake: FakeServerHandle;

beforeAll(async () => {
  tmp = mkdtempSync(join(tmpdir(), 'construct-loops-research-'));
  process.env.HOME = tmp;

  // Start the fake provider before app + worker spawns. Bun.spawn captures
  // env at spawn time, so OPENROUTER_BASE_URL must already be set when the
  // first child runs.
  fake = startFakeProviderServer();
  process.env.OPENROUTER_BASE_URL = fake.baseUrl;
  process.env.OPENROUTER_API_KEY = 'fake-key';
  process.env.TAVILY_BASE_URL = fake.baseUrl;
  process.env.TAVILY_API_KEY = 'fake-key';

  const dbUrl = join(tmp, 'db.sqlite');
  const { createApp } = await import('../app.js');
  app = await createApp({ dbUrl, workerCount: 0, skipStatic: true });
  await app.ready();
  await app.listen({ port: 0, host: '127.0.0.1' });
  const addr = app.server.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  port = addr.port;
});

afterAll(async () => {
  await app.close();
  fake.stop();
  try { rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
});

async function poll<T>(fn: () => Promise<T | null>, predicate: (v: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v !== null && predicate(v)) return v;
    await new Promise(r => setTimeout(r, 50));
  }
  throw new Error('poll timeout');
}

describe('Loops API — monitor end-to-end', () => {
  it('start monitor loop with poll_every=2 → run-cycles call LLM, wait-cycles don\'t', async () => {
    const baseSearchCount = fake.searchCount();

    const startRes = await fetch(`http://127.0.0.1:${port}/api/loops/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        template_id: 'monitor',
        prompt: 'how does a sourdough starter develop?',
        cycles_target: 4,
        poll_every: 2,
      }),
    });
    expect(startRes.status).toBe(201);
    const { id } = await startRes.json() as { id: string };

    const finalState = await poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/loops/${id}`);
        if (res.status !== 200) return null;
        return await res.json() as {
          loop: { status: string; template_id: string };
          cycles: Array<{ status: string }>;
          artifacts: Array<{ kind: string; payload: Record<string, unknown> }>;
        };
      },
      v => v.loop.status === 'completed' || v.loop.status === 'failed',
      30_000,
    );

    expect(finalState.loop.status).toBe('completed');
    expect(finalState.loop.template_id).toBe('monitor');
    expect(finalState.cycles).toHaveLength(4);

    const cycleOutputs = finalState.artifacts.filter(a => a.kind === 'cycle_output');
    expect(cycleOutputs).toHaveLength(4);
    const procKinds = cycleOutputs.map(o => (o.payload.processor as { kind: string }).kind);
    expect(procKinds).toEqual(['monitor_run', 'monitor_wait', 'monitor_run', 'monitor_wait']);

    // Only run-cycles hit the LLM provider.
    expect(fake.searchCount() - baseSearchCount).toBe(2);
  }, 60_000);
});

describe('Loops API — research end-to-end', () => {
  it('start research loop → child hits fake LLM → completes through ledger', async () => {
    const baseSearchCount = fake.searchCount();
    const baseCompleteCount = fake.completeCount();

    const startRes = await fetch(`http://127.0.0.1:${port}/api/loops/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        template_id: 'research',
        prompt: 'how does a sourdough starter develop?',
        cycles_target: 2,
      }),
    });
    expect(startRes.status).toBe(201);
    const { id } = await startRes.json() as { id: string };

    const finalState = await poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/loops/${id}`);
        if (res.status !== 200) return null;
        return await res.json() as {
          loop: { id: string; status: string; template_id: string; prompt: string };
          cycles: Array<{ status: string; index: number }>;
          artifacts: Array<{ kind: string }>;
        };
      },
      v => v.loop.status === 'completed' || v.loop.status === 'failed',
      30_000,
    );

    expect(finalState.loop.status).toBe('completed');
    expect(finalState.loop.template_id).toBe('research');
    expect(finalState.loop.prompt).toBe('how does a sourdough starter develop?');
    expect(finalState.cycles).toHaveLength(2);
    expect(finalState.cycles.every(c => c.status === 'finalized')).toBe(true);
    expect(finalState.artifacts.filter(a => a.kind === 'cycle_output')).toHaveLength(2);

    // Real HTTP calls actually hit the fake — confirms env-based redirection
    // crossed the parent → child process boundary.
    expect(fake.searchCount()).toBeGreaterThan(baseSearchCount);
    expect(fake.completeCount()).toBeGreaterThan(baseCompleteCount);

    // NDJSON event log mirrors the cycle structure.
    const ndjsonRes = await fetch(`http://127.0.0.1:${port}/api/loops/${id}/events.ndjson`);
    expect(ndjsonRes.status).toBe(200);
    const text = await ndjsonRes.text();
    const events = text.split('\n').filter(Boolean).map(l => JSON.parse(l) as {
      type: string; payload: Record<string, unknown>;
    });

    const cycleSteps = events.filter(e => e.type === 'cycle_step');
    // 2 cycles × 3 steps (processor + derivation + renderer) = 6
    expect(cycleSteps).toHaveLength(6);
    const stepKinds = cycleSteps.map(e => e.payload.step as string);
    expect(stepKinds.filter(s => s === 'processor')).toHaveLength(2);
    expect(stepKinds.filter(s => s === 'derivation')).toHaveLength(2);
    expect(stepKinds.filter(s => s === 'renderer')).toHaveLength(2);

    // Fresh run → no cached steps.
    expect(cycleSteps.every(e => e.payload.cached === false)).toBe(true);

    // Loop terminal event reports completion.
    const loopEvents = events.filter(e => e.type === 'loop');
    const terminal = loopEvents[loopEvents.length - 1];
    expect((terminal.payload as { status: string }).status).toBe('completed');
  }, 60_000);
});

describe('Loops API — Phase 3 output-shape enforcement', () => {
  it('table-shape prompt (HSV vs HPV) → schedule artifact + table render + gate satisfied', async () => {
    const startRes = await fetch(`http://127.0.0.1:${port}/api/loops/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        template_id: 'research',
        // Prompt mentions HSV/HPV — the fake server's Phase 3 detection
        // branch returns the four-column table classification; the synthesis
        // branch produces a Markdown table that the gate accepts.
        prompt: 'Compare HSV and HPV: transmission, symptoms, treatment, vaccine.',
        cycles_target: 2,
      }),
    });
    expect(startRes.status).toBe(201);
    const { id } = await startRes.json() as { id: string };

    const finalState = await poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/loops/${id}`);
        if (res.status !== 200) return null;
        return await res.json() as {
          loop: { status: string };
          artifacts: Array<{ kind: string; payload: Record<string, unknown> }>;
        };
      },
      v => v.loop.status === 'completed' || v.loop.status === 'failed',
      30_000,
    );

    expect(finalState.loop.status).toBe('completed');

    // Schedule artifact carries the detected table shape with the right columns.
    const schedule = finalState.artifacts.find(a => a.kind === 'schedule');
    expect(schedule).toBeDefined();
    expect(schedule!.payload).toEqual({
      output_shape: {
        kind: 'table',
        columns: ['transmission', 'symptoms', 'treatment', 'vaccine'],
      },
    });

    // Every cycle_output's render payload reflects the table gate. The final
    // cycle's render asserts shape_satisfied=true with no missing columns.
    const cycleOutputs = finalState.artifacts.filter(a => a.kind === 'cycle_output');
    expect(cycleOutputs).toHaveLength(2);
    const lastRender = cycleOutputs[cycleOutputs.length - 1].payload.render as {
      shape_kind: string; shape_satisfied: boolean; shape_missing: unknown;
    };
    expect(lastRender.shape_kind).toBe('table');
    expect(lastRender.shape_satisfied).toBe(true);
    expect(lastRender.shape_missing).toBeNull();
  }, 60_000);

  it('list-shape prompt (Berkeley volunteering) → schedule artifact + list render + gate satisfied', async () => {
    const startRes = await fetch(`http://127.0.0.1:${port}/api/loops/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        template_id: 'research',
        // Prompt mentions Berkeley + volunteer → fake's detection returns
        // list classification; synthesis returns a 7-item numbered list
        // (above the 5-item minimum).
        prompt: 'What are the best places in Berkeley to volunteer?',
        cycles_target: 2,
      }),
    });
    expect(startRes.status).toBe(201);
    const { id } = await startRes.json() as { id: string };

    const finalState = await poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/loops/${id}`);
        if (res.status !== 200) return null;
        return await res.json() as {
          loop: { status: string };
          artifacts: Array<{ kind: string; payload: Record<string, unknown> }>;
        };
      },
      v => v.loop.status === 'completed' || v.loop.status === 'failed',
      30_000,
    );

    expect(finalState.loop.status).toBe('completed');

    const schedule = finalState.artifacts.find(a => a.kind === 'schedule');
    expect(schedule).toBeDefined();
    expect(schedule!.payload).toEqual({
      output_shape: { kind: 'list', min_items: 5 },
    });

    const cycleOutputs = finalState.artifacts.filter(a => a.kind === 'cycle_output');
    expect(cycleOutputs).toHaveLength(2);
    const lastRender = cycleOutputs[cycleOutputs.length - 1].payload.render as {
      shape_kind: string; shape_satisfied: boolean; shape_missing: unknown;
    };
    expect(lastRender.shape_kind).toBe('list');
    expect(lastRender.shape_satisfied).toBe(true);
    expect(lastRender.shape_missing).toBeNull();
  }, 60_000);

  it('mixed-shape prompt (smashed-burgers) → schedule artifact + mixed render + gate satisfied', async () => {
    const startRes = await fetch(`http://127.0.0.1:${port}/api/loops/start`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        template_id: 'research',
        // "smashed-burger" + "best places to get" → fake detection returns
        // mixed (prose + list); synthesis returns history paragraph + 5-item list.
        prompt: 'Tell me about the smashed-burger style, plus the 5 best places to get one.',
        cycles_target: 2,
      }),
    });
    expect(startRes.status).toBe(201);
    const { id } = await startRes.json() as { id: string };

    const finalState = await poll(
      async () => {
        const res = await fetch(`http://127.0.0.1:${port}/api/loops/${id}`);
        if (res.status !== 200) return null;
        return await res.json() as {
          loop: { status: string };
          artifacts: Array<{ kind: string; payload: Record<string, unknown> }>;
        };
      },
      v => v.loop.status === 'completed' || v.loop.status === 'failed',
      30_000,
    );

    expect(finalState.loop.status).toBe('completed');

    const schedule = finalState.artifacts.find(a => a.kind === 'schedule');
    expect(schedule).toBeDefined();
    expect(schedule!.payload).toEqual({
      output_shape: {
        kind: 'mixed',
        components: [{ kind: 'prose' }, { kind: 'list', min_items: 5 }],
      },
    });

    const cycleOutputs = finalState.artifacts.filter(a => a.kind === 'cycle_output');
    expect(cycleOutputs).toHaveLength(2);
    const lastRender = cycleOutputs[cycleOutputs.length - 1].payload.render as {
      shape_kind: string; shape_satisfied: boolean; shape_missing: unknown;
    };
    expect(lastRender.shape_kind).toBe('mixed');
    expect(lastRender.shape_satisfied).toBe(true);
    expect(lastRender.shape_missing).toBeNull();
  }, 60_000);
});
