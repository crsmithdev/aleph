import type { Sqlite } from '@construct/data';
import { seedDefaults } from './services/defaults.js';

export function applyResearchDDL(sqlite: Sqlite): void {
  // Run rename migration BEFORE CREATE TABLE so it doesn't create an empty research_queries first
  try {
    // Only rename if research_queries doesn't already exist
    const hasQueries = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_queries'").get();
    const hasSessions = sqlite.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='research_sessions'").get();
    if (!hasQueries && hasSessions) {
      sqlite.exec('ALTER TABLE research_sessions RENAME TO research_queries');
    } else if (hasQueries && hasSessions) {
      // Both tables exist: dependent tables have stale FK refs to research_sessions.
      // Drop and let CREATE TABLE IF NOT EXISTS below recreate with correct FKs.
      // Safe because these tables have no rows (all inserts failed due to stale FK).
      sqlite.exec('PRAGMA foreign_keys = OFF');
      sqlite.exec(`
        DROP TABLE IF EXISTS research_proposed_monitors;
        DROP TABLE IF EXISTS research_monitor_alerts;
        DROP TABLE IF EXISTS research_monitor_snapshots;
        DROP TABLE IF EXISTS research_plan_modifications;
        DROP TABLE IF EXISTS research_plans;
        DROP TABLE IF EXISTS research_jobs;
        DROP TABLE IF EXISTS research_steps;
        DROP TABLE IF EXISTS research_findings;
        DROP TABLE IF EXISTS research_threads;
        DROP TABLE IF EXISTS research_sessions;
      `);
      sqlite.exec('PRAGMA foreign_keys = ON');
    }
  } catch { /* already renamed or not applicable */ }

  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS research_queries (
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
      session_id TEXT NOT NULL REFERENCES research_queries(id) ON DELETE CASCADE,
      parent_thread_id TEXT REFERENCES research_threads(id) ON DELETE SET NULL,
      spawned_from_finding_id TEXT,
      query TEXT NOT NULL,
      node_type TEXT NOT NULL DEFAULT 'question',
      origin TEXT NOT NULL DEFAULT 'seed',
      perturbation_strategy TEXT,
      status TEXT NOT NULL DEFAULT 'queued',
      priority REAL NOT NULL DEFAULT 0.5,
      depth INTEGER NOT NULL DEFAULT 0,
      max_depth INTEGER NOT NULL DEFAULT 9,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rt_session_status ON research_threads(session_id, status, priority);

    CREATE TABLE IF NOT EXISTS research_findings (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES research_threads(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES research_queries(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      summary TEXT NOT NULL,
      source_urls TEXT NOT NULL DEFAULT '[]',
      source_quality REAL NOT NULL DEFAULT 0.5,
      tags TEXT NOT NULL DEFAULT '[]',
      confidence REAL NOT NULL DEFAULT 0.5,
      novelty REAL NOT NULL DEFAULT 0.5,
      actionability REAL NOT NULL DEFAULT 0.5,
      user_rating TEXT,
      follow_ups TEXT NOT NULL DEFAULT '[]',
      follow_up_analysis TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rf_session_created ON research_findings(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_rf_thread ON research_findings(thread_id);

    CREATE TABLE IF NOT EXISTS research_steps (
      id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL REFERENCES research_threads(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES research_queries(id) ON DELETE CASCADE,
      finding_id TEXT REFERENCES research_findings(id) ON DELETE SET NULL,
      model TEXT NOT NULL,
      provider TEXT NOT NULL DEFAULT 'openrouter',
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      cost_usd REAL NOT NULL DEFAULT 0,
      tool_calls TEXT NOT NULL DEFAULT '[]',
      duration_ms INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      metadata TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rs_session_created ON research_steps(session_id, created_at);

    CREATE TABLE IF NOT EXISTS research_plans (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES research_queries(id) ON DELETE CASCADE,
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
      session_id TEXT REFERENCES research_queries(id) ON DELETE SET NULL,
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
      session_id TEXT NOT NULL REFERENCES research_queries(id) ON DELETE CASCADE,
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
      session_id TEXT NOT NULL REFERENCES research_queries(id) ON DELETE CASCADE,
      thread_id TEXT REFERENCES research_threads(id) ON DELETE SET NULL,
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

    CREATE TABLE IF NOT EXISTS research_defaults (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      config TEXT NOT NULL DEFAULT '{}',
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS research_concepts (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES research_queries(id) ON DELETE CASCADE,
      canonical_name TEXT NOT NULL,
      aliases TEXT NOT NULL DEFAULT '[]',
      summary TEXT NOT NULL DEFAULT '',
      key_facts TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_rc_session ON research_concepts(session_id);
    CREATE INDEX IF NOT EXISTS idx_rc_canonical ON research_concepts(session_id, canonical_name);

    CREATE TABLE IF NOT EXISTS research_concept_links (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES research_queries(id) ON DELETE CASCADE,
      from_concept_id TEXT NOT NULL REFERENCES research_concepts(id) ON DELETE CASCADE,
      to_concept_id TEXT NOT NULL REFERENCES research_concepts(id) ON DELETE CASCADE,
      relation TEXT NOT NULL,
      evidence_finding_ids TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(from_concept_id, to_concept_id, relation)
    );
    CREATE INDEX IF NOT EXISTS idx_rcl_session ON research_concept_links(session_id);
    CREATE INDEX IF NOT EXISTS idx_rcl_from ON research_concept_links(from_concept_id);

    CREATE TABLE IF NOT EXISTS research_finding_concepts (
      finding_id TEXT NOT NULL REFERENCES research_findings(id) ON DELETE CASCADE,
      concept_id TEXT NOT NULL REFERENCES research_concepts(id) ON DELETE CASCADE,
      session_id TEXT NOT NULL REFERENCES research_queries(id) ON DELETE CASCADE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (finding_id, concept_id)
    );
    CREATE INDEX IF NOT EXISTS idx_rfc_concept ON research_finding_concepts(concept_id);
    CREATE INDEX IF NOT EXISTS idx_rfc_session ON research_finding_concepts(session_id);

    CREATE TABLE IF NOT EXISTS research_sources (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES research_queries(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      title TEXT NOT NULL DEFAULT '',
      snippet TEXT NOT NULL DEFAULT '',
      extraction_status TEXT NOT NULL DEFAULT 'pending',
      extracted_text TEXT,
      extracted_at TEXT,
      fetched_at TEXT,
      error TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(session_id, url)
    );
    CREATE INDEX IF NOT EXISTS idx_rsrc_session_status ON research_sources(session_id, extraction_status);
    CREATE INDEX IF NOT EXISTS idx_rsrc_status ON research_sources(extraction_status, created_at);
  `);

  // Migrations
  try { sqlite.exec(`ALTER TABLE research_threads ADD COLUMN short_query TEXT`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_queries ADD COLUMN seed_query_short TEXT`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_queries ADD COLUMN seed_query_super_short TEXT`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_steps ADD COLUMN label TEXT`); } catch { /* exists */ }
  try { sqlite.exec("ALTER TABLE research_findings ADD COLUMN source_url_meta TEXT NOT NULL DEFAULT '[]'"); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_findings ADD COLUMN follow_up_analysis TEXT`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_threads ADD COLUMN node_type TEXT NOT NULL DEFAULT 'question'`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_findings RENAME COLUMN follow_up_questions TO follow_ups`); } catch { /* exists or unsupported */ }
  try { sqlite.exec(`ALTER TABLE research_findings ADD COLUMN source_texts TEXT NOT NULL DEFAULT '[]'`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_threads ADD COLUMN min_searches INTEGER`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_threads ADD COLUMN fetch_source_text INTEGER`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_queries ADD COLUMN document TEXT NOT NULL DEFAULT ''`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_jobs ADD COLUMN thread_id TEXT`); } catch { /* exists */ }
  try { sqlite.exec(`CREATE INDEX IF NOT EXISTS idx_rj_thread ON research_jobs(thread_id, status)`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_threads ADD COLUMN retry_after TEXT`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_threads ADD COLUMN seed_similarity REAL`); } catch { /* exists */ }
  try { sqlite.exec(`ALTER TABLE research_steps ADD COLUMN metadata TEXT`); } catch { /* exists */ }

  // Backfill cost_usd for steps stored before pricing was configured (idempotent — only touches cost_usd=0 rows)
  sqlite.exec(`
    UPDATE research_steps SET cost_usd =
      CASE model
        WHEN 'deepseek/deepseek-chat'    THEN (prompt_tokens * 0.27 + completion_tokens * 1.10) / 1000000.0
        WHEN 'deepseek/deepseek-chat-v3' THEN (prompt_tokens * 0.27 + completion_tokens * 1.10) / 1000000.0
        ELSE cost_usd
      END
    WHERE cost_usd = 0 AND (prompt_tokens > 0 OR completion_tokens > 0)
      AND model IN ('deepseek/deepseek-chat', 'deepseek/deepseek-chat-v3')
  `);

  // Seed research_sources from existing findings' source_url_meta.
  // Existing URLs go in as 'skipped' — the queue is forward-looking, we don't
  // want a backlog drain to re-fetch everything on first boot after upgrade.
  try {
    const already = sqlite.prepare('SELECT 1 FROM research_sources LIMIT 1').get();
    if (!already) {
      const rows = sqlite.prepare(
        'SELECT id, session_id, source_url_meta FROM research_findings WHERE source_url_meta IS NOT NULL AND source_url_meta != \'[]\''
      ).all() as Array<{ id: string; session_id: string; source_url_meta: string }>;
      const insert = sqlite.prepare(
        `INSERT OR IGNORE INTO research_sources (id, session_id, url, title, snippet, extraction_status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'skipped', datetime('now'), datetime('now'))`
      );
      const seed = sqlite.transaction((items: Array<{ sid: string; url: string; title: string; snippet: string }>) => {
        for (const it of items) {
          insert.run(`src_${it.sid.slice(0, 8)}_${Buffer.from(it.url).toString('base64').slice(0, 16)}`, it.sid, it.url, it.title, it.snippet);
        }
      });
      const items: Array<{ sid: string; url: string; title: string; snippet: string }> = [];
      for (const r of rows) {
        try {
          const meta = JSON.parse(r.source_url_meta) as Array<{ url: string; title?: string; snippet?: string }>;
          for (const m of meta) {
            if (m && m.url) items.push({ sid: r.session_id, url: m.url, title: m.title ?? '', snippet: m.snippet ?? '' });
          }
        } catch { /* skip malformed */ }
      }
      if (items.length > 0) seed(items);
    }
  } catch { /* table or data absent */ }

  // Fix stale FK: research_monitors.session_id may reference the old 'research_sessions'
  // table name (pre-rename). Rebuild the table to point at research_queries.
  try {
    const fks = sqlite.prepare('PRAGMA foreign_key_list(research_monitors)').all() as Array<{ table: string }>;
    const hasStaleFK = fks.some(f => f.table === 'research_sessions');
    if (hasStaleFK) {
      sqlite.exec('PRAGMA foreign_keys = OFF');
      sqlite.exec(`
        CREATE TABLE research_monitors_new (
          id TEXT PRIMARY KEY,
          session_id TEXT REFERENCES research_queries(id) ON DELETE SET NULL,
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
        INSERT INTO research_monitors_new SELECT * FROM research_monitors;
        DROP TABLE research_monitors;
        ALTER TABLE research_monitors_new RENAME TO research_monitors;
      `);
      sqlite.exec('PRAGMA foreign_keys = ON');
    }
  } catch { /* not applicable */ }

  seedDefaults(sqlite);
}
