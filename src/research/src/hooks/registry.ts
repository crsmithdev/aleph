import type { HookEvent, HookHandler, HookPayload, HookResult, HookOptions } from './types.js';

interface Registration<E extends HookEvent> {
  handler: HookHandler<E>;
  opts: HookOptions;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const registry = new Map<HookEvent, Registration<any>[]>();

export function registerHook<E extends HookEvent>(
  event: E,
  handler: HookHandler<E>,
  opts: HookOptions = {}
): void {
  const list = registry.get(event) ?? [];
  list.push({ handler, opts });
  registry.set(event, list);
}

// Test/reset hook. Clears all registrations for an event (or all events).
export function clearHooks(event?: HookEvent): void {
  if (event) registry.delete(event);
  else registry.clear();
}

export function hasHooks(event: HookEvent): boolean {
  const list = registry.get(event);
  return !!list && list.length > 0;
}

export interface HookInvocation<E extends HookEvent> {
  label: string;
  duration_ms: number;
  status: 'ok' | 'timeout' | 'error' | 'empty';
  result?: HookResult<E>;
  error?: string;
}

function withTimeout<T>(p: Promise<T>, timeoutMs: number | undefined): Promise<T> {
  if (!timeoutMs || timeoutMs <= 0) return p;
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`hook timeout after ${timeoutMs}ms`)), timeoutMs);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); }
    );
  });
}

// Runs every handler registered for the event. Handlers are invoked
// sequentially — a handler may observe side effects from handlers earlier
// in the list (useful for chains), but most Phase 1 use cases will register
// exactly one handler per event. Failures in one handler do not cancel the
// rest; each is caught and reported in the invocation list.
export async function runHooks<E extends HookEvent>(
  event: E,
  payload: HookPayload<E>
): Promise<HookInvocation<E>[]> {
  const list = registry.get(event) ?? [];
  if (list.length === 0) return [];
  const invocations: HookInvocation<E>[] = [];
  for (const reg of list) {
    const label = reg.opts.label ?? 'unnamed';
    const t0 = Date.now();
    try {
      const result = await withTimeout(reg.handler(payload), reg.opts.timeoutMs);
      const duration_ms = Date.now() - t0;
      if (result === null || result === undefined) {
        invocations.push({ label, duration_ms, status: 'empty' });
      } else {
        invocations.push({ label, duration_ms, status: 'ok', result });
      }
    } catch (err) {
      const duration_ms = Date.now() - t0;
      const msg = err instanceof Error ? err.message : String(err);
      const status: HookInvocation<E>['status'] = msg.startsWith('hook timeout') ? 'timeout' : 'error';
      invocations.push({ label, duration_ms, status, error: msg });
    }
  }
  return invocations;
}

// Convenience: return the first non-empty result (most common Phase 1 pattern
// where a single handler is registered per event).
export function firstResult<E extends HookEvent>(
  invocations: HookInvocation<E>[]
): HookResult<E> | null {
  for (const i of invocations) {
    if (i.status === 'ok' && i.result) return i.result;
  }
  return null;
}
