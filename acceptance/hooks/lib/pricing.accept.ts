// Archived goal tests from hooks/lib/pricing.test.ts: `bun run accept` runs them, `bun run test` does not.
// Source: https://claude.com/pricing (read 2026-10-27)
import { expect, test } from "bun:test";
import { costDetails, priceFor } from "../../../hooks/lib/pricing";

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

test("other models keep one rate", () => {
  const c = costDetails("claude-opus-5-5", { input: 200_000, output: 0 });
  expect(c?.input).toBeCloseTo(0.8, 12);
});
