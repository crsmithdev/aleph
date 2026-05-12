/**
 * Background research event logger — loop-engine only.
 *
 * Subscribes to the global event bus (`onResearchEvent`) and writes each
 * event as one line to `~/.construct/research-logs/{session_id}.ndjson`.
 * Also fans the event out to in-process listeners (the SSE handler on
 * `/api/loops/:id/stream` reads the bus directly; the file path backs the
 * `/events.ndjson` endpoint used for backfill on connect).
 *
 * Lossless: every emitResearchEvent call from the engine reaches this
 * subscriber before the API replies, so an SSE client connecting mid-run
 * gets the full sequence by replaying the file first.
 *
 * Files: `~/.construct/research-logs/{loopId}.ndjson`
 * Each line: { type, payload, logged_at }
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { onResearchEvent, type ResearchEvent } from '@construct/research';

const logsDir = join(process.env.HOME!, '.construct', 'research-logs');

export interface LoggedEvent {
  type: 'loop' | 'cycle' | 'cycle_step' | 'milestone' | 'artifact' | 'decision';
  payload: unknown;
  logged_at: string;
}

type EventListener = (sessionId: string, event: LoggedEvent) => void;
const liveListeners: Set<EventListener> = new Set();

/** Subscribe to the live event stream. Returns an unsubscribe fn.
 *  Every event that is appended to the log is also fanned out here. */
export function onLoggedEvent(fn: EventListener): () => void {
  liveListeners.add(fn);
  return () => { liveListeners.delete(fn); };
}

function writeEvent(sessionId: string, event: LoggedEvent): void {
  mkdirSync(logsDir, { recursive: true });
  const line = JSON.stringify(event) + '\n';
  try {
    appendFileSync(join(logsDir, `${sessionId}.ndjson`), line, 'utf-8');
  } catch { /* fs errors are non-fatal — the DB is still source of truth */ }
  for (const fn of liveListeners) {
    try { fn(sessionId, event); } catch { /* isolate listener faults */ }
  }
}

function handlePushEvent(e: ResearchEvent): void {
  writeEvent(e.session_id, {
    type: e.type as LoggedEvent['type'],
    payload: e.payload,
    logged_at: e.logged_at,
  });
}

export function readSessionLog(sessionId: string): LoggedEvent[] {
  const path = join(logsDir, `${sessionId}.ndjson`);
  if (!existsSync(path)) return [];
  try {
    return readFileSync(path, 'utf-8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line) as LoggedEvent);
  } catch { return []; }
}

export function sessionLogPath(sessionId: string): string {
  return join(logsDir, `${sessionId}.ndjson`);
}

export function startResearchLogger(): void {
  onResearchEvent(handlePushEvent);
}
