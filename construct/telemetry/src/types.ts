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
    | "tokens";
  toolName?: string;
  skillName?: string;
  isError?: boolean;
  hookEvent?: string;
  hookName?: string;
  hookCommand?: string;
  hookDurationMs?: number;
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

export interface ToolMetric {
  name: string;
  count: number;
  errorCount: number;
  pct: number;
}

export interface HookMetric {
  command: string;
  event: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  errors: number;
}

export interface SkillMetric {
  skill: string;
  count: number;
  pct: number;
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
  totalCost: number;
  byDay: SessionBucket[];
}

export interface ToolsData {
  ranked: ToolMetric[];
  byDay: (TimeBucket & { tools: Record<string, number> })[];
}

export interface HooksData {
  ranked: HookMetric[];
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
  invocations: { timestamp: string; sessionId: string; project: string }[];
}

export interface HookDetailData {
  command: string;
  event: string;
  totalCount: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  errors: number;
  byDay: { date: string; count: number; avgMs: number }[];
  invocations: { timestamp: string; sessionId: string; durationMs: number }[];
}

export interface MemoryUsageData {
  stores: number;
  searches: number;
  byDay: { date: string; stores: number; searches: number }[];
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
