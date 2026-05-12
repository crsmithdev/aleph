/**
 * Noop template — the smoke-test template that proves the engine plumbing
 * works without any real LLM / search / extraction. Used by Phase 1 acceptance
 * + CI smoke tests + the Dev mode preset.
 *
 * Runs `cycles_target` cycles (default 5), producing canned outputs each cycle.
 * stop_rule fires once that many cycle_output artifacts exist. `processor_delay_ms`
 * lets tests slow the run down enough to reliably kill the child mid-cycle.
 */

import type { Template } from '../types.js';

export function makeNoopTemplate(
  opts: { cycles_target?: number; processor_delay_ms?: number } = {},
): Template {
  const target = opts.cycles_target ?? 5;
  const delay = opts.processor_delay_ms ?? 0;

  return {
    id: 'noop',

    async processor(input, _state) {
      const i = (input as { cycle_index: number }).cycle_index;
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      return { kind: 'noop_proc', cycle: i, fact: `fact ${i}` };
    },

    async derivation(_state, processor_output) {
      const proc = processor_output as { cycle: number; fact: string };
      return { kind: 'noop_deriv', from_cycle: proc.cycle, next_query: `query for cycle ${proc.cycle + 1}` };
    },

    async renderer(state) {
      const facts = state.artifacts
        .filter(a => a.kind === 'cycle_output')
        .map(a => ((a.payload.processor as { fact: string } | undefined)?.fact ?? ''));
      return { kind: 'noop_render', facts_so_far: facts, count: facts.length };
    },

    async stop_rule(state) {
      const completed = state.artifacts.filter(a => a.kind === 'cycle_output').length;
      if (completed >= target) {
        return { done: true, reason: `noop_target_reached:${target}` };
      }
      return { done: false };
    },
  };
}
