import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

function obsQuery<T>(endpoint: string, days: number) {
  return useQuery<T>({
    queryKey: ['observability', endpoint, days],
    queryFn: () => api.get<T>(`/observability/${endpoint}?days=${days}`),
  });
}

export function useObsOverview(days: number) {
  return obsQuery<{
    sessions: number;
    messages: number;
    toolCalls: number;
    totalCost: number;
    byDay: Array<{ date: string; sessions: number; messages: number }>;
  }>('overview', days);
}

export function useObsTools(days: number) {
  return obsQuery<{
    ranked: Array<{ name: string; count: number; errorCount: number; pct: number }>;
    byDay: Array<{ date: string; count: number; tools: Record<string, number> }>;
  }>('tools', days);
}

export function useObsHooks(days: number) {
  return obsQuery<{
    ranked: Array<{
      command: string;
      event: string;
      count: number;
      avgMs: number;
      p50Ms: number;
      p95Ms: number;
      errors: number;
    }>;
  }>('hooks', days);
}

export function useObsSkills(days: number) {
  return obsQuery<{
    ranked: Array<{ skill: string; count: number; pct: number }>;
    byDay: Array<{ date: string; count: number; skills: Record<string, number> }>;
  }>('skills', days);
}

export function useObsTokens(days: number) {
  return obsQuery<{
    byDay: Array<{
      date: string;
      input: number;
      output: number;
      cacheRead: number;
      cacheCreation: number;
    }>;
  }>('tokens', days);
}

export function useObsCost(days: number) {
  return obsQuery<{
    totalUsd: number;
    byDay: Array<{ date: string; usd: number }>;
    byModel: Array<{ model: string; usd: number; pct: number }>;
  }>('cost', days);
}

export function useObsSessions(days: number) {
  return obsQuery<{
    byDay: Array<{ date: string; sessions: number; messages: number }>;
    byProject: Array<{ project: string; sessions: number }>;
    byHour: Array<{ hour: number; count: number }>;
  }>('sessions', days);
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
    invocations: Array<{ timestamp: string; sessionId: string; project: string }>;
  }>({
    queryKey: ['observability', 'tool-detail', name, days],
    queryFn: () => api.get(`/observability/tools/${encodeURIComponent(name)}?days=${days}`),
    enabled: !!name,
  });
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
    byDay: Array<{ date: string; count: number; avgMs: number }>;
    invocations: Array<{ timestamp: string; sessionId: string; durationMs: number }>;
  }>({
    queryKey: ['observability', 'hook-detail', name, days],
    queryFn: () => api.get(`/observability/hooks/${encodeURIComponent(name)}?days=${days}`),
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
  }>('memory/usage', days);
}

export function useTriggerSnapshot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/observability/memory/snapshot', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['observability', 'memory'] }),
  });
}
