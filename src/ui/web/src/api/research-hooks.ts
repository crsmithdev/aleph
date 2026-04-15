import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Types matching the API response shapes
export interface ResearchQuery {
  id: string;
  title: string;
  seed_query: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  config: Record<string, unknown>;
  summary: string;
  document: string;
  user_notes: string;
  created_at: string;
  updated_at: string;
}

/** @deprecated Use ResearchQuery */
export type ResearchSession = ResearchQuery;

export interface ResearchThread {
  id: string;
  session_id: string;
  parent_thread_id: string | null;
  query: string;
  short_query: string | null;
  origin: string;
  perturbation_strategy: string | null;
  status: string;
  priority: number;
  depth: number;
  max_depth: number;
  min_searches: number | null;
  fetch_source_text: boolean | null;
  retry_after: string | null;
  created_at: string;
  updated_at: string;
}

export interface ResearchFinding {
  id: string;
  thread_id: string;
  session_id: string;
  content: string;
  summary: string;
  source_urls: string[];
  source_texts: string[];
  source_url_meta: Array<{ url: string; title: string; snippet: string }>;
  tags: string[];
  confidence: number;
  novelty: number;
  actionability: number;
  user_rating: string | null;
  follow_ups: string[];
  follow_up_analysis?: {
    candidates: Array<{
      text: string;
      quality_score: number;
      jaccard_similarity: number;
      embedding_similarity: number | null;
      llm_similarity: number | null;
      similarity_method: string;
      distance_from_parent: number;
      rank_score: number;
      accepted: boolean;
      rejection_reason: string | null;
    }>;
    similarity_threshold: number;
    retry_count: number;
    min_required: number;
  };
  created_at: string;
}

export interface ResearchPlan {
  id: string;
  session_id: string;
  items: ResearchPlanItem[];
  generated_at: string;
  status: string;
}

export interface ResearchPlanItem {
  rank: number;
  thread_id: string;
  thread_query: string;
  parent_thread_title: string | null;
  origin: string;
  perturbation_strategy: string | null;
  estimated_cost: number;
  rationale: string;
}

export interface SessionCosts {
  total_cost: number;
  step_count: number;
  today_cost: number;
  total_steps: number;
  by_model: Record<string, { cost: number; steps: number; tokens: number }>;
}

// --- Stats ---
export interface ResearchStatsData {
  totalSessions: number;
  activeSessions: number;
  totalFindings: number;
  totalThreads: number;
  totalCost: number;
  avgConfidence: number;
  avgNovelty: number;
  byDay: Array<{ date: string; sessions: number; findings: number; cost: number }>;
}

export function useResearchStats(range: string, granularity: string) {
  const params = new URLSearchParams({ range, granularity });
  return useQuery({
    queryKey: ['research-stats', range, granularity],
    queryFn: () => api.get<ResearchStatsData>(`/research/stats?${params}`),
  });
}

// --- Workers (global) ---
export interface WorkerStatus {
  id: number;
  pid: number | null;
  status: 'starting' | 'running' | 'stopping' | 'stopped' | 'backoff';
  restarts: number;
  uptimeMs: number | null;
  currentJob: ResearchJob | null;
}

export function useResearchWorkers() {
  return useQuery({
    queryKey: ['research-workers'],
    queryFn: () => api.get<WorkerStatus[]>('/research/workers'),
    refetchInterval: 5000,
  });
}

export function useAddWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<WorkerStatus>('/research/workers/add', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-workers'] }),
  });
}

export function useRemoveWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<{ removed: number | null }>('/research/workers/remove', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-workers'] }),
  });
}

export function useKillWorker() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) => api.post<{ killed: boolean }>(`/research/workers/${id}/kill`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-workers'] }),
  });
}

export interface JobStatsData {
  total: number;
  completed: number;
  failed: number;
  cancelled: number;
  avgDurationMs: number | null;
  byDay: { date: string; completed: number; failed: number; avgDurationMs: number | null }[];
}

export function useJobStats() {
  return useQuery({
    queryKey: ['research-job-stats'],
    queryFn: () => api.get<JobStatsData>('/research/jobs/stats'),
    refetchInterval: 10000,
  });
}

export function useAllJobs(opts?: { limit?: number; status?: string }) {
  const params = new URLSearchParams();
  if (opts?.limit) params.set('limit', String(opts.limit));
  if (opts?.status) params.set('status', opts.status);
  const qs = params.toString();
  return useQuery({
    queryKey: ['research-all-jobs', opts?.limit, opts?.status],
    queryFn: () => api.get<ResearchJob[]>(`/research/jobs${qs ? `?${qs}` : ''}`),
    refetchInterval: 5000,
  });
}

// --- Env check ---
export interface ResearchEnvCheck {
  anthropic: boolean;
  openrouter: boolean;
  jina: boolean;
  jina_balance: number | null;
  tavily: boolean;
  brave: boolean;
  searchProvider: 'tavily' | 'brave' | 'duckduckgo';
  warnings: string[];
  errors: string[];
}

export function useResearchEnvCheck() {
  return useQuery({
    queryKey: ['research-env-check'],
    queryFn: () => api.get<ResearchEnvCheck>('/research/env-check'),
    staleTime: 60_000,
  });
}

// --- Provider config ---
export interface ProviderKeyInfo {
  set: boolean;
  masked: string;
}

export interface ProviderConfig {
  llm_provider: string;
  model: string;
  recent_models: string[];
  search_provider: string;
  fulltext_provider: string;
  keys: {
    anthropic: ProviderKeyInfo;
    openrouter: ProviderKeyInfo;
    tavily: ProviderKeyInfo;
    brave: ProviderKeyInfo;
    jina: ProviderKeyInfo;
  };
  max_thread_depth: number;
  min_searches: number;
  fetch_source_text: boolean;
  gap_analysis: boolean;
  max_gap_searches: number;
  daily_limit: string;
}

export function useProviderConfig() {
  return useQuery({
    queryKey: ['research-config'],
    queryFn: () => api.get<ProviderConfig>('/research/config'),
    staleTime: 30_000,
  });
}

export function useUpdateProviderConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Record<string, unknown>) =>
      api.patch('/research/config', data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-config'] });
      qc.invalidateQueries({ queryKey: ['research-env-check'] });
    },
  });
}

// --- Queries ---
export function useResearchQueries(status?: string) {
  const params = status ? `?status=${status}` : '';
  return useQuery({
    queryKey: ['research-queries', status],
    queryFn: () => api.get<ResearchQuery[]>(`/research/queries${params}`),
  });
}

/** @deprecated Use useResearchQueries */
export const useResearchSessions = useResearchQueries;

export function useResearchQuery(id: string) {
  return useQuery({
    queryKey: ['research-queries', id],
    queryFn: () => api.get<ResearchQuery>(`/research/queries/${id}`),
    enabled: !!id,
  });
}

/** @deprecated Use useResearchQuery */
export const useResearchSession = useResearchQuery;

export function useCreateResearchQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { seed_query: string; title?: string; config?: Record<string, unknown> }) =>
      api.post<ResearchQuery>('/research/queries', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-queries'] }),
  });
}

/** @deprecated Use useCreateResearchQuery */
export const useCreateResearchSession = useCreateResearchQuery;

export function useUpdateResearchQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; status?: string; title?: string }) =>
      api.patch<ResearchQuery>(`/research/queries/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['research-queries'] });
      qc.invalidateQueries({ queryKey: ['research-queries', vars.id] });
    },
  });
}

/** @deprecated Use useUpdateResearchQuery */
export const useUpdateResearchSession = useUpdateResearchQuery;

export function useUpdateQueryConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, config }: { id: string; config: Record<string, unknown> }) =>
      api.patch<ResearchQuery>(`/research/queries/${id}`, { config }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['research-queries'] });
      qc.invalidateQueries({ queryKey: ['research-queries', vars.id] });
    },
  });
}

/** @deprecated Use useUpdateQueryConfig */
export const useUpdateSessionConfig = useUpdateQueryConfig;

// --- Threads ---
export function useResearchThreads(sessionId: string, opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['research-threads', sessionId],
    queryFn: () => api.get<ResearchThread[]>(`/research/queries/${sessionId}/threads`),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval,
  });
}

export function useInjectThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, query, max_depth }: { sessionId: string; query: string; max_depth?: number }) =>
      api.post<ResearchThread>(`/research/queries/${sessionId}/threads`, { query, max_depth }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['research-threads', vars.sessionId] }),
  });
}

export function useUpdateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sessionId, ...data }: { id: string; sessionId: string; status?: string; max_depth?: number; priority?: number; fetch_source_text?: boolean | null }) =>
      api.patch<ResearchThread>(`/research/threads/${id}`, data),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['research-threads', vars.sessionId] }),
  });
}

export function useFetchThreadText() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, threadId }: { sessionId: string; threadId: string }) =>
      api.post<{ updated: number }>(`/research/queries/${sessionId}/threads/${threadId}/fetch-text`, {}),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['research-findings', vars.sessionId] }),
  });
}

export function useRedoThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, threadId, fetch_source_text }: { sessionId: string; threadId: string; fetch_source_text?: boolean }) =>
      api.post<ResearchThread>(`/research/queries/${sessionId}/threads/${threadId}/redo`, fetch_source_text !== undefined ? { fetch_source_text } : {}),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['research-threads', vars.sessionId] });
      qc.invalidateQueries({ queryKey: ['research-findings', vars.sessionId] });
      qc.invalidateQueries({ queryKey: ['research-steps', vars.sessionId] });
    },
  });
}

export function useFetchFindingText() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, findingId }: { sessionId: string; findingId: string }) =>
      api.post<{ updated: boolean }>(`/research/findings/${findingId}/fetch-text`, {}),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['research-findings', vars.sessionId] }),
  });
}

// --- Findings ---
export function useResearchFindings(sessionId: string, opts?: { sort?: string; limit?: number; refetchInterval?: number }) {
  const params = new URLSearchParams();
  if (opts?.sort) params.set('sort', opts.sort);
  if (opts?.limit) params.set('limit', String(opts.limit));
  const qs = params.toString();
  return useQuery({
    queryKey: ['research-findings', sessionId, opts],
    queryFn: () => api.get<ResearchFinding[]>(`/research/queries/${sessionId}/findings${qs ? `?${qs}` : ''}`),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval,
  });
}

export function useRateFinding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, user_rating }: { id: string; user_rating: string }) =>
      api.patch<ResearchFinding>(`/research/findings/${id}`, { user_rating }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-findings'] }),
  });
}

// --- Steps ---
export interface ResearchStep {
  id: string;
  thread_id: string;
  session_id: string;
  model: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  tool_calls: Array<{ tool: string; input?: Record<string, unknown>; output?: string; error?: string; jina_fetches?: Array<{ url: string; ok: boolean; content_length: number; error?: string }> }>;
  duration_ms: number;
  error: string | null;
  label: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export function useResearchSteps(sessionId: string, threadId?: string, opts?: { refetchInterval?: number }) {
  const params = new URLSearchParams();
  if (threadId) params.set('thread_id', threadId);
  const qs = params.toString();
  return useQuery({
    queryKey: ['research-steps', sessionId, threadId],
    queryFn: () => api.get<ResearchStep[]>(`/research/queries/${sessionId}/steps${qs ? `?${qs}` : ''}`),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval,
  });
}

// --- Plan ---
export function useResearchPlan(sessionId: string) {
  return useQuery({
    queryKey: ['research-plan', sessionId],
    queryFn: () => api.get<ResearchPlan>(`/research/queries/${sessionId}/plan`),
    enabled: !!sessionId,
    retry: false,
  });
}

export function useModifyPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, ...data }: { sessionId: string; action: string; target_item_rank?: number; target_thread_id?: string }) =>
      api.post(`/research/queries/${sessionId}/plan/modify`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['research-plan', vars.sessionId] });
      qc.invalidateQueries({ queryKey: ['research-threads', vars.sessionId] });
    },
  });
}

// --- Costs ---
export function useResearchCosts(sessionId: string, opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['research-costs', sessionId],
    queryFn: () => api.get<SessionCosts>(`/research/queries/${sessionId}/costs`),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval,
  });
}

// --- Running status ---
export interface RunningStatus {
  running: boolean;
  job: {
    id: string;
    status: string;
    mode: string;
    iterations_completed: number;
    max_iterations: number | null;
    heartbeat_at: string | null;
  } | null;
}

export function useResearchRunning(sessionId: string) {
  return useQuery({
    queryKey: ['research-running', sessionId],
    queryFn: () => api.get<RunningStatus>(`/research/queries/${sessionId}/running`),
    enabled: !!sessionId,
    refetchInterval: 3000,
  });
}

export interface ResearchActivity {
  running: boolean;
  job: { id: string; status: string; iterations_completed: number; max_iterations: number | null } | null;
  active_thread: { id: string; query: string } | null;
  queued_threads: number;
  exhausted_threads: number;
  recent_steps: Array<{
    model: string;
    cost_usd: number;
    duration_ms: number;
    error: string | null;
    tool_calls: Array<{ tool: string; query?: string }>;
    created_at: string;
  }>;
}

export function useResearchActivity(sessionId: string, opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['research-activity', sessionId],
    queryFn: () => api.get<ResearchActivity>(`/research/queries/${sessionId}/activity`),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval,
  });
}

// --- Document generation ---
export function useGenerateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId }: { sessionId: string }) =>
      api.post<{ document: string }>(`/research/queries/${sessionId}/generate-document`, {}),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['research-queries', vars.sessionId] });
    },
  });
}

// --- Delete query ---
export function useDeleteResearchQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api.delete(`/research/queries/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-queries'] });
      qc.invalidateQueries({ queryKey: ['research-stats'] });
    },
  });
}

/** @deprecated Use useDeleteResearchQuery */
export const useDeleteResearchSession = useDeleteResearchQuery;

// --- Global run/stop ---
export function useRunAllResearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/research/run-all', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-running'] });
      qc.invalidateQueries({ queryKey: ['research-activity'] });
    },
  });
}

export function useStopAllResearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post('/research/stop-all', {}),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-running'] });
      qc.invalidateQueries({ queryKey: ['research-activity'] });
    },
  });
}

// --- Reset (dev) ---
export function useClearResearchDB() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.delete('/research/reset'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-queries'] });
      qc.invalidateQueries({ queryKey: ['research-stats'] });
    },
  });
}

// --- Run ---
export function useRunResearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, iterations, mode }: { sessionId: string; iterations?: number; mode?: string }) =>
      api.post(`/research/queries/${sessionId}/run`, { iterations, mode }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['research-running', vars.sessionId] });
      qc.invalidateQueries({ queryKey: ['research-activity', vars.sessionId] });
    },
  });
}

export function useCancelJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ jobId }: { jobId: string }) =>
      api.post(`/research/jobs/${jobId}/cancel`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-running'] });
      qc.invalidateQueries({ queryKey: ['research-activity'] });
    },
  });
}

// --- Jobs ---
export interface ResearchJob {
  id: string;
  session_id: string;
  thread_id: string | null;
  status: string;
  mode: string;
  max_iterations: number | null;
  iterations_completed: number;
  claimed_by: string | null;
  claimed_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  heartbeat_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

export function useResearchJobs(sessionId: string) {
  return useQuery({
    queryKey: ['research-jobs', sessionId],
    queryFn: () => api.get<ResearchJob[]>(`/research/queries/${sessionId}/jobs`),
    enabled: !!sessionId,
    refetchInterval: 5000,
  });
}

// --- SSE Stream ---
export type StreamEvent =
  | { type: 'finding'; payload: ResearchFinding }
  | { type: 'thread'; payload: ResearchThread }
  | { type: 'step'; payload: ResearchStep }
  | { type: 'job'; payload: ResearchJob };

export function useResearchStream(sessionId: string) {
  const qc = useQueryClient();
  const [events, setEvents] = useState<StreamEvent[]>([]);

  useEffect(() => {
    if (!sessionId) return;
    const es = new EventSource(`/api/research/queries/${sessionId}/stream`);

    es.onmessage = (event: MessageEvent) => {
      try {
        const parsed: StreamEvent = JSON.parse(event.data);

        if (parsed.type === 'finding') {
          qc.setQueryData(
            ['research-findings', sessionId, {}],
            (old: ResearchFinding[] | undefined) => {
              if (!old) return [parsed.payload];
              if (old.find(f => f.id === parsed.payload.id)) return old;
              return [parsed.payload, ...old];
            }
          );
        } else if (parsed.type === 'thread') {
          qc.setQueryData(
            ['research-threads', sessionId],
            (old: ResearchThread[] | undefined) => {
              if (!old) return [parsed.payload];
              const idx = old.findIndex(t => t.id === parsed.payload.id);
              if (idx >= 0) { const n = [...old]; n[idx] = parsed.payload; return n; }
              return [...old, parsed.payload];
            }
          );
        } else if (parsed.type === 'job') {
          qc.setQueryData(
            ['research-jobs', sessionId],
            (old: ResearchJob[] | undefined) => {
              if (!old) return [parsed.payload];
              const idx = old.findIndex(j => j.id === parsed.payload.id);
              if (idx >= 0) { const n = [...old]; n[idx] = parsed.payload; return n; }
              return [...old, parsed.payload];
            }
          );
        }

        setEvents(prev => [parsed, ...prev].slice(0, 500));
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // EventSource auto-reconnects — no action needed
    };

    return () => es.close();
  }, [sessionId, qc]);

  return { events };
}
