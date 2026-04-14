/**
 * Background research event logger.
 *
 * Polls the DB for new findings, steps, and thread state changes for every session
 * and appends them to per-session NDJSON log files at:
 *   ~/.construct/research-logs/{sessionId}.ndjson
 *
 * Each line: { type: 'finding'|'step'|'thread', payload: {...}, logged_at: ISO }
 *
 * Benefits:
 * - Export reads the pre-built log instead of reconstructing from scratch
 * - The UI can fetch all historical events in one request (GET /queries/:id/events)
 *   rather than waiting for the SSE stream to replay everything
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Sqlite } from '@construct/data';
import { listQueries, listFindings, listSteps, listThreads } from '@construct/research';

const logsDir = join(process.env.HOME!, '.construct', 'research-logs');

export interface LoggedEvent {
  type: 'finding' | 'step' | 'thread';
  payload: unknown;
  logged_at: string;
}

// In-memory state per session to avoid re-logging already-seen events
const sessionState = new Map<string, {
  findingIds: Set<string>;
  stepIds: Set<string>;
  threadStates: Map<string, string>; // threadId → "status:updated_at"
}>();

function appendEvent(sessionId: string, type: LoggedEvent['type'], payload: unknown): void {
  mkdirSync(logsDir, { recursive: true });
  const line = JSON.stringify({ type, payload, logged_at: new Date().toISOString() }) + '\n';
  try {
    appendFileSync(join(logsDir, `${sessionId}.ndjson`), line, 'utf-8');
  } catch { /* ignore fs errors */ }
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

export function startResearchLogger(sqlite: Sqlite): void {
  const poll = () => {
    try {
      const sessions = listQueries(sqlite);
      for (const session of sessions) {
        const id = session.id;

        if (!sessionState.has(id)) {
          sessionState.set(id, {
            findingIds: new Set(),
            stepIds: new Set(),
            threadStates: new Map(),
          });
        }
        const state = sessionState.get(id)!;

        const findings = listFindings(sqlite, id);
        for (const f of findings) {
          if (!state.findingIds.has(f.id)) {
            state.findingIds.add(f.id);
            appendEvent(id, 'finding', f);
          }
        }

        const steps = listSteps(sqlite, id, { limit: 1000 });
        for (const s of steps) {
          if (!state.stepIds.has(s.id)) {
            state.stepIds.add(s.id);
            appendEvent(id, 'step', s);
          }
        }

        const threads = listThreads(sqlite, id);
        for (const t of threads) {
          const key = `${t.status}:${t.updated_at}`;
          if (state.threadStates.get(t.id) !== key) {
            state.threadStates.set(t.id, key);
            appendEvent(id, 'thread', t);
          }
        }
      }
    } catch { /* ignore polling errors */ }
  };

  setInterval(poll, 3000);
}
