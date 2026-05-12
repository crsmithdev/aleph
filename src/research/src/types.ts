export interface ResearchQuery {
  id: string;
  title: string;
  prompt: string;
  prompt_short: string | null;
  prompt_super_short: string | null;
  prompt_hints: PromptHints;
  /** Detected structural shape of the question (survey, timeline, list,
   *  dynamics, comparison, lookup, audit). Null until the shape detector
   *  has run; an empty `shapes` array means detection ran but found
   *  nothing recognizable (rare). Multiple shapes when the prompt is
   *  mixed (e.g. survey + timeline + list). Each shape has a paired
   *  completeness criterion used by the planner to decide when its lens
   *  is satisfied. */
  question_shape: ShapeAnalysis | null;
  /** Coarse topic-cluster label (one of a fixed enum). Null until the
   *  classifier has run; persisted with confidence so the UI can show
   *  low-confidence assignments as muted. Distinct from `question_shape`
   *  (structural) — this is subject-matter. */
  topic_cluster: TopicClusterAnalysis | null;
  status: 'active' | 'paused' | 'exhausted' | 'halted' | 'completed' | 'archived';
  config: SessionConfig;
  summary: string;
  document: string;
  user_notes: string;
  created_at: string;
  updated_at: string;
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

/** Structural classification of a research question. Drives planner
 *  strategy: e.g. `survey`/`timeline`/`list` benefit from a canonical
 *  artifacts pass before depth-first exploration; `lookup` is one fact;
 *  `comparison` needs parity per side. Distinct from `PromptShape`,
 *  which describes desired output formatting. */
export type QuestionShape =
  | 'survey'      // "overview of X", "what is X" — wants breadth + canon
  | 'timeline'    // "history of X", "evolution of X" — wants chronological
  | 'list'        // "key X", "examples of X" — wants enumerated items
  | 'dynamics'    // "how does X work", "why did X happen" — wants causal narrative
  | 'comparison'  // "X vs Y", "tradeoffs" — wants axes + parity
  | 'lookup'      // "what was the X of Y" — wants single fact + source
  | 'audit';      // "is X complete", "is X true" — wants checklist + verification

export interface ShapeLens {
  shape: QuestionShape;
  /** Free-text completeness criterion the planner uses to decide whether
   *  this lens is satisfied. E.g. "list at least 10 key artists with
   *  their breakthrough tracks", "events for each year 1990–1999". */
  criterion: string;
}

export interface ShapeAnalysis {
  /** Detected shapes for the prompt. Multiple if mixed. */
  shapes: QuestionShape[];
  /** Per-shape completeness criteria. One lens per detected shape. */
  lenses: ShapeLens[];
  /** Detector confidence 0–1. The planner can fall back to a default
   *  strategy ('survey') when confidence is below ~0.5. */
  confidence: number;
}

/** Coarse subject-matter cluster for a research prompt. Locked enum so
 *  downstream UI/analytics can group consistently; `'Misc'` is the catch-all
 *  for prompts that don't fit any cluster. Distinct from `QuestionShape`,
 *  which describes the structure of the question rather than its topic. */
export type TopicCluster =
  | 'AI / LLM tooling'
  | 'Music history'
  | 'Databases'
  | 'Audio & DSP'
  | 'Personal infra'
  | 'Misc';

export interface TopicClusterAnalysis {
  cluster: TopicCluster;
  /** Classifier confidence 0–1. The UI may render low-confidence
   *  assignments as muted. */
  confidence: number;
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
  /** Floor on jaccard similarity between a perturbation's generated query
   *  and the seed prompt. Tuned much looser than topic_coherence (which
   *  applies to follow-ups) so creative angles still pass — the goal is
   *  to catch pure-tangent drift, not constrain creativity. A perturbation
   *  whose query falls below the floor is regenerated once; if the second
   *  attempt also fails, the perturbation is cancelled and a step is
   *  recorded (decision='perturbation_rejected'). 0 disables the check. */
  perturbation_coherence_floor: number;
  model: string;
  /** Cheap, fast model for short utility calls (YES/NO judges, dedup, thread
   *  titles, perturbation query gen). Defaults to model when null. Step rows
   *  record the actual model used so the events view shows fast vs primary. */
  model_fast?: string | null;
  /** Model for the milestone iteration-check hook ("is the loop on track or
   *  drifting?"). One cheap call per milestone (25/50/75% envelope). Defaults
   *  to gemini-2.0-flash-001 to match the document-polish pass. */
  iteration_check_model: string;
  /** Model for the post-mortem hook fired once on natural completion. One
   *  cheap call producing a final verdict + recommendations. Defaults to
   *  gemini-2.0-flash-001 to match the document-polish pass. */
  post_mortem_model: string;
  providers: {
    primary: 'openrouter';
    openrouter_models: string[];
  };
  schedule: {
    mode: 'default' | 'scheduled' | 'priority';
    active_windows: Array<{
      days: string[];
      start: string;
      end: string;
    }>;
    timezone: string;
    /** Live mode wall-clock cap. Null = no cap. Measured from query.created_at. */
    max_session_duration_minutes?: number | null;
  };
  /** What to do when max_session_duration_minutes elapses. Default 'pause' (promotable). */
  on_duration_expiry?: 'pause' | 'complete';
  /** Auto-pick a domain agent role at session creation (GPT-Researcher style). */
  role_priming_enabled?: boolean;
  /** Human-readable role label (e.g. "Finance Analyst"). Set by pickAgentRole or caller. */
  role_label?: string | null;
  /** System-prompt body threaded through answer-voice LLM calls. */
  role_prompt?: string | null;
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
  // Depth 0 = seed, depth 1 = children, depth 2 = grandchildren, ... .
  // Children at depth N can only spawn if N+1 < max_thread_depth (engine gate
  // at engine.ts:807). So max_thread_depth=2 caps the tree at 2 levels and
  // typically yields 2-4 threads — too narrow to fill an 8-worker pool. 3
  // gives ~7 threads (1 seed + 2 children + 4 grandchildren) on a typical
  // branching factor, which saturates the pool for most queries.
  max_thread_depth: 3,
  max_total_threads: 60,
  p_serendipity: 0.15,
  max_perturbation_probability: 0.40,
  novelty_threshold: 0.3,
  dedup_similarity_threshold: 0.85,
  diminishing_returns_threshold: 0.25,
  diminishing_returns_window: 20,
  min_delay_between_steps_ms: 8000,
  max_steps_per_hour: 30,
  // Capped at the worker pool size (default 8). Burst session-jobs only run
  // the seed thread; everything else fans out as thread-jobs that workers
  // claim in parallel, so this is the real per-session parallelism cap.
  max_concurrent_threads: 8,
  // DeepSeek v3.2 — non-reasoning chat model. Output cost is half of v3
  // ($0.378 vs $0.77), input slightly higher ($0.252 vs $0.20). Net win
  // because output dominates our token mix. v4 family is reasoning-only
  // and adds a hidden reasoning-token tax — not safe as a drop-in.
  model: 'deepseek/deepseek-v3.2',
  model_fast: 'google/gemini-2.0-flash-001',
  iteration_check_model: 'google/gemini-2.0-flash-001',
  post_mortem_model: 'google/gemini-2.0-flash-001',
  providers: {
    primary: 'openrouter',
    openrouter_models: [
      'deepseek/deepseek-v3.2',
    ],
  },
  schedule: {
    mode: 'default',
    active_windows: [],
    timezone: 'America/Los_Angeles',
    max_session_duration_minutes: null,
  },
  on_duration_expiry: 'pause',
  // On by default: pickAgentRole runs once at session creation and threads
  // a domain-expert system prompt through every answer-voice LLM call
  // (lead/synth/extract). Cost is one cheap model call. Disable per-query
  // via config.role_priming_enabled=false if you want raw default voice.
  role_priming_enabled: true,
  role_label: null,
  role_prompt: null,
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
  perturbation_coherence_floor: 0.05,
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

export type ThreadOrigin = 'seed' | 'follow_up' | 'perturbation' | 'user_injected' | 'monitor_alert' | 'verify' | 'gap_analysis' | 'lead_review' | 'canon_slot';
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

/** Kind of finding. Drives summary inclusion and confidence policy.
 *  - `normal`: standard finding from a seed/follow-up/canon-slot/gap thread.
 *  - `perturbation`: derived from a perturbation thread; included as
 *    "adjacent perspective" rather than primary evidence.
 *  - `speculation`: forward-looking or futurist content (e.g. from
 *    `temporal_shift` perturbations or text matching forward-date
 *    patterns); confidence is capped to ensure such material can't
 *    masquerade as fact. */
export type FindingKind = 'normal' | 'perturbation' | 'speculation';

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
  /** Classified at finding creation. See `FindingKind`. */
  kind: FindingKind;
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
  /** Null for session-scope steps (role pick, title gen, hooks) — they have no thread. */
  thread_id: string | null;
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
  error_kind: string | null;
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
  | { decision: 'enumerate_canon'; items: Array<{ item: string; context: string }>; shape_hint: string; target_count: number }
  | { decision: 'coverage_check'; slots: Array<{ thread_id: string; item: string; finding_count: number; covered: boolean }>; covered_count: number; total_count: number }
  | { decision: 'select_perturbation'; strategy: PerturbationStrategy; trigger: PerturbationTrigger; candidates: Array<{ strategy: PerturbationStrategy; weight: number }>; cooldown_excluded: PerturbationStrategy[]; signal?: { rolling_avg_novelty?: number; threshold?: number; window?: number; dominant_tag?: string; dominant_ratio?: number; canon_covered?: number; canon_total?: number } }
  | { decision: 'perturbation_rate_limited'; trigger: PerturbationTrigger; reason: string; recent_perturbations: number; window: number }

/** What caused a perturbation to fire. `probabilistic` is the default
 *  per-iteration dice roll (random with depth-scaled probability). The other
 *  three are evidence-driven triggers added in B3:
 *  - `stuck_novelty`: rolling-avg novelty over the last N findings dropped
 *    below the diminishing-returns threshold.
 *  - `cluster`: the last N findings share a dominant tag/concept above the
 *    forced-diversity threshold.
 *  - `coverage_met`: canon-slot coverage criterion is satisfied and the run
 *    still has budget for creative angles. */
export type PerturbationTrigger = 'probabilistic' | 'stuck_novelty' | 'cluster' | 'coverage_met'

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
export type JobMode = 'priority' | 'default' | 'scheduled';

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
// Per-1M-token pricing in USD. Keep aligned with provider catalogs; stale
// entries silently undercount cost telemetry. Consulted: openrouter.ai/pricing
// + costgoat.com/pricing/openrouter (May 2026).
export const MODEL_PRICING: Record<string, { input: number; output: number }> = {
  // Anthropic direct
  'claude-sonnet-4-6': { input: 3.0, output: 15.0 },
  'claude-haiku-4-5': { input: 0.80, output: 4.0 },
  'claude-opus-4-6': { input: 15.0, output: 75.0 },
  // DeepSeek
  'deepseek/deepseek-v4-flash': { input: 0.14, output: 0.28 },
  'deepseek/deepseek-v4-pro': { input: 0.435, output: 0.87 },
  'deepseek/deepseek-v3.2': { input: 0.252, output: 0.378 },
  'deepseek/deepseek-chat': { input: 0.20, output: 0.77 },
  'deepseek/deepseek-chat-v3': { input: 0.20, output: 0.77 },
  'deepseek/deepseek-chat-v3-0324': { input: 0.20, output: 0.77 },
  // Cheap fast models for judges/dedup/titles
  'google/gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
  'google/gemini-2.5-flash': { input: 0.30, output: 2.50 },
  'openai/gpt-5-nano': { input: 0.05, output: 0.40 },
  'openai/gpt-4.1-mini': { input: 0.40, output: 1.60 },
  'meta-llama/llama-3.3-70b-instruct': { input: 0.10, output: 0.32 },
  'anthropic/claude-haiku-4.5': { input: 1.00, output: 5.00 },
};
