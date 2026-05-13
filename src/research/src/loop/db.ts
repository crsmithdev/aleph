/**
 * SQL helpers for the loop engine. Thin wrappers around bun:sqlite prepared
 * statements — the engine reads/writes through these so the SQL stays in one
 * place. JSON columns (envelope, envelope_consumed, payload) are parsed at the
 * boundary; callers get typed values.
 */

import { randomUUID } from 'node:crypto';
import type { Sqlite } from '@construct/data';
import { emitResearchEvent } from '../services/events.js';
import { generateId } from '../services/id.js';
import { EMPTY_USAGE } from './envelope.js';
import type {
  Artifact, ArtifactId, ArtifactKind, Cycle, CycleId, Envelope, EnvelopeUsage,
  Loop, LoopId, LoopState, LoopStatus, Milestone, MilestoneId,
} from './types.js';

// ---- Loops -------------------------------------------------------------------

/**
 * Loop IDs are slugs (e.g. `white-mist-mist-4e8a`) produced by `generateId()`,
 * the same memorable-id helper the older research-queries pipeline used. The
 * shared slug scheme means a `/research/:id` URL stays meaningful across the
 * transition. Cycles, artifacts, and milestones stay on UUIDs — internal
 * references that never appear in URLs.
 */
export function createLoop(
  sqlite: Sqlite,
  args: { id?: LoopId; template_id: string; envelope?: Envelope; prompt?: string; mode?: string | null },
): Loop {
  const id = args.id ?? generateId();
  sqlite.prepare(
    'INSERT INTO loops (id, template_id, envelope, prompt, mode) VALUES (?, ?, ?, ?, ?)'
  ).run(id, args.template_id, JSON.stringify(args.envelope ?? {}), args.prompt ?? '', args.mode ?? null);
  return getLoop(sqlite, id)!;
}

/**
 * List all loops, newest-first. Backs `GET /api/loops`; the `/research/history`
 * page renders these rows via the `loopAsQuery` adapter. No pagination yet —
 * the page filters in-memory and that's fine for the current loop counts.
 */
export function listLoops(sqlite: Sqlite, opts: { limit?: number } = {}): Loop[] {
  const limit = opts.limit ?? 200;
  const rows = sqlite.prepare(
    'SELECT id, template_id, status, envelope, envelope_consumed, child_pid, prompt, mode, created_at, updated_at FROM loops ORDER BY created_at DESC LIMIT ?'
  ).all(limit) as Array<{
    id: string; template_id: string; status: string; envelope: string;
    envelope_consumed: string; child_pid: number | null; prompt: string;
    mode: string | null;
    created_at: string; updated_at: string;
  }>;
  return rows.map(row => ({
    ...row,
    status: row.status as LoopStatus,
    envelope: JSON.parse(row.envelope) as Envelope,
    envelope_consumed: JSON.parse(row.envelope_consumed) as EnvelopeUsage,
  }));
}

/**
 * Per-loop summary the History/Landing page needs to render cost / verdict /
 * findings without a follow-up round-trip per row.
 *
 *   - `cost`             — `envelope_consumed.cost_usd` (already on the row).
 *   - `cycles`           — `envelope_consumed.cycles_count` (proxy for findings
 *                          in the loops engine — one cycle = one cycle_output).
 *   - `sources`          — `envelope_consumed.sources_count`.
 *   - `last_step_at`     — `updated_at`. Refined later if step granularity matters.
 *   - `latest_post_mortem` — joined from the freshest `kind: 'post_mortem'`
 *                          artifact per loop. `verdict` uses the engine's
 *                          `success | partial | failure` vocab; the UI adapter
 *                          maps that onto `pass | flag | halt`.
 */
export interface LoopRowStats {
  cost: number;
  cycles: number;
  sources: number;
  last_step_at: string | null;
  latest_post_mortem: { verdict: 'success' | 'partial' | 'failure'; flags: string[]; created_at: string } | null;
}

export interface LoopWithStats extends Loop {
  stats: LoopRowStats;
}

/**
 * List loops with per-row summary stats. One SQL query joins each loop to its
 * latest post_mortem via a correlated subquery (no PARTITION OVER — better-sqlite3
 * supports it but the subquery form keeps the SQL readable). Loops without a
 * post-mortem yield `latest_post_mortem: null`; loops that fired one carry the
 * engine's typed verdict.
 */
export function listLoopsWithStats(sqlite: Sqlite, opts: { limit?: number } = {}): LoopWithStats[] {
  const limit = opts.limit ?? 200;
  const rows = sqlite.prepare(
    `SELECT
       l.id, l.template_id, l.status, l.envelope, l.envelope_consumed,
       l.child_pid, l.prompt, l.mode, l.created_at, l.updated_at,
       pm.payload AS pm_payload, pm.created_at AS pm_created_at
     FROM loops l
     LEFT JOIN artifacts pm
       ON pm.id = (
         SELECT a.id FROM artifacts a
         WHERE a.loop_id = l.id AND a.kind = 'post_mortem'
         ORDER BY a.created_at DESC LIMIT 1
       )
     ORDER BY l.created_at DESC
     LIMIT ?`
  ).all(limit) as Array<{
    id: string; template_id: string; status: string; envelope: string;
    envelope_consumed: string; child_pid: number | null; prompt: string;
    mode: string | null;
    created_at: string; updated_at: string;
    pm_payload: string | null; pm_created_at: string | null;
  }>;
  return rows.map(row => {
    const consumed = JSON.parse(row.envelope_consumed) as EnvelopeUsage;
    let latest_post_mortem: LoopRowStats['latest_post_mortem'] = null;
    if (row.pm_payload && row.pm_created_at) {
      try {
        const payload = JSON.parse(row.pm_payload) as { verdict?: string; flags?: unknown };
        const v = payload.verdict;
        if (v === 'success' || v === 'partial' || v === 'failure') {
          latest_post_mortem = {
            verdict: v,
            flags: Array.isArray(payload.flags) ? payload.flags.filter((f): f is string => typeof f === 'string') : [],
            created_at: row.pm_created_at,
          };
        }
      } catch { /* corrupt payload — surface as no post-mortem */ }
    }
    return {
      id: row.id,
      template_id: row.template_id,
      status: row.status as LoopStatus,
      envelope: JSON.parse(row.envelope) as Envelope,
      envelope_consumed: consumed,
      child_pid: row.child_pid,
      prompt: row.prompt,
      mode: row.mode,
      created_at: row.created_at,
      updated_at: row.updated_at,
      stats: {
        cost: consumed.cost_usd,
        cycles: consumed.cycles_count,
        sources: consumed.sources_count,
        last_step_at: row.updated_at,
        latest_post_mortem,
      },
    };
  });
}

export function getLoop(sqlite: Sqlite, id: LoopId): Loop | null {
  const row = sqlite.prepare(
    'SELECT id, template_id, status, envelope, envelope_consumed, child_pid, prompt, mode, created_at, updated_at FROM loops WHERE id = ?'
  ).get(id) as {
    id: string; template_id: string; status: string; envelope: string;
    envelope_consumed: string; child_pid: number | null; prompt: string;
    mode: string | null;
    created_at: string; updated_at: string;
  } | undefined;
  if (!row) return null;
  return {
    ...row,
    status: row.status as LoopStatus,
    envelope: JSON.parse(row.envelope) as Envelope,
    envelope_consumed: JSON.parse(row.envelope_consumed) as EnvelopeUsage,
  };
}

export function updateLoopStatus(sqlite: Sqlite, id: LoopId, status: LoopStatus): void {
  sqlite.prepare("UPDATE loops SET status = ?, updated_at = datetime('now') WHERE id = ?").run(status, id);
}

export function updateLoopChildPid(sqlite: Sqlite, id: LoopId, pid: number | null): void {
  sqlite.prepare("UPDATE loops SET child_pid = ?, updated_at = datetime('now') WHERE id = ?").run(pid, id);
}

/**
 * Atomic add to envelope_consumed. Uses JSON-parse / merge / write — fine for
 * a single-writer-per-loop (subprocess-per-loop) model. If we ever moved to
 * multi-writer, this would need a SQLite-native JSON_PATCH.
 */
export function bumpUsage(sqlite: Sqlite, id: LoopId, delta: Partial<EnvelopeUsage>): EnvelopeUsage {
  const loop = getLoop(sqlite, id);
  if (!loop) throw new Error(`loop ${id} not found`);
  const next: EnvelopeUsage = {
    time_minutes: loop.envelope_consumed.time_minutes + (delta.time_minutes ?? 0),
    cost_usd: loop.envelope_consumed.cost_usd + (delta.cost_usd ?? 0),
    cycles_count: loop.envelope_consumed.cycles_count + (delta.cycles_count ?? 0),
    sources_count: loop.envelope_consumed.sources_count + (delta.sources_count ?? 0),
  };
  sqlite.prepare("UPDATE loops SET envelope_consumed = ?, updated_at = datetime('now') WHERE id = ?")
    .run(JSON.stringify(next), id);
  return next;
}

// ---- Cycles ------------------------------------------------------------------

export function createCycle(
  sqlite: Sqlite,
  args: { id?: CycleId; loop_id: LoopId; idx: number; priority?: number },
): Cycle {
  const id = args.id ?? randomUUID();
  sqlite.prepare(
    'INSERT INTO cycles (id, loop_id, idx, priority) VALUES (?, ?, ?, ?)'
  ).run(id, args.loop_id, args.idx, args.priority ?? 0.5);
  return getCycle(sqlite, id)!;
}

export function getCycle(sqlite: Sqlite, id: CycleId): Cycle | null {
  const row = sqlite.prepare(
    'SELECT id, loop_id, idx, priority, status, started_at, finalized_at FROM cycles WHERE id = ?'
  ).get(id) as {
    id: string; loop_id: string; idx: number; priority: number; status: string;
    started_at: string | null; finalized_at: string | null;
  } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    loop_id: row.loop_id,
    index: row.idx,
    priority: row.priority,
    status: row.status as Cycle['status'],
    started_at: row.started_at,
    finalized_at: row.finalized_at,
  };
}

export function listCycles(sqlite: Sqlite, loop_id: LoopId): Cycle[] {
  const rows = sqlite.prepare(
    'SELECT id, loop_id, idx, priority, status, started_at, finalized_at FROM cycles WHERE loop_id = ? ORDER BY priority DESC, created_at ASC'
  ).all(loop_id) as Array<{
    id: string; loop_id: string; idx: number; priority: number; status: string;
    started_at: string | null; finalized_at: string | null;
  }>;
  return rows.map(r => ({
    id: r.id,
    loop_id: r.loop_id,
    index: r.idx,
    priority: r.priority,
    status: r.status as Cycle['status'],
    started_at: r.started_at,
    finalized_at: r.finalized_at,
  }));
}

export function findInProgressCycle(sqlite: Sqlite, loop_id: LoopId): Cycle | null {
  const cycles = listCycles(sqlite, loop_id);
  return cycles.find(c => c.status === 'pending' || c.status === 'running') ?? null;
}

export function markCycleRunning(sqlite: Sqlite, id: CycleId): void {
  sqlite.prepare("UPDATE cycles SET status = 'running', started_at = COALESCE(started_at, datetime('now')) WHERE id = ?").run(id);
}

export function markCycleFinalized(sqlite: Sqlite, id: CycleId): void {
  sqlite.prepare("UPDATE cycles SET status = 'finalized', finalized_at = datetime('now') WHERE id = ?").run(id);
}

// ---- Artifacts ---------------------------------------------------------------

export function createArtifact(
  sqlite: Sqlite,
  args: { id?: ArtifactId; loop_id: LoopId; cycle_id?: CycleId | null; kind: ArtifactKind; payload: Record<string, unknown> },
): Artifact {
  const id = args.id ?? randomUUID();
  sqlite.prepare(
    'INSERT INTO artifacts (id, loop_id, cycle_id, kind, payload) VALUES (?, ?, ?, ?, ?)'
  ).run(id, args.loop_id, args.cycle_id ?? null, args.kind, JSON.stringify(args.payload));
  const artifact = getArtifact(sqlite, id)!;
  // Emit on the bus so research-logger persists this to events.ndjson and
  // SSE listeners see it live. Previously the SSE route fabricated artifact
  // frames on connect from listArtifacts() — that left a postmortem replay
  // of the on-disk log unable to recover artifact timing.
  emitResearchEvent(args.loop_id, 'artifact', {
    id: artifact.id,
    loop_id: artifact.loop_id,
    cycle_id: artifact.cycle_id,
    kind: artifact.kind,
    created_at: artifact.created_at,
  });
  return artifact;
}

export function getArtifact(sqlite: Sqlite, id: ArtifactId): Artifact | null {
  const row = sqlite.prepare(
    'SELECT id, loop_id, cycle_id, kind, payload, created_at FROM artifacts WHERE id = ?'
  ).get(id) as { id: string; loop_id: string; cycle_id: string | null; kind: string; payload: string; created_at: string } | undefined;
  if (!row) return null;
  return { ...row, payload: JSON.parse(row.payload) as Record<string, unknown> };
}

export function listArtifacts(sqlite: Sqlite, loop_id: LoopId, kind?: ArtifactKind): Artifact[] {
  const sql = kind
    ? 'SELECT id, loop_id, cycle_id, kind, payload, created_at FROM artifacts WHERE loop_id = ? AND kind = ? ORDER BY created_at'
    : 'SELECT id, loop_id, cycle_id, kind, payload, created_at FROM artifacts WHERE loop_id = ? ORDER BY created_at';
  const rows = (kind ? sqlite.prepare(sql).all(loop_id, kind) : sqlite.prepare(sql).all(loop_id)) as Array<{
    id: string; loop_id: string; cycle_id: string | null; kind: string; payload: string; created_at: string;
  }>;
  return rows.map(r => ({ ...r, payload: JSON.parse(r.payload) as Record<string, unknown> }));
}

// ---- Milestones --------------------------------------------------------------

export function createMilestone(
  sqlite: Sqlite,
  args: { id?: MilestoneId; loop_id: LoopId; at_envelope_pct: 25 | 50 | 75; artifact_id: ArtifactId },
): Milestone {
  const id = args.id ?? randomUUID();
  sqlite.prepare(
    'INSERT INTO milestones (id, loop_id, at_envelope_pct, artifact_id) VALUES (?, ?, ?, ?)'
  ).run(id, args.loop_id, args.at_envelope_pct, args.artifact_id);
  const row = sqlite.prepare('SELECT * FROM milestones WHERE id = ?').get(id) as Milestone;
  return row;
}

export function listMilestones(sqlite: Sqlite, loop_id: LoopId): Milestone[] {
  return sqlite.prepare('SELECT * FROM milestones WHERE loop_id = ? ORDER BY at_envelope_pct').all(loop_id) as Milestone[];
}

// ---- Composite read ----------------------------------------------------------

/**
 * Read the full state a template hook needs. Re-read whenever the state may
 * have changed (after processor / derivation / new artifacts).
 */
export function readState(sqlite: Sqlite, loop_id: LoopId): LoopState {
  const loop = getLoop(sqlite, loop_id);
  if (!loop) throw new Error(`loop ${loop_id} not found`);
  return {
    loop,
    cycles: listCycles(sqlite, loop_id),
    artifacts: listArtifacts(sqlite, loop_id),
    envelope_consumed: loop.envelope_consumed,
  };
}

// Exported here so engine.ts can sanity-default to it.
export { EMPTY_USAGE };
