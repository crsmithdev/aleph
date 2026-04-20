export interface ResearchQuery {
  id: string;
  title: string;
  prompt: string;
  prompt_short: string | null;
  prompt_super_short: string | null;
  prompt_hints: PromptHints;
  interpretation: InterpretedPrompt | null;
  status: 'active' | 'paused' | 'exhausted' | 'halted' | 'completed' | 'archived';
  config: SessionConfig;
  summary: string;
  document: string;
  user_notes: string;
  intent: string | null;
  output_shape: OutputShape | null;
  created_at: string;
  updated_at: string;
}

/** Shape the user wants the final answer to take — used by the leader to steer
 *  pruning/spawning, and by the synthesizer to format the doc. */
export type OutputShape = 'list_of_entities' | 'overview' | 'comparison' | 'timeline' | 'how_to';

export interface SteeringNote {
  id: string;
  session_id: string;
  text: string;
  applied_at: string | null;
  created_at: string;
}

export interface InterpretedPrompt {
  intent: string;
  shape: PromptShape;
  depth: PromptDepth;
  scope: string;
  dispatch_params?: Record<string, unknown>;
}

/** @deprecated Use ResearchQuery */
export type ResearchSession = ResearchQuery;

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

export interface SessionConfig {
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
  topic_coherence: {
    seed_similarity_min: number;  // 0 = disabled; min jaccard similarity to original seed query
    hop_similarity_min: number;   // 0 = disabled; min jaccard similarity to parent thread query
  };
  model: string;
  providers: {
    primary: 'openrouter';
    openrouter_models: string[];
  };
  schedule: {
    mode: 'background' | 'scheduled' | 'burst';
    active_windows: Array<{
      days: string[];
      start: string;
      end: string;
    }>;
    timezone: string;
  };
  perturbation: PerturbationConfig;
  follow_up: {
    min_count: number;        // default 2
    max_count: number;        // default 5 — hard cap on spawned follow-ups per iteration
    max_retries: number;      // default 3
    similarity_threshold: number; // default 0.75
  };
  burst_iterations: number;
  min_searches_per_thread: number;
  fetch_source_text: boolean;
  gap_analysis: {
    enabled: boolean;
    max_gap_searches: number;
    // 'per_finding' fires gap analysis after every finding (legacy, noisy).
    // 'periodic' runs a lead review every `every_n_findings` completed findings (recommended).
    // Optional so that `Partial<SessionConfig>` fixtures can omit them; code paths
    // tolerate undefined and default to 'periodic' / 10.
    mode?: 'per_finding' | 'periodic';
    every_n_findings?: number;
  };
  llm_max_output_tokens: number;     // per-call LLM output ceiling
  snippet_synthesis_chars: number;   // chars per search result passed to synthesis
  snippet_display_chars: number;     // chars per source stored for citation UI
}

export interface PerturbationConfig {
  depth_scaling: boolean;
  chain_length: number;
  strategy_cooldown: number;
  forced_diversity_threshold: number;
  strategy_weights: Record<string, number>;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  budget_daily_usd: 5.0,
  budget_total_usd: null,
  budget_alert_threshold: 0.80,
  max_thread_depth: 2,
  max_total_threads: 60,
  p_serendipity: 0.15,
  max_perturbation_probability: 0.40,
  novelty_threshold: 0.3,
  dedup_similarity_threshold: 0.85,
  diminishing_returns_threshold: 0.25,
  diminishing_returns_window: 20,
  min_delay_between_steps_ms: 8000,
  max_steps_per_hour: 30,
  max_concurrent_threads: 3,
  model: 'deepseek/deepseek-chat',
  providers: {
    primary: 'openrouter',
    openrouter_models: [
      'deepseek/deepseek-chat',
    ],
  },
  schedule: {
    mode: 'background',
    active_windows: [],
    timezone: 'America/Los_Angeles',
  },
  follow_up: {
    min_count: 1,
    max_count: 2,
    max_retries: 3,
    similarity_threshold: 0.75,
  },
  topic_coherence: {
    seed_similarity_min: 0.0,
    hop_similarity_min: 0.0,
  },
  burst_iterations: 10,
  min_searches_per_thread: 1,
  fetch_source_text: false,
  gap_analysis: {
    enabled: true,
    max_gap_searches: 2,
    mode: 'periodic',
    every_n_findings: 10,
  },
  llm_max_output_tokens: 8192,
  snippet_synthesis_chars: 3000,
  snippet_display_chars: 200,
  perturbation: {
    depth_scaling: true,
    chain_length: 2,
    strategy_cooldown: 3,
    forced_diversity_threshold: 5,
    strategy_weights: {
      analogical: 1.0,
      contrarian: 0.8,
      persona_injection: 1.0,
      negation: 0.6,
      geographic: 1.0,
      temporal_shift: 0.8,
      scale_shift: 0.6,
      economics: 0.7,
      citation_chain: 1.2,
      social_graph: 1.0,
      adjacent_community: 0.9,
      supply_chain: 0.7,
      news_injection: 0.8,
      cross_session: 1.0,
      user_interest: 0.5,
      metaphor: 0.4,
      people_deep_dive: 1.0,
      failure_post_mortem: 0.9,
      second_order: 0.8,
      regulatory: 0.7,
      academic: 0.8,
    },
  },
};

export type ThreadOrigin = 'seed' | 'follow_up' | 'perturbation' | 'user_injected' | 'monitor_alert' | 'verify' | 'gap_analysis' | 'lead_review';
export type ThreadStatus = 'queued' | 'active' | 'paused' | 'exhausted' | 'pruned' | 'deferred';

// All 21 perturbation strategies from spec §3.3
export type PerturbationStrategy =
  // Perspective shifts
  | 'analogical'
  | 'contrarian'
  | 'persona_injection'
  | 'negation'
  // Dimensional shifts
  | 'geographic'
  | 'temporal_shift'
  | 'scale_shift'
  | 'economics'
  // Network walking
  | 'citation_chain'
  | 'social_graph'
  | 'adjacent_community'
  | 'supply_chain'
  // Knowledge injection
  | 'news_injection'
  | 'cross_session'
  | 'user_interest'
  | 'metaphor'
  // Deepening
  | 'people_deep_dive'
  | 'failure_post_mortem'
  | 'second_order'
  | 'regulatory'
  | 'academic';

export interface ResearchThread {
  id: string;
  session_id: string;
  parent_thread_id: string | null;
  spawned_from_finding_id: string | null;
  query: string;
  short_query: string | null;
  node_type: 'question' | 'topic';
  origin: ThreadOrigin;
  perturbation_strategy: PerturbationStrategy | null;
  status: ThreadStatus;
  priority: number;
  depth: number;
  max_depth: number;
  min_searches: number | null;
  fetch_source_text?: boolean | null;
  seed_similarity: number | null;
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
  source_quality: number;
  tags: string[];
  confidence: number;
  novelty: number;
  actionability: number;
  user_rating: 'promising' | 'not_useful' | 'critical' | null;
  follow_ups: string[];
  follow_up_analysis?: FollowUpAnalysis;
  created_at: string;
}

export interface Concept {
  id: string;
  session_id: string;
  canonical_name: string;
  aliases: string[];
  summary: string;
  key_facts: string[];
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

export interface ConceptWithStats extends Concept {
  finding_count: number;
  source_count: number;
}

export type SourceExtractionStatus = 'pending' | 'extracted' | 'failed' | 'skipped';

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

export interface ResearchStep {
  id: string;
  thread_id: string;
  session_id: string;
  finding_id: string | null;
  model: string;
  provider: string;
  prompt_tokens: number;
  completion_tokens: number;
  cost_usd: number;
  tool_calls: ToolCallRecord[];
  duration_ms: number;
  error: string | null;
  label: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface JinaFetchRecord {
  url: string;
  ok: boolean;
  content_length: number;
  error?: string;
}

export interface ToolCallRecord {
  tool: string;
  input: Record<string, unknown>;
  output?: string;
  error?: string;
  jina_fetches?: JinaFetchRecord[];
}

export interface FollowUpCandidate {
  text: string;
  quality_score: number;       // 0–1: relevance + specificity + focus
  dedup_similarity: number;    // max similarity vs previously-accepted candidates (0.0 = first candidate, no prior comparisons)
  embedding_similarity: number | null;
  llm_similarity: number | null;
  similarity_method: 'jaccard' | 'embedding' | 'llm';
  distance_from_parent: number; // 0–1: 1 - jaccardSimilarity(question, parentQuery)
  rank_score: number;          // composite: 0.40*quality + 0.30*distance + 0.30*(1-max_sim)
  accepted: boolean;
  rejection_reason: string | null;
}

export interface FollowUpAnalysis {
  candidates: FollowUpCandidate[];
  similarity_threshold: number;
  retry_count: number;
  min_required: number;
}

export type StepMetadata =
  | { decision: 'gap_analysis'; has_gaps: boolean; gap_count: number; gap_queries: string[] }
  | { decision: 'synthesis'; confidence: number; novelty: number; actionability: number; tags: string[] }
  | { decision: 'dedup'; is_duplicate: boolean; existing_count: number }
  | { decision: 'follow_up_eval'; accepted_count: number; rejected_count: number; retry_count: number }

export interface ResearchPlan {
  id: string;
  session_id: string; // FK to research_queries
  items: ResearchPlanItem[];
  generated_at: string;
  status: 'proposed' | 'acknowledged' | 'modified';
}

export interface ResearchPlanItem {
  rank: number;
  thread_id: string;
  thread_query: string;
  parent_thread_title: string | null;
  origin: ThreadOrigin;
  perturbation_strategy: PerturbationStrategy | null;
  estimated_cost: number;
  rationale: string;
}

export interface PlanModification {
  id: string;
  plan_id: string;
  action: 'veto' | 'boost' | 'deprioritize' | 'inject' | 'note' | 'config_change';
  target_item_rank: number | null;
  target_thread_id: string | null;
  payload: string;
  source: string;
  raw_input: string | null;
  applied_at: string | null;
  created_at: string;
}

// === Monitor Types ===

export interface Monitor {
  id: string;
  session_id: string | null;
  title: string;
  status: 'active' | 'paused' | 'archived';
  queries: string[];
  fetch_urls: string[];
  schedule: string;
  timezone: string;
  match_criteria: MatchCriteria;
  model: string;
  cost_per_cycle_estimate: number;
  budget_daily_usd: number | null;
  created_at: string;
  updated_at: string;
}

export interface MatchCriteria {
  keywords_include?: string[];
  keywords_exclude?: string[];
  price_range?: { min: number; max: number } | null;
  location_filter?: string | null;
  relevance_prompt?: string;
  urgency_rules?: string;
  severity_rules?: { urgent: string; notable: string };
}

export interface MonitorSnapshot {
  id: string;
  monitor_id: string;
  cycle_number: number;
  raw_results: string;
  result_hash: string;
  item_count: number;
  cost_usd: number;
  created_at: string;
}

export interface MonitorAlert {
  id: string;
  monitor_id: string;
  snapshot_id: string;
  alert_type: 'new_item' | 'removed_item' | 'changed_item' | 'threshold_crossed' | 'custom';
  title: string;
  content: string;
  source_url: string | null;
  matched_criteria: string[];
  severity: 'info' | 'notable' | 'urgent';
  status: 'unread' | 'read' | 'acted_on' | 'dismissed';
  spawned_thread_id: string | null;
  created_at: string;
}

export interface ProposedMonitor {
  id: string;
  session_id: string;
  thread_id: string;
  proposed_queries: string[];
  proposed_fetch_urls: string[];
  proposed_criteria: MatchCriteria;
  proposed_schedule: string;
  rationale: string;
  status: 'proposed' | 'accepted' | 'rejected';
  created_at: string;
}

// === Job Types ===

export type JobStatus = 'pending' | 'claimed' | 'running' | 'completed' | 'failed' | 'cancelled';
export type JobMode = 'burst' | 'background' | 'scheduled';

export interface ResearchJob {
  id: string;
  session_id: string;
  thread_id: string | null;
  status: JobStatus;
  mode: JobMode;
  max_iterations: number | null;
  iterations_completed: number;
  claimed_by: string | null;
  claimed_at: string | null;
  heartbeat_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

// Cost calculation constants (per 1M tokens)
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.80, output: 4.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  'deepseek/deepseek-chat': { input: 0.27, output: 1.10 },
  'deepseek/deepseek-chat-v3': { input: 0.27, output: 1.10 },
};
