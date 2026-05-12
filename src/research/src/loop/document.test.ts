/**
 * Document-polish tests. Mirrors planner.test.ts / shape.test.ts:
 *   - generateDocument happy path (real render artifact → polished text)
 *   - generateDocument with no render → null (degenerate empty-cycle case)
 *   - generateDocument cycle_output as render source (research template wraps render in cycle_output.render)
 *   - readLatestDocument picks the freshest by created_at
 *   - prompt format carries findings + sources verbatim
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../ddl';
import { createArtifact, createCycle, createLoop, listArtifacts } from './db';
import { FakeLLMProvider } from './llm';
import { generateDocument, readLatestDocument, type DocumentPayload } from './document';

function newDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite as unknown as Parameters<typeof applyResearchDDL>[0]);
  return sqlite as unknown as Parameters<typeof applyResearchDDL>[0];
}

function seedRenderInCycleOutput(
  sqlite: ReturnType<typeof newDb>,
  loop_id: string,
  render: { findings: Array<{ cycle: number; query: string; text: string }>; sources: Array<{ url: string; title: string }>; cycles_rendered: number },
) {
  const cycle = createCycle(sqlite, { loop_id, idx: 0 });
  createArtifact(sqlite, {
    loop_id,
    cycle_id: cycle.id,
    kind: 'cycle_output',
    payload: { render: { kind: 'render', ...render } },
  });
}

describe('generateDocument — happy path', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('writes a document artifact containing the LLM-polished text', async () => {
    const llm = new FakeLLMProvider({
      complete: () => '## Lead\n\nA polished encyclopedic article.\n\n## References\n\n[1] Example Source',
    });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'compare X and Y' });
    seedRenderInCycleOutput(sqlite, loop.id, {
      findings: [
        { cycle: 0, query: 'X overview', text: 'X is a system that does foo.' },
        { cycle: 1, query: 'Y overview', text: 'Y is a system that does bar.' },
      ],
      sources: [
        { url: 'https://example.test/a', title: 'A about X' },
        { url: 'https://example.test/b', title: 'B about Y' },
      ],
      cycles_rendered: 2,
    });

    const doc = await generateDocument(sqlite, loop.id, 'compare X and Y', llm);

    expect(doc).not.toBeNull();
    expect(doc!.kind).toBe('document');
    const payload = doc!.payload as unknown as DocumentPayload;
    expect(payload.text).toContain('Lead');
    expect(payload.text).toContain('References');
    expect(payload.source_count).toBe(2);
    expect(payload.rendered_cycles).toBe(2);
    expect(payload.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(payload.model).toBeTruthy();
  });

  test('encyclopedia-editor prompt is sent to the LLM with findings + source list', async () => {
    const llm = new FakeLLMProvider({ complete: () => '## Article\n\nbody' });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    seedRenderInCycleOutput(sqlite, loop.id, {
      findings: [
        { cycle: 0, query: 'redux state', text: 'Redux is a state container.' },
        { cycle: 1, query: 'mobx state', text: 'MobX uses observables.' },
      ],
      sources: [{ url: 'https://r.test/1', title: 'Redux Docs' }],
      cycles_rendered: 2,
    });

    await generateDocument(sqlite, loop.id, 'compare state libs', llm);

    expect(llm.lastCompletePrompt).toContain('compare state libs');
    expect(llm.lastCompletePrompt).toContain('Wikipedia article');
    expect(llm.lastCompletePrompt).toContain('[Cycle 0: redux state]');
    expect(llm.lastCompletePrompt).toContain('Redux is a state container.');
    expect(llm.lastCompletePrompt).toContain('[Cycle 1: mobx state]');
    expect(llm.lastCompletePrompt).toContain('[1] Redux Docs — https://r.test/1');
  });
});

describe('generateDocument — degenerate inputs', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('no render artifact → null (no LLM call)', async () => {
    const llm = new FakeLLMProvider({ complete: () => 'should not be called' });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    // Only a schedule artifact exists; no cycle_output yet.
    createArtifact(sqlite, {
      loop_id: loop.id,
      cycle_id: null,
      kind: 'schedule',
      payload: { output_shape: { kind: 'prose' }, plan: { canon: [], branches: [{ id: 'main', query: 'q' }], per_branch_budget: 3, perturbation_weights: {}, milestone_plan: [1] } },
    });

    const doc = await generateDocument(sqlite, loop.id, 'p', llm);

    expect(doc).toBeNull();
    expect(llm.completeCalls).toBe(0);
  });

  test('empty findings array → null', async () => {
    const llm = new FakeLLMProvider({ complete: () => 'never' });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    seedRenderInCycleOutput(sqlite, loop.id, { findings: [], sources: [], cycles_rendered: 0 });

    const doc = await generateDocument(sqlite, loop.id, 'p', llm);

    expect(doc).toBeNull();
    expect(llm.completeCalls).toBe(0);
  });
});

describe('generateDocument — top-level render artifact (non-cycle_output)', () => {
  test('finds a render artifact stored directly (not nested in cycle_output)', async () => {
    const sqlite = newDb();
    const llm = new FakeLLMProvider({ complete: () => '# polished' });
    const loop = createLoop(sqlite, { template_id: 'monitor', prompt: 'p' });
    createArtifact(sqlite, {
      loop_id: loop.id,
      cycle_id: null,
      kind: 'render',
      payload: {
        kind: 'render',
        findings: [{ cycle: 0, query: 'q', text: 'direct render text' }],
        sources: [],
        cycles_rendered: 1,
      },
    });

    const doc = await generateDocument(sqlite, loop.id, 'p', llm);

    expect(doc).not.toBeNull();
    expect((doc!.payload as unknown as DocumentPayload).text).toBe('# polished');
  });
});

describe('readLatestDocument — picks freshest', () => {
  test('returns null when no document artifact exists', () => {
    const sqlite = newDb();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const arts = listArtifacts(sqlite, loop.id);
    expect(readLatestDocument(arts)).toBeNull();
  });

  test('returns the document with the latest created_at', async () => {
    const sqlite = newDb();
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    // Two document artifacts created in sequence; SQLite created_at has
    // sub-second precision via datetime('now') so back-to-back inserts
    // can share a timestamp. We force order by inserting two different
    // texts and checking that one of them comes back (test is tolerant of
    // either tie-breaker, just verifies the helper isn't broken on the
    // collision).
    createArtifact(sqlite, {
      loop_id: loop.id, cycle_id: null, kind: 'document',
      payload: { text: 'first', source_count: 0, generated_at: '2026-01-01T00:00:00Z', model: 'm', rendered_cycles: 0 },
    });
    // Sleep 1.1s so the SQLite-generated created_at is strictly newer.
    await new Promise(r => setTimeout(r, 1100));
    createArtifact(sqlite, {
      loop_id: loop.id, cycle_id: null, kind: 'document',
      payload: { text: 'second', source_count: 1, generated_at: '2026-01-01T00:00:01Z', model: 'm', rendered_cycles: 0 },
    });

    const arts = listArtifacts(sqlite, loop.id);
    const latest = readLatestDocument(arts);
    expect(latest).not.toBeNull();
    expect(latest!.payload.text).toBe('second');
  });
});
