/**
 * Noop template — the smoke-test template that proves the engine plumbing
 * works without any real LLM / search / extraction. Used by Phase 1 acceptance
 * + CI smoke tests + the Dev mode preset.
 *
 * Runs `cycles_target` cycles (default 5), producing canned outputs each cycle.
 * stop_rule fires once that many cycle_output artifacts exist.
 */

import type { Template } from '../types.js';

export function makeNoopTemplate(opts: { cycles_target?: number } = {}): Template {
  const target = opts.cycles_target ?? 5;

  return {
    id: 'noop',

    async processor(input, _state) {
      const i = (input as { cycle_index: number }).cycle_index;
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
