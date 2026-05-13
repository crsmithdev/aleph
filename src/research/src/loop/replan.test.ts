/**
 * rePlanSchedule — Phase 5c. Milestone re-planning produces a chained
 * `kind: 'schedule'` artifact whose branches preserve the first N entries
 * of the prior plan verbatim (so cycle index → branch mapping stays stable
 * for already-finalized cycles), with `predecessor_id` linking back to the
 * source artifact.
 */

import { describe, test, expect, beforeEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { applyResearchDDL } from '../ddl';
import { createLoop, createArtifact, listArtifacts } from './db';
import { FakeLLMProvider } from './llm';
import { rePlanSchedule, readScheduleFromArtifacts } from './shape';
import type { SchedulePayload } from './types';

function newDb() {
  const sqlite = new Database(':memory:');
  sqlite.exec('PRAGMA journal_mode = WAL');
  sqlite.exec('PRAGMA foreign_keys = ON');
  applyResearchDDL(sqlite as unknown as Parameters<typeof applyResearchDDL>[0]);
  return sqlite as unknown as Parameters<typeof applyResearchDDL>[0];
}

function llmReturning(plan: string) {
  return new FakeLLMProvider({ complete: () => plan });
}

const SEED_PRIOR: SchedulePayload = {
  output_shape: { kind: 'prose' },
  plan: {
    canon: ['react', 'vue'],
    branches: [
      { id: 'react-overview', query: 'react current state' },
      { id: 'vue-overview', query: 'vue current state' },
      { id: 'comparison', query: 'react vs vue' },
    ],
    per_branch_budget: 2,
    perturbation_weights: {},
    milestone_plan: [0.5, 1.0],
  },
  envelope: { cycles: { count: 10 } },
  created_with_mode: 'default',
};

describe('rePlanSchedule', () => {
  let sqlite: ReturnType<typeof newDb>;
  beforeEach(() => { sqlite = newDb(); });

  test('preserves first N branches verbatim, appends planner-suggested tail', async () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'compare react and vue' });
    const priorArtifact = createArtifact(sqlite, {
      loop_id: loop.id, cycle_id: null, kind: 'schedule',
      payload: SEED_PRIOR as unknown as Record<string, unknown>,
    });

    // Planner returns a fresh plan with one of the prior ids (should de-dupe)
    // plus one new branch.
    const llm = llmReturning(JSON.stringify({
      canon: ['react', 'vue', 'svelte'],
      branches: [
        { id: 'react-overview', query: 'STALE — should be dropped, already preserved' },
        { id: 'ecosystem',       query: 'ecosystem comparison' },
      ],
      per_branch_budget: 3,
      perturbation_weights: {},
      milestone_plan: [0.25, 0.5, 0.75, 1.0],
    }));

    // After 2 cycles, branches[0..1] are finalized → preserve them.
    const next = await rePlanSchedule(
      sqlite, loop.id, loop.prompt, llm,
      SEED_PRIOR, priorArtifact.id, 2,
    );
    expect(next).not.toBeNull();
    if (!next) return;

    // Preserved prefix is byte-identical to prior.
    expect(next.plan.branches[0]).toEqual(SEED_PRIOR.plan.branches[0]);
    expect(next.plan.branches[1]).toEqual(SEED_PRIOR.plan.branches[1]);
    // Planner's stale react-overview suggestion gets dropped (id collision).
    // `ecosystem` lands at index 2 since `comparison` from prior wasn't preserved.
    const tailIds = next.plan.branches.slice(2).map(b => b.id);
    expect(tailIds).toEqual(['ecosystem']);
  });

  test('writes predecessor_id linking to the prior artifact', async () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const priorArtifact = createArtifact(sqlite, {
      loop_id: loop.id, cycle_id: null, kind: 'schedule',
      payload: SEED_PRIOR as unknown as Record<string, unknown>,
    });

    const llm = llmReturning(JSON.stringify({
      canon: ['x'],
      branches: [{ id: 'main', query: 'q' }],
      per_branch_budget: 1,
      perturbation_weights: {},
      milestone_plan: [0.5],
    }));

    const next = await rePlanSchedule(sqlite, loop.id, loop.prompt, llm, SEED_PRIOR, priorArtifact.id, 0);
    expect(next?.predecessor_id).toBe(priorArtifact.id);
  });

  test('preserves prior envelope, models, flags, created_with_mode', async () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const prior: SchedulePayload = {
      ...SEED_PRIOR,
      models: { iteration_check: 'cheap-model', post_mortem: 'premium-model' },
      flags: { fake_llm: true },
    };
    const priorArtifact = createArtifact(sqlite, {
      loop_id: loop.id, cycle_id: null, kind: 'schedule',
      payload: prior as unknown as Record<string, unknown>,
    });

    const llm = llmReturning(JSON.stringify({
      branches: [{ id: 'main', query: 'q' }],
    }));

    const next = await rePlanSchedule(sqlite, loop.id, loop.prompt, llm, prior, priorArtifact.id, 0);
    expect(next?.envelope).toEqual(prior.envelope);
    expect(next?.models).toEqual(prior.models);
    expect(next?.flags).toEqual(prior.flags);
    expect(next?.created_with_mode).toBe('default');
  });

  test('readScheduleFromArtifacts returns the latest by created_at after re-plan', async () => {
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'p' });
    const priorArtifact = createArtifact(sqlite, {
      loop_id: loop.id, cycle_id: null, kind: 'schedule',
      payload: SEED_PRIOR as unknown as Record<string, unknown>,
    });

    // Small delay so created_at strictly advances (SQLite datetime is
    // second-precision, but the test uses the comparison on equal-valued
    // strings via ROWID via the artifact-list order).
    await new Promise(r => setTimeout(r, 1100));

    const llm = llmReturning(JSON.stringify({
      branches: [{ id: 'new-tail', query: 'rephrase' }],
    }));
    await rePlanSchedule(sqlite, loop.id, loop.prompt, llm, SEED_PRIOR, priorArtifact.id, 0);

    const all = listArtifacts(sqlite, loop.id);
    const latest = readScheduleFromArtifacts(all);
    expect(latest).not.toBeNull();
    expect(latest?.predecessor_id).toBe(priorArtifact.id);
    expect(latest?.plan.branches[0]?.id).toBe('new-tail');
  });

  test('planner LLM failure → planLoop fallback runs; re-plan still writes (degraded) artifact', async () => {
    // planLoop is total — it swallows LLM errors and returns a fallback plan
    // (single branch on the prompt). The fallback's id collides with the
    // preserved prefix's `main` branch if there is one; here we have no
    // preserved branches, so the fallback lands as a tail.
    const loop = createLoop(sqlite, { template_id: 'research', prompt: 'fallback-query' });
    const priorArtifact = createArtifact(sqlite, {
      loop_id: loop.id, cycle_id: null, kind: 'schedule',
      payload: SEED_PRIOR as unknown as Record<string, unknown>,
    });

    const llm = new FakeLLMProvider({
      complete: () => { throw new Error('upstream unavailable'); },
    });

    const next = await rePlanSchedule(sqlite, loop.id, loop.prompt, llm, SEED_PRIOR, priorArtifact.id, 0);
    // No preserved prefix + planner fallback = one branch on the prompt.
    expect(next.plan.branches).toEqual([{ id: 'main', query: 'fallback-query' }]);
    expect(next.predecessor_id).toBe(priorArtifact.id);
    expect(listArtifacts(sqlite, loop.id, 'schedule')).toHaveLength(2);
  });
});
