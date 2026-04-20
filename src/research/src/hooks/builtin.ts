import { registerHook, hasHooks } from './registry.js';
import { createPreDispatchHandler, type PreDispatchHandlerOptions } from './pre-dispatch.js';
import { createIterationCheckHandler, type IterationCheckHandlerOptions } from './iteration-check.js';
import { createPostMortemHandler, type PostMortemHandlerOptions } from './post-mortem.js';

export interface BuiltinHookOptions {
  apiKey?: string;
  preDispatchModel?: string;
  preDispatchTimeoutMs?: number;
  iterationCheckModel?: string;
  iterationCheckTimeoutMs?: number;
  postMortemModel?: string;
  postMortemTimeoutMs?: number;
  // Test injection point — forwarded to handlers.
  fetchImpl?: typeof fetch;
  // If true, register even when an equivalent hook is already registered.
  // Default is idempotent (skip if already registered).
  force?: boolean;
}

// Register the default agent handlers shipped with @construct/research.
// Idempotent — calling this twice in the same process is a no-op unless
// `force` is set. Missing API key is a skip (not an error) — the hook bus
// handles no-op events gracefully.
export function registerBuiltinHooks(opts: BuiltinHookOptions = {}): void {
  const apiKey = opts.apiKey ?? process.env.OPENROUTER_API_KEY ?? '';

  if (apiKey && (!hasHooks('pre_dispatch') || opts.force)) {
    const handlerOpts: PreDispatchHandlerOptions = {
      apiKey,
      model: opts.preDispatchModel,
      fetchImpl: opts.fetchImpl,
    };
    registerHook('pre_dispatch', createPreDispatchHandler(handlerOpts), {
      label: 'builtin-pre-dispatch',
      timeoutMs: opts.preDispatchTimeoutMs ?? 30_000,
    });
  }

  if (apiKey && (!hasHooks('iteration_check') || opts.force)) {
    const handlerOpts: IterationCheckHandlerOptions = {
      apiKey,
      model: opts.iterationCheckModel,
      fetchImpl: opts.fetchImpl,
    };
    registerHook('iteration_check', createIterationCheckHandler(handlerOpts), {
      label: 'builtin-iteration-check',
      timeoutMs: opts.iterationCheckTimeoutMs ?? 30_000,
    });
  }

  if (apiKey && (!hasHooks('post_mortem') || opts.force)) {
    const handlerOpts: PostMortemHandlerOptions = {
      apiKey,
      model: opts.postMortemModel,
      fetchImpl: opts.fetchImpl,
    };
    registerHook('post_mortem', createPostMortemHandler(handlerOpts), {
      label: 'builtin-post-mortem',
      timeoutMs: opts.postMortemTimeoutMs ?? 45_000,
    });
  }
}
