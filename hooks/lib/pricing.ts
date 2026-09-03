/**
 * USD per token, from https://platform.claude.com/docs/en/about-claude/pricing
 * (read 2026-09-03). Langfuse's public models API keeps only input/output
 * prices, and cache reads are most of a Claude Code request, so the hook
 * prices each generation itself and sends cost_details.
 */
const PER_MILLION: Record<string, { input: number; output: number; cacheRead: number; cacheWrite: number }> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25, cacheWrite: 12.5 },
  "claude-fable-5": { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-8": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-7": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-opus-4-6": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-sonnet-4-6": { input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
};

export interface Usage { input: number; output: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number }

/** Longest known prefix wins, so `claude-haiku-4-5-20251001` prices as haiku 4.5. */
export function priceFor(model: string) {
  const key = Object.keys(PER_MILLION).filter((k) => model.startsWith(k)).sort((a, b) => b.length - a.length)[0];
  return key ? PER_MILLION[key] : null;
}

export function costDetails(model: string, usage: Usage): Record<string, number> | null {
  const p = priceFor(model);
  if (!p) return null;
  const cost: Record<string, number> = {
    input: (usage.input * p.input) / 1e6,
    output: (usage.output * p.output) / 1e6,
  };
  if (usage.cache_read_input_tokens) cost.cache_read_input_tokens = (usage.cache_read_input_tokens * p.cacheRead) / 1e6;
  if (usage.cache_creation_input_tokens) cost.cache_creation_input_tokens = (usage.cache_creation_input_tokens * p.cacheWrite) / 1e6;
  cost.total = Object.values(cost).reduce((sum, value) => sum + value, 0);
  return cost;
}
