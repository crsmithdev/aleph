/**
 * Loop engine — the v1 dispatcher.
 *
 * Drives a single loop to completion by:
 *  1. Reading state (loop + cycles + artifacts + envelope).
 *  2. Stopping if envelope exhausted.
 *  3. Finding an in-progress cycle (resume) or creating a new one.
 *  4. Calling the template's four hooks (processor, derivation, renderer) via
 *     the ledger-cached `runOnce` — so a killed run resumes without redoing work.
 *  5. Bumping the loop's envelope usage and firing milestone hooks at 25/50/75 %.
 *  6. Calling `template.stop_rule(state)` (fresh, NOT ledger-cached — stop is
 *     policy, not deterministic plumbing).
 *
 * One process drives one loop. Concurrency *within* a loop (mapWithConcurrency
 * over derivation outputs) is a Phase-2 concern when real templates need it;
 * the noop template is purely sequential.
 *
 * Crash resume is enforced by the cycle_ledger PRIMARY KEY (loop_id, cycle_id,
 * step, input_hash). When a killed process restarts, each step's `runOnce`
 * call finds its cached entry and returns it without re-executing.
 */

import type { Sqlite } from '@construct/data';
import { crossedThresholds, exhaustedLimit } from './envelope.js';
import { runOnce } from './ledger.js';
import {
  bumpUsage, createArtifact, createCycle, createMilestone, findInProgressCycle,
  listCycles, markCycleFinalized, markCycleRunning, readState, updateLoopStatus,
} from './db.js';
import type { Cycle, LoopId, LoopState, StopDecision, Template } from './types.js';

export interface LoopRunResult {
  status: 'completed' | 'envelope_exhausted';
  reason: string;
  cycles_run: number;
  milestones_fired: Array<25 | 50 | 75>;
}

/**
 * Drive a loop to completion. Idempotent on the cycle-ledger key, so calling
 * this twice on the same loop after a crash mid-cycle replays the cached
 * steps and continues.
 */
export async function runLoop(
  sqlite: Sqlite,
  template: Template,
  loop_id: LoopId,
  options: { max_iterations?: number } = {},
): Promise<LoopRunResult> {
  const maxIter = options.max_iterations ?? 1000; // safety belt; envelope/stop_rule should fire first
  const milestonesFired = new Set<25 | 50 | 75>();
  let cyclesRun = 0;

  // Idempotency: re-entering a terminal loop is a no-op. Important for crash
  // resume — supervisor may re-spawn after a clean completion.
  const initial = readState(sqlite, loop_id).loop;
  if (initial.status === 'completed' || initial.status === 'failed' || initial.status === 'cancelled') {
    return { status: 'completed', reason: `already_${initial.status}`, cycles_run: 0, milestones_fired: [] };
  }

  updateLoopStatus(sqlite, loop_id, 'running');

  for (let iter = 0; iter < maxIter; iter++) {
    const state = readState(sqlite, loop_id);

    // Envelope check first — cheapest terminal condition.
    const limit = exhaustedLimit(state.loop.envelope, state.envelope_consumed);
    if (limit) {
      updateLoopStatus(sqlite, loop_id, 'completed');
      return {
        status: 'envelope_exhausted',
        reason: `envelope:${limit}`,
        cycles_run: cyclesRun,
        milestones_fired: [...milestonesFired],
      };
    }

    // Find an in-progress cycle (resume case) or create a new one.
    let cycle = findInProgressCycle(sqlite, loop_id);
    if (!cycle) {
      const nextIdx = listCycles(sqlite, loop_id).length;
      cycle = createCycle(sqlite, { loop_id, idx: nextIdx });
    }

    const usageBefore = state.envelope_consumed;
    await runCycle(sqlite, template, state, cycle);
    cyclesRun++;
    const usageAfter = bumpUsage(sqlite, loop_id, { cycles_count: 1 });

    // Milestone hooks: fire each threshold at-most-once.
    for (const pct of crossedThresholds(state.loop.envelope, usageBefore, usageAfter)) {
      if (milestonesFired.has(pct)) continue;
      const milestoneState = readState(sqlite, loop_id);
      const summary = await template.renderer(milestoneState);
      const artifact = createArtifact(sqlite, {
        loop_id,
        cycle_id: cycle.id,
        kind: 'milestone',
        payload: { at_envelope_pct: pct, summary: summary as unknown },
      });
      createMilestone(sqlite, { loop_id, at_envelope_pct: pct, artifact_id: artifact.id });
      milestonesFired.add(pct);
    }

    // Stop rule — policy, runs fresh every iteration.
    const newState = readState(sqlite, loop_id);
    const decision: StopDecision = await template.stop_rule(newState);
    if (decision.done) {
      updateLoopStatus(sqlite, loop_id, 'completed');
      return {
        status: 'completed',
        reason: decision.reason ?? 'stop_rule',
        cycles_run: cyclesRun,
        milestones_fired: [...milestonesFired],
      };
    }
  }

  // Safety belt tripped — shouldn't happen if stop_rule / envelope are well-formed.
  updateLoopStatus(sqlite, loop_id, 'failed');
  throw new Error(`runLoop ${loop_id}: max_iterations (${maxIter}) reached without stop_rule`);
}

/**
 * Run one cycle's three deterministic steps via the ledger. stop_rule is NOT
 * here — it's policy and runs fresh after the cycle finalizes.
 */
async function runCycle(
  sqlite: Sqlite,
  template: Template,
  state: LoopState,
  cycle: Cycle,
): Promise<void> {
  markCycleRunning(sqlite, cycle.id);

  const procInput = { cycle_index: cycle.index, prompt: state.loop.prompt };
  const proc = await runOnce(
    sqlite,
    { loop_id: cycle.loop_id, cycle_id: cycle.id, step: 'processor', input: procInput },
    async () => ({ output: await template.processor(procInput, state), cost_usd: 0 }),
  );

  const stateAfterProc = readState(sqlite, cycle.loop_id);
  const deriv = await runOnce(
    sqlite,
    { loop_id: cycle.loop_id, cycle_id: cycle.id, step: 'derivation', input: { processor_output: proc.output } },
    async () => ({ output: await template.derivation(stateAfterProc, proc.output), cost_usd: 0 }),
  );

  const stateAfterDeriv = readState(sqlite, cycle.loop_id);
  const render = await runOnce(
    sqlite,
    { loop_id: cycle.loop_id, cycle_id: cycle.id, step: 'renderer', input: { cycle_index: cycle.index } },
    async () => ({ output: await template.renderer(stateAfterDeriv), cost_usd: 0 }),
  );

  // Cycle output stored as an artifact for the template's record.
  createArtifact(sqlite, {
    loop_id: cycle.loop_id,
    cycle_id: cycle.id,
    kind: 'cycle_output',
    payload: { processor: proc.output as unknown, derivation: deriv.output as unknown, render: render.output as unknown },
  });

  markCycleFinalized(sqlite, cycle.id);
}
