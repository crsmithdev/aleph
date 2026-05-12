/**
 * Cost-tracking proxy for LLMProvider.
 *
 * Wraps an LLMProvider so each call's `cost_usd` (computed by the provider
 * from token counts × model pricing) is accumulated into a running total.
 * Callers that have access to (sqlite, loop_id) then bump the loop's
 * envelope_consumed.cost_usd once at the end — keeping the per-call cost
 * source-of-truth in the provider while letting helpers like
 * `ensureScheduleArtifact` and `generateDocument` charge their LLM spend to
 * the envelope without changing every helper's return signature.
 *
 * Templates don't need this — they return cost_usd directly via HookResult,
 * which the engine sums into bumpUsage at end-of-cycle. This proxy exists
 * only for the LLM calls that happen outside the four-hook contract
 * (schedule detection, planner, document polish).
 */
import type { LLMProvider, LLMResult, SearchOptions, WebSearchResult } from './llm.js';

export interface CostTracker {
  /** The wrapped provider — pass this everywhere the original was used. */
  llm: LLMProvider;
  /** Accumulated USD cost across every call made through `llm`. */
  total: () => number;
}

export function withCostTracker(inner: LLMProvider): CostTracker {
  let total = 0;
  const llm: LLMProvider = {
    async complete(model: string, prompt: string, maxTokens: number, systemPrompt?: string | null): Promise<LLMResult> {
      const result = await inner.complete(model, prompt, maxTokens, systemPrompt);
      total += result.cost_usd;
      return result;
    },
    async searchWeb(model: string, query: string, options?: SearchOptions): Promise<WebSearchResult> {
      const result = await inner.searchWeb(model, query, options);
      total += result.cost_usd;
      return result;
    },
  };
  return { llm, total: () => total };
}
