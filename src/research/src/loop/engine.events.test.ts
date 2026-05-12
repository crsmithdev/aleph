/**
 * Engine telemetry — verifies runLoop emits the expected event sequence
 * through `emitResearchEvent`. Closes the "telemetry-exists" gate for Phase 1
 * and pins the event vocabulary (loop / cycle / cycle_step / milestone)
 * against accidental regression.
 */
import { describe, test, expect, beforeEach, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../ddl';
import { clearResearchListeners, onResearchEvent, type ResearchEvent } from '../services/events';
import { createLoop, listCycles } from './db';
import { listEntries } from './ledger';
import { runLoop } from './engine';
import { makeNoopTemplate } from './templates/noop';

function newDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite as unknown as Parameters<typeof applyResearchDDL>[0]);
  return sqlite as unknown as Parameters<typeof applyResearchDDL>[0];
}

describe('engine event emission', () => {
  let sqlite: ReturnType<typeof newDb>;
  let events: ResearchEvent[];
  beforeEach(() => {
    sqlite = newDb();
    events = [];
    onResearchEvent(e => { events.push(e); });
  });
  afterEach(() => { clearResearchListeners(); });

  test('emits loop / cycle / cycle_step events for a clean 2-cycle run', async () => {
    const loop = createLoop(sqlite, { template_id: 'noop' });
    await runLoop(sqlite, makeNoopTemplate({ cycles_target: 2 }), loop.id);

    // All events scoped to this loop.
    expect(events.every(e => e.session_id === loop.id)).toBe(true);

    const byType = (t: string) => events.filter(e => e.type === t);

    // 1 loop:running at start + 1 loop:completed at end = 2 loop events.
    const loops = byType('loop');
    expect(loops).toHaveLength(2);
    expect((loops[0].payload as { status: string }).status).toBe('running');
    expect((loops[1].payload as { status: string }).status).toBe('completed');
    expect((loops[1].payload as { reason: string }).reason).toBe('noop_target_reached:2');
    expect((loops[1].payload as { cycles_run: number }).cycles_run).toBe(2);

    // 2 cycles × 2 transitions (running, finalized) = 4 cycle events.
    const cycles = byType('cycle');
    expect(cycles).toHaveLength(4);
    expect(cycles.map(c => (c.payload as { status: string }).status))
      .toEqual(['running', 'finalized', 'running', 'finalized']);

    // 2 cycles × 3 steps = 6 cycle_step events, all uncached on a fresh run.
    const steps = byType('cycle_step');
    expect(steps).toHaveLength(6);
    expect(steps.map(s => (s.payload as { step: string }).step))
      .toEqual(['processor', 'derivation', 'renderer', 'processor', 'derivation', 'renderer']);
    expect(steps.every(s => (s.payload as { cached: boolean }).cached === false)).toBe(true);

    // No milestones fired (no envelope).
    expect(byType('milestone')).toHaveLength(0);
  });

  test('emits milestone events at 25/50/75% envelope', async () => {
    const loop = createLoop(sqlite, { template_id: 'noop', envelope: { cycles: { count: 8 } } });
    await runLoop(sqlite, makeNoopTemplate({ cycles_target: 100 }), loop.id);

    const milestones = events.filter(e => e.type === 'milestone');
    expect(milestones).toHaveLength(3);
    expect(milestones.map(m => (m.payload as { at_envelope_pct: number }).at_envelope_pct))
      .toEqual([25, 50, 75]);
    expect(milestones.every(m => typeof (m.payload as { artifact_id: string }).artifact_id === 'string'))
      .toBe(true);

    // Final loop event reports envelope_exhausted.
    const loops = events.filter(e => e.type === 'loop');
    const terminal = loops[loops.length - 1];
    expect((terminal.payload as { status: string }).status).toBe('envelope_exhausted');
    expect((terminal.payload as { reason: string }).reason).toBe('envelope:cycles');
  });

  test('cycle_step events report cached=true on resume', async () => {
    const loop = createLoop(sqlite, { template_id: 'noop' });
    const template = makeNoopTemplate({ cycles_target: 1 });

    // First run completes cleanly.
    await runLoop(sqlite, template, loop.id);
    expect(listEntries(sqlite, loop.id)).toHaveLength(3);

    // Simulate partial crash: drop derivation+renderer, re-mark cycle/loop running.
    const cycle = listCycles(sqlite, loop.id)[0];
    sqlite.prepare("DELETE FROM cycle_ledger WHERE cycle_id = ? AND step IN ('derivation','renderer')").run(cycle.id);
    sqlite.prepare("UPDATE cycles SET status = 'running', finalized_at = NULL WHERE id = ?").run(cycle.id);
    sqlite.prepare("UPDATE loops SET status = 'running' WHERE id = ?").run(loop.id);
    sqlite.prepare("DELETE FROM artifacts WHERE cycle_id = ? AND kind = 'cycle_output'").run(cycle.id);

    events.length = 0; // clear captured events from first run
    await runLoop(sqlite, template, loop.id);

    const steps = events.filter(e => e.type === 'cycle_step');
    expect(steps).toHaveLength(3);
    const byStep = (name: string) => steps.find(s => (s.payload as { step: string }).step === name);
    expect((byStep('processor')!.payload as { cached: boolean }).cached).toBe(true);
    expect((byStep('derivation')!.payload as { cached: boolean }).cached).toBe(false);
    expect((byStep('renderer')!.payload as { cached: boolean }).cached).toBe(false);
  });

  test('idempotent re-entry on terminal loop emits no engine events', async () => {
    const loop = createLoop(sqlite, { template_id: 'noop' });
    await runLoop(sqlite, makeNoopTemplate({ cycles_target: 1 }), loop.id);

    events.length = 0;
    const result = await runLoop(sqlite, makeNoopTemplate({ cycles_target: 1 }), loop.id);
    expect(result.reason).toBe('already_completed');
    expect(events).toHaveLength(0);
  });
});
