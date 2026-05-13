import type { Sqlite } from '@construct/data';
import type { SessionConfig } from '../types.js';
import { DEFAULT_SESSION_CONFIG } from '../types.js';

/**
 * Merge a stored partial config onto the code-defined defaults. The slimmed
 * `SessionConfig` is two flat fields (no nested objects), so the merge
 * collapses to a plain spread. Unknown keys in the stored JSON are
 * discarded — useful when migrating off the legacy ~25-field shape.
 */
function mergeWithCodeDefaults(partial: Partial<SessionConfig>): SessionConfig {
  return {
    iteration_check_model: partial.iteration_check_model ?? DEFAULT_SESSION_CONFIG.iteration_check_model,
    post_mortem_model: partial.post_mortem_model ?? DEFAULT_SESSION_CONFIG.post_mortem_model,
  };
}

export function seedDefaults(sqlite: Sqlite): void {
  const existing = sqlite.prepare('SELECT 1 FROM research_defaults WHERE id = 1').get();
  if (!existing) {
    sqlite.prepare('INSERT INTO research_defaults (id, config) VALUES (1, ?)').run(JSON.stringify(DEFAULT_SESSION_CONFIG));
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
  const merged: SessionConfig = mergeWithCodeDefaults({ ...current, ...updates });
  sqlite.prepare("UPDATE research_defaults SET config = ?, updated_at = datetime('now') WHERE id = 1").run(JSON.stringify(merged));
  return merged;
}

export function resetDefaults(sqlite: Sqlite): SessionConfig {
  sqlite.prepare("UPDATE research_defaults SET config = ?, updated_at = datetime('now') WHERE id = 1").run(JSON.stringify(DEFAULT_SESSION_CONFIG));
  return DEFAULT_SESSION_CONFIG;
}
