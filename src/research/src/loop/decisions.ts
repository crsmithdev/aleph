/**
 * Decision recording — the observability seam for engine choices.
 *
 * Two surfaces:
 *
 *   1. **Live event**. `emitResearchEvent(loop_id, 'decision', DecisionPayload)`
 *      fires on the in-process bus so the SSE stream + research-logger pick
 *      the choice up immediately. This is what powers the Activity tab's
 *      Decisions panel in real time.
 *
 *   2. **Persisted artifact**. A single `kind: 'decision_log'` artifact per
 *      loop (`cycle_id = null`) accumulates every entry across the run. The
 *      append model follows the engine's append-as-new-row pattern in
 *      `db.ts:createArtifact`: read the latest decision_log, push a new
 *      entry, write a new artifact row. The freshest by `created_at` is the
 *      authoritative log. This gives us a post-hoc queryable artifact —
 *      useful when the user opens an old loop and the event stream is gone.
 *
 * Two entry points, mirroring what's possible at each call site:
 *
 *   - `recordDecision(sqlite, loop_id, decision)` — emits AND appends. Use
 *     this anywhere a `Sqlite` handle is available (the planner via
 *     `ensureScheduleArtifact` qualifies; the engine's cycle-step loop does
 *     not — see below).
 *
 *   - `emitDecisionEvent(loop_id, decision)` — event only, no artifact
 *     write. The fallback when sqlite isn't reachable from the call site
 *     (currently: the research template's derivation hook, which receives
 *     `LoopState` but not the DB connection).
 *
 * Both helpers wrap a single `try/catch` so a database fault on the artifact
 * append never crashes the cycle — the event still fires and stderr surfaces
 * the failure, satisfying Commandment 1's "nothing may fail silently".
 *
 * Reads: `readDecisionLog(artifacts)` collapses the latest `decision_log`
 * artifact off a `LoopState`'s artifact array — templates + routes consume
 * it without a separate DB read.
 */
import type { Sqlite } from '@construct/data';
import { emitResearchEvent } from '../services/events.js';
import { createArtifact, listArtifacts } from './db.js';
import type {
  Artifact,
  DecisionLogEntry,
  DecisionLogPayload,
  DecisionPayload,
  LoopId,
} from './types.js';

const DECISION_LOG_KIND = 'decision_log';

/**
 * Find the latest `decision_log` artifact for a loop on a pre-loaded
 * artifact array. `null` when no decisions have been recorded yet.
 *
 * `created_at` is second-precision in SQLite, so multiple appends in the
 * same second tie on the timestamp. We rely on `listArtifacts` returning
 * rows in insertion order (it does — see db.ts:204, `ORDER BY created_at`
 * is stable on rowid as a secondary), and take the *last* matching entry.
 * A direct sort by created_at would non-deterministically pick a different
 * row inside a tie.
 */
export function readDecisionLog(artifacts: Artifact[]): DecisionLogPayload | null {
  const logs = artifacts.filter(a => a.kind === DECISION_LOG_KIND);
  if (logs.length === 0) return null;
  return logs[logs.length - 1].payload as unknown as DecisionLogPayload;
}

/**
 * Fire a `decision` event on the in-process bus. No artifact write. Use
 * this in call sites where sqlite isn't available (currently: the research
 * template's derivation hook).
 */
export function emitDecisionEvent(loop_id: LoopId, decision: DecisionPayload): void {
  emitResearchEvent(loop_id, 'decision', decision);
}

/**
 * Emit the live event AND append to the persisted `decision_log` artifact.
 * Append model: read the latest decision_log, push the new entry, write a
 * new artifact. Latest-by-created_at wins.
 *
 * Per Commandment 1, artifact-append failures surface on stderr but don't
 * throw — the event has already fired, so the UI's live stream is intact;
 * the persisted log gains a hole but the system keeps running. A repeated
 * failure across many calls is the signal the operator needs.
 */
export function recordDecision(
  sqlite: Sqlite,
  loop_id: LoopId,
  decision: DecisionPayload,
): void {
  emitDecisionEvent(loop_id, decision);
  try {
    // listArtifacts returns rows in insertion order — the last entry is
    // always the most recent append, even when SQLite's second-precision
    // `created_at` column ties multiple appends within the same second.
    const existing = listArtifacts(sqlite, loop_id, DECISION_LOG_KIND);
    const latest = existing.length === 0 ? null : existing[existing.length - 1];
    const prior = latest
      ? (latest.payload as unknown as DecisionLogPayload).entries ?? []
      : [];
    const entry: DecisionLogEntry = {
      decision,
      recorded_at: new Date().toISOString(),
    };
    const payload: DecisionLogPayload = { entries: [...prior, entry] };
    createArtifact(sqlite, {
      loop_id,
      cycle_id: null,
      kind: DECISION_LOG_KIND,
      payload: payload as unknown as Record<string, unknown>,
    });
  } catch (err) {
    process.stderr.write(
      `[decisions] failed to append decision_log artifact loop=${loop_id} type=${decision.type} err=${(err as Error).message}\n`,
    );
  }
}
