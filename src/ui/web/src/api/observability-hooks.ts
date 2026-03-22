import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

type Granularity = 'minute' | 'hour' | 'day';

interface ObsQueryOpts {
  days: number;
  granularity?: Granularity;
  session?: string;
}

function obsQueryParams(opts: ObsQueryOpts): string {
  const params = new URLSearchParams();
  params.set('days', String(opts.days));
  if (opts.granularity && opts.granularity !== 'day') params.set('granularity', opts.granularity);
  if (opts.session) params.set('session', opts.session);
  return params.toString();
}

function obsQuery<T>(endpoint: string, opts: ObsQueryOpts) {
  return useQuery<T>({
    queryKey: ['observability', endpoint, opts.days, opts.granularity || 'day', opts.session || ''],
    queryFn: () => api.get<T>(`/observability/${endpoint}?${obsQueryParams(opts)}`),
  });
}

export function useObsOverview(days: number, session?: string) {
  return obsQuery<{
    sessions: number;
    messages: number;
    toolCalls: number;
    toolErrors: number;
    hookErrors: number;
    totalCost: number;
    byDay: Array<{ date: string; sessions: number; messages: number }>;
    queryTimeMs: number;
  }>('overview', { days, session });
}

export function useObsTools(days: number, granularity?: Granularity, session?: string) {
  return obsQuery<{
    ranked: Array<{
      name: string;
      count: number;
      errorCount: number;
      pct: number;
      active: boolean;
      lastUsed?: string;
    }>;
    byDay: Array<{ date: string; count: number; tools: Record<string, number> }>;
    queryTimeMs: number;
  }>('tools', { days, granularity, session });
}

export function useObsHooks(days: number, granularity?: Granularity, session?: string) {
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
    }>;
    byDay: Array<{ date: string; count: number; hooks: Record<string, number> }>;
    queryTimeMs: number;
  }>('hooks', { days, granularity, session });
}

export function useObsSkills(days: number, granularity?: Granularity, session?: string) {
  return obsQuery<{
    ranked: Array<{ skill: string; count: number; pct: number; errors: number; lastUsed?: string }>;
    byDay: Array<{ date: string; count: number; skills: Record<string, number> }>;
    queryTimeMs: number;
  }>('skills', { days, granularity, session });
}

export function useObsTokens(days: number, session?: string) {
  return obsQuery<{
    byDay: Array<{
      date: string;
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    }>;
    queryTimeMs: number;
  }>('tokens', { days, session });
}

export function useObsCost(days: number, session?: string) {
  return obsQuery<{
    totalUsd: number;
    byDay: Array<{ date: string; usd: number }>;
    byModel: Array<{ model: string; usd: number; pct: number }>;
    queryTimeMs: number;
  }>('cost', { days, session });
}

export function useObsSessions(days: number, session?: string) {
  return obsQuery<{
    byDay: Array<{ date: string; sessions: number; messages: number }>;
    byProject: Array<{ project: string; sessions: number }>;
    byHour: Array<{ hour: number; count: number }>;
    queryTimeMs: number;
  }>('sessions', { days, session });
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

export function useObsToolDetail(name: string, days: number) {
  return useQuery<{
    name: string;
    totalCount: number;
    errorCount: number;
    byDay: Array<{ date: string; count: number; byHour: Record<number, number> }>;
    invocations: Array<{ timestamp: string; sessionId: string; project: string; params?: Record<string, unknown> }>;
    queryTimeMs: number;
  }>({
    queryKey: ['observability', 'tool-detail', name, days],
    queryFn: () => api.get(`/observability/tools/${encodeURIComponent(name)}?days=${days}`),
    enabled: !!name,
  });
}

export function useObsHookEvents(days: number) {
  return obsQuery<{
    events: Array<{ event: string; count: number; hooks: string[] }>;
    invocations: Array<{
      timestamp: string;
      sessionId: string;
      event: string;
      hooks: Array<{ command: string; durationMs?: number; exitCode?: number; output?: string }>;
    }>;
    queryTimeMs: number;
  }>('hooks/events', { days });
}

export function useObsHookDetail(name: string, days: number) {
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
    byDay: Array<{ date: string; count: number; avgMs: number }>;
    invocations: Array<{ timestamp: string; sessionId: string; durationMs: number; exitCode?: number; output?: string }>;
    queryTimeMs: number;
  }>({
    queryKey: ['observability', 'hook-detail', name, days],
    queryFn: () => api.get(`/observability/hooks/${encodeURIComponent(name)}?days=${days}`),
    enabled: !!name,
  });
}

export function useObsSkillDetail(name: string, days: number) {
  return useQuery<{
    skill: string;
    totalCount: number;
    errorCount: number;
    byDay: Array<{ date: string; count: number }>;
    invocations: Array<{ timestamp: string; sessionId: string; project: string; params?: Record<string, unknown> }>;
    queryTimeMs: number;
  }>({
    queryKey: ['observability', 'skill-detail', name, days],
    queryFn: () => api.get(`/observability/skills/${encodeURIComponent(name)}?days=${days}`),
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

export function useObsMemoryUsage(days: number) {
  return obsQuery<{
    stores: number;
    searches: number;
    byDay: Array<{ date: string; stores: number; searches: number }>;
    queryTimeMs: number;
  }>('memory/usage', { days });
}

export function useTriggerSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/observability/memory/snapshot', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observability', 'memory'] }),
  });
}
