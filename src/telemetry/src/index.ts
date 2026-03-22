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
  ProjectBucket,
  HourBucket,
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
} from "./types.js";

export { parseAllSessions, parseSessionsForDays, clearCache } from "./parser.js";
export { calculateCost, getKnownModels } from "./pricing.js";
export {
  aggregateOverview,
  aggregateTools,
  aggregateHooks,
  aggregateSkills,
  aggregateTokens,
  aggregateCost,
  aggregateSessions,
  aggregateToolDetail,
  aggregateHookDetail,
  aggregateSkillDetail,
  aggregateMemoryUsage,
  aggregateHookEvents,
  getRecentEvents,
} from "./aggregator.js";

import { parseSessionsForDays } from "./parser.js";
import {
  aggregateOverview,
  aggregateTools,
  aggregateHooks,
  aggregateSkills,
  aggregateCost,
} from "./aggregator.js";
import type { StatusSummary } from "./types.js";

export function getStatus(days = 7): StatusSummary {
  const entries = parseSessionsForDays(days);
  const overview = aggregateOverview(entries);
  const tools = aggregateTools(entries);
  const hooks = aggregateHooks(entries);
  const skills = aggregateSkills(entries);
  const cost = aggregateCost(entries);

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
