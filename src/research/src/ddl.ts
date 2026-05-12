import type { Sqlite } from '@construct/data';
import { seedDefaults } from './services/defaults.js';

/**
 * DDL for the @construct/research package.
 *
 *   - `research_defaults`  — persisted SessionConfig (backs `/api/research/defaults`).
 *   - `loops` / `cycles` / `artifacts` / `cycle_ledger` / `milestones`  — the
 *                            loop engine's full table set.
 *
 * `dropLegacyTables()` below runs on every boot to drop the pre-loops engine's
 * tables (queries, threads, findings, steps, plans, jobs, sources, concepts,
 * monitors, iteration_checks, post_mortems, perturbation_state, …). The drop
 * is idempotent — a no-op on already-clean DBs — and exists as a safety net
 * for dev installs that still carry the old schema.
 */
export function applyResearchDDL(sqlite: Sqlite): void {
  dropLegacyTables(sqlite);

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS research_defaults (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS loops (
      id TEXT PRIMARY KEY,
      template_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      envelope TEXT NOT NULL DEFAULT '{}',
      envelope_consumed TEXT NOT NULL DEFAULT '{"time_minutes":0,"cost_usd":0,"cycles_count":0,"sources_count":0}',
      child_pid INTEGER,
      prompt TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_loops_status ON loops(status);

    CREATE TABLE IF NOT EXISTS cycles (
      id TEXT PRIMARY KEY,
      loop_id TEXT NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
      idx INTEGER NOT NULL,
      priority REAL NOT NULL DEFAULT 0.5,
      status TEXT NOT NULL DEFAULT 'pending',
      started_at TEXT,
      finalized_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_cycles_loop_dispatch ON cycles(loop_id, priority DESC, created_at);
    CREATE INDEX IF NOT EXISTS idx_cycles_loop_status ON cycles(loop_id, status);

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      loop_id TEXT NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
      cycle_id TEXT REFERENCES cycles(id) ON DELETE SET NULL,
      kind TEXT NOT NULL,
      payload TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_loop_kind ON artifacts(loop_id, kind, created_at);
    CREATE INDEX IF NOT EXISTS idx_artifacts_cycle ON artifacts(cycle_id);

    CREATE TABLE IF NOT EXISTS cycle_ledger (
      loop_id TEXT NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
      cycle_id TEXT NOT NULL REFERENCES cycles(id) ON DELETE CASCADE,
      step TEXT NOT NULL,
      input_hash TEXT NOT NULL,
      output TEXT NOT NULL,
      cost_usd REAL NOT NULL DEFAULT 0,
      recorded_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (loop_id, cycle_id, step, input_hash)
    );
    CREATE INDEX IF NOT EXISTS idx_ledger_loop ON cycle_ledger(loop_id, recorded_at);

    CREATE TABLE IF NOT EXISTS milestones (
      id TEXT PRIMARY KEY,
      loop_id TEXT NOT NULL REFERENCES loops(id) ON DELETE CASCADE,
      at_envelope_pct INTEGER NOT NULL,
      artifact_id TEXT NOT NULL REFERENCES artifacts(id) ON DELETE CASCADE,
      digest_artifact_id TEXT REFERENCES artifacts(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_milestones_loop ON milestones(loop_id, at_envelope_pct);
  `);

  seedDefaults(sqlite);
}

/**
 * Idempotent drop of every pre-loops research table. Runs on every boot —
 * a no-op on already-clean DBs (CI, fresh installs), drops the lot on dev
 * DBs that still carry the old schema.
 *
 * Order matters: drop child tables before parents to avoid FK cascade
 * surprises. PRAGMA foreign_keys = OFF makes the order moot but explicit
 * order is still safer.
 */
function dropLegacyTables(sqlite: Sqlite): void {
  sqlite.exec('PRAGMA foreign_keys = OFF');
  sqlite.exec(`
    DROP TABLE IF EXISTS research_perturbation_state;
    DROP TABLE IF EXISTS research_finding_concepts;
    DROP TABLE IF EXISTS research_concept_links;
    DROP TABLE IF EXISTS research_concepts;
    DROP TABLE IF EXISTS research_sources;
    DROP TABLE IF EXISTS research_post_mortems;
    DROP TABLE IF EXISTS research_iteration_checks;
    DROP TABLE IF EXISTS research_proposed_monitors;
    DROP TABLE IF EXISTS research_monitor_alerts;
    DROP TABLE IF EXISTS research_monitor_snapshots;
    DROP TABLE IF EXISTS research_monitors;
    DROP TABLE IF EXISTS research_jobs;
    DROP TABLE IF EXISTS research_plan_modifications;
    DROP TABLE IF EXISTS research_plans;
    DROP TABLE IF EXISTS research_steps;
    DROP TABLE IF EXISTS research_findings;
    DROP TABLE IF EXISTS research_threads;
    DROP TABLE IF EXISTS research_queries;
    DROP TABLE IF EXISTS research_sessions;
  `);
  sqlite.exec('PRAGMA foreign_keys = ON');
}
