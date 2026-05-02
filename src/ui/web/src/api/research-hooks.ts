import { useState, useEffect, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// Types matching the API response shapes
export interface QueryStats {
  findings: number;
  concepts: number;
  sources: number;
  threads: number;
  cost: number;
  last_step_at: string | null;
  findings_by_day: number[]; // length 7, oldest → newest
  latest_post_mortem: { verdict: 'pass' | 'flag'; flags: string[]; created_at: string } | null;
}

export type PromptShape = 'answer' | 'list' | 'table' | 'brief' | 'dataset';
export type PromptDepth = 'shallow' | 'normal' | 'deep';
export type PromptAudience = 'self' | 'team' | 'external';
export type PromptUrgency = 'fast' | 'thorough';

export interface PromptHints {
  shape?: PromptShape;
  depth?: PromptDepth;
  audience?: PromptAudience;
  urgency?: PromptUrgency;
}

export interface IterationCorrection {
  kill_threads?: string[];
  narrow_sources?: string[];
  scope_change?: string;
}

export interface AppliedAction {
  action: 'kill_thread' | 'narrow_sources' | 'scope_change_proposed';
  target?: string;
  detail?: string;
  ok: boolean;
  error?: string;
}

export interface IterationCheckRecord {
  id: string;
  session_id: string;
  job_id: string | null;
  iterations_completed: number;
  verdict: 'on_track' | 'drifting' | 'needs_correction';
  notes: string;
  correction: IterationCorrection | null;
  applied_actions: AppliedAction[];
  created_at: string;
}

export interface PostMortemRecord {
  id: string;
  session_id: string;
  job_id: string | null;
  verdict: 'pass' | 'flag';
  flags: string[];
  notes: string;
  recommendations: string[];
  metrics_snapshot: {
    metrics?: {
      findings: number;
      threads_active: number;
      threads_total: number;
      cost_usd: number;
      errors: number;
      steps: number;
      duration_ms: number;
    };
    thread_state?: { by_status: Record<string, number>; stuck_count: number; pruned_count: number };
    source_health?: { failure_rate: number; total_attempts: number; top_failing_domains: Array<{ domain: string; count: number }> };
  };
  created_at: string;
}

export function useIterationChecks(sessionId: string) {
  return useQuery({
    queryKey: ['research-iteration-checks', sessionId],
    queryFn: () => api.get<IterationCheckRecord[]>(`/research/queries/${sessionId}/iteration-checks`),
    enabled: !!sessionId,
    refetchInterval: 5000,
  });
}

export function usePostMortems(sessionId: string) {
  return useQuery({
    queryKey: ['research-post-mortems', sessionId],
    queryFn: () => api.get<PostMortemRecord[]>(`/research/queries/${sessionId}/post-mortems`),
    enabled: !!sessionId,
    refetchInterval: 10000,
  });
}

export type QuestionShape =
  | 'survey' | 'timeline' | 'list' | 'dynamics'
  | 'comparison' | 'lookup' | 'audit';

export interface ShapeLens {
  shape: QuestionShape;
  criterion: string;
}

export interface ShapeAnalysis {
  shapes: QuestionShape[];
  lenses: ShapeLens[];
  confidence: number;
}

export interface ResearchQuery {
  id: string;
  title: string;
  prompt: string;
  prompt_short: string | null;
  prompt_super_short: string | null;
  prompt_hints: PromptHints;
  question_shape: ShapeAnalysis | null;
  status: 'active' | 'paused' | 'exhausted' | 'halted' | 'completed' | 'archived';
  config: Record<string, unknown>;
  summary: string;
  document: string;
  user_notes: string;
  created_at: string;
  updated_at: string;
  stats?: QueryStats; // populated by GET /research/queries (list endpoint)
}

export interface SteeringNote {
  id: string;
  session_id: string;
  text: string;
  applied_at: string | null;
  created_at: string;
}

export interface LeadModification {
  id: string;
  plan_id: string;
  action: 'veto' | 'boost' | 'deprioritize' | 'inject' | 'note' | 'config_change';
  target_item_rank: number | null;
  target_thread_id: string | null;
  payload: string;
  source: string;
  applied_at: string | null;
  created_at: string;
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
      dedup_similarity: number;
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

// --- Summary (cross-session roll-up) ---
export interface ResearchSummary {
  topConcepts: Array<{
    name: string;
    session_count: number;
    finding_count: number;
  }>;
  extractionQueue: {
    running: number;
    pending: number;
    failed: number;
    total: number;
  };
  stepsPerHour: number;
  recentConcepts: Array<{
    name: string;
    session_id: string;
    session_title: string;
    created_at: string;
  }>;
}

export function useResearchSummary() {
  return useQuery({
    queryKey: ['research-summary'],
    queryFn: () => api.get<ResearchSummary>('/research/summary'),
    refetchInterval: 15000,
  });
}

// --- Error status (credit/rate/overload) ---
export type ErrorKind = 'credit_exhausted' | 'rate_limit' | 'overload';

export interface SessionErrorStatus {
  session_id: string;
  session_title: string;
  error_kind: ErrorKind;
  model: string;
  count: number;
  last_at: string;
  last_message: string;
}

export interface ErrorStatusReport {
  worst: ErrorKind | null;
  sessions: SessionErrorStatus[];
}

export function useResearchErrorStatus() {
  return useQuery({
    queryKey: ['research-error-status'],
    queryFn: () => api.get<ErrorStatusReport>('/research/error-status'),
    refetchInterval: 15000,
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

// --- Research defaults (persisted SessionConfig) ---
export interface ResearchDefaults {
  budget_daily_usd: number;
  budget_total_usd: number | null;
  budget_alert_threshold: number;
  max_thread_depth: number;
  max_total_threads: number;
  p_serendipity: number;
  max_perturbation_probability: number;
  novelty_threshold: number;
  dedup_similarity_threshold: number;
  diminishing_returns_threshold: number;
  diminishing_returns_window: number;
  min_delay_between_steps_ms: number;
  max_steps_per_hour: number;
  max_concurrent_threads: number;
  model: string;
  providers: { primary: 'openrouter'; openrouter_models: string[] };
  schedule: { mode: string; active_windows: unknown[]; timezone: string };
  topic_coherence: { seed_similarity_min: number; hop_similarity_min: number };
  follow_up: { min_count: number; max_count: number; max_retries: number; similarity_threshold: number };
  perturbation: {
    depth_scaling: boolean;
    chain_length: number;
    strategy_cooldown: number;
    forced_diversity_threshold: number;
    strategy_weights: Record<string, number>;
  };
  burst_iterations: number;
  min_searches_per_thread: number;
  fetch_source_text: boolean;
  gap_analysis: { enabled: boolean; max_gap_searches: number };
  llm_max_output_tokens: number;
  snippet_synthesis_chars: number;
  snippet_display_chars: number;
}

export function useResearchDefaults() {
  return useQuery({
    queryKey: ['research-defaults'],
    queryFn: () => api.get<ResearchDefaults>('/research/defaults'),
    staleTime: 30_000,
  });
}

export function useUpdateResearchDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ResearchDefaults>) =>
      api.put<ResearchDefaults>('/research/defaults', patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['research-defaults'] });
    },
  });
}

export function useResetResearchDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ResearchDefaults>('/research/defaults/reset', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-defaults'] }),
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
    mutationFn: (data: { prompt: string; hints?: PromptHints; title?: string; mode?: 'live' | 'deep'; config?: Record<string, unknown> }) =>
      api.post<ResearchQuery>('/research/queries', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-queries'] }),
  });
}

/** @deprecated Use useCreateResearchQuery */
export const useCreateResearchSession = useCreateResearchQuery;

export function useUpdateResearchQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string; status?: string; title?: string; question_shape?: ShapeAnalysis | null }) =>
      api.patch<ResearchQuery>(`/research/queries/${id}`, data),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['research-queries'] });
      qc.invalidateQueries({ queryKey: ['research-queries', vars.id] });
    },
  });
}

/** Promote a paused/live session to long-lived. Clears the wall-clock cap,
 *  widens limits back toward defaults, flips status to 'active'. */
export function usePromoteResearchQuery() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      api.post<ResearchQuery>(`/research/queries/${id}/promote`, {}),
    onSuccess: (_, id) => {
      qc.invalidateQueries({ queryKey: ['research-queries'] });
      qc.invalidateQueries({ queryKey: ['research-queries', id] });
    },
  });
}

export function useSteeringNotes(sessionId: string) {
  return useQuery({
    queryKey: ['research-nudges', sessionId],
    queryFn: () => api.get<{ notes: SteeringNote[]; lead_modifications: LeadModification[] }>(`/research/queries/${sessionId}/nudges`),
    enabled: !!sessionId,
    refetchInterval: 5000,
  });
}

export function useCreateSteeringNote() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId, text }: { sessionId: string; text: string }) =>
      api.post<SteeringNote>(`/research/queries/${sessionId}/nudges`, { text }),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['research-nudges', vars.sessionId] });
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

export interface ConceptWithStats {
  id: string;
  session_id: string;
  canonical_name: string;
  aliases: string[];
  summary: string;
  key_facts: string[];
  finding_count: number;
  source_count: number;
  created_at: string;
  updated_at: string;
}

export interface ConceptLink {
  id: string;
  session_id: string;
  from_concept_id: string;
  to_concept_id: string;
  relation: string;
  evidence_finding_ids: string[];
  created_at: string;
}

export interface ConceptDetail extends ConceptWithStats {
  finding_ids: string[];
  sources: Array<{ url: string; title: string; snippet: string }>;
}

export function useConcepts(sessionId: string) {
  return useQuery({
    queryKey: ['research-concepts', sessionId],
    queryFn: () => api.get<ConceptWithStats[]>(`/research/queries/${sessionId}/concepts`),
    enabled: !!sessionId,
    refetchInterval: 15_000,
  });
}

export function useConceptLinks(sessionId: string) {
  return useQuery({
    queryKey: ['research-concept-links', sessionId],
    queryFn: () => api.get<ConceptLink[]>(`/research/queries/${sessionId}/concept-links`),
    enabled: !!sessionId,
    refetchInterval: 15_000,
  });
}

export function useConceptDetail(sessionId: string, conceptId: string | null) {
  return useQuery({
    queryKey: ['research-concept', sessionId, conceptId],
    queryFn: () => api.get<ConceptDetail>(
      `/research/queries/${sessionId}/concepts/${conceptId ?? ''}`
    ),
    enabled: !!sessionId && !!conceptId,
  });
}

export type SourceExtractionStatus = 'pending' | 'extracted' | 'failed' | 'skipped' | 'claimed';

export interface Source {
  id: string;
  session_id: string;
  url: string;
  title: string;
  snippet: string;
  extraction_status: SourceExtractionStatus;
  extracted_text: string | null;
  extracted_at: string | null;
  fetched_at: string | null;
  error: string | null;
  attempt_count: number;
  created_at: string;
  updated_at: string;
}

export interface SourcesResponse {
  items: Source[];
  counts: Record<'pending' | 'extracted' | 'failed' | 'skipped', number>;
}

export function useSources(sessionId: string, status?: SourceExtractionStatus | 'all') {
  const q = status && status !== 'all' ? `?status=${status}` : '';
  return useQuery({
    queryKey: ['research-sources', sessionId, status ?? 'all'],
    queryFn: () => api.get<SourcesResponse>(`/research/queries/${sessionId}/sources${q}`),
    enabled: !!sessionId,
    refetchInterval: 10_000,
  });
}

export function useRetrySource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId }: { sourceId: string; sessionId: string }) =>
      api.post<Source>(`/research/sources/${sourceId}/retry`, {}),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['research-sources', vars.sessionId] }),
  });
}

export function useSkipSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sourceId }: { sourceId: string; sessionId: string }) =>
      api.post<Source>(`/research/sources/${sourceId}/skip`, {}),
    onSuccess: (_, vars) => qc.invalidateQueries({ queryKey: ['research-sources', vars.sessionId] }),
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
  error_kind: string | null;
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
export interface ResearchPlanEnvelope {
  plan: ResearchPlan | null;
  status: 'pending' | 'ready';
}

export function useResearchPlan(sessionId: string) {
  return useQuery({
    queryKey: ['research-plan', sessionId],
    queryFn: () => api.get<ResearchPlanEnvelope>(`/research/queries/${sessionId}/plan`),
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

// --- Manual post-mortem re-review ---
export function useRunPostMortem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ sessionId }: { sessionId: string }) =>
      api.post<PostMortemRecord | null>(`/research/queries/${sessionId}/post-mortem`, {}),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: ['research-post-mortems', vars.sessionId] });
      // Refresh listing card chips that read latest_post_mortem from QueryStats.
      qc.invalidateQueries({ queryKey: ['research-queries'] });
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
export type StreamSessionEvent = {
  id: string;
  title: string;
  prompt: string;
  status: string;
  updated_at: string;
};

export type StreamEvent = (
  | { type: 'finding'; payload: ResearchFinding }
  | { type: 'thread'; payload: ResearchThread }
  | { type: 'step'; payload: ResearchStep }
  | { type: 'job'; payload: ResearchJob }
  | { type: 'session'; payload: StreamSessionEvent }
  | { type: 'query'; payload: ResearchQuery }
) & { _seq?: number };

// Cross-session: single multiplexed stream for workers page / global activity rail.
// Only accumulates into the `events` list — no query-cache writes.
export function useCrossSessionStream(enabled = true, maxEvents = 200) {
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!enabled) return;
    const es = new EventSource(`/api/research/stream`);

    es.onmessage = (event: MessageEvent) => {
      try {
        const parsed: StreamEvent = JSON.parse(event.data);
        parsed._seq = ++seqRef.current;
        setEvents(prev => [parsed, ...prev].slice(0, maxEvents));
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => { /* EventSource auto-reconnects */ };

    return () => es.close();
  }, [enabled, maxEvents]);

  return { events };
}


export function useResearchStream(sessionId: string, enabled = true) {
  const qc = useQueryClient();
  const [events, setEvents] = useState<StreamEvent[]>([]);
  const seqRef = useRef(0);

  useEffect(() => {
    if (!sessionId || !enabled) return;
    const es = new EventSource(`/api/research/queries/${sessionId}/stream`);

    es.onmessage = (event: MessageEvent) => {
      try {
        const parsed: StreamEvent = JSON.parse(event.data);
        parsed._seq = ++seqRef.current;

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
        } else if (parsed.type === 'query') {
          qc.setQueryData(['research-queries', sessionId], parsed.payload);
        }

        if (parsed.type !== 'job') {
          setEvents(prev => {
            // Dedup: server resends everything on reconnect (each connection has fresh cursors).
            // Finding/step rows are immutable — match by payload.id.
            // Thread rows mutate — match by (id, status, updated_at) so status transitions still emit.
            if (parsed.type === 'finding' || parsed.type === 'step') {
              const id = (parsed.payload as { id: string }).id;
              if (prev.some(e => e.type === parsed.type && (e.payload as { id: string }).id === id)) return prev;
            } else if (parsed.type === 'thread') {
              const t = parsed.payload;
              if (prev.some(e => {
                if (e.type !== 'thread') return false;
                const p = e.payload;
                return p.id === t.id && p.status === t.status && p.updated_at === t.updated_at;
              })) return prev;
            }
            return [parsed, ...prev].slice(0, 1000);
          });
        }
      } catch { /* ignore parse errors */ }
    };

    es.onerror = () => {
      // EventSource auto-reconnects — no action needed
    };

    return () => es.close();
  }, [sessionId, qc, enabled]);

  return { events };
}

// ---------------------------------------------------------------------------
// Metrics — job lifecycle, source health, thread state, job traces, cost trajectory
// ---------------------------------------------------------------------------

export interface DurationStats {
  p50: number;
  p95: number;
  avg: number;
  max: number;
  count: number;
}

export interface JobLifecycleMetrics {
  total: number;
  by_status: Record<string, number>;
  queue_wait_ms: DurationStats | null;
  claim_to_start_ms: DurationStats | null;
  duration_ms: DurationStats | null;
  total_ms: DurationStats | null;
  by_worker: Array<{
    worker_id: string;
    total: number;
    completed: number;
    failed: number;
    cancelled: number;
    running: number;
    avg_duration_ms: number | null;
    cost_usd: number;
    steps: number;
  }>;
  by_mode: Record<string, number>;
}

export interface SourceHealthMetrics {
  total: number;
  by_status: Record<string, number>;
  failure_rate: number;
  avg_attempts_on_failure: number | null;
  top_failure_reasons: Array<{ reason: string; count: number; sample_url: string }>;
  top_failing_domains: Array<{ domain: string; failed: number; total: number; rate: number }>;
  recent_failures: Array<{ id: string; url: string; error: string | null; attempt_count: number; updated_at: string }>;
}

export interface ThreadStateMetrics {
  by_status: Record<string, { count: number; time_in_state_ms: DurationStats | null }>;
  stuck_threads: Array<{
    id: string;
    short_query: string | null;
    query: string;
    status: string;
    updated_at: string;
    stuck_for_ms: number;
  }>;
  transitions_observed: number;
}

export interface JobTracePhase {
  name: 'created' | 'claimed' | 'started' | 'completed';
  at: string;
  offset_ms: number;
}

export interface JobTraceStep {
  id: string;
  thread_id: string;
  label: string | null;
  model: string;
  provider: string | null;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  duration_ms: number;
  created_at: string;
  offset_ms: number;
  error: string | null;
}

export interface JobTrace {
  job: ResearchJob;
  thread: ResearchThread | null;
  phases: JobTracePhase[];
  steps: JobTraceStep[];
  total_cost_usd: number;
  total_tokens: number;
  total_duration_ms: number | null;
}

export interface SessionCostTrajectory {
  total_cost_usd: number;
  total_tokens: number;
  total_steps: number;
  by_model: Array<{ model: string; cost: number; steps: number; tokens: number }>;
  by_provider: Array<{ provider: string; cost: number; steps: number }>;
  series: Array<{ at: string; cumulative_cost_usd: number; cumulative_tokens: number; step_id: string; model: string }>;
}

export function useJobMetrics(sessionId: string, opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['research-metrics-jobs', sessionId],
    queryFn: () => api.get<JobLifecycleMetrics>(`/research/queries/${sessionId}/metrics/jobs`),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval ?? 10_000,
  });
}

export function useGlobalJobMetrics(opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['research-metrics-jobs-global'],
    queryFn: () => api.get<JobLifecycleMetrics>('/research/metrics/jobs'),
    refetchInterval: opts?.refetchInterval ?? 30_000,
  });
}

export function useSourceHealth(sessionId: string, opts?: { refetchInterval?: number; limit?: number }) {
  return useQuery({
    queryKey: ['research-metrics-sources', sessionId, opts?.limit ?? 25],
    queryFn: () => api.get<SourceHealthMetrics>(
      `/research/queries/${sessionId}/metrics/sources${opts?.limit ? `?limit=${opts.limit}` : ''}`
    ),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval ?? 10_000,
  });
}

export function useGlobalSourceHealth(opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['research-metrics-sources-global'],
    queryFn: () => api.get<SourceHealthMetrics>('/research/metrics/sources'),
    refetchInterval: opts?.refetchInterval ?? 30_000,
  });
}

export function useThreadStateMetrics(sessionId: string, opts?: { refetchInterval?: number; stuckThresholdMs?: number }) {
  const qs = opts?.stuckThresholdMs ? `?stuck_threshold_ms=${opts.stuckThresholdMs}` : '';
  return useQuery({
    queryKey: ['research-metrics-threads', sessionId, opts?.stuckThresholdMs ?? 300000],
    queryFn: () => api.get<ThreadStateMetrics>(`/research/queries/${sessionId}/metrics/threads${qs}`),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval ?? 5000,
  });
}

export function useJobTrace(jobId: string | null, opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['research-job-trace', jobId],
    queryFn: () => api.get<JobTrace>(`/research/jobs/${jobId}/trace`),
    enabled: !!jobId,
    refetchInterval: opts?.refetchInterval,
  });
}

export function useSessionCostTrajectory(sessionId: string, opts?: { refetchInterval?: number }) {
  return useQuery({
    queryKey: ['research-cost-trajectory', sessionId],
    queryFn: () => api.get<SessionCostTrajectory>(`/research/queries/${sessionId}/metrics/cost-trajectory`),
    enabled: !!sessionId,
    refetchInterval: opts?.refetchInterval,
  });
}
