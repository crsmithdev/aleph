import type { PromptHints, InterpretedPrompt } from '../types.js';

// Payload and result shapes for each hook event. A new event adds two entries
// here (payload + result) and the registry picks up the type automatically.

export interface HookPayloadMap {
  pre_dispatch: {
    query_id: string;
    prompt: string;
    hints: PromptHints;
  };
  iteration_check: {
    query_id: string;
    prompt: string;
    hints: PromptHints;
    iterations_completed: number;
    metrics: IterationMetrics;
    recent_thread_queries: string[];
    recent_finding_summaries: string[];
  };
  post_mortem: {
    query_id: string;
    job_id: string | null;
    prompt: string;
    hints: PromptHints;
    interpretation: InterpretedPrompt | null;
    final_summary: string;
    metrics: PostMortemMetrics;
    thread_state: PostMortemThreadState;
    source_health: PostMortemSourceHealth;
    sample_findings: string[];
  };
}

export interface PostMortemThreadState {
  by_status: Record<string, number>;
  stuck_count: number;
  pruned_count: number;
}

export interface PostMortemSourceHealth {
  failure_rate: number;
  total_attempts: number;
  top_failing_domains: Array<{ domain: string; count: number }>;
}

export interface HookResultMap {
  pre_dispatch: {
    interpretation?: InterpretedPrompt;
    clarifying_question?: string;
    notes?: string;
  };
  iteration_check: {
    verdict: 'on_track' | 'drifting' | 'needs_correction';
    notes: string;
    correction?: IterationCorrection;
  };
  post_mortem: {
    verdict: 'pass' | 'flag';
    flags: string[];
    notes: string;
    recommendations: string[];
  };
}

export interface IterationMetrics {
  findings: number;
  threads_active: number;
  threads_total: number;
  cost_usd: number;
  errors: number;
  steps: number;
}

export interface PostMortemMetrics extends IterationMetrics {
  duration_ms: number;
}

// Iteration corrections split into auto-apply vs. confirm-required tiers.
// kill_threads is auto; scope_change is confirm.
export interface IterationCorrection {
  kill_threads?: string[];
  narrow_sources?: string[];
  scope_change?: string;
}

export type HookEvent = keyof HookPayloadMap;
export type HookPayload<E extends HookEvent> = HookPayloadMap[E];
export type HookResult<E extends HookEvent> = HookResultMap[E];
export type HookHandler<E extends HookEvent> = (payload: HookPayload<E>) => Promise<HookResult<E> | null>;

export interface HookOptions {
  timeoutMs?: number;
  label?: string;
}
