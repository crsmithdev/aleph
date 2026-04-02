import type { Sqlite } from '@construct/data';

export function applyResearchDDL(sqlite: Sqlite): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS research_sessions (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      seed_query TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      config TEXT NOT NULL DEFAULT '{}',
      summary TEXT NOT NULL DEFAULT '',
      user_notes TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_threads (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
      parent_thread_id TEXT REFERENCES research_threads(id) ON DELETE SET NULL,
      spawned_from_finding_id TEXT,
      query TEXT NOT NULL,
      origin TEXT NOT NULL DEFAULT 'seed',
      perturbation_strategy TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      priority REAL NOT NULL DEFAULT 0.5,
      depth INTEGER NOT NULL DEFAULT 0,
      max_depth INTEGER NOT NULL DEFAULT 8,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rt_session_status ON research_threads(session_id, status, priority);

    CREATE TABLE IF NOT EXISTS research_findings (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES research_threads(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_urls TEXT NOT NULL DEFAULT '[]',
      source_quality REAL NOT NULL DEFAULT 0.5,
      tags TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.5,
      novelty REAL NOT NULL DEFAULT 0.5,
      actionability REAL NOT NULL DEFAULT 0.5,
      user_rating TEXT,
      follow_up_questions TEXT NOT NULL DEFAULT '[]',
      follow_up_analysis TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rf_session_created ON research_findings(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_rf_thread ON research_findings(thread_id);

    CREATE TABLE IF NOT EXISTS research_steps (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES research_threads(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
      finding_id TEXT REFERENCES research_findings(id) ON DELETE SET NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'anthropic',
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      tool_calls TEXT NOT NULL DEFAULT '[]',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rs_session_created ON research_steps(session_id, created_at);

    CREATE TABLE IF NOT EXISTS research_plans (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
      items TEXT NOT NULL DEFAULT '[]',
      generated_at TEXT NOT NULL DEFAULT (datetime('now')),
      status TEXT NOT NULL DEFAULT 'proposed'
    );
    CREATE INDEX IF NOT EXISTS idx_rp_session ON research_plans(session_id);

    CREATE TABLE IF NOT EXISTS research_plan_modifications (
      id TEXT PRIMARY KEY,
      plan_id TEXT NOT NULL REFERENCES research_plans(id) ON DELETE CASCADE,
      action TEXT NOT NULL,
      target_item_rank INTEGER,
      target_thread_id TEXT,
      payload TEXT NOT NULL DEFAULT '',
      source TEXT NOT NULL DEFAULT 'cli',
      raw_input TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rpm_plan ON research_plan_modifications(plan_id);

    CREATE TABLE IF NOT EXISTS research_monitors (
      id TEXT PRIMARY KEY,
      session_id TEXT REFERENCES research_sessions(id) ON DELETE SET NULL,
      title TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'active',
      queries TEXT NOT NULL DEFAULT '[]',
      fetch_urls TEXT NOT NULL DEFAULT '[]',
      schedule TEXT NOT NULL DEFAULT '0 8 * * *',
      timezone TEXT NOT NULL DEFAULT 'America/Los_Angeles',
      match_criteria TEXT NOT NULL DEFAULT '{}',
      model TEXT NOT NULL DEFAULT 'claude-haiku-4-5',
      cost_per_cycle_estimate REAL NOT NULL DEFAULT 0,
      budget_daily_usd REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_monitor_snapshots (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL REFERENCES research_monitors(id) ON DELETE CASCADE,
      cycle_number INTEGER NOT NULL,
      raw_results TEXT NOT NULL,
      result_hash TEXT NOT NULL,
      item_count INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rms_monitor ON research_monitor_snapshots(monitor_id, cycle_number DESC);

    CREATE TABLE IF NOT EXISTS research_monitor_alerts (
      id TEXT PRIMARY KEY,
      monitor_id TEXT NOT NULL REFERENCES research_monitors(id) ON DELETE CASCADE,
      snapshot_id TEXT NOT NULL REFERENCES research_monitor_snapshots(id) ON DELETE CASCADE,
      alert_type TEXT NOT NULL,
      title TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      source_url TEXT,
      matched_criteria TEXT NOT NULL DEFAULT '[]',
      severity TEXT NOT NULL DEFAULT 'info',
      status TEXT NOT NULL DEFAULT 'unread',
      spawned_thread_id TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rma_monitor ON research_monitor_alerts(monitor_id, status, created_at);

    CREATE TABLE IF NOT EXISTS research_proposed_monitors (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
      thread_id TEXT NOT NULL REFERENCES research_threads(id) ON DELETE CASCADE,
      proposed_queries TEXT NOT NULL DEFAULT '[]',
      proposed_fetch_urls TEXT NOT NULL DEFAULT '[]',
      proposed_criteria TEXT NOT NULL DEFAULT '{}',
      proposed_schedule TEXT NOT NULL DEFAULT '0 8 * * *',
      rationale TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'proposed',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rpm_session ON research_proposed_monitors(session_id);

    CREATE TABLE IF NOT EXISTS research_jobs (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES research_sessions(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending',
      mode TEXT NOT NULL DEFAULT 'burst',
      max_iterations INTEGER,
      iterations_completed INTEGER NOT NULL DEFAULT 0,
      claimed_by TEXT,
      claimed_at TEXT,
      heartbeat_at TEXT,
      started_at TEXT,
      completed_at TEXT,
      error TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rj_status ON research_jobs(status, created_at);
    CREATE INDEX IF NOT EXISTS idx_rj_session ON research_jobs(session_id, status);
    CREATE INDEX IF NOT EXISTS idx_rj_heartbeat ON research_jobs(status, heartbeat_at);
  `);

  // Migration: add follow_up_analysis if missing
  try {
    sqlite.exec(`ALTER TABLE research_findings ADD COLUMN follow_up_analysis TEXT`);
  } catch { /* column already exists */ }
}
