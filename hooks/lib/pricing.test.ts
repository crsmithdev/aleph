// Source: https://claude.com/pricing (read 2026-10-27)
import { expect, test } from "bun:test";
import { costDetails, priceFor } from "./pricing";

const rate = (p: ReturnType<typeof priceFor>) => p && { input: p.input, output: p.output, cacheRead: p.cacheRead, cacheWrite: p.cacheWrite };

test("5.5 list prices", () => {
  expect(rate(priceFor("claude-opus-5-5"))).toEqual({ input: 4, output: 20, cacheWrite: 5, cacheRead: 0.2 });
  expect(rate(priceFor("claude-sonnet-5-5"))).toEqual({ input: 2, output: 10, cacheWrite: 2.5, cacheRead: 0.1 });
  expect(rate(priceFor("claude-haiku-5-5"))).toEqual({ input: 0.1, output: 0.5, cacheWrite: 0.125, cacheRead: 0.01 });
  expect(rate(priceFor("claude-haiku-5-5-20261001"))).toEqual(rate(priceFor("claude-haiku-5-5")));
  expect(priceFor("claude-haiku-5-5")?.long).toEqual({ above: 100_000, rate: { input: 0.5, output: 2.5, cacheWrite: 0.625, cacheRead: 0.05 } });
});

test("opus-5 and sonnet-5 keep their values", () => {
  expect(priceFor("claude-opus-5")).toEqual({ input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 });
  expect(priceFor("claude-sonnet-5")).toEqual({ input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 });
});

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

test("other models keep one rate", () => {
  const c = costDetails("claude-opus-5-5", { input: 200_000, output: 0 });
  expect(c?.input).toBeCloseTo(0.8, 12);
});
