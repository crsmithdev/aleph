import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../ddl';
import { createLoop, listArtifacts, listCycles, listMilestones, getLoop, readState } from './db';
import { runLoop } from './engine';
import { listEntries } from './ledger';
import { makeNoopTemplate } from './templates/noop';

function newDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite as unknown as Parameters<typeof applyResearchDDL>[0]);
  return sqlite as unknown as Parameters<typeof applyResearchDDL>[0];
}

describe('noop template — end-to-end', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('runs to completion against an empty envelope (stop_rule terminates)', async () => {
    const loop = createLoop(sqlite, { template_id: 'noop' });
    const template = makeNoopTemplate({ cycles_target: 3 });

    const result = await runLoop(sqlite, template, loop.id);

    expect(result.status).toBe('completed');
    expect(result.reason).toBe('noop_target_reached:3');
    expect(result.cycles_run).toBe(3);
    expect(getLoop(sqlite, loop.id)?.status).toBe('completed');

    const cycles = listCycles(sqlite, loop.id);
    expect(cycles).toHaveLength(3);
    expect(cycles.every(c => c.status === 'finalized')).toBe(true);
    expect(cycles.map(c => c.index)).toEqual([0, 1, 2]);
  });

  test('every cycle writes processor + derivation + renderer to the ledger', async () => {
    const loop = createLoop(sqlite, { template_id: 'noop' });
    const template = makeNoopTemplate({ cycles_target: 2 });
    await runLoop(sqlite, template, loop.id);

    const entries = listEntries(sqlite, loop.id);
    // 2 cycles × 3 steps = 6 entries
    expect(entries).toHaveLength(6);
    const steps = entries.map(e => e.step);
    expect(steps.filter(s => s === 'processor')).toHaveLength(2);
    expect(steps.filter(s => s === 'derivation')).toHaveLength(2);
    expect(steps.filter(s => s === 'renderer')).toHaveLength(2);
  });

  test('produces a cycle_output artifact per cycle', async () => {
    const loop = createLoop(sqlite, { template_id: 'noop' });
    await runLoop(sqlite, makeNoopTemplate({ cycles_target: 4 }), loop.id);

    const outputs = listArtifacts(sqlite, loop.id, 'cycle_output');
    expect(outputs).toHaveLength(4);
    // Each should contain processor + derivation + render
    for (const a of outputs) {
      expect(a.payload.processor).toBeDefined();
      expect(a.payload.derivation).toBeDefined();
      expect(a.payload.render).toBeDefined();
    }
  });

  test('stops on envelope cycles-limit before reaching template stop_rule', async () => {
    const loop = createLoop(sqlite, { template_id: 'noop', envelope: { cycles: { count: 2 } } });
    const template = makeNoopTemplate({ cycles_target: 100 });
    const result = await runLoop(sqlite, template, loop.id);
    expect(result.status).toBe('envelope_exhausted');
    expect(result.reason).toBe('envelope:cycles');
    expect(result.cycles_run).toBe(2);
    expect(getLoop(sqlite, loop.id)?.envelope_consumed.cycles_count).toBe(2);
  });

  test('fires milestone hooks at 25/50/75% envelope', async () => {
    // 8-cycle envelope; thresholds at 2, 4, 6 cycles
    const loop = createLoop(sqlite, { template_id: 'noop', envelope: { cycles: { count: 8 } } });
    const result = await runLoop(sqlite, makeNoopTemplate({ cycles_target: 100 }), loop.id);

    expect(result.status).toBe('envelope_exhausted');
    expect(result.milestones_fired).toEqual([25, 50, 75]);

    const milestones = listMilestones(sqlite, loop.id);
    expect(milestones).toHaveLength(3);
    expect(milestones.map(m => m.at_envelope_pct).sort()).toEqual([25, 50, 75]);

    const milestoneArtifacts = listArtifacts(sqlite, loop.id, 'milestone');
    expect(milestoneArtifacts).toHaveLength(3);
  });
});

describe('crash resume — input-hash dedup', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('re-running a terminal loop is a no-op (engine is idempotent)', async () => {
    const loop = createLoop(sqlite, { template_id: 'noop' });

    let calls = 0;
    const template = makeNoopTemplate({ cycles_target: 3 });
    const instrumented = {
      ...template,
      processor: async (input: unknown, state: unknown) => {
        calls++;
        return await template.processor(input, state as never);
      },
    };

    // First run: completes, status=completed.
    await runLoop(sqlite, instrumented, loop.id);
    expect(calls).toBe(3);
    expect(getLoop(sqlite, loop.id)?.status).toBe('completed');

    // Re-spawn against the same loop — supervisor may have restarted us after clean exit.
    // Engine sees terminal status and bails without running anything new.
    const result = await runLoop(sqlite, instrumented, loop.id);
    expect(calls).toBe(3);
    expect(result.reason).toBe('already_completed');
    expect(result.cycles_run).toBe(0);
  });

  test('partial cycle: if processor recorded but derivation never ran, resume re-uses processor and runs derivation', async () => {
    const loop = createLoop(sqlite, { template_id: 'noop' });
    const template = makeNoopTemplate({ cycles_target: 1 });

    // Run normally — should complete with 1 cycle, 3 ledger entries.
    await runLoop(sqlite, template, loop.id);
    const beforeEntries = listEntries(sqlite, loop.id);
    expect(beforeEntries).toHaveLength(3);

    // Simulate crash mid-cycle by deleting the derivation + renderer entries from the ledger.
    // Then re-mark the cycle and loop as still-in-progress.
    const cycle = listCycles(sqlite, loop.id)[0];
    sqlite.prepare("DELETE FROM cycle_ledger WHERE cycle_id = ? AND step IN ('derivation','renderer')").run(cycle.id);
    sqlite.prepare("UPDATE cycles SET status = 'running', finalized_at = NULL WHERE id = ?").run(cycle.id);
    sqlite.prepare("UPDATE loops SET status = 'running' WHERE id = ?").run(loop.id);
    // Also drop the post-cycle cycle_output artifact so renderer fires a fresh render.
    sqlite.prepare("DELETE FROM artifacts WHERE cycle_id = ? AND kind = 'cycle_output'").run(cycle.id);

    let procCalls = 0;
    let derivCalls = 0;
    const instrumented = {
      ...template,
      processor: async (input: unknown, state: unknown) => {
        procCalls++;
        return await template.processor(input, state as never);
      },
      derivation: async (state: unknown, po: unknown) => {
        derivCalls++;
        return await template.derivation(state as never, po);
      },
    };

    await runLoop(sqlite, instrumented, loop.id);

    // Processor should NOT have re-run (ledger hit); derivation SHOULD have re-run (ledger miss).
    expect(procCalls).toBe(0);
    expect(derivCalls).toBe(1);

    const afterEntries = listEntries(sqlite, loop.id);
    // Should be back to 3 entries (processor cached + derivation re-recorded + renderer re-recorded)
    expect(afterEntries).toHaveLength(3);
  });
});

describe('readState', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('reflects a fresh loop accurately', () => {
    const loop = createLoop(sqlite, { template_id: 'noop', prompt: 'test prompt' });
    const state = readState(sqlite, loop.id);
    expect(state.loop.prompt).toBe('test prompt');
    expect(state.loop.status).toBe('pending');
    expect(state.cycles).toEqual([]);
    expect(state.artifacts).toEqual([]);
    expect(state.envelope_consumed.cycles_count).toBe(0);
  });
});
