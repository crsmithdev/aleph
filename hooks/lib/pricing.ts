/**
 * USD per million tokens, from https://platform.claude.com/docs/en/about-claude/pricing
 * (read 2026-09-03); the three 5.5 models from https://claude.com/pricing (read 2026-10-27).
 * These are API list prices. Chris's runs use the claude.ai subscription, so a
 * cost from this table is an API-equivalent estimate. Where Claude Code reports
 * a cost (`total_cost_usd` in a `claude -p` result), that cost wins; the table
 * is for transcript turns only. Langfuse's public models API keeps only input/output
 * prices, and cache reads are most of a Claude Code request, so the hook
 * prices each generation itself and sends cost_details.
 */
interface Rate { input: number; output: number; cacheRead: number; cacheWrite: number }
/** `long` replaces the base rate for a request whose prompt (input + cache read + cache write) exceeds `above` tokens. */
type Price = Rate & { long?: { above: number; rate: Rate } };
const PER_MILLION: Record<string, Price> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": {
    input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125,
    long: { above: 100_000, rate: { input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 } },
  },
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
  const price = priceFor(model);
  if (!price) return null;
  const prompt = usage.input + (usage.cache_read_input_tokens ?? 0) + (usage.cache_creation_input_tokens ?? 0);
  const p: Rate = price.long && prompt > price.long.above ? price.long.rate : price;
  const cost: Record<string, number> = {
    input: (usage.input * p.input) / 1e6,
    output: (usage.output * p.output) / 1e6,
  };
  if (usage.cache_read_input_tokens) cost.cache_read_input_tokens = (usage.cache_read_input_tokens * p.cacheRead) / 1e6;
  if (usage.cache_creation_input_tokens) cost.cache_creation_input_tokens = (usage.cache_creation_input_tokens * p.cacheWrite) / 1e6;
  cost.total = Object.values(cost).reduce((sum, value) => sum + value, 0);
  return cost;
}
