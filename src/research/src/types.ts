/**
 * @construct/research — config types.
 *
 * `SessionConfig` is the persisted defaults surface for the two per-loop
 * model selections the engine still reads at run time:
 *
 *   - `iteration_check_model` — model for the milestone iteration-check hook.
 *   - `post_mortem_model`     — model for the natural-completion post-mortem.
 *
 * Phase 7 cutover slimmed this from ~25 legacy fields (max_thread_depth,
 * p_serendipity, follow_up, topic_coherence, gap_analysis, schedule.mode,
 * etc. — all relics of the pre-loops executor) down to the surviving two.
 * Per-loop config now rides on the schedule artifact (`SchedulePayload` in
 * `./loop/types.ts`); see `MODE_PROFILES` in `./loop/modes.ts` for the
 * envelope + flag bundles each mode contributes.
 *
 * Per-loop runtime types are in `./loop/types.ts`.
 */

export interface SessionConfig {
  /** Model for the milestone iteration-check hook. One cheap call per
   *  milestone (25/50/75% envelope). Defaults to gemini-2.0-flash-001 to
   *  match the document-polish pass. Persisted; surfaced to the user via
   *  the Providers page. */
  iteration_check_model: string;
  /** Model for the post-mortem hook fired once on natural completion. One
   *  cheap call producing a final verdict + recommendations. Defaults to
   *  gemini-2.0-flash-001 to match the document-polish pass. Persisted;
   *  surfaced to the user via the Providers page. */
  post_mortem_model: string;
}

export const DEFAULT_SESSION_CONFIG: SessionConfig = {
  iteration_check_model: 'google/gemini-2.0-flash-001',
  post_mortem_model: 'google/gemini-2.0-flash-001',
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
