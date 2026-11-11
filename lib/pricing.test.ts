// Source: https://claude.com/pricing (read 2026-10-27)
import { expect, test } from "bun:test";
import { costDetails, priceFor } from "./pricing.ts";

test("haiku 5.5 tier is per request by prompt size", () => {
  const at = (read: number) => costDetails("claude-haiku-5-5", { input: 40_000, output: 1_000, cache_read_input_tokens: read });
  const low = at(60_000); // prompt exactly 100,000
  expect(low?.input).toBeCloseTo((40_000 * 0.1) / 1e6, 12);
  expect(low?.cache_read_input_tokens).toBeCloseTo((60_000 * 0.01) / 1e6, 12);
  expect(low?.output).toBeCloseTo((1_000 * 0.5) / 1e6, 12);
  const high = at(60_001); // prompt 100,001
  expect(high?.input).toBeCloseTo((40_000 * 0.5) / 1e6, 12);
  expect(high?.cache_read_input_tokens).toBeCloseTo((60_001 * 0.05) / 1e6, 12);
  expect(high?.output).toBeCloseTo((1_000 * 2.5) / 1e6, 12);
});

test("every claude cache write costs twice the input rate", () => {
  const claude = ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5", "claude-fable-5-1", "claude-fable-5", "claude-opus-5", "claude-opus-4-8", "claude-opus-4-7", "claude-opus-4-6", "claude-sonnet-5", "claude-sonnet-4-6", "claude-haiku-4-5"];
  for (const model of claude) {
    const price = priceFor(model)!;
    expect(price.cacheWrite).toBe(price.input * 2);
    if (price.long) expect(price.long.rate.cacheWrite).toBe(price.long.rate.input * 2);
  }
  const write = (model: string) => costDetails(model, { input: 0, output: 0, cache_creation_input_tokens: 1_000_000 })?.cache_creation_input_tokens;
  expect(write("claude-opus-5-5")).toBe(8);
  expect(write("claude-sonnet-4-6")).toBe(6);
});

test("gpt-oss-20b costs nothing", () => {
  expect(costDetails("gpt-oss-20b", { input: 1000, output: 500, cache_read_input_tokens: 200 })?.total).toBe(0);
});
