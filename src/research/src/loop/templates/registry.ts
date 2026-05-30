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
import type { Sqlite } from '@aleph/data';
import type { Template } from '../types.js';
import type { LLMProvider } from '../llm.js';
import { makeNoopTemplate } from './noop.js';
import { makeResearchTemplate } from './research.js';
import { makeMonitorTemplate } from './monitor.js';

export interface TemplateOverrides {
  cycles_target?: number;
  processor_delay_ms?: number;
  search_model?: string;
  complete_model?: string;
  /** Model passed to the research template's optional `iterationCheck` hook.
   *  `run.ts` reads this from `research_defaults.iteration_check_model` and
   *  threads it through at spawn time. */
  iteration_check_model?: string;
  /** Model passed to the research template's optional `postMortem` hook.
   *  `run.ts` reads this from `research_defaults.post_mortem_model` and
   *  threads it through at spawn time. */
  post_mortem_model?: string;
  poll_every?: number;
}

export interface TemplateDeps {
  llm?: LLMProvider;
  /** SQLite handle for templates that persist out-of-band artifacts. The
   *  research template uses it to append to the `decision_log` artifact from
   *  inside its derivation hook (so follow-up picks survive a page reload —
   *  events alone are live-only). Optional: tests that don't care about
   *  persistence omit it; the helper falls back to event-only emission. */
  sqlite?: Sqlite;
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
        iteration_check_model: overrides.iteration_check_model,
        post_mortem_model: overrides.post_mortem_model,
      },
      { llm: deps.llm, sqlite: deps.sqlite },
    ) as Template;
  }
  if (template_id === 'monitor') {
    if (!deps.llm) {
      throw new Error('monitor template requires deps.llm — supply an LLMProvider');
    }
    return makeMonitorTemplate(
      prompt,
      {
        cycles_target: overrides.cycles_target,
        poll_every: overrides.poll_every,
        search_model: overrides.search_model,
      },
      { llm: deps.llm },
    ) as Template;
  }
  return null;
}

export function listTemplateIds(): string[] {
  return ['noop', 'research', 'monitor'];
}
