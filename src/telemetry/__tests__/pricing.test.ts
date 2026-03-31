import { describe, it, expect } from "bun:test";
import { calculateCost } from "../src/pricing.js";

describe("pricing", () => {
  it("calculates sonnet cost correctly", () => {
    // 1M input tokens at $3/M = $3
    const cost = calculateCost("claude-sonnet-4-6", 1_000_000, 0, 0, 0);
    expect(cost).toBeCloseTo(3.0, 4);
  });

  it("calculates opus cost correctly", () => {
    // 1M input at $15/M, 1M output at $75/M = $90
    const cost = calculateCost("claude-opus-4-6", 1_000_000, 1_000_000, 0, 0);
    expect(cost).toBeCloseTo(90.0, 4);
  });

  it("calculates haiku cost correctly", () => {
    // 1M input at $0.8/M = $0.80
    const cost = calculateCost("claude-haiku-4-5-20251001", 1_000_000, 0, 0, 0);
    expect(cost).toBeCloseTo(0.8, 4);
  });

  it("includes cache costs", () => {
    // Cache read: 1M at $0.3/M = $0.30
    // Cache creation: 1M at $3.75/M = $3.75
    const cost = calculateCost("claude-sonnet-4-6", 0, 0, 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(4.05, 4);
  });

  it("returns 0 for unknown model", () => {
    const cost = calculateCost("gpt-4", 1_000_000, 1_000_000, 0, 0);
    expect(cost).toBe(0);
  });

  it("matches model prefixes correctly", () => {
    // Full versioned model ID should match prefix
    const cost1 = calculateCost("claude-sonnet-4-6-20260301", 1_000_000, 0, 0, 0);
    expect(cost1).toBeCloseTo(3.0, 4);

    const cost2 = calculateCost("claude-opus-4-6[1m]", 1_000_000, 0, 0, 0);
    // "claude-opus-4-6" starts with "claude-opus-4" so matches opus pricing
    expect(cost2).toBeCloseTo(15.0, 4);
  });

  it("handles realistic session cost", () => {
    // Typical assistant turn: 2000 input, 500 output, 8000 cache read
    const cost = calculateCost(
      "claude-sonnet-4-6",
      2000,
      500,
      8000,
      0,
    );
    // (2000 * 3 + 500 * 15 + 8000 * 0.3) / 1M = (6000 + 7500 + 2400) / 1M = 0.0159
    expect(cost).toBeCloseTo(0.0159, 4);
  });
});
