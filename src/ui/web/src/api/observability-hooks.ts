import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

type TimeRange = 'session' | '1h' | '1d' | '7d' | '30d';
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
    }>;
    byDay: Array<{ date: string; count: number; tools: Record<string, number> }>;
    queryTimeMs: number;
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
      active: boolean;
      fullCommand?: string;
      blocking?: boolean;
      gate?: string;
      markerFile?: string;
      description?: string;
    }>;
    byDay: Array<{ date: string; count: number; hooks: Record<string, number> }>;
    unused: Array<{ command: string; event: string; blocking?: boolean; gate?: string; markerFile?: string; description?: string }>;
    markerStats?: Record<string, { writes: number; clears: number; activeNow: boolean }>;
    queryTimeMs: number;
  }>('hooks', { range, granularity, session });
}

export function useObsSkills(range: TimeRange, granularity?: Granularity, session?: string) {
  return obsQuery<{
    ranked: Array<{ skill: string; count: number; pct: number; errors: number; lastUsed?: string; type: 'command' | 'skill'; registered: boolean }>;
    byDay: Array<{ date: string; count: number; skills: Record<string, number> }>;
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
    byDay: Array<{ date: string; sessions: number; messages: number; userMessages?: number; assistantMessages?: number }>;
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
      gateInfo?: { inlineOverride: boolean; dispatchBlocks: number; dispatchAllows: number; mode: 'dispatched' | 'inline' | 'none' };
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
    byDay: Array<{ date: string; count: number; byHour: Record<number, number> }>;
    invocations: Array<{ timestamp: string; sessionId: string; project: string; params?: Record<string, unknown>; isError?: boolean; errorMessage?: string }>;
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

export function useObsCompaction(range: TimeRange, granularity?: Granularity, session?: string) {
  return obsQuery<{
    totalCompactions: number;
    totalTokensAtCompaction: number;
    avgPreTokens: number;
    byDay: Array<{ date: string; count: number }>;
    events: Array<{ timestamp: string; sessionId: string; trigger: string; preTokens: number }>;
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
        kind: 'tool' | 'hook' | 'token';
        label: string;
        startMs: number;
        durationMs: number;
        isError?: boolean;
        detail?: string;
        toolUseId?: string;
        subagentSessionId?: string;
      }>;
      tokenCount?: number;
      cost?: number;
      model?: string;
    }>;
    parentSessionId?: string;
    totalDurationMs: number;
    totalTokens: number;
    totalCost: number;
    gateInfo?: { inlineOverride: boolean; dispatchBlocks: number; dispatchAllows: number; mode: 'dispatched' | 'inline' | 'none' };
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
