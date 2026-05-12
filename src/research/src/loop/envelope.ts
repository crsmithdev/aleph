/**
 * Envelope accounting — multi-stack budget that stops at the first consumed limit.
 *
 * Set any subset of { time, cost, cycles, sources }. Each is independent;
 * the loop halts as soon as any one is exhausted. A loop with an empty
 * envelope (`{}`) runs until its stop_rule says done — useful for tests
 * that aren't budget-driven.
 *
 * Spec: docs/plans/research-engine-build-plan.md §Phase 1, "Envelope."
 */

import type { Envelope, EnvelopeUsage } from './types.js';

export const EMPTY_USAGE: EnvelopeUsage = {
  time_minutes: 0,
  cost_usd: 0,
  cycles_count: 0,
  sources_count: 0,
};

/**
 * Returns the first limit that's been consumed, or null if none are. The
 * engine calls this between cycles and stops the loop when it returns
 * a non-null value.
 */
export function exhaustedLimit(
  envelope: Envelope,
  usage: EnvelopeUsage,
): 'time' | 'cost' | 'cycles' | 'sources' | null {
  if (envelope.time && usage.time_minutes >= envelope.time.minutes) return 'time';
  if (envelope.cost && usage.cost_usd >= envelope.cost.usd) return 'cost';
  if (envelope.cycles && usage.cycles_count >= envelope.cycles.count) return 'cycles';
  if (envelope.sources && usage.sources_count >= envelope.sources.count) return 'sources';
  return null;
}

/**
 * Percent consumed of the most-loaded limit. Used to fire milestone hooks
 * at 25 / 50 / 75 %. Returns 0 when no limits are set.
 */
export function envelopePercent(envelope: Envelope, usage: EnvelopeUsage): number {
  const ratios: number[] = [];
  if (envelope.time) ratios.push(usage.time_minutes / envelope.time.minutes);
  if (envelope.cost) ratios.push(usage.cost_usd / envelope.cost.usd);
  if (envelope.cycles) ratios.push(usage.cycles_count / envelope.cycles.count);
  if (envelope.sources) ratios.push(usage.sources_count / envelope.sources.count);
  if (ratios.length === 0) return 0;
  return Math.max(...ratios) * 100;
}

/**
 * Add to current usage. Returns the new usage (does not mutate the input).
 */
export function consume(usage: EnvelopeUsage, delta: Partial<EnvelopeUsage>): EnvelopeUsage {
  return {
    time_minutes: usage.time_minutes + (delta.time_minutes ?? 0),
    cost_usd: usage.cost_usd + (delta.cost_usd ?? 0),
    cycles_count: usage.cycles_count + (delta.cycles_count ?? 0),
    sources_count: usage.sources_count + (delta.sources_count ?? 0),
  };
}

/**
 * Which milestone thresholds have been crossed by going from `prev` → `next`.
 * Returns the list of percentages crossed in this transition (25, 50, 75).
 * Used by the engine to fire milestone hooks at-most-once per threshold.
 */
export function crossedThresholds(
  envelope: Envelope,
  prev: EnvelopeUsage,
  next: EnvelopeUsage,
): Array<25 | 50 | 75> {
  const prevPct = envelopePercent(envelope, prev);
  const nextPct = envelopePercent(envelope, next);
  const out: Array<25 | 50 | 75> = [];
  for (const t of [25, 50, 75] as const) {
    if (prevPct < t && nextPct >= t) out.push(t);
  }
  return out;
}
