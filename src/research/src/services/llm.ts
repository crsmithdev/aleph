import type { Sqlite } from '@construct/data';
import type { LLMProvider, LLMResult } from '../engine.js';
import { calculateCost } from '../engine.js';
import * as steps from './steps.js';

/** Per-call context attached to every recorded step. session_id is required —
 *  every LLM call must belong to a session for cost/event accounting to work.
 *  thread_id is null for session-scope work (role pick, title gen, hooks). */
export interface CallContext {
  session_id: string;
  thread_id?: string | null;
  finding_id?: string | null;
  label: string;
  metadata?: Record<string, unknown> | null;
}

export interface CompleteOpts {
  systemPrompt?: string | null;
}

/** Wraps a raw LLMProvider so that every `.complete()` call automatically
 *  records a research_steps row + emits a step SSE event. New call sites that
 *  use this wrapper get logging by construction; nobody has to remember to
 *  call createStep themselves. */
export class TrackedLLM {
  /** Exposed so callers can attach extra metadata to a step after the call
   *  (e.g. pickAgentRole writes {role_label, role_prompt} onto its step). */
  readonly sqlite: Sqlite;
  constructor(private provider: LLMProvider, sqlite: Sqlite) {
    this.sqlite = sqlite;
  }

  async complete(
    ctx: CallContext,
    model: string,
    prompt: string,
    maxTokens: number,
    opts?: CompleteOpts,
  ): Promise<LLMResult & { cost: number; stepId: string }> {
    // Records a step on success only. Errors propagate up — the engine has its
    // own per-thread error handler that records a richer step (with error_kind
    // classification + retry-streak tracking); session-scope callers
    // (pickAgentRole, title gen, hooks) intentionally swallow errors and don't
    // log a step. Recording here too would double-count, breaking error-streak
    // arithmetic in runThread.
    const startTime = Date.now();
    const result = await this.provider.complete(model, prompt, maxTokens, opts?.systemPrompt);
    const cost = calculateCost(result.model, result.promptTokens, result.completionTokens);
    const step = steps.createStep(this.sqlite, {
      thread_id: ctx.thread_id ?? null,
      session_id: ctx.session_id,
      finding_id: ctx.finding_id ?? null,
      model: result.model,
      prompt_tokens: result.promptTokens,
      completion_tokens: result.completionTokens,
      cost_usd: cost,
      duration_ms: Date.now() - startTime,
      label: ctx.label,
      metadata: ctx.metadata ?? null,
    });
    return { ...result, cost, stepId: step.id };
  }
}
