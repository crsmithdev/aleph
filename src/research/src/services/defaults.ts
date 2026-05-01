import type { Sqlite } from '@construct/data';
import type { SessionConfig } from '../types.js';
import { DEFAULT_SESSION_CONFIG } from '../types.js';

function mergeWithCodeDefaults(partial: Partial<SessionConfig>): SessionConfig {
  return {
    ...DEFAULT_SESSION_CONFIG,
    ...partial,
    providers: { ...DEFAULT_SESSION_CONFIG.providers, ...(partial.providers ?? {}) },
    schedule: { ...DEFAULT_SESSION_CONFIG.schedule, ...(partial.schedule ?? {}) },
    perturbation: { ...DEFAULT_SESSION_CONFIG.perturbation, ...(partial.perturbation ?? {}) },
    follow_up: { ...DEFAULT_SESSION_CONFIG.follow_up, ...(partial.follow_up ?? {}) },
    topic_coherence: { ...DEFAULT_SESSION_CONFIG.topic_coherence, ...(partial.topic_coherence ?? {}) },
    gap_analysis: { ...DEFAULT_SESSION_CONFIG.gap_analysis, ...(partial.gap_analysis ?? {}) },
  };
}

export function seedDefaults(sqlite: Sqlite): void {
  const existing = sqlite.prepare('SELECT config FROM research_defaults WHERE id = 1').get() as { config: string } | undefined;
  if (!existing) {
    sqlite.prepare('INSERT INTO research_defaults (id, config) VALUES (1, ?)').run(JSON.stringify(DEFAULT_SESSION_CONFIG));
    return;
  }
  migrateDefaults(sqlite, existing.config);
}

/** Bump stored default fields to current code defaults IF the stored value
 *  still matches the previous code default (i.e., the user hasn't customized).
 *  Narrow + idempotent: runs on every startup, only rewrites when applicable. */
function migrateDefaults(sqlite: Sqlite, storedJson: string): void {
  const stored = JSON.parse(storedJson) as Partial<SessionConfig> & Record<string, unknown>;

  // (previous_default, new_default) tuples — only migrate if stored still matches previous.
  const scalarMigrations: Array<[keyof SessionConfig, unknown, unknown]> = [
    ['max_total_threads', 150, DEFAULT_SESSION_CONFIG.max_total_threads],
    ['max_thread_depth', 3, DEFAULT_SESSION_CONFIG.max_thread_depth],
    ['min_searches_per_thread', 2, DEFAULT_SESSION_CONFIG.min_searches_per_thread],
    // Bump per-session thread parallelism so workers actually fan out — burst
    // session-jobs are now kickoff-only and follow-ups go through thread-jobs,
    // so the prior cap of 3 left 5/8 workers idle on every active session.
    ['max_concurrent_threads', 3, DEFAULT_SESSION_CONFIG.max_concurrent_threads],
    // Bump primary model: deepseek-chat → deepseek-v3.2 (50% cheaper output,
    // sparse attention, same prompt behavior). Only migrate if stored is the
    // previous default, so user-customized models stay put.
    ['model', 'deepseek/deepseek-chat', DEFAULT_SESSION_CONFIG.model],
  ];

  let changed = false;
  for (const [key, prev, next] of scalarMigrations) {
    if (stored[key as string] === prev) { (stored as Record<string, unknown>)[key as string] = next; changed = true; }
  }

  // Migrate openrouter_models default array if it still matches the prior default.
  const providers = stored.providers as { openrouter_models?: string[] } | undefined;
  if (providers && Array.isArray(providers.openrouter_models)
      && providers.openrouter_models.length === 1
      && providers.openrouter_models[0] === 'deepseek/deepseek-chat') {
    providers.openrouter_models = [...DEFAULT_SESSION_CONFIG.providers.openrouter_models];
    changed = true;
  }

  // Backfill model_fast for installs that predate the field.
  if (stored.model_fast === undefined) {
    stored.model_fast = DEFAULT_SESSION_CONFIG.model_fast;
    changed = true;
  }

  const fu = (stored.follow_up ?? {}) as Record<string, unknown>;
  if (fu.min_count === 2 && fu.max_count === 4) {
    fu.min_count = DEFAULT_SESSION_CONFIG.follow_up.min_count;
    fu.max_count = DEFAULT_SESSION_CONFIG.follow_up.max_count;
    stored.follow_up = fu as unknown as SessionConfig['follow_up'];
    changed = true;
  }

  if (changed) {
    sqlite.prepare("UPDATE research_defaults SET config = ?, updated_at = datetime('now') WHERE id = 1")
      .run(JSON.stringify(stored));
    console.log('[research_defaults] migrated to new code defaults');
  }
}

export function getDefaults(sqlite: Sqlite): SessionConfig {
  const row = sqlite.prepare('SELECT config FROM research_defaults WHERE id = 1').get() as { config: string } | undefined;
  if (!row) return DEFAULT_SESSION_CONFIG;
  const stored = JSON.parse(row.config) as Partial<SessionConfig>;
  return mergeWithCodeDefaults(stored);
}

export function updateDefaults(sqlite: Sqlite, updates: Partial<SessionConfig>): SessionConfig {
  const current = getDefaults(sqlite);
  const merged: SessionConfig = {
    ...current,
    ...updates,
    providers: { ...current.providers, ...(updates.providers ?? {}) },
    schedule: { ...current.schedule, ...(updates.schedule ?? {}) },
    perturbation: { ...current.perturbation, ...(updates.perturbation ?? {}) },
    follow_up: { ...current.follow_up, ...(updates.follow_up ?? {}) },
    topic_coherence: { ...current.topic_coherence, ...(updates.topic_coherence ?? {}) },
    gap_analysis: { ...current.gap_analysis, ...(updates.gap_analysis ?? {}) },
  };
  sqlite.prepare("UPDATE research_defaults SET config = ?, updated_at = datetime('now') WHERE id = 1").run(JSON.stringify(merged));
  return merged;
}

export function resetDefaults(sqlite: Sqlite): SessionConfig {
  sqlite.prepare("UPDATE research_defaults SET config = ?, updated_at = datetime('now') WHERE id = 1").run(JSON.stringify(DEFAULT_SESSION_CONFIG));
  return DEFAULT_SESSION_CONFIG;
}
