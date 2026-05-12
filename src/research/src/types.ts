/**
 * @construct/research — config types.
 *
 * Only the persisted `SessionConfig` shape and its UI-editable defaults live
 * here. Per-loop runtime types are in `./loop/types.ts`.
 */

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
};

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
