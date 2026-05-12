/**
 * Adaptive planner tests — Phase 4.1.
 *
 * Mirrors `shape.test.ts`'s structure: one happy-path block per parsing
 * branch, one tolerance/fallback block for the malformed paths, and one
 * integration block that runs `ensureScheduleArtifact` end-to-end with
 * fake LLM responses for both detection and planning.
 *
 * The planner is forgiving by design — Phase 3's detector falls back to
 * prose on any parsing failure, and the planner falls back to a minimal
 * single-branch plan. Both are silent-but-observable degradations: the
 * schedule artifact records what the LLM emitted, so a regression shows
 * up in the artifact stream rather than as a crash or a missing field.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../ddl';
import { createLoop, listArtifacts } from './db';
import { FakeLLMProvider } from './llm';
import { planLoop } from './planner';
import { ensureScheduleArtifact } from './shape';
import type { LoopSchedule, OutputShape } from './types';

function newDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite as unknown as Parameters<typeof applyResearchDDL>[0]);
  return sqlite as unknown as Parameters<typeof applyResearchDDL>[0];
}

/**
 * Dispatch on prompt prefix so one fake provider can answer both detection
 * and planning calls in the same `ensureScheduleArtifact` flow. Real prompts
 * are unambiguous — detection starts with "Classify the output shape", the
 * planner starts with "Plan a research loop".
 */
function llmFor({ shape, plan }: { shape?: string; plan?: string }): FakeLLMProvider {
  return new FakeLLMProvider({
    complete: (_model, prompt) => {
      if (prompt.startsWith('Plan a research loop')) return plan ?? '';
      return shape ?? '';
    },
  });
}

const PROSE_SHAPE: OutputShape = { kind: 'prose' };

describe('planLoop — happy path', () => {
  test('valid JSON with all fields decodes into LoopSchedule', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      canon: ['redux', 'mobx', 'zustand'],
      branches: [
        { id: 'redux-overview', query: 'redux current state', budget: 4 },
        { id: 'mobx-overview',  query: 'mobx state management' },
      ],
      per_branch_budget: 2,
      perturbation_weights: { 'rephrase': 0.8, 'pivot': 0.2 },
      milestone_plan: [0.25, 0.5, 0.75, 1.0],
    })});

    const plan = await planLoop('what are popular React state libraries?', PROSE_SHAPE, llm);

    expect(plan).toEqual({
      canon: ['redux', 'mobx', 'zustand'],
      branches: [
        { id: 'redux-overview', query: 'redux current state', budget: 4 },
        { id: 'mobx-overview',  query: 'mobx state management' },
      ],
      per_branch_budget: 2,
      perturbation_weights: { 'rephrase': 0.8, 'pivot': 0.2 },
      milestone_plan: [0.25, 0.5, 0.75, 1.0],
    });
    expect(llm.completeCalls).toBe(1);
  });

  test('strips markdown code fences before parsing', async () => {
    const llm = llmFor({ plan: '```json\n{"branches":[{"id":"main","query":"q"}]}\n```' });
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expect(plan.branches).toEqual([{ id: 'main', query: 'q' }]);
  });
});

describe('planLoop — defaults for missing optional fields', () => {
  test('omitting canon → empty array', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      branches: [{ id: 'main', query: 'q' }],
    })});
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expect(plan.canon).toEqual([]);
  });

  test('omitting per_branch_budget → defaults to 3', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      branches: [{ id: 'main', query: 'q' }],
    })});
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expect(plan.per_branch_budget).toBe(3);
  });

  test('omitting perturbation_weights → empty object', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      branches: [{ id: 'main', query: 'q' }],
    })});
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expect(plan.perturbation_weights).toEqual({});
  });

  test('omitting milestone_plan → defaults to [0.25, 0.5, 0.75, 1.0]', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      branches: [{ id: 'main', query: 'q' }],
    })});
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expect(plan.milestone_plan).toEqual([0.25, 0.5, 0.75, 1.0]);
  });

  test('omitting Branch.budget keeps the field absent (inherits per_branch_budget at runtime)', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      branches: [{ id: 'main', query: 'q' }],
    })});
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expect(plan.branches[0]).toEqual({ id: 'main', query: 'q' });
    expect(plan.branches[0].budget).toBeUndefined();
  });
});

describe('planLoop — input filtering', () => {
  test('canon entries that are not non-empty strings get filtered', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      canon: ['ok', '', 42, null, 'also-ok'],
      branches: [{ id: 'main', query: 'q' }],
    })});
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expect(plan.canon).toEqual(['ok', 'also-ok']);
  });

  test('branches missing id or query are filtered', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      branches: [
        { id: 'good', query: 'q1' },
        { id: 'no-query' },
        { query: 'no-id' },
        { id: '', query: 'empty-id' },
        { id: 'good-2', query: 'q2', budget: 5 },
      ],
    })});
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expect(plan.branches).toEqual([
      { id: 'good', query: 'q1' },
      { id: 'good-2', query: 'q2', budget: 5 },
    ]);
  });

  test('perturbation_weights out of [0,1] range filtered out', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      branches: [{ id: 'main', query: 'q' }],
      perturbation_weights: { 'a': 0.5, 'b': -0.1, 'c': 1.5, 'd': 'not-a-number', 'e': 0 },
    })});
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expect(plan.perturbation_weights).toEqual({ 'a': 0.5, 'e': 0 });
  });

  test('milestone_plan values out of (0,1] range filtered out', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      branches: [{ id: 'main', query: 'q' }],
      milestone_plan: [0.25, 0, 1.5, 'half', 0.75],
    })});
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expect(plan.milestone_plan).toEqual([0.25, 0.75]);
  });
});

describe('planLoop — fallbacks', () => {
  function expectFallback(plan: LoopSchedule, prompt: string) {
    expect(plan.branches).toEqual([{ id: 'main', query: prompt }]);
    expect(plan.canon).toEqual([]);
    expect(plan.per_branch_budget).toBe(3);
    expect(plan.perturbation_weights).toEqual({});
    expect(plan.milestone_plan).toEqual([0.25, 0.5, 0.75, 1.0]);
  }

  test('malformed JSON → fallback plan on prompt', async () => {
    const llm = llmFor({ plan: 'not json at all' });
    const plan = await planLoop('my prompt', PROSE_SHAPE, llm);
    expectFallback(plan, 'my prompt');
  });

  test('LLM throws → fallback plan, does not crash', async () => {
    const llm = new FakeLLMProvider({
      complete: () => { throw new Error('upstream unavailable'); },
    });
    const plan = await planLoop('my prompt', PROSE_SHAPE, llm);
    expectFallback(plan, 'my prompt');
  });

  test('valid JSON but zero branches → fallback (invariant: ≥1 branch)', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      canon: ['something'],
      branches: [],
      per_branch_budget: 7,
    })});
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expectFallback(plan, 'p');
  });

  test('all branches malformed → fallback (filter empties branches array)', async () => {
    const llm = llmFor({ plan: JSON.stringify({
      branches: [
        { id: '', query: 'empty-id' },
        { query: 'no-id' },
        'not-an-object',
      ],
    })});
    const plan = await planLoop('p', PROSE_SHAPE, llm);
    expectFallback(plan, 'p');
  });

  test('non-object response (array, number, null) → fallback', async () => {
    for (const body of ['[]', '42', 'null', '"a string"']) {
      const llm = llmFor({ plan: body });
      const plan = await planLoop('p', PROSE_SHAPE, llm);
      expectFallback(plan, 'p');
    }
  });
});

describe('planLoop — output_shape feeds into the prompt', () => {
  test('detected shape appears in the planner prompt verbatim', async () => {
    const llm = llmFor({ plan: JSON.stringify({ branches: [{ id: 'main', query: 'q' }] }) });
    await planLoop('my prompt', { kind: 'list', min_items: 7 }, llm);
    // FakeLLMProvider captures the last prompt; we assert it carries the shape.
    expect(llm.lastCompletePrompt).toContain('"kind":"list"');
    expect(llm.lastCompletePrompt).toContain('"min_items":7');
    expect(llm.lastCompletePrompt).toContain('Target prompt: my prompt');
  });
});

describe('ensureScheduleArtifact — planner integration (Phase 4)', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('first call detects shape AND plans, writes both onto the schedule artifact', async () => {
    const llm = llmFor({
      shape: '{"kind":"list","min_items":5}',
      plan: JSON.stringify({
        canon: ['redux', 'mobx'],
        branches: [{ id: 'main', query: 'react state libs' }],
        per_branch_budget: 2,
        perturbation_weights: {},
        milestone_plan: [0.5, 1.0],
      }),
    });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'react state libs' });

    const payload = await ensureScheduleArtifact(sqlite, loop.id, loop.prompt, llm);

    expect(payload.output_shape).toEqual({ kind: 'list', min_items: 5 });
    expect(payload.plan).toEqual({
      canon: ['redux', 'mobx'],
      branches: [{ id: 'main', query: 'react state libs' }],
      per_branch_budget: 2,
      perturbation_weights: {},
      milestone_plan: [0.5, 1.0],
    });
    // Two LLM calls: detection then planning.
    expect(llm.completeCalls).toBe(2);

    // The artifact carries the full payload, not just the shape.
    const artifacts = listArtifacts(sqlite, loop.id, 'schedule');
    expect(artifacts).toHaveLength(1);
    const stored = artifacts[0].payload as unknown as { output_shape: OutputShape; plan: LoopSchedule };
    expect(stored.output_shape).toEqual({ kind: 'list', min_items: 5 });
    expect(stored.plan.canon).toEqual(['redux', 'mobx']);
  });

  test('respawn after schedule exists short-circuits BOTH calls', async () => {
    const llm = llmFor({
      shape: '{"kind":"prose"}',
      plan: JSON.stringify({ branches: [{ id: 'main', query: 'q' }] }),
    });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });

    await ensureScheduleArtifact(sqlite, loop.id, loop.prompt, llm);
    const callsAfterFirst = llm.completeCalls;
    expect(callsAfterFirst).toBe(2);

    const second = await ensureScheduleArtifact(sqlite, loop.id, loop.prompt, llm);
    expect(llm.completeCalls).toBe(callsAfterFirst);                     // no extra calls
    expect(listArtifacts(sqlite, loop.id, 'schedule')).toHaveLength(1);  // no duplicate artifact
    expect(second.plan.branches).toEqual([{ id: 'main', query: 'q' }]);  // payload survives roundtrip
  });

  test('detection succeeds but planner fails → schedule still gets a (fallback) plan', async () => {
    // Detector returns valid shape; planner returns garbage so coerce fails.
    const llm = llmFor({
      shape: '{"kind":"prose"}',
      plan: 'not json at all',
    });
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'my prompt' });

    const payload = await ensureScheduleArtifact(sqlite, loop.id, loop.prompt, llm);

    expect(payload.output_shape).toEqual({ kind: 'prose' });
    // Fallback plan — single branch on the prompt itself.
    expect(payload.plan.branches).toEqual([{ id: 'main', query: 'my prompt' }]);
    expect(payload.plan.canon).toEqual([]);
  });
});
