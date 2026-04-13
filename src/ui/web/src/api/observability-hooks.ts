import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

export type TimeRange = 'session' | '1h' | '1d' | '7d' | '30d';
type Granularity = 'minute' | 'hour' | 'day';

interface ObsQueryOpts {
  range: TimeRange;
  granularity?: Granularity;
  session?: string;
}

function obsQueryParams(opts: ObsQueryOpts): string {
  const params = new URLSearchParams();
  params.set('range', opts.range);
  if (opts.granularity && opts.granularity !== 'day') params.set('granularity', opts.granularity);
  if (opts.session) params.set('session', opts.session);
  return params.toString();
}

function obsQuery<T>(endpoint: string, opts: ObsQueryOpts) {
  return useQuery<T>({
    queryKey: ['observability', endpoint, opts.range, opts.granularity || 'day', opts.session || ''],
    queryFn: () => api.get<T>(`/observability/${endpoint}?${obsQueryParams(opts)}`),
  });
}

export function useObsOverview(range: TimeRange, granularity?: Granularity, session?: string) {
  return obsQuery<{
    sessions: number;
    messages: number;
    toolCalls: number;
    toolErrors: number;
    hookErrors: number;
    totalCost: number;
    byDay: Array<{ date: string; sessions: number; messages: number }>;
    queryTimeMs: number;
  }>('overview', { range, granularity, session });
}

export function useObsTools(range: TimeRange, granularity?: Granularity, session?: string) {
  return obsQuery<{
    ranked: Array<{
      name: string;
      count: number;
      errorCount: number;
      pct: number;
      active: boolean;
      lastUsed?: string;
      avgMs?: number;
      p50Ms?: number;
      p95Ms?: number;
      linesAdded?: number;
      linesRemoved?: number;
      sessionCount?: number;
      velocity?: number;
    }>;
    byDay: Array<{ date: string; count: number; tools: Record<string, number> }>;
    byDayChurn: Array<{ date: string; count: number; tools: Record<string, number> }>;
    byDayProject: Array<{ date: string; count: number; projects: Record<string, number> }>;
    byDayVelocity: Array<{ date: string; count: number; velocity: number }>;
    byDayErrors: Array<{ date: string; count: number; tools: Record<string, number> }>;
    byDayLatency: Array<{ date: string; count: number; tools: Record<string, number> }>;
    byDaySessionCount: Array<{ date: string; count: number; tools: Record<string, number> }>;
    skillToolMatrix: Array<{ skill: string; tools: Array<{ tool: string; count: number }> }>;
    projectRanked: Array<{ project: string; count: number; pct: number }>;
    queryTimeMs: number;
    totalRows: number;
  }>('tools', { range, granularity, session });
}

export function useObsHooks(range: TimeRange, granularity?: Granularity, session?: string) {
  return obsQuery<{
    ranked: Array<{
      command: string;
      event: string;
      count: number;
      avgMs: number;
      p50Ms: number;
      p95Ms: number;
      errors: number;
      lastUsed?: string;
      active: boolean;
      fullCommand?: string;
      blocking?: boolean;
      gate?: string;
      markerFile?: string;
      description?: string;
      group?: string;
    }>;
    byDay: Array<{ date: string; count: number; hooks: Record<string, number> }>;
    byEvent?: Array<{ event: string; count: number }>;
    byDayLatency: Array<{ date: string; count: number; hooks: Record<string, number> }>;
    byDayErrors: Array<{ date: string; count: number; hooks: Record<string, number> }>;
    byDayEvent: Array<{ date: string; count: number; events: Record<string, number> }>;
    unused: Array<{ command: string; event: string; blocking?: boolean; gate?: string; markerFile?: string; description?: string; group?: string }>;
    markerStats?: Record<string, { writes: number; clears: number; activeNow: boolean }>;
    gating?: Record<string, HookGatingStat>;
    queryTimeMs: number;
  }>('hooks', { range, granularity, session });
}

export type HookGatingStat = {
  blocks: number;
  advisories: number;
  passes: number;
  total: number;
  blockRate: number;
  advisoryRate: number;
  ignoredAdvisories: number;
  repeatedBlocks: number;
  topPatterns?: Array<{ detail: string; count: number }>;
};

export function useObsSkills(range: TimeRange, granularity?: Granularity, session?: string) {
  return obsQuery<{
    ranked: Array<{ skill: string; count: number; pct: number; errors: number; avgMs?: number; p50Ms?: number; p95Ms?: number; sessions?: number; lastUsed?: string; type: 'command' | 'skill'; registered: boolean }>;
    byDay: Array<{ date: string; count: number; skills: Record<string, number> }>;
    byType?: Array<{ type: string; count: number }>;
    byDaySessions: Array<{ date: string; count: number; skills: Record<string, number> }>;
    byDayErrors: Array<{ date: string; count: number; skills: Record<string, number> }>;
    byDayLatency: Array<{ date: string; count: number; skills: Record<string, number> }>;
    unused: string[];
    queryTimeMs: number;
  }>('skills', { range, granularity, session });
}

export function useObsTokens(range: TimeRange, granularity?: Granularity, session?: string) {
  return obsQuery<{
    cacheEfficiency: number;
    totalInput: number;
    totalOutput: number;
    totalCacheRead: number;
    totalCacheCreation: number;
    byDay: Array<{
      date: string;
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    }>;
    queryTimeMs: number;
  }>('tokens', { range, granularity, session });
}

export function useObsCost(range: TimeRange, granularity?: Granularity, session?: string) {
  return obsQuery<{
    totalUsd: number;
    byDay: Array<{ date: string; usd: number }>;
    byModel: Array<{ model: string; usd: number; pct: number }>;
    queryTimeMs: number;
  }>('cost', { range, granularity, session });
}

export function useObsSessions(range: TimeRange, granularity?: Granularity, session?: string) {
  return obsQuery<{
    byDay: Array<{ date: string; sessions: number; messages: number; userMessages?: number; assistantMessages?: number; cost?: number; linesAdded?: number; linesRemoved?: number; commits?: number }>;
    byDayProject: Array<{ date: string; count: number; projects: Record<string, number> }>;
    byProject: Array<{ project: string; sessions: number }>;
    byActivity: Array<{ date: string; count: number }>;
    sessions: Array<{
      sessionId: string;
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
      parentSessionId?: string;
      hasSubagents?: boolean;
      gateInfo?: { inlineOverride: boolean; dispatchBlocks: number; dispatchAllows: number; hookBlocks: number; hookAdvisories: number; mode: 'dispatched' | 'inline' | 'none' };
      firstUserMessage?: string;
      intent?: string;
      outcome?: string;
      sessionNotes?: string[];
    }>;
    avgDurationMs: number;
    totalUserMessages: number;
    totalAssistantMessages: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
    totalCommits: number;
    queryTimeMs: number;
  }>('sessions', { range, granularity, session });
}

export function useObsMemory() {
  return useQuery<{
    snapshots: Array<{
      takenAt: string;
      total: number;
      byType: Record<string, number>;
      health: { score: number; stale: number };
      byTag: Record<string, number>;
    }>;
  }>({
    queryKey: ['observability', 'memory'],
    queryFn: () => api.get('/observability/memory'),
  });
}

export function useObsToolDetail(name: string, range: TimeRange) {
  return useQuery<{
    name: string;
    totalCount: number;
    errorCount: number;
    totalLinesAdded: number;
    totalLinesRemoved: number;
    sessionCount: number;
    byDay: Array<{ date: string; count: number; byHour: Record<number, number>; errors: number; errorRate: number; sessions: number; linesAdded: number; linesRemoved: number; p50Ms?: number; p95Ms?: number; avgMs?: number }>;
    skills: Array<{ name: string; count: number }>;
    invocations: Array<{ timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; durationMs?: number; isError?: boolean; errorMessage?: string; errorFull?: string; skill?: string; linesAdded?: number; linesRemoved?: number }>;
    queryTimeMs: number;
  }>({
    queryKey: ['observability', 'tool-detail', name, range],
    queryFn: () => api.get(`/observability/tools/${encodeURIComponent(name)}?range=${range}`),
    enabled: !!name,
  });
}

export function useObsHookEvents(range: TimeRange) {
  return obsQuery<{
    events: Array<{ event: string; count: number; hooks: string[] }>;
    invocations: Array<{
      timestamp: string;
      sessionId: string;
      event: string;
      hooks: Array<{ command: string; durationMs?: number; exitCode?: number; output?: string }>;
    }>;
    queryTimeMs: number;
  }>('hooks/events', { range });
}

export function useObsHookDetail(name: string, range: TimeRange) {
  return useQuery<{
    command: string;
    event: string;
    totalCount: number;
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    errors: number;
    active: boolean;
    fullCommand?: string;
    sourceCode?: string;
    blocking?: boolean;
    description?: string;
    gating?: HookGatingStat | null;
    byDay: Array<{ date: string; count: number; avgMs: number }>;
    invocations: Array<{ timestamp: string; sessionId: string; durationMs: number; exitCode?: number; output?: string; trigger?: string; isError?: boolean; errorMessage?: string }>;
    queryTimeMs: number;
  }>({
    queryKey: ['observability', 'hook-detail', name, range],
    queryFn: () => api.get(`/observability/hooks/${encodeURIComponent(name)}?range=${range}`),
    enabled: !!name,
  });
}

export function useObsSkillDetail(name: string, range: TimeRange) {
  return useQuery<{
    skill: string;
    totalCount: number;
    errorCount: number;
    byDay: Array<{ date: string; count: number }>;
    invocations: Array<{ timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; userRequest?: string }>;
    sourceContent?: string;
    type?: 'command' | 'skill';
    queryTimeMs: number;
  }>({
    queryKey: ['observability', 'skill-detail', name, range],
    queryFn: () => api.get(`/observability/skills/${encodeURIComponent(name)}?range=${range}`),
    enabled: !!name,
  });
}

export function useObsMemoryItems(filters: { type?: string; tag?: string; q?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters.type) params.set('type', filters.type);
  if (filters.tag) params.set('tag', filters.tag);
  if (filters.q) params.set('q', filters.q);
  if (filters.limit) params.set('limit', String(filters.limit));
  return useQuery<{
    items: Array<{
      id: string;
      content: string;
      memory_type: string;
      tags: string;
      created_at: string;
      updated_at: string;
    }>;
  }>({
    queryKey: ['observability', 'memory-items', filters],
    queryFn: () => api.get(`/observability/memory/items?${params.toString()}`),
  });
}

export function useObsEvents(
  range: TimeRange,
  filters: { entryType?: string; search?: string },
  limit = 100,
  offset = 0,
) {
  const params = new URLSearchParams();
  params.set('range', range);
  params.set('limit', String(limit));
  params.set('offset', String(offset));
  if (filters.entryType) params.set('type', filters.entryType);
  if (filters.search) params.set('search', filters.search);
  return useQuery<{
    events: Array<{
      sessionId: string;
      timestamp: string;
      project: string;
      model?: string;
      entryType: string;
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
      turnDurationMs?: number;
      inputTokens?: number;
      outputTokens?: number;
      cacheReadTokens?: number;
      cacheCreationTokens?: number;
    }>;
    total: number;
    queryTimeMs: number;
  }>({
    queryKey: ['observability', 'events', range, filters, limit, offset],
    queryFn: () => api.get(`/observability/events?${params.toString()}`),
  });
}

export function useObsMemoryUsage(range: TimeRange, granularity?: Granularity) {
  return obsQuery<{
    stores: number;
    searches: number;
    byDay: Array<{ date: string; stores: number; searches: number }>;
    queryTimeMs: number;
  }>('memory/usage', { range, granularity });
}

export function useObsMemorySearches(range: TimeRange) {
  return obsQuery<{
    totalSearches: number;
    invocations: Array<{
      timestamp: string;
      sessionId: string;
      query: string;
      mode?: string;
      tags?: string[];
      durationMs?: number;
      isError?: boolean;
      errorMessage?: string;
      results: Array<{
        id?: string;
        content: string;
        memory_type?: string;
        tags?: string[];
        score?: number;
        name?: string;
      }>;
      resultCount: number;
    }>;
    queryTimeMs: number;
  }>('memory/searches', { range });
}

export function useObsCompaction(range: TimeRange, granularity?: Granularity, session?: string) {
  return obsQuery<{
    totalCompactions: number;
    totalTokensAtCompaction: number;
    avgPreTokens: number;
    byDay: Array<{ date: string; count: number }>;
    events: Array<{ timestamp: string; sessionId: string; trigger: string; preTokens: number; toolCallCount?: number; contextPct?: number }>;
    queryTimeMs: number;
  }>('compaction', { range, granularity, session });
}

export function useObsApiDuration(range: TimeRange, granularity?: Granularity, session?: string) {
  return obsQuery<{
    avgMs: number;
    p50Ms: number;
    p95Ms: number;
    byDay: Array<{ date: string; avgMs: number; count: number }>;
    queryTimeMs: number;
  }>('api-duration', { range, granularity, session });
}

export function useObsSessionTrace(sessionId: string, range: TimeRange) {
  return useQuery<{
    sessionId: string;
    project: string;
    turns: Array<{
      index: number;
      userMessage: string;
      startTime: string;
      durationMs: number;
      spans: Array<{
        id: string;
        kind: 'tool' | 'hook' | 'token' | 'verify';
        label: string;
        startMs: number;
        durationMs: number;
        isError?: boolean;
        detail?: string;
        toolUseId?: string;
        subagentSessionId?: string;
      }>;
      tokenCount?: number;
      contextTokens?: number;
      outputTokens?: number;
      cost?: number;
      model?: string;
      assistantText?: string;
    }>;
    parentSessionId?: string;
    compactions: Array<{ timestamp: string; trigger: string; preTokens?: number }>;
    totalDurationMs: number;
    totalTokens: number;
    totalCost: number;
    gateInfo?: { inlineOverride: boolean; dispatchBlocks: number; dispatchAllows: number; hookBlocks: number; hookAdvisories: number; mode: 'dispatched' | 'inline' | 'none' };
    queryTimeMs: number;
  }>({
    queryKey: ['observability', 'session-trace', sessionId, range],
    queryFn: () => api.get(`/observability/sessions/${encodeURIComponent(sessionId)}/trace?range=${range}`),
    enabled: !!sessionId,
  });
}

export function useObsDbStats() {
  return useQuery<{
    databases: Array<{
      name: string;
      path: string;
      sizeBytes: number;
      walSizeBytes: number;
      tables: Array<{ name: string; rows: number }>;
    }>;
  }>({
    queryKey: ['observability', 'db-stats'],
    queryFn: () => api.get('/observability/db-stats'),
  });
}

export function useObsDbSchema(db: string, table: string) {
  return useQuery<{
    columns: Array<{ name: string; type: string; notnull: boolean; pk: boolean; defaultValue: string | null }>;
  }>({
    queryKey: ['observability', 'db-schema', db, table],
    queryFn: () => api.get(`/observability/db-schema/${encodeURIComponent(db)}/${encodeURIComponent(table)}`),
    enabled: !!db && !!table,
  });
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
  queryTimeMs?: number;
}

export function useObsSessionContextFiles(sessionId: string) {
  return useQuery<{
    files: Array<{ label: string; path: string; chars: number; estTokens: number }>;
  }>({
    queryKey: ['observability', 'session-context-files', sessionId],
    queryFn: () => api.get(`/observability/sessions/${encodeURIComponent(sessionId)}/context-files`),
    staleTime: Infinity,
  });
}

export function useObsSubagents(range: TimeRange, granularity?: Granularity) {
  const shouldPoll = range === '1h' || range === '1d';
  return useQuery<SubagentsData>({
    queryKey: ['observability', 'subagents', range, granularity || 'day'],
    queryFn: () => api.get<SubagentsData>(`/observability/subagents?${obsQueryParams({ range, granularity })}`),
    refetchInterval: shouldPoll ? 10_000 : undefined,
  });
}

export function useTriggerSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/observability/memory/snapshot', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observability', 'memory'] }),
  });
}

export function useObsDbContents(db: string, table: string, limit = 50, offset = 0) {
  return useQuery<{ rows: Record<string, unknown>[]; total: number; error?: string }>({
    queryKey: ['observability', 'db-contents', db, table, limit, offset],
    queryFn: () => api.get(`/observability/db-contents/${encodeURIComponent(db)}/${encodeURIComponent(table)}?limit=${limit}&offset=${offset}`),
    enabled: !!db && !!table,
  });
}

export function useDeleteMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.delete(`/observability/memory/${encodeURIComponent(id)}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observability', 'memory-items'] }),
  });
}

export function useUpdateMemory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, content }: { id: string; content: string }) =>
      api.put(`/observability/memory/${encodeURIComponent(id)}`, { content }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observability', 'memory-items'] }),
  });
}

export type EvalResult = {
  name: string;
  totalRuns: number;
  passAt1Rate: number;
  passAt3Rate: number;
  lastRun: string;
  trend: 'improving' | 'stable' | 'regressing';
};

export function useObsEvals() {
  return useQuery<{
    evals: EvalResult[];
    byDay: Array<{ date: string; runs: number; passRate: number }>;
    totalRuns: number;
    overallPassAt3Rate: number;
  }>({
    queryKey: ['observability', 'evals'],
    queryFn: () => api.get('/observability/evals'),
    staleTime: 30_000,
  });
}

export type EvalScenario = {
  name: string;
  dirName: string;
  description: string;
  hook: string;
  event: string;
  expect: string;
  depth: string;
  trials: number;
  prompt: string;
  constraints: string[];
};

export function useObsEvalScenarios() {
  return useQuery<{ scenarios: EvalScenario[] }>({
    queryKey: ['observability', 'evals', 'scenarios'],
    queryFn: () => api.get('/observability/evals/scenarios'),
    staleTime: 30_000,
  });
}

export function useObsEvalScenarioDetail(name: string) {
  return useQuery<EvalScenario & { runs: EvalRun[] }>({
    queryKey: ['observability', 'evals', 'scenarios', name],
    queryFn: () => api.get(`/observability/evals/scenarios/${encodeURIComponent(name)}`),
    enabled: !!name,
    staleTime: 10_000,
  });
}

export type EvalRun = {
  ts: string;
  evalName: string;
  passed: number;
  failed: number;
  passAt1: boolean;
  hookName?: string;
  scenarioName?: string;
  expectedDecision?: string;
  actualDecision?: string;
  tier?: number;
  graders?: Array<{ type: string; result: string }>;
};

export function useObsEvalRuns(scenario?: string) {
  return useQuery<{ runs: EvalRun[]; total: number }>({
    queryKey: ['observability', 'evals', 'runs', scenario ?? ''],
    queryFn: () => api.get(`/observability/evals/runs${scenario ? `?scenario=${encodeURIComponent(scenario)}` : ''}`),
    staleTime: 10_000,
  });
}

export function useRunEvalScenario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (name: string) => api.post(`/observability/evals/run/${encodeURIComponent(name)}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['observability', 'evals'] });
    },
  });
}

export function useCreateEvalScenario() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: Record<string, unknown>) => api.post('/observability/evals/scenarios', body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['observability', 'evals', 'scenarios'] });
    },
  });
}

// ---------------------------------------------------------------------------
// Signal file hooks
// ---------------------------------------------------------------------------

export function useObsRatings() {
  return useQuery<{
    ratings: Array<{ timestamp: string; rating: string; type?: string; context?: string }>;
    total: number;
    byType: Record<string, number>;
    byDay: Array<{ date: string; positive: number; negative: number }>;
  }>({
    queryKey: ['observability', 'signals', 'ratings'],
    queryFn: () => api.get('/observability/signals/ratings'),
  });
}

export function useObsDirectives() {
  return useQuery<{
    directives: Array<{ ts: string; sessionId: string; directives: string[]; promptWords?: number }>;
    total: number;
    depthCounts: Record<string, number>;
    byDay: Array<{ date: string; full: number; quick: number; total: number }>;
    topSkills: Array<{ skill: string; count: number }>;
  }>({
    queryKey: ['observability', 'signals', 'directives'],
    queryFn: () => api.get('/observability/signals/directives'),
  });
}

export function useObsToolSignals() {
  return useQuery<{
    signals: Array<{ type: string; file: string; count: number; sessionId: string; timestamp: string }>;
    byFile: Array<{ file: string; count: number }>;
    total: number;
  }>({
    queryKey: ['observability', 'signals', 'tool-signals'],
    queryFn: () => api.get('/observability/signals/tool-signals'),
  });
}

export function useObsConsolidation() {
  return useQuery<{
    state: { lastRun?: string; lastMemoryCount?: number };
    rules: string[];
    rulesPath: string | null;
  }>({
    queryKey: ['observability', 'signals', 'consolidation'],
    queryFn: () => api.get('/observability/signals/consolidation'),
    staleTime: 30_000,
  });
}

export function useObsSessionFiles(limit?: number) {
  return useQuery<{
    sessions: Array<{
      filename: string;
      timestamp: string;
      intent: string;
      outcome: string;
      milestones: string[];
      notes: string[];
    }>;
    total: number;
  }>({
    queryKey: ['observability', 'signals', 'sessions', limit ?? 100],
    queryFn: () => api.get(`/observability/signals/sessions${limit ? `?limit=${limit}` : ''}`),
  });
}
