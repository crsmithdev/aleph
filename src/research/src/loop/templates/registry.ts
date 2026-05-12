/**
 * Template registry — single map from `template_id` to factory. Both the API
 * (kicking off a loop) and the child entry point (`run.ts`) resolve here so
 * the two processes can't diverge on which template a given id resolves to.
 *
 * Overrides (e.g. `processor_delay_ms` for kill-and-resume tests) are passed
 * to the factory but NOT persisted — the API supervisor passes them through
 * once at spawn time. A respawn after a crash uses defaults; the engine's
 * ledger is what makes the loop's outputs deterministic, not the template
 * config, so the run still completes correctly.
 *
 * Phase 2 lands `research` and `monitor`.
 */
import type { Template } from '../types.js';
import { makeNoopTemplate } from './noop.js';

export interface TemplateOverrides {
  cycles_target?: number;
  processor_delay_ms?: number;
}

export function buildTemplate(
  template_id: string,
  _prompt: string,
  overrides: TemplateOverrides = {},
): Template | null {
  if (template_id === 'noop') {
    return makeNoopTemplate({
      cycles_target: overrides.cycles_target,
      processor_delay_ms: overrides.processor_delay_ms,
    });
  }
  return null;
}

export function listTemplateIds(): string[] {
  return ['noop'];
}
