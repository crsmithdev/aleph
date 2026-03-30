import { describe, it, expect, beforeEach } from "bun:test";
import { resolve, join } from "path";
import { mkdirSync, copyFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { parseAllSessions, clearCache } from "../src/parser.js";
import {
  aggregateOverview,
  aggregateTools,
  aggregateHooks,
  aggregateSkills,
  aggregateTokens,
  aggregateCost,
  aggregateSessions,
} from "../src/aggregator.js";
import type { SessionEntry } from "../src/types.js";

const fixturesDir = resolve(import.meta.dir, "../fixtures");

function setupFixtureDir(): string {
  const base = join(tmpdir(), `telemetry-agg-${Date.now()}`);
  const projDir = join(base, "-home-user-project");
  mkdirSync(projDir, { recursive: true });
  copyFileSync(
    join(fixturesDir, "test-session.jsonl"),
    join(projDir, "sess-001.jsonl"),
  );
  return base;
}

describe("aggregator", () => {
  let entries: SessionEntry[];

  beforeEach(() => {
    clearCache();
    const baseDir = setupFixtureDir();
    entries = parseAllSessions({ baseDir });
  });

  describe("aggregateOverview", () => {
    it("counts sessions, messages, and tool calls", () => {
      const overview = aggregateOverview(entries);
      expect(overview.sessions).toBe(3);
      expect(overview.messages).toBeGreaterThan(0);
      expect(overview.toolCalls).toBeGreaterThan(0);
    });

    it("calculates cost > 0", () => {
      const overview = aggregateOverview(entries);
      expect(overview.totalCost).toBeGreaterThan(0);
    });

    it("produces sorted daily buckets", () => {
      const overview = aggregateOverview(entries);
      expect(overview.byDay.length).toBeGreaterThan(0);
      for (let i = 1; i < overview.byDay.length; i++) {
        expect(overview.byDay[i].date >= overview.byDay[i - 1].date).toBe(true);
      }
    });
  });

  describe("aggregateTools", () => {
    it("ranks tools by frequency", () => {
      const tools = aggregateTools(entries);
      expect(tools.ranked.length).toBeGreaterThan(0);
      // Read appears multiple times, should be near top
      const readTool = tools.ranked.find((t) => t.name === "Read");
      expect(readTool).toBeDefined();
      expect(readTool!.count).toBeGreaterThanOrEqual(2);
    });

    it("percentages sum to ~100", () => {
      const tools = aggregateTools(entries);
      const totalPct = tools.ranked.reduce((s, t) => s + t.pct, 0);
      expect(Math.abs(totalPct - 100)).toBeLessThan(1);
    });

    it("produces daily tool breakdown", () => {
      const tools = aggregateTools(entries);
      expect(tools.byDay.length).toBeGreaterThan(0);
    });
  });

  describe("aggregateHooks", () => {
    it("extracts hook metrics with durations", () => {
      const hooks = aggregateHooks(entries);
      expect(hooks.ranked.length).toBeGreaterThan(0);
      const formatHook = hooks.ranked.find((h) =>
        h.command.includes("routing-submit-classify"),
      );
      expect(formatHook).toBeDefined();
      expect(formatHook!.count).toBeGreaterThanOrEqual(1);
      expect(formatHook!.p50Ms).toBeGreaterThan(0);
    });

    it("calculates p50 and p95", () => {
      const hooks = aggregateHooks(entries);
      for (const h of hooks.ranked) {
        expect(h.p95Ms).toBeGreaterThanOrEqual(h.p50Ms);
      }
    });
  });

  describe("aggregateSkills", () => {
    it("detects skills from Skill tool uses", () => {
      const skills = aggregateSkills(entries);
      expect(skills.ranked.length).toBe(2);
      expect(skills.ranked.some((s) => s.skill === "commit")).toBe(true);
      expect(skills.ranked.some((s) => s.skill === "code-review")).toBe(true);
    });
  });

  describe("aggregateTokens", () => {
    it("aggregates tokens by day", () => {
      const tokens = aggregateTokens(entries);
      expect(tokens.byDay.length).toBeGreaterThan(0);

      const total = tokens.byDay.reduce((s, d) => s + d.input + d.output, 0);
      expect(total).toBeGreaterThan(0);
    });
  });

  describe("aggregateCost", () => {
    it("calculates total cost", () => {
      const cost = aggregateCost(entries);
      expect(cost.totalUsd).toBeGreaterThan(0);
    });

    it("breaks down cost by model", () => {
      const cost = aggregateCost(entries);
      expect(cost.byModel.length).toBeGreaterThan(0);
      // Should have both sonnet and opus
      expect(cost.byModel.some((m) => m.model.includes("sonnet"))).toBe(true);
      expect(cost.byModel.some((m) => m.model.includes("opus"))).toBe(true);
    });

    it("model percentages sum to ~100", () => {
      const cost = aggregateCost(entries);
      const totalPct = cost.byModel.reduce((s, m) => s + m.pct, 0);
      expect(Math.abs(totalPct - 100)).toBeLessThan(1);
    });

    it("daily costs sum to total", () => {
      const cost = aggregateCost(entries);
      const dailySum = cost.byDay.reduce((s, d) => s + d.usd, 0);
      expect(Math.abs(dailySum - cost.totalUsd)).toBeLessThan(0.001);
    });
  });

  describe("aggregateSessions", () => {
    it("counts sessions by day", () => {
      const sessions = aggregateSessions(entries);
      expect(sessions.byDay.length).toBeGreaterThan(0);
      const totalSessions = sessions.byDay.reduce((s, d) => s + d.sessions, 0);
      expect(totalSessions).toBeGreaterThanOrEqual(3);
    });

    it("counts sessions by project", () => {
      const sessions = aggregateSessions(entries);
      expect(sessions.byProject.length).toBeGreaterThan(0);
    });

    it("counts by activity bucket", () => {
      const sessions = aggregateSessions(entries);
      expect(sessions.byActivity.length).toBeGreaterThan(0);
    });
  });

  describe("empty input", () => {
    it("handles empty entries array", () => {
      const overview = aggregateOverview([]);
      expect(overview.sessions).toBe(0);
      expect(overview.totalCost).toBe(0);
      expect(overview.byDay.length).toBe(0);

      const tools = aggregateTools([]);
      expect(tools.ranked.length).toBe(0);

      const hooks = aggregateHooks([]);
      expect(hooks.ranked.length).toBe(0);
    });
  });
});
