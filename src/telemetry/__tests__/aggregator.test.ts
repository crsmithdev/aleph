import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { resolve, join } from "path";
import { mkdirSync, copyFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import { adaptAllSessions as parseAllSessions, clearCache, slashDispatchTarget } from "../src/adapter.js";
import {
  reduceOverview as aggregateOverview,
  reduceTools as aggregateTools,
  reduceHooks as aggregateHooks,
  reduceSkills as aggregateSkills,
  reduceTokens as aggregateTokens,
  reduceCost as aggregateCost,
  reduceSessions as aggregateSessions,
  reduceSkillDetail,
} from "../src/reducers.js";
import type { TelemetryEvent } from "../src/event.js";

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
  let entries: TelemetryEvent[];
  let baseDir: string;

  beforeEach(() => {
    clearCache();
    baseDir = setupFixtureDir();
    entries = parseAllSessions({ baseDir, includeEvents: false });
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
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
        h.command.includes("format-reminder"),
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

    it("conversion excludes slash invocations and unregistered skills", () => {
      const ts = "2026-05-20T00:00:00.000Z";
      const ev = (kind: string, data: Record<string, unknown>) => ({ ts, sid: "s1", kind, data } as any);
      const events = [
        ev("directive", { directives: ["skill:plan"] }),
        ev("directive", { directives: ["skill:plan"] }),
        ev("directive", { directives: ["skill:plan"] }),
        ev("tool", { skill: "plan" }),                 // keyword-driven invoke
        ev("tool", { skill: "plan", viaSlash: true }), // mandatory slash invoke
        ev("directive", { directives: ["skill:omnibus"] }), // unregistered/renamed
        ev("directive", { directives: ["skill:omnibus"] }),
        ev("tool", { skill: "omnibus", viaSlash: true }),
      ];
      const skills = aggregateSkills(events, "day", new Set(["plan"]));
      const plan = skills.ranked.find((s) => s.skill === "plan")!;
      const omni = skills.ranked.find((s) => s.skill === "omnibus")!;

      expect(plan.matched).toBe(3);
      expect(plan.count).toBe(2);                       // both invokes counted as usage
      expect(plan.conversionPct).toBeCloseTo(100 / 3);  // 1 keyword invoke / 3 matches
      expect(omni).toBeDefined();                       // dead name still listed
      expect(omni.matched).toBe(2);
      expect(omni.conversionPct).toBeUndefined();       // unregistered → no conversion
      expect(skills.conversionMatched).toBe(3);         // registered matches only
      expect(skills.conversionInvokes).toBe(1);         // registered, non-slash only
    });
  });

  describe("slashDispatchTarget", () => {
    it("names the dispatched skill so cross-skill turns aren't mis-tagged", () => {
      // /audit expands to an omnibus dispatch — names omnibus, not audit
      expect(slashDispatchTarget("Invoke the `omnibus` skill with verb=`audit` and arguments: x", true)).toBe("omnibus");
      expect(slashDispatchTarget("/plan trim the keywords", false)).toBe("plan");
      expect(slashDispatchTarget("write a plan for the reducer", false)).toBeUndefined();
      // a path/prose that isn't a command
      expect(slashDispatchTarget("look at /home/me/file.ts", false)).toBeUndefined();
      // an injected skill body that merely mentions the phrase mid-text is NOT a dispatch
      expect(slashDispatchTarget("# Dogfood\n\nYou should invoke the dogfood skill when…", true)).toBeUndefined();
      // the audit skill invoked during a /audit→omnibus turn must NOT match "audit"
      expect(slashDispatchTarget("Invoke the `omnibus` skill with verb=`audit`", true) === "audit").toBe(false);
    });
  });

  describe("aggregateSkillDetail per-keyword stats", () => {
    it("excludes slash invocations and injected/meta turns", () => {
      const ts = "2026-05-21T00:00:00.000Z";
      const ev = (kind: string, data: Record<string, unknown>) => ({ ts, sid: "s1", kind, data } as any);
      const events = [
        ev("message", { role: "user", text: "write a plan for the reducer" }),
        ev("tool", { skill: "plan", userRequest: "write a plan for the reducer" }), // auto invoke
        ev("message", { role: "user", text: "what's the plan here" }),             // matched, not invoked
        ev("message", { role: "user", text: "Invoke the `plan` skill with verb=x", isMeta: true }), // injected
        ev("tool", { skill: "plan", userRequest: "/plan", viaSlash: true }),        // slash invoke
      ];
      const d = reduceSkillDetail(events, "plan", ["write a plan", "what's the plan", "/plan"]);
      const byKw = Object.fromEntries((d.keywords ?? []).map((k) => [k.keyword, k]));

      expect(byKw["write a plan"].matched).toBe(1);
      expect(byKw["write a plan"].invoked).toBe(1);
      expect(byKw["write a plan"].successPct).toBe(100);
      expect(byKw["what's the plan"].matched).toBe(1);
      expect(byKw["what's the plan"].invoked).toBe(0);   // matched but model didn't invoke
      expect(byKw["what's the plan"].successPct).toBe(0);
      expect(byKw["/plan"].matched).toBe(0);             // isMeta dispatch excluded from matched
      // both invocations are present in the table, slash flagged
      expect(d.invocations.filter((i) => i.viaSlash).length).toBe(1);
      expect(d.invocations.filter((i) => !i.viaSlash).length).toBe(1);
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
