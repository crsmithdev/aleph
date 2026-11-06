// Source: https://claude.com/pricing (read 2026-10-27)
import { expect, test } from "bun:test";
import { costDetails } from "./pricing.ts";

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

test("gpt-oss-20b costs nothing", () => {
  expect(costDetails("gpt-oss-20b", { input: 1000, output: 500, cache_read_input_tokens: 200 })?.total).toBe(0);
});
