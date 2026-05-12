/**
 * SQL helpers for the loop engine. Thin wrappers around bun:sqlite prepared
 * statements — the engine reads/writes through these so the SQL stays in one
 * place. JSON columns (envelope, envelope_consumed, payload) are parsed at the
 * boundary; callers get typed values.
 */

import { randomUUID } from 'node:crypto';
import type { Sqlite } from '@construct/data';
import { generateId } from '../services/id.js';
import { EMPTY_USAGE } from './envelope.js';
import type {
  Artifact, ArtifactId, ArtifactKind, Cycle, CycleId, Envelope, EnvelopeUsage,
  Loop, LoopId, LoopState, LoopStatus, Milestone, MilestoneId,
} from './types.js';

// ---- Loops -------------------------------------------------------------------

/**
 * Loop IDs are slugs (e.g. `white-mist-mist-4e8a`) produced by the same
 * `generateId()` the legacy research-queries pipeline uses. This keeps the
 * `/research/:id` URL scheme consistent across both systems — a `:id` segment
 * resolves to either a loop or a research_queries row by trying both tables.
 * Cycles, artifacts, and milestones stay on UUIDs — they're internal references
 * that never appear in URLs.
 */
export function createLoop(
  sqlite: Sqlite,
  args: { id?: LoopId; template_id: string; envelope?: Envelope; prompt?: string },
): Loop {
  const id = args.id ?? generateId();
  sqlite.prepare(
    'INSERT INTO loops (id, template_id, envelope, prompt) VALUES (?, ?, ?, ?)'
  ).run(id, args.template_id, JSON.stringify(args.envelope ?? {}), args.prompt ?? '');
  return getLoop(sqlite, id)!;
}

export function getLoop(sqlite: Sqlite, id: LoopId): Loop | null {
  const row = sqlite.prepare(
    'SELECT id, template_id, status, envelope, envelope_consumed, child_pid, prompt, created_at, updated_at FROM loops WHERE id = ?'
  ).get(id) as {
    id: string; template_id: string; status: string; envelope: string;
    envelope_consumed: string; child_pid: number | null; prompt: string;
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
  return getArtifact(sqlite, id)!;
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
