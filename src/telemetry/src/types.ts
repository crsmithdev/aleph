export interface SessionEntry {
  sessionId: string;
  timestamp: string;
  project: string;
  model?: string;
  entryType:
    | "tool_use"
    | "tool_result"
    | "hook_progress"
    | "stop_hook_summary"
    | "turn_duration"
    | "tokens"
    | "user_message";
  toolName?: string;
  toolParams?: Record<string, unknown>;
  skillName?: string;
  isError?: boolean;
  errorMessage?: string;
  toolUseId?: string;
  hookEvent?: string;
  hookName?: string;
  hookCommand?: string;
  hookDurationMs?: number;
  hookExitCode?: number;
  hookOutput?: string;
  userRequest?: string;
  turnDurationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

export interface ParseOptions {
  since?: Date;
  projects?: string[];
  baseDir?: string;
}

export type Granularity = "minute" | "hour" | "day";

export interface ToolMetric {
  name: string;
  count: number;
  errorCount: number;
  pct: number;
  active?: boolean;
  lastUsed?: string;
}

export interface HookMetric {
  command: string;
  event: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  errors: number;
  active?: boolean;
  fullCommand?: string;
}

export interface SkillMetric {
  skill: string;
  count: number;
  pct: number;
  errors: number;
  lastUsed?: string;
}

export interface TimeBucket {
  date: string;
  count: number;
}

export interface TokenBucket {
  date: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
}

export interface CostBucket {
  date: string;
  usd: number;
}

export interface ModelCost {
  model: string;
  usd: number;
  pct: number;
}

export interface SessionBucket {
  date: string;
  sessions: number;
  messages: number;
}

export interface ProjectBucket {
  project: string;
  sessions: number;
}

export interface HourBucket {
  hour: number;
  count: number;
}

export interface OverviewData {
  sessions: number;
  messages: number;
  toolCalls: number;
  toolErrors: number;
  hookErrors: number;
  totalCost: number;
  byDay: SessionBucket[];
}

export interface ToolsData {
  ranked: ToolMetric[];
  byDay: (TimeBucket & { tools: Record<string, number> })[];
}

export interface HooksData {
  ranked: HookMetric[];
  byDay: (TimeBucket & { hooks: Record<string, number> })[];
}

export interface SkillsData {
  ranked: SkillMetric[];
  byDay: (TimeBucket & { skills: Record<string, number> })[];
}

export interface TokensData {
  byDay: TokenBucket[];
}

export interface CostData {
  totalUsd: number;
  byDay: CostBucket[];
  byModel: ModelCost[];
}

export interface SessionsData {
  byDay: SessionBucket[];
  byProject: ProjectBucket[];
  byHour: HourBucket[];
}

export interface ToolDetailData {
  name: string;
  totalCount: number;
  errorCount: number;
  byDay: (TimeBucket & { byHour: Record<number, number> })[];
  invocations: { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; isError?: boolean; errorMessage?: string }[];
}

export interface HookDetailData {
  command: string;
  event: string;
  totalCount: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  errors: number;
  fullCommand?: string;
  byDay: { date: string; count: number; avgMs: number }[];
  invocations: { timestamp: string; sessionId: string; durationMs: number; exitCode?: number; output?: string; trigger?: string; isError?: boolean; errorMessage?: string }[];
}

export interface SkillDetailData {
  skill: string;
  totalCount: number;
  errorCount: number;
  byDay: TimeBucket[];
  invocations: { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; userRequest?: string }[];
}

export interface MemoryUsageData {
  stores: number;
  searches: number;
  byDay: { date: string; stores: number; searches: number }[];
}

export interface HookInvocation {
  timestamp: string;
  sessionId: string;
  event: string;
  hooks: Array<{ command: string; durationMs?: number; exitCode?: number; output?: string }>;
}

export interface HookEventSummary {
  event: string;
  count: number;
  hooks: string[];
}

export interface HookEventData {
  events: HookEventSummary[];
  invocations: HookInvocation[];
  queryTimeMs?: number;
}

export interface StatusSummary {
  sessions: number;
  messages: number;
  toolCalls: number;
  totalCostUsd: number;
  topTools: ToolMetric[];
  topHooks: HookMetric[];
  topSkills: SkillMetric[];
}
