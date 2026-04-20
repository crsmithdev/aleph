import type { Sqlite } from '@construct/data';
import { generateId } from './id.js';
import type { SteeringNote } from '../types.js';

export function createSteeringNote(sqlite: Sqlite, sessionId: string, text: string): SteeringNote {
  const id = generateId();
  const now = new Date().toISOString();
  sqlite.prepare(`
    INSERT INTO research_steering_notes (id, session_id, text, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, sessionId, text, now);
  return sqlite.prepare('SELECT * FROM research_steering_notes WHERE id = ?').get(id) as unknown as SteeringNote;
}

export function listSteeringNotes(sqlite: Sqlite, sessionId: string): SteeringNote[] {
  return sqlite.prepare(
    'SELECT * FROM research_steering_notes WHERE session_id = ? ORDER BY created_at ASC'
  ).all(sessionId) as unknown as SteeringNote[];
}

export function listUnappliedSteeringNotes(sqlite: Sqlite, sessionId: string): SteeringNote[] {
  return sqlite.prepare(
    'SELECT * FROM research_steering_notes WHERE session_id = ? AND applied_at IS NULL ORDER BY created_at ASC'
  ).all(sessionId) as unknown as SteeringNote[];
}

export function markSteeringNotesApplied(sqlite: Sqlite, ids: string[]): void {
  if (ids.length === 0) return;
  const placeholders = ids.map(() => '?').join(',');
  sqlite.prepare(
    `UPDATE research_steering_notes SET applied_at = datetime('now') WHERE id IN (${placeholders})`
  ).run(...ids);
}
