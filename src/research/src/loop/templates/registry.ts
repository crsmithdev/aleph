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
 * `deps` (Phase 2+) carries the LLM provider that template hooks call into.
 * Production code in `run.ts` constructs `OpenRouterProvider` from env;
 * tests pass a `FakeLLMProvider`. The mockable-LLM-boundary principle in
 * `docs/plans/research-system-principles.md` §Verification: all real model
 * calls go through this seam.
 *
 * Phase 2 lands `research`. Phase 2.6 lands `monitor`.
 */
import type { Template } from '../types.js';
import type { LLMProvider } from '../llm.js';
import { makeNoopTemplate } from './noop.js';
import { makeResearchTemplate } from './research.js';

export interface TemplateOverrides {
  cycles_target?: number;
  processor_delay_ms?: number;
  search_model?: string;
  complete_model?: string;
}

export interface TemplateDeps {
  llm?: LLMProvider;
}

export function buildTemplate(
  template_id: string,
  prompt: string,
  overrides: TemplateOverrides = {},
  deps: TemplateDeps = {},
): Template | null {
  if (template_id === 'noop') {
    return makeNoopTemplate({
      cycles_target: overrides.cycles_target,
      processor_delay_ms: overrides.processor_delay_ms,
    });
  }
  if (template_id === 'research') {
    if (!deps.llm) {
      throw new Error('research template requires deps.llm — supply an LLMProvider');
    }
    return makeResearchTemplate(
      prompt,
      {
        cycles_target: overrides.cycles_target,
        search_model: overrides.search_model,
        complete_model: overrides.complete_model,
      },
      { llm: deps.llm },
    ) as Template;
  }
  return null;
}

export function listTemplateIds(): string[] {
  return ['noop', 'research'];
}
