/**
 * Join audit — cockpit-spec F7.
 *
 * Reports the DELTA from a classified baseline of expected orphans, never an
 * absolute count: a permanently-amber metric trains its only reader to ignore it.
 *
 * An "orphan" here is an event whose trace_id belongs to no turn/job trace tree —
 * in Phase 1 that means daemon lifecycle events, which are expected and are the
 * baseline.
 */
import type { Db } from "../platform/db.ts";
import { emit } from "../core/emit.ts";
import type { IdTuple } from "../core/envelope.ts";

export interface OrphanBaseline {
  /** kinds whose events legitimately live outside a turn/job trace */
  expected_kinds: string[];
}

export const DEFAULT_BASELINE: OrphanBaseline = {
  expected_kinds: [
    "daemon.started", "daemon.stopped", "daemon.killed", "daemon.boot_step", "daemon.config_loaded",
    "obs.export_failed", "obs.join_audit", "meter.window_threshold", "session.archived",
    // The shutdown checkpoint runs outside any turn: it writes and commits the
    // brief after the bus has drained. Classified, not tolerated silently.
    "session.checkpointed", "vault.written", "vault.commit",
  ],
};

export interface JoinAuditResult {
  since: string;
  traces: number;
  orphans: number;
  baseline: number;
  delta: number;
  unexpected: Array<{ trace_id: string; kinds: string[] }>;
}

export function joinAudit(db: Db, since: string, baseline: OrphanBaseline = DEFAULT_BASELINE): JoinAuditResult {
  const rows = db.query<{ trace_id: string; kind: string }, [string]>(
    "SELECT trace_id, kind FROM events WHERE ts >= ?",
  ).all(since);

  const byTrace = new Map<string, string[]>();
  for (const row of rows) byTrace.set(row.trace_id, [...(byTrace.get(row.trace_id) ?? []), row.kind]);

  // A trace is joined when it contains a unit of work; anything else is an orphan.
  const isJoined = (kinds: string[]) =>
    kinds.includes("session.turn_started") || kinds.includes("bus.started");

  const orphanTraces = [...byTrace.entries()].filter(([, kinds]) => !isJoined(kinds));
  const expected = orphanTraces.filter(([, kinds]) => kinds.every((k) => baseline.expected_kinds.includes(k)));
  const unexpected = orphanTraces.filter(([, kinds]) => !kinds.every((k) => baseline.expected_kinds.includes(k)));

  return {
    since,
    traces: byTrace.size,
    orphans: orphanTraces.length,
    baseline: expected.length,
    delta: unexpected.length,
    unexpected: unexpected.map(([trace_id, kinds]) => ({ trace_id, kinds: [...new Set(kinds)] })),
  };
}

export function emitJoinAudit(db: Db, ids: IdTuple, since: string, baseline?: OrphanBaseline): JoinAuditResult {
  const result = joinAudit(db, since, baseline);
  emit("obs.join_audit", ids, {
    since, orphans: result.orphans, baseline: result.baseline, delta: result.delta,
  }, {
    cause: {
      kind: "computed",
      text: result.delta === 0
        ? `${result.traces} traces, ${result.orphans} orphans, all classified`
        : `${result.delta} unclassified orphan trace(s): ${result.unexpected.map((u) => u.kinds.join("+")).join(", ")}`,
      source: "obs/join-audit.ts:emitJoinAudit",
    },
  });
  return result;
}
