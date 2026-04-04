import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Types matching the API response shapes
export interface ResearchSession {
  id: string;
  title: string;
  seed_query: string;
  status: 'active' | 'paused' | 'completed' | 'archived';
  config: Record<string, unknown>;
  summary: string;
  user_notes: string;
  created_at: string;
  updated_at: string;
}

export interface ResearchThread {
  id: string;
  session_id: string;
  parent_thread_id: string | null;
  query: string;
  origin: string;
  perturbation_strategy: string | null;
  status: string;
  priority: number;
  depth: number;
  max_depth: number;
  min_searches: number | null;
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

// --- Env check ---
export interface ResearchEnvCheck {
  anthropic: boolean;
  openrouter: boolean;
  jina: boolean;
  jina_balance: number | null;
  jina_trial_balance: number | null;
  jina_paid_balance: number | null;
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

// --- Sessions ---
export function useResearchSessions(status?: string) {
  const params = status ? `?status=${status}` : '';
  return useQuery({
    queryKey: ['research-sessions', status],
    queryFn: () => api.get<ResearchSession[]>(`/research/sessions${params}`),
  });
}

export function useResearchSession(id: string) {
  return useQuery({
    queryKey: ['research-sessions', id],
    queryFn: () => api.get<ResearchSession>(`/research/sessions/${id}`),
    enabled: !!id,
  });
}

export function useCreateResearchSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: { seed_query: string; title?: string; config?: Record<string, unknown> }) =>
      api.post<ResearchSession>('/research/sessions', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-sessions'] }),
  });
}

export function useUpdateResearchSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; status?: string; title?: string }) =>
      api.patch<ResearchSession>(`/research/sessions/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['research-sessions'] });
      qc.invalidateQueries({ queryKey: ['research-sessions', vars.id] });
    },
  });
}

export function useUpdateSessionConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, config }: { id: string; config: Record<string, unknown> }) =>
      api.patch<ResearchSession>(`/research/sessions/${id}`, { config }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['research-sessions'] });
      qc.invalidateQueries({ queryKey: ['research-sessions', vars.id] });
    },
  });
}

// --- Threads ---
export function useResearchThreads(sessionId: string, opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['research-threads', sessionId],
    queryFn: () => api.get<ResearchThread[]>(`/research/sessions/${sessionId}/threads`),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval,
  });
}

export function useInjectThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, query, max_depth }: { sessionId: string; query: string; max_depth?: number }) =>
      api.post<ResearchThread>(`/research/sessions/${sessionId}/threads`, { query, max_depth }),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['research-threads', vars.sessionId] }),
  });
}

export function useUpdateThread() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, sessionId, ...data }: { id: string; sessionId: string; status?: string; max_depth?: number; priority?: number }) =>
      api.patch<ResearchThread>(`/research/threads/${id}`, data),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['research-threads', vars.sessionId] }),
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
    queryFn: () => api.get<ResearchFinding[]>(`/research/sessions/${sessionId}/findings${qs ? `?${qs}` : ''}`),
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
  tool_calls: Array<{ tool: string; input?: Record<string, unknown>; output?: string; error?: string; jina_fetches?: Array<{ url: string; ok: boolean; content_length: number }> }>;
  duration_ms: number;
  error: string | null;
  created_at: string;
}

export function useResearchSteps(sessionId: string, threadId?: string, opts?: { refetchInterval?: number }) {
  const params = new URLSearchParams();
  if (threadId) params.set('thread_id', threadId);
  const qs = params.toString();
  return useQuery({
    queryKey: ['research-steps', sessionId, threadId],
    queryFn: () => api.get<ResearchStep[]>(`/research/sessions/${sessionId}/steps${qs ? `?${qs}` : ''}`),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval,
  });
}

// --- Plan ---
export function useResearchPlan(sessionId: string) {
  return useQuery({
    queryKey: ['research-plan', sessionId],
    queryFn: () => api.get<ResearchPlan>(`/research/sessions/${sessionId}/plan`),
    enabled: !!sessionId,
    retry: false,
  });
}

export function useModifyPlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, ...data }: { sessionId: string; action: string; target_item_rank?: number; target_thread_id?: string }) =>
      api.post(`/research/sessions/${sessionId}/plan/modify`, data),
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
    queryFn: () => api.get<SessionCosts>(`/research/sessions/${sessionId}/costs`),
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
    queryFn: () => api.get<RunningStatus>(`/research/sessions/${sessionId}/running`),
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
    queryFn: () => api.get<ResearchActivity>(`/research/sessions/${sessionId}/activity`),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval,
  });
}

// --- Delete session ---
export function useDeleteResearchSession() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id }: { id: string }) =>
      api.delete(`/research/sessions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-sessions'] });
      qc.invalidateQueries({ queryKey: ['research-stats'] });
    },
  });
}

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
      qc.invalidateQueries({ queryKey: ['research-sessions'] });
      qc.invalidateQueries({ queryKey: ['research-stats'] });
    },
  });
}

// --- Run ---
export function useRunResearch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, iterations, mode }: { sessionId: string; iterations?: number; mode?: string }) =>
      api.post(`/research/sessions/${sessionId}/run`, { iterations, mode }),
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
    queryFn: () => api.get<ResearchJob[]>(`/research/sessions/${sessionId}/jobs`),
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
    const es = new EventSource(`/api/research/sessions/${sessionId}/stream`);

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
          qc.invalidateQueries({ queryKey: ['research-running', sessionId] });
          qc.invalidateQueries({ queryKey: ['research-activity', sessionId] });
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
