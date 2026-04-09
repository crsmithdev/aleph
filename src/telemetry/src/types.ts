export interface SessionEntry {
  sessionId: string;
  parentSessionId?: string;
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
    | "user_message"
    | "compact_boundary"
    | "directive";
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
  compactTrigger?: string;
  compactPreTokens?: number;
  role?: "user" | "assistant";
  directive?: string;
  directiveFollowed?: boolean;
  gitBranch?: string;
  cwd?: string;
  linesAdded?: number;
  linesRemoved?: number;
  toolDurationMs?: number;
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
  avgMs?: number;
  p50Ms?: number;
  p95Ms?: number;
  linesAdded?: number;
  linesRemoved?: number;
  sessionCount?: number;
  velocity?: number;
}

export interface CompactionData {
  totalCompactions: number;
  totalTokensAtCompaction: number;
  avgPreTokens: number;
  byDay: TimeBucket[];
  events: Array<{ timestamp: string; sessionId: string; trigger: string; preTokens: number; toolCallCount?: number; contextPct?: number }>;
}

export interface VerificationPhaseResult {
  result: "pass" | "fail" | "skip";
  count?: number;
  coverage?: number;
}

export interface VerificationData {
  totalRuns: number;
  byPhase: Record<string, { pass: number; fail: number; skip: number }>;
  byDay: Array<{ date: string; pass: number; fail: number }>;
  recentRuns: Array<{ timestamp: string; sessionId: string; phases: Record<string, VerificationPhaseResult> }>;
}

export interface EvalResult {
  name: string;
  totalRuns: number;
  passAt1Rate: number;
  passAt3Rate: number;
  lastRun: string;
  trend: "improving" | "stable" | "regressing";
}

export interface EvalData {
  evals: EvalResult[];
  byDay: Array<{ date: string; runs: number; passRate: number }>;
  totalRuns: number;
  overallPassAt3Rate: number;
}

export interface ApiDurationData {
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  byDay: Array<{ date: string; avgMs: number; count: number }>;
}

export interface HookMetric {
  command: string;
  event: string;
  count: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  errors: number;
  lastUsed?: string;
  active?: boolean;
  fullCommand?: string;
}

export interface SkillMetric {
  skill: string;
  count: number;
  pct: number;
  errors: number;
  sessions: number;
  avgMs?: number;
  p50Ms?: number;
  p95Ms?: number;
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
  userMessages?: number;
  assistantMessages?: number;
  cost?: number;
  linesAdded?: number;
  linesRemoved?: number;
  commits?: number;
}

export interface ProjectBucket {
  project: string;
  sessions: number;
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
  byDayChurn: (TimeBucket & { tools: Record<string, number> })[];
  byDayProject: (TimeBucket & { projects: Record<string, number> })[];
  byDayVelocity: (TimeBucket & { velocity: number })[];
  byDayErrors: (TimeBucket & { tools: Record<string, number> })[];
  byDayLatency: (TimeBucket & { tools: Record<string, number> })[];
  byDaySessionCount: (TimeBucket & { tools: Record<string, number> })[];
  skillToolMatrix: Array<{ skill: string; tools: Array<{ tool: string; count: number }> }>;
  projectRanked: Array<{ project: string; count: number; pct: number }>;
}

export interface HooksData {
  ranked: HookMetric[];
  byDay: (TimeBucket & { hooks: Record<string, number> })[];
  byDayLatency: (TimeBucket & { hooks: Record<string, number> })[];
  byDayErrors: (TimeBucket & { hooks: Record<string, number> })[];
  byDayEvent: (TimeBucket & { events: Record<string, number> })[];
}

export interface SkillsData {
  ranked: SkillMetric[];
  byDay: (TimeBucket & { skills: Record<string, number> })[];
  byDaySessions: (TimeBucket & { skills: Record<string, number> })[];
  byDayErrors: (TimeBucket & { skills: Record<string, number> })[];
  byDayLatency: (TimeBucket & { skills: Record<string, number> })[];
}

export interface TokensData {
  cacheEfficiency: number;
  totalInput: number;
  totalOutput: number;
  totalCacheRead: number;
  totalCacheCreation: number;
  byDay: TokenBucket[];
}

export interface CostData {
  totalUsd: number;
  byDay: CostBucket[];
  byModel: ModelCost[];
}

export interface GateInfo {
  inlineOverride: boolean;
  dispatchBlocks: number;
  dispatchAllows: number;
  mode: "dispatched" | "inline" | "none";
}

export interface SessionMetric {
  sessionId: string;
  parentSessionId?: string;
  project: string;
  durationMs: number;
  userMessages: number;
  assistantMessages: number;
  toolCalls: number;
  cost: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  compactions: number;
  firstTimestamp: string;
  lastTimestamp: string;
  gitBranch?: string;
  hasSubagents?: boolean;
  gateInfo?: GateInfo;
  firstUserMessage?: string;
}

export interface SessionsData {
  byDay: SessionBucket[];
  byProject: ProjectBucket[];
  byActivity: TimeBucket[];
  byDayProject: (TimeBucket & { projects: Record<string, number> })[];
  sessions: SessionMetric[];
  avgDurationMs: number;
  totalUserMessages: number;
  totalAssistantMessages: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  totalCommits: number;
}

export interface ToolDetailData {
  name: string;
  totalCount: number;
  errorCount: number;
  totalLinesAdded: number;
  totalLinesRemoved: number;
  sessionCount: number;
  byDay: (TimeBucket & {
    byHour: Record<number, number>;
    errors: number;
    errorRate: number;
    sessions: number;
    linesAdded: number;
    linesRemoved: number;
    p50Ms?: number;
    p95Ms?: number;
    avgMs?: number;
  })[];
  skills: { name: string; count: number }[];
  invocations: { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; durationMs?: number; isError?: boolean; errorMessage?: string; errorFull?: string; skill?: string; linesAdded?: number; linesRemoved?: number }[];
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
  byDay: TimeBucket[];
  invocations: { timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; userRequest?: string }[];
}

export interface MemoryUsageData {
  stores: number;
  searches: number;
  byDay: { date: string; stores: number; searches: number }[];
}

export interface MemorySearchResult {
  id?: string;
  content: string;
  memory_type?: string;
  tags?: string[];
  score?: number;
  name?: string;
}

export interface MemorySearchInvocation {
  timestamp: string;
  sessionId: string;
  query: string;
  mode?: string;
  tags?: string[];
  durationMs?: number;
  isError?: boolean;
  errorMessage?: string;
  results: MemorySearchResult[];
  resultCount: number;
}

export interface MemorySearchData {
  totalSearches: number;
  invocations: MemorySearchInvocation[];
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

export interface TraceSpan {
  id: string;
  kind: "tool" | "hook" | "token";
  label: string;
  startMs: number;
  durationMs: number;
  isError?: boolean;
  detail?: string;
  toolUseId?: string;
  subagentSessionId?: string;
  resultTokens?: number;
}

export interface TraceTurn {
  index: number;
  userMessage: string;
  startTime: string;
  durationMs: number;
  spans: TraceSpan[];
  tokenCount?: number;
  contextTokens?: number;
  outputTokens?: number;
  inputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  cost?: number;
  model?: string;
  assistantText?: string;
}

export interface TraceCompaction {
  timestamp: string;
  trigger: string;
  preTokens?: number;
  summary?: string;
}

export interface TraceData {
  sessionId: string;
  parentSessionId?: string;
  project: string;
  turns: TraceTurn[];
  compactions: TraceCompaction[];
  totalDurationMs: number;
  totalTokens: number;
  totalCost: number;
  gateInfo?: GateInfo;
}

export interface SubagentInvocation {
  timestamp: string;
  sessionId: string;
  project: string;
  description?: string;
  subagentType?: string;
  runInBackground?: boolean;
  model?: string;
  durationMs?: number;
  isError?: boolean;
  errorMessage?: string;
  subagentSessionId?: string;
}

export interface SubagentTypeBucket {
  subagentType: string;
  count: number;
  pct: number;
  avgMs: number;
  p95Ms: number;
  errors: number;
}

export interface SubagentsData {
  activeNow: number;
  totalDispatches: number;
  backgroundDispatches: number;
  parentSessionCount: number;
  avgMs: number;
  p50Ms: number;
  p95Ms: number;
  byDay: { date: string; count: number; backgroundCount: number; foregroundCount: number }[];
  byType: SubagentTypeBucket[];
  recent: SubagentInvocation[];
}
