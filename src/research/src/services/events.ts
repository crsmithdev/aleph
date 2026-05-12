/**
 * Research event bus — in-process pub/sub for telemetry.
 *
 * Services emit synchronously at write sites (after the DB write succeeds).
 * Subscribers (e.g. the UI-layer research-logger) persist the stream to
 * NDJSON and fan it out to SSE listeners.
 *
 * Goals:
 *  - Lossless: every state change emits one event
 *  - Zero-latency: emit is synchronous on the write path
 *  - Fault-isolated: a bad listener never breaks the emitter
 *
 * The poll-based reconciler in research-logger remains as a safety net for
 * mutations that happen outside the services (direct SQL, migrations, tests)
 * but the push stream is the authoritative source.
 */
export type ResearchEventType =
  | 'loop' | 'cycle' | 'cycle_step' | 'milestone' | 'artifact' | 'decision';

export interface ResearchEvent {
  session_id: string;
  type: ResearchEventType;
  payload: unknown;
  logged_at: string;
}

type Listener = (event: ResearchEvent) => void;

const listeners: Set<Listener> = new Set();

export function onResearchEvent(fn: Listener): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

export function emitResearchEvent(
  sessionId: string,
  type: ResearchEventType,
  payload: unknown
): void {
  const event: ResearchEvent = {
    session_id: sessionId,
    type,
    payload,
    logged_at: new Date().toISOString(),
  };
  for (const fn of listeners) {
    try { fn(event); } catch { /* listener faults don't break the emitter */ }
  }
}

export function clearResearchListeners(): void {
  listeners.clear();
}
