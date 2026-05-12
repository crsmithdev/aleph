/**
 * Output-shape detection tests — Phase 3.1.
 *
 * Two surfaces under test:
 *   - `detectOutputShape(prompt, llm)` — classifies via one LLM call, tolerates
 *     malformed responses, degrades to `prose` on any failure.
 *   - `ensureScheduleArtifact(sqlite, loop_id, prompt, llm)` — idempotent
 *     write at session-create time; never re-detects on respawn.
 *
 * Tests use FakeLLMProvider scripted with a handler-per-shape so we can
 * deterministically assert every classification branch and parser path
 * without spinning up the HTTP fake server.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../ddl';
import { createArtifact, createCycle, createLoop, listArtifacts, readState } from './db';
import { FakeLLMProvider } from './llm';
import { detectOutputShape, ensureScheduleArtifact, readScheduleFromArtifacts, validateShape } from './shape';

function newDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite as unknown as Parameters<typeof applyResearchDDL>[0]);
  return sqlite as unknown as Parameters<typeof applyResearchDDL>[0];
}

function llmReturning(text: string): FakeLLMProvider {
  return new FakeLLMProvider({ complete: () => text });
}

describe('detectOutputShape — classification', () => {
  test('prose response decodes to {kind:"prose"}', async () => {
    const llm = llmReturning('{"kind":"prose"}');
    const shape = await detectOutputShape('How does a sourdough starter develop?', llm);
    expect(shape).toEqual({ kind: 'prose' });
    expect(llm.completeCalls).toBe(1);
  });

  test('list response with explicit min_items preserves it', async () => {
    const llm = llmReturning('{"kind":"list","min_items":8}');
    const shape = await detectOutputShape('best Berkeley volunteering options', llm);
    expect(shape).toEqual({ kind: 'list', min_items: 8 });
  });

  test('list response without min_items gets default 5', async () => {
    const llm = llmReturning('{"kind":"list"}');
    const shape = await detectOutputShape('p', llm);
    expect(shape).toEqual({ kind: 'list', min_items: 5 });
  });

  test('table response preserves columns', async () => {
    const llm = llmReturning('{"kind":"table","columns":["transmission","symptoms","treatment","vaccine"]}');
    const shape = await detectOutputShape('Compare HSV and HPV', llm);
    expect(shape).toEqual({
      kind: 'table',
      columns: ['transmission', 'symptoms', 'treatment', 'vaccine'],
    });
  });

  test('timeline response with min_events preserves it', async () => {
    const llm = llmReturning('{"kind":"timeline","min_events":5}');
    const shape = await detectOutputShape('Major events in the printing press', llm);
    expect(shape).toEqual({ kind: 'timeline', min_events: 5 });
  });

  test('mixed response with valid components decodes recursively', async () => {
    const llm = llmReturning(
      '{"kind":"mixed","components":[{"kind":"prose"},{"kind":"list","min_items":5}]}'
    );
    const shape = await detectOutputShape('History of smashed burgers + 5 best places', llm);
    expect(shape).toEqual({
      kind: 'mixed',
      components: [{ kind: 'prose' }, { kind: 'list', min_items: 5 }],
    });
  });
});

describe('detectOutputShape — tolerance + fallbacks', () => {
  test('strips markdown code fences before parsing', async () => {
    const llm = llmReturning('```json\n{"kind":"list","min_items":7}\n```');
    const shape = await detectOutputShape('p', llm);
    expect(shape).toEqual({ kind: 'list', min_items: 7 });
  });

  test('malformed JSON falls back to prose', async () => {
    const llm = llmReturning('the answer is a table, definitely');
    const shape = await detectOutputShape('p', llm);
    expect(shape).toEqual({ kind: 'prose' });
  });

  test('unknown kind falls back to prose', async () => {
    const llm = llmReturning('{"kind":"interpretive-dance"}');
    const shape = await detectOutputShape('p', llm);
    expect(shape).toEqual({ kind: 'prose' });
  });

  test('table with single column rejected (just a list) → prose', async () => {
    const llm = llmReturning('{"kind":"table","columns":["solo"]}');
    const shape = await detectOutputShape('p', llm);
    // Coerce returns null for single-column table; outer falls back to prose.
    expect(shape).toEqual({ kind: 'prose' });
  });

  test('mixed with <2 components rejected → prose', async () => {
    const llm = llmReturning('{"kind":"mixed","components":[{"kind":"prose"}]}');
    const shape = await detectOutputShape('p', llm);
    expect(shape).toEqual({ kind: 'prose' });
  });

  test('LLM throwing falls back to prose, does not crash', async () => {
    const llm = new FakeLLMProvider({
      complete: () => { throw new Error('upstream unavailable'); },
    });
    const shape = await detectOutputShape('p', llm);
    expect(shape).toEqual({ kind: 'prose' });
  });
});

describe('ensureScheduleArtifact — idempotent persistence', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('first call detects and writes a schedule artifact', async () => {
    const llm = llmReturning('{"kind":"list","min_items":5}');
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'best Berkeley volunteer options' });

    const payload = await ensureScheduleArtifact(sqlite, loop.id, loop.prompt, llm);

    expect(payload.output_shape).toEqual({ kind: 'list', min_items: 5 });
    const artifacts = listArtifacts(sqlite, loop.id, 'schedule');
    expect(artifacts).toHaveLength(1);
    expect(artifacts[0].payload).toEqual({ output_shape: { kind: 'list', min_items: 5 } });
    expect(llm.completeCalls).toBe(1);
  });

  test('second call reuses the existing artifact without a new LLM call', async () => {
    const llm = llmReturning('{"kind":"list","min_items":5}');
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });

    await ensureScheduleArtifact(sqlite, loop.id, loop.prompt, llm);
    const callsAfterFirst = llm.completeCalls;
    const second = await ensureScheduleArtifact(sqlite, loop.id, loop.prompt, llm);

    expect(llm.completeCalls).toBe(callsAfterFirst);     // no extra call on respawn
    expect(second.output_shape).toEqual({ kind: 'list', min_items: 5 });
    expect(listArtifacts(sqlite, loop.id, 'schedule')).toHaveLength(1);
  });

  test('readScheduleFromArtifacts surfaces the payload from a LoopState-style list', async () => {
    const llm = llmReturning('{"kind":"table","columns":["a","b"]}');
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    await ensureScheduleArtifact(sqlite, loop.id, loop.prompt, llm);

    const all = listArtifacts(sqlite, loop.id);
    const schedule = readScheduleFromArtifacts(all);
    expect(schedule?.output_shape).toEqual({ kind: 'table', columns: ['a', 'b'] });
  });

  test('readScheduleFromArtifacts returns null when no schedule exists (noop loop)', async () => {
    const loop = createLoop(sqlite, { template_id: 'noop', prompt: 'p' });
    const all = listArtifacts(sqlite, loop.id);
    expect(readScheduleFromArtifacts(all)).toBeNull();
  });
});

// ---- Validator unit tests ---------------------------------------------------

function seedCycleOutput(sqlite: ReturnType<typeof newDb>, loop_id: string, text: string) {
  const cycle = createCycle(sqlite, { loop_id, idx: 0 });
  createArtifact(sqlite, {
    loop_id,
    cycle_id: cycle.id,
    kind: 'cycle_output',
    payload: {
      processor: { kind: 'research_proc', query: 'q', text, source_urls: [], source_meta: [], tokens: { prompt: 0, completion: 0 }, model: 'fake' },
      derivation: { kind: 'research_deriv', followups: [] },
      render: { kind: 'render', findings: [], sources: [], cycles_rendered: 0 },
    },
  });
}

describe('validateShape — prose', () => {
  test('always satisfied', () => {
    const sqlite = newDb();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    seedCycleOutput(sqlite, loop.id, 'just some prose without structure');
    const state = readState(sqlite, loop.id);
    expect(validateShape(state, { kind: 'prose' })).toEqual({
      satisfied: true, shape_kind: 'prose', missing: null,
    });
  });
});

describe('validateShape — table', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('Markdown table with all required columns + data row → satisfied', () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    seedCycleOutput(sqlite, loop.id, [
      'Comparison:',
      '',
      '| transmission | symptoms | treatment | vaccine |',
      '|---|---|---|---|',
      '| Direct | Sores | Antivirals | No |',
      '| Sexual | Warts | Removal | Gardasil |',
      '',
      'End.',
    ].join('\n'));
    const state = readState(sqlite, loop.id);
    const result = validateShape(state, {
      kind: 'table',
      columns: ['transmission', 'symptoms', 'treatment', 'vaccine'],
    });
    expect(result).toEqual({ satisfied: true, shape_kind: 'table', missing: null });
  });

  test('case-insensitive header matching', () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    seedCycleOutput(sqlite, loop.id, [
      '| Transmission | Symptoms | Treatment | Vaccine |',
      '|---|---|---|---|',
      '| a | b | c | d |',
    ].join('\n'));
    const state = readState(sqlite, loop.id);
    expect(validateShape(state, {
      kind: 'table',
      columns: ['transmission', 'symptoms', 'treatment', 'vaccine'],
    }).satisfied).toBe(true);
  });

  test('no table at all → unsatisfied, all columns reported missing', () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    seedCycleOutput(sqlite, loop.id, 'just prose, definitely no table syntax here at all');
    const state = readState(sqlite, loop.id);
    const result = validateShape(state, { kind: 'table', columns: ['a', 'b', 'c'] });
    expect(result.satisfied).toBe(false);
    expect(result.missing).toEqual({ columns: ['a', 'b', 'c'] });
  });

  test('table missing one required column → unsatisfied, that column reported', () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    seedCycleOutput(sqlite, loop.id, [
      '| a | b | c |',
      '|---|---|---|',
      '| 1 | 2 | 3 |',
    ].join('\n'));
    const state = readState(sqlite, loop.id);
    const result = validateShape(state, { kind: 'table', columns: ['a', 'b', 'c', 'd'] });
    expect(result.satisfied).toBe(false);
    expect(result.missing).toEqual({ columns: ['d'] });
  });

  test('header without divider line is not a table → unsatisfied', () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    seedCycleOutput(sqlite, loop.id, '| a | b | c |\nthen some prose, no divider');
    const state = readState(sqlite, loop.id);
    expect(validateShape(state, { kind: 'table', columns: ['a', 'b'] }).satisfied).toBe(false);
  });

  test('table header but no data row → unsatisfied', () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    seedCycleOutput(sqlite, loop.id, '| a | b |\n|---|---|\n');
    const state = readState(sqlite, loop.id);
    expect(validateShape(state, { kind: 'table', columns: ['a', 'b'] }).satisfied).toBe(false);
  });

  test('table accumulates across cycles — second cycle adds the missing column', () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    // Cycle 0: incomplete table missing 'vaccine'.
    seedCycleOutput(sqlite, loop.id, '| transmission | symptoms |\n|---|---|\n| direct | sores |');
    // Cycle 1: now produces the complete table.
    seedCycleOutput(sqlite, loop.id, [
      '| transmission | symptoms | treatment | vaccine |',
      '|---|---|---|---|',
      '| direct | sores | antivirals | none |',
    ].join('\n'));
    const state = readState(sqlite, loop.id);
    expect(validateShape(state, {
      kind: 'table',
      columns: ['transmission', 'symptoms', 'treatment', 'vaccine'],
    }).satisfied).toBe(true);
  });
});
