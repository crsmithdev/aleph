/**
 * Background research event logger.
 *
 * Two modes, in order of preference:
 *
 *   1. PUSH (primary) — services call `emitResearchEvent` at every mutation
 *      site (thread/job/step/finding/source). This module subscribes via
 *      `onResearchEvent` and writes each event to NDJSON synchronously, then
 *      fans it out to SSE listeners. This is lossless by construction — there
 *      is no sampling gap.
 *
 *   2. POLL (reconciler) — every 3s we scan the DB for rows we haven't seen
 *      before. This catches mutations that bypass the services (direct SQL,
 *      migrations, tests) or rows inserted before the process booted. Rows
 *      already known to the push path are deduped by id/state key.
 *
 * Files: ~/.construct/research-logs/{sessionId}.ndjson
 * Each line: { type: 'finding'|'step'|'thread'|'job'|'source', payload: {...}, logged_at: ISO }
 */

import { appendFileSync, mkdirSync, existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type { Sqlite } from '@construct/data';
import {
  listQueries, listFindings, listSteps, listThreads, listJobsForSession, listSources,
  onResearchEvent, type ResearchEvent,
} from '@construct/research';

const logsDir = join(process.env.HOME!, '.construct', 'research-logs');

export interface LoggedEvent {
  // v0 engine events + v1 loop engine events. The push path writes all of
  // them through `handlePushEvent`; loop events skip the dedupe blocks since
  // those are keyed on v0 mutation shapes.
  type:
    | 'finding' | 'step' | 'thread' | 'job' | 'source' | 'concept' | 'concept_link' | 'query'
    | 'loop' | 'cycle' | 'cycle_step' | 'milestone' | 'artifact';
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

// Per-session dedupe state — prevents poll reconciler from re-emitting push-logged rows.
const sessionState = new Map<string, {
  findingIds: Set<string>;
  stepIds: Set<string>;
  threadStates: Map<string, string>; // threadId → "status:updated_at"
  jobStates: Map<string, string>;    // jobId → "status:updated_at:iterations_completed"
  sourceStates: Map<string, string>; // sourceId → "status:updated_at"
}>();

function ensureState(sessionId: string) {
  let state = sessionState.get(sessionId);
  if (!state) {
    state = {
      findingIds: new Set(),
      stepIds: new Set(),
      threadStates: new Map(),
      jobStates: new Map(),
      sourceStates: new Map(),
    };
    sessionState.set(sessionId, state);
  }
  return state;
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

/** Key used for dedupe between push and poll paths. Must be stable for the
 *  same logical state so a row logged via push is skipped by the next poll. */
function stateKey(type: LoggedEvent['type'], payload: unknown): string | null {
  if (!payload || typeof payload !== 'object') return null;
  const p = payload as Record<string, unknown>;
  switch (type) {
    case 'thread': return `${p.status}:${p.updated_at}`;
    case 'job':    return `${p.status}:${p.updated_at}:${p.iterations_completed ?? 0}`;
    case 'source': return `${p.extraction_status}:${p.updated_at}`;
    default: return null;
  }
}

function handlePushEvent(e: ResearchEvent): void {
  const state = ensureState(e.session_id);
  const logged: LoggedEvent = { type: e.type, payload: e.payload, logged_at: e.logged_at };

  // Insert-only types: once seen, skip. Update types: key by state.
  if (e.type === 'finding') {
    const id = (e.payload as { id?: string }).id;
    if (id) { if (state.findingIds.has(id)) return; state.findingIds.add(id); }
  } else if (e.type === 'step') {
    const id = (e.payload as { id?: string }).id;
    if (id) { if (state.stepIds.has(id)) return; state.stepIds.add(id); }
  } else if (e.type === 'thread') {
    const p = e.payload as { id: string };
    const key = stateKey('thread', e.payload)!;
    if (state.threadStates.get(p.id) === key) return;
    state.threadStates.set(p.id, key);
  } else if (e.type === 'job') {
    const p = e.payload as { id: string };
    const key = stateKey('job', e.payload)!;
    if (state.jobStates.get(p.id) === key) return;
    state.jobStates.set(p.id, key);
  } else if (e.type === 'source') {
    const p = e.payload as { id: string };
    const key = stateKey('source', e.payload)!;
    if (state.sourceStates.get(p.id) === key) return;
    state.sourceStates.set(p.id, key);
  }

  writeEvent(e.session_id, logged);
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
  // --- Push path: subscribe before any poll so we dedupe against pushed rows ---
  onResearchEvent(handlePushEvent);

  // --- Poll reconciler: catches bypass writes and warms state for existing rows ---
  const poll = () => {
    try {
      const sessions = listQueries(sqlite);
      for (const session of sessions) {
        const id = session.id;
        const state = ensureState(id);

        for (const f of listFindings(sqlite, id)) {
          if (!state.findingIds.has(f.id)) {
            state.findingIds.add(f.id);
            writeEvent(id, { type: 'finding', payload: f, logged_at: new Date().toISOString() });
          }
        }

        for (const s of listSteps(sqlite, id, { limit: 1000 })) {
          if (!state.stepIds.has(s.id)) {
            state.stepIds.add(s.id);
            writeEvent(id, { type: 'step', payload: s, logged_at: new Date().toISOString() });
          }
        }

        for (const t of listThreads(sqlite, id)) {
          const key = stateKey('thread', t)!;
          if (state.threadStates.get(t.id) !== key) {
            state.threadStates.set(t.id, key);
            writeEvent(id, { type: 'thread', payload: t, logged_at: new Date().toISOString() });
          }
        }

        for (const j of listJobsForSession(sqlite, id)) {
          const key = stateKey('job', j)!;
          if (state.jobStates.get(j.id) !== key) {
            state.jobStates.set(j.id, key);
            writeEvent(id, { type: 'job', payload: j, logged_at: new Date().toISOString() });
          }
        }

        for (const s of listSources(sqlite, id, { limit: 2000 })) {
          const key = stateKey('source', s)!;
          if (state.sourceStates.get(s.id) !== key) {
            state.sourceStates.set(s.id, key);
            writeEvent(id, { type: 'source', payload: s, logged_at: new Date().toISOString() });
          }
        }
      }
    } catch { /* polling faults are non-fatal */ }
  };

  setInterval(poll, 3000);
}
