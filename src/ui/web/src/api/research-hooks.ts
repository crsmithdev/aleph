/**
 * Research hooks — the slimmed-down post-Phase-7 surface.
 *
 * The loops engine replaced every legacy hook that touched research_queries
 * / research_findings / research_threads / research_jobs etc. What's left
 * here is the surface the surviving UI still consumes:
 *
 *   - useResearchQueries → adapts /api/loops into the legacy ResearchQuery
 *     shape so the History/Landing rendering still works unchanged.
 *   - useResearchStats   → /api/loops/stats; KPI strip on Landing.
 *   - useProviderConfig / useUpdateProviderConfig → /research/config (the
 *     two endpoints that survive Phase 7 deletion of routes/research.ts).
 *   - useResearchDefaults / useUpdateResearchDefaults / useResetResearchDefaults
 *     → /research/defaults (likewise survives).
 *
 * The legacy types (PromptHints, ShapeAnalysis, QueryStats, etc.) stay
 * because ResearchQuery embeds them; loops adapt to null-valued versions
 * so the History table's columns gracefully render dashes.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from './client';

// ---- ResearchQuery legacy shape (kept so History/Landing render unchanged) ----

export interface QueryStats {
  findings: number;
  concepts: number;
  sources: number;
  threads: number;
  cost: number;
  last_step_at: string | null;
  findings_by_day: number[];
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

/** Coarse subject-matter cluster paired with classifier confidence.
 *  Distinct from `ShapeAnalysis` (structural). */
export interface TopicClusterAnalysis {
  cluster: TopicCluster;
  confidence: number;
}

export type TopicCluster =
  | 'AI / LLM tooling'
  | 'Music history'
  | 'Databases'
  | 'Audio & DSP'
  | 'Personal infra'
  | 'Misc';

export const TOPIC_CLUSTERS: readonly TopicCluster[] = [
  'AI / LLM tooling',
  'Music history',
  'Databases',
  'Audio & DSP',
  'Personal infra',
  'Misc',
] as const;

export interface ResearchQuery {
  id: string;
  title: string;
  prompt: string;
  prompt_short: string | null;
  prompt_super_short: string | null;
  prompt_hints: PromptHints;
  question_shape: ShapeAnalysis | null;
  topic_cluster: TopicClusterAnalysis | null;
  status: 'active' | 'paused' | 'exhausted' | 'halted' | 'completed' | 'archived';
  config: Record<string, unknown>;
  summary: string;
  document: string;
  user_notes: string;
  created_at: string;
  updated_at: string;
  stats?: QueryStats;
}

// ---- Stats (loops-flavored, served by /api/loops/stats) -------------------

export interface ResearchStatsData {
  totalSessions: number;
  activeSessions: number;
  totalFindings: number;
  totalThreads: number;
  totalCost: number;
  avgConfidence: number;
  avgNovelty: number;
  passRate: number;
  flagRate: number;
  haltRate: number;
  byDay: Array<{ date: string; sessions: number; findings: number; cost: number }>;
  byVerdict: Array<{ date: string; pass: number; flag: number; halt: number }>;
}

export function useResearchStats(range: string, granularity: string) {
  const params = new URLSearchParams({ range });
  return useQuery({
    // granularity is retained in the queryKey so the cache invalidates if a
    // caller toggles between day/hour even though the loops endpoint always
    // returns daily buckets — the UI just renders whatever resolution it gets.
    queryKey: ['loops-stats', range, granularity],
    queryFn: () => api.get<ResearchStatsData>(`/loops/stats?${params}`),
  });
}

// ---- Provider config (surviving /research/config endpoint) ----------------

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
    mutationFn: (data: Record<string, unknown>) => api.patch('/research/config', data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-config'] }),
  });
}

// ---- Research defaults (surviving /research/defaults endpoint) -----------

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
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-defaults'] }),
  });
}

export function useResetResearchDefaults() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<ResearchDefaults>('/research/defaults/reset', {}),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['research-defaults'] }),
  });
}

// ---- Queries (loops-only, adapted to ResearchQuery shape) ----------------

interface LoopRow {
  id: string;
  template_id: string;
  status: string;
  prompt: string;
  envelope: Record<string, unknown>;
  envelope_consumed: Record<string, number>;
  created_at: string;
  updated_at: string;
}

/** Map a loop's engine status onto `ResearchQuery`'s status union so the
 *  history table's status filters / badges / dots still resolve. */
function mapLoopStatus(s: string): ResearchQuery['status'] {
  switch (s) {
    case 'pending':
    case 'running':   return 'active';
    case 'paused':    return 'paused';
    case 'completed': return 'completed';
    case 'failed':
    case 'cancelled': return 'halted';
    default:          return 'active';
  }
}

/** Adapter: present a `loops` row as if it were a `ResearchQuery` so the
 *  unified `/research/history` table can render it with no per-row branching.
 *  Loops don't carry pre-detected shape/topic — surfaced as null here; the
 *  table renders the dash. Config / summary / document / user_notes are
 *  stubbed (loops haven't collapsed them onto the schedule yet). */
function loopAsQuery(loop: LoopRow): ResearchQuery {
  return {
    id: loop.id,
    title: loop.prompt || loop.id,
    prompt: loop.prompt,
    prompt_short: null,
    prompt_super_short: null,
    prompt_hints: {} as PromptHints,
    question_shape: null,
    topic_cluster: null,
    status: mapLoopStatus(loop.status),
    config: {},
    summary: '',
    document: '',
    user_notes: '',
    created_at: loop.created_at,
    updated_at: loop.updated_at,
  };
}

export function useResearchQueries(_status?: string) {
  // Loops are the only research backend post-Phase 7. The `_status` argument
  // is preserved on the hook signature so existing call sites still type-check
  // but is currently ignored — the loops endpoint doesn't support status
  // filtering and the in-memory filter the surviving UI does is fine for the
  // small loop counts we have.
  return useQuery({
    queryKey: ['research-queries'],
    queryFn: async () => {
      const loops = await api.get<LoopRow[]>(`/loops`);
      return loops.map(loopAsQuery).sort((a, b) => b.created_at.localeCompare(a.created_at));
    },
  });
}
