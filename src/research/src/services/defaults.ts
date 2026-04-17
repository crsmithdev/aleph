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
