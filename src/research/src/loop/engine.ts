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
  getCycle, getLoop, listCycles, markCycleFinalized, markCycleRunning, readState,
  updateLoopStatus,
} from './db.js';
import { emitResearchEvent } from '../services/events.js';
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
  emitLoop(sqlite, loop_id);

  for (let iter = 0; iter < maxIter; iter++) {
    const state = readState(sqlite, loop_id);

    // Envelope check first — cheapest terminal condition.
    const limit = exhaustedLimit(state.loop.envelope, state.envelope_consumed);
    if (limit) {
      updateLoopStatus(sqlite, loop_id, 'completed');
      const reason = `envelope:${limit}`;
      emitLoop(sqlite, loop_id, { terminal: { status: 'envelope_exhausted', reason, cycles_run: cyclesRun, milestones_fired: [...milestonesFired] } });
      return {
        status: 'envelope_exhausted',
        reason,
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
      const milestone = createMilestone(sqlite, { loop_id, at_envelope_pct: pct, artifact_id: artifact.id });
      milestonesFired.add(pct);
      emitResearchEvent(loop_id, 'milestone', {
        id: milestone.id,
        loop_id,
        cycle_id: cycle.id,
        at_envelope_pct: pct,
        artifact_id: artifact.id,
      });
    }

    // Stop rule — policy, runs fresh every iteration.
    const newState = readState(sqlite, loop_id);
    const decision: StopDecision = await template.stop_rule(newState);
    if (decision.done) {
      updateLoopStatus(sqlite, loop_id, 'completed');
      const reason = decision.reason ?? 'stop_rule';
      emitLoop(sqlite, loop_id, { terminal: { status: 'completed', reason, cycles_run: cyclesRun, milestones_fired: [...milestonesFired] } });
      return {
        status: 'completed',
        reason,
        cycles_run: cyclesRun,
        milestones_fired: [...milestonesFired],
      };
    }
  }

  // Safety belt tripped — shouldn't happen if stop_rule / envelope are well-formed.
  updateLoopStatus(sqlite, loop_id, 'failed');
  emitLoop(sqlite, loop_id, { terminal: { status: 'failed', reason: `max_iterations:${maxIter}`, cycles_run: cyclesRun, milestones_fired: [...milestonesFired] } });
  throw new Error(`runLoop ${loop_id}: max_iterations (${maxIter}) reached without stop_rule`);
}

/**
 * Emit a `loop` event reflecting current DB state plus optional terminal
 * summary. Subscribers (research-logger → NDJSON + SSE) treat these as the
 * authoritative loop status timeline.
 */
function emitLoop(
  sqlite: Sqlite,
  loop_id: LoopId,
  extra?: { terminal?: { status: 'completed' | 'envelope_exhausted' | 'failed'; reason: string; cycles_run: number; milestones_fired: Array<25 | 50 | 75> } },
): void {
  const loop = getLoop(sqlite, loop_id);
  if (!loop) return;
  emitResearchEvent(loop_id, 'loop', {
    id: loop.id,
    template_id: loop.template_id,
    status: loop.status,
    envelope: loop.envelope,
    envelope_consumed: loop.envelope_consumed,
    updated_at: loop.updated_at,
    ...extra?.terminal,
  });
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
  emitCycle(sqlite, cycle.id);

  const procInput = { cycle_index: cycle.index, prompt: state.loop.prompt };
  const proc = await runOnce(
    sqlite,
    { loop_id: cycle.loop_id, cycle_id: cycle.id, step: 'processor', input: procInput },
    async () => ({ output: await template.processor(procInput, state), cost_usd: 0 }),
  );
  emitResearchEvent(cycle.loop_id, 'cycle_step', {
    loop_id: cycle.loop_id, cycle_id: cycle.id, cycle_index: cycle.index,
    step: 'processor', cached: proc.cached, cost_usd: proc.cost_usd,
  });

  const stateAfterProc = readState(sqlite, cycle.loop_id);
  const deriv = await runOnce(
    sqlite,
    { loop_id: cycle.loop_id, cycle_id: cycle.id, step: 'derivation', input: { processor_output: proc.output } },
    async () => ({ output: await template.derivation(stateAfterProc, proc.output), cost_usd: 0 }),
  );
  emitResearchEvent(cycle.loop_id, 'cycle_step', {
    loop_id: cycle.loop_id, cycle_id: cycle.id, cycle_index: cycle.index,
    step: 'derivation', cached: deriv.cached, cost_usd: deriv.cost_usd,
  });

  const stateAfterDeriv = readState(sqlite, cycle.loop_id);
  const render = await runOnce(
    sqlite,
    { loop_id: cycle.loop_id, cycle_id: cycle.id, step: 'renderer', input: { cycle_index: cycle.index } },
    async () => ({ output: await template.renderer(stateAfterDeriv), cost_usd: 0 }),
  );
  emitResearchEvent(cycle.loop_id, 'cycle_step', {
    loop_id: cycle.loop_id, cycle_id: cycle.id, cycle_index: cycle.index,
    step: 'renderer', cached: render.cached, cost_usd: render.cost_usd,
  });

  // Cycle output stored as an artifact for the template's record.
  createArtifact(sqlite, {
    loop_id: cycle.loop_id,
    cycle_id: cycle.id,
    kind: 'cycle_output',
    payload: { processor: proc.output as unknown, derivation: deriv.output as unknown, render: render.output as unknown },
  });

  markCycleFinalized(sqlite, cycle.id);
  emitCycle(sqlite, cycle.id);
}

function emitCycle(sqlite: Sqlite, cycle_id: string): void {
  const cycle = getCycle(sqlite, cycle_id);
  if (!cycle) return;
  emitResearchEvent(cycle.loop_id, 'cycle', {
    id: cycle.id,
    loop_id: cycle.loop_id,
    index: cycle.index,
    priority: cycle.priority,
    status: cycle.status,
    started_at: cycle.started_at,
    finalized_at: cycle.finalized_at,
  });
}
