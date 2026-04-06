/**
 * Telemetry v2 — public API.
 *
 * Facade that maintains the same export surface as v1 but routes through
 * the adapter (Claude Code JSONL → TelemetryEvent[]) and reducers.
 */

// Re-export all output types (unchanged from v1)
export type {
  SessionEntry,
  ParseOptions,
  Granularity,
  ToolMetric,
  HookMetric,
  SkillMetric,
  TimeBucket,
  TokenBucket,
  CostBucket,
  ModelCost,
  SessionBucket,
  SessionMetric,
  ProjectBucket,
  OverviewData,
  ToolsData,
  HooksData,
  SkillsData,
  TokensData,
  CostData,
  SessionsData,
  StatusSummary,
  ToolDetailData,
  HookDetailData,
  SkillDetailData,
  MemoryUsageData,
  HookEventData,
  HookEventSummary,
  HookInvocation,
  CompactionData,
  ApiDurationData,
  TraceData,
  TraceSpan,
  TraceTurn,
  SubagentsData,
  SubagentInvocation,
  SubagentTypeBucket,
  GateInfo,
  VerificationData,
  EvalData,
  EvalResult,
} from "./types.js";

// Re-export new types
export type { TelemetryEvent } from "./event.js";

export { calculateCost } from "./pricing.js";

// Adapter (replaces parser)
export { adaptAllSessions, adaptSessionsForDays, clearCache } from "./adapter.js";

// Backward-compatible aliases
export { adaptAllSessions as parseAllSessions, adaptSessionsForDays as parseSessionsForDays } from "./adapter.js";

// Reducers (replace aggregator) — exported under both old and new names
export {
  reduceOverview as aggregateOverview,
  reduceTools as aggregateTools,
  reduceHooks as aggregateHooks,
  reduceSkills as aggregateSkills,
  reduceTokens as aggregateTokens,
  reduceCost as aggregateCost,
  reduceSessions as aggregateSessions,
  reduceToolDetail as aggregateToolDetail,
  reduceHookDetail as aggregateHookDetail,
  reduceSkillDetail as aggregateSkillDetail,
  reduceMemoryUsage as aggregateMemoryUsage,
  reduceHookEvents as aggregateHookEvents,
  reduceCompaction as aggregateCompaction,
  reduceApiDuration as aggregateApiDuration,
  reduceSessionTrace as aggregateSessionTrace,
  reduceRecentEvents as getRecentEvents,
  reduceSubagents as aggregateSubagents,
  reduceVerifications as aggregateVerifications,
} from "./reducers.js";

// -- getStatus convenience function --

import { adaptSessionsForDays } from "./adapter.js";
import {
  reduceOverview,
  reduceTools,
  reduceHooks,
  reduceSkills,
  reduceCost,
} from "./reducers.js";
import type { StatusSummary } from "./types.js";

export function getStatus(days = 7): StatusSummary {
  const events = adaptSessionsForDays(days);
  const overview = reduceOverview(events);
  const tools = reduceTools(events);
  const hooks = reduceHooks(events);
  const skills = reduceSkills(events);
  const cost = reduceCost(events);

  return {
    sessions: overview.sessions,
    messages: overview.messages,
    toolCalls: overview.toolCalls,
    totalCostUsd: cost.totalUsd,
    topTools: tools.ranked.slice(0, 5),
    topHooks: hooks.ranked.slice(0, 3),
    topSkills: skills.ranked.slice(0, 3),
  };
}
