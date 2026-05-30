/**
 * Cycle ledger — input-hash dedup for crash resume.
 *
 * When a child process is killed mid-cycle and restarts, the engine replays
 * each step. Steps whose `input_hash` already has a ledger entry return the
 * recorded output without re-executing — that's what makes the run resumable
 * without duplicating LLM/network work.
 *
 * Spec: docs/plans/research-engine-build-plan.md §Phase 1.
 */

import { createHash } from 'node:crypto';
import type { Sqlite } from '@aleph/data';
import type { CycleId, CycleLedgerEntry, LedgerStep, LoopId } from './types.js';

/**
 * Stable hash of arbitrary JSON-serialisable input. Used as the cycle-ledger
 * key alongside (loop_id, cycle_id, step). Two inputs that serialise to the
 * same canonical JSON produce the same hash.
 *
 * Canonicalisation: keys sorted recursively at every object level. Arrays
 * preserve order (semantic). Primitives serialise as JSON.stringify does.
 */
export function inputHash(input: unknown): string {
  return createHash('sha256').update(canonicalJson(input)).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === undefined) return '__undefined__';
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']';
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const pairs = keys.map(k => JSON.stringify(k) + ':' + canonicalJson((value as Record<string, unknown>)[k]));
  return '{' + pairs.join(',') + '}';
}

/**
 * Look up a prior ledger entry's output. Returns `null` if no entry exists —
 * caller should execute the step and then call `recordEntry`.
 */
export function lookupOutput(
  sqlite: Sqlite,
  args: { loop_id: LoopId; cycle_id: CycleId; step: LedgerStep; input_hash: string },
): { output: unknown; cost_usd: number } | null {
  const row = sqlite.prepare(
    'SELECT output, cost_usd FROM cycle_ledger WHERE loop_id = ? AND cycle_id = ? AND step = ? AND input_hash = ?'
  ).get(args.loop_id, args.cycle_id, args.step, args.input_hash) as { output: string; cost_usd: number } | undefined;
  if (!row) return null;
  return { output: JSON.parse(row.output) as unknown, cost_usd: row.cost_usd };
}

/**
 * Idempotently record a step's output. Re-recording the same key is a no-op
 * (INSERT OR IGNORE) — important when a step racey-records during a kill.
 */
export function recordEntry(
  sqlite: Sqlite,
  entry: Omit<CycleLedgerEntry, 'recorded_at'>,
): void {
  sqlite.prepare(
    'INSERT OR IGNORE INTO cycle_ledger (loop_id, cycle_id, step, input_hash, output, cost_usd) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(
    entry.loop_id,
    entry.cycle_id,
    entry.step,
    entry.input_hash,
    JSON.stringify(entry.output),
    entry.cost_usd,
  );
}

/**
 * List every ledger entry for a loop, ordered by recording time. Used by the
 * engine on resume to skip already-completed steps.
 */
export function listEntries(sqlite: Sqlite, loop_id: LoopId): CycleLedgerEntry[] {
  const rows = sqlite.prepare(
    'SELECT loop_id, cycle_id, step, input_hash, output, cost_usd, recorded_at FROM cycle_ledger WHERE loop_id = ? ORDER BY recorded_at'
  ).all(loop_id) as Array<{
    loop_id: string;
    cycle_id: string;
    step: string;
    input_hash: string;
    output: string;
    cost_usd: number;
    recorded_at: string;
  }>;
  return rows.map(r => ({
    loop_id: r.loop_id,
    cycle_id: r.cycle_id,
    step: r.step as LedgerStep,
    input_hash: r.input_hash,
    output: JSON.parse(r.output) as unknown,
    cost_usd: r.cost_usd,
    recorded_at: r.recorded_at,
  }));
}

/**
 * Convenience: run `step(input)` exactly once, caching the result in the
 * ledger. On crash + resume, the cached result is returned without re-running.
 */
export async function runOnce<T>(
  sqlite: Sqlite,
  args: { loop_id: LoopId; cycle_id: CycleId; step: LedgerStep; input: unknown },
  run: () => Promise<{ output: T; cost_usd: number }>,
): Promise<{ output: T; cost_usd: number; cached: boolean }> {
  const hash = inputHash(args.input);
  const existing = lookupOutput(sqlite, { loop_id: args.loop_id, cycle_id: args.cycle_id, step: args.step, input_hash: hash });
  if (existing) {
    return { output: existing.output as T, cost_usd: existing.cost_usd, cached: true };
  }
  const result = await run();
  recordEntry(sqlite, {
    loop_id: args.loop_id,
    cycle_id: args.cycle_id,
    step: args.step,
    input_hash: hash,
    output: result.output,
    cost_usd: result.cost_usd,
  });
  return { ...result, cached: false };
}
