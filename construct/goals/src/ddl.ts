import type { Sqlite } from '@construct/data';

export function applyDDL(sqlite: Sqlite): void {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      color TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS goals (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      priority TEXT NOT NULL DEFAULT 'medium',
      state TEXT NOT NULL DEFAULT 'not_started',
      archived INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS goal_categories (
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
      PRIMARY KEY (goal_id, category_id)
    );
    CREATE INDEX IF NOT EXISTS idx_goal_categories_category ON goal_categories(category_id);
    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      content TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_notes_goal ON notes(goal_id);
    CREATE TABLE IF NOT EXISTS todos (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      done INTEGER NOT NULL DEFAULT 0,
      note TEXT,
      goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_todos_goal ON todos(goal_id);
    CREATE TABLE IF NOT EXISTS habits (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      frequency TEXT NOT NULL,
      goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
      end_date TEXT,
      active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS habit_completions (
      id TEXT PRIMARY KEY,
      habit_id TEXT NOT NULL REFERENCES habits(id) ON DELETE CASCADE,
      period_key TEXT NOT NULL,
      completed_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(habit_id, period_key)
    );
    CREATE INDEX IF NOT EXISTS idx_hc_habit ON habit_completions(habit_id);
    CREATE TABLE IF NOT EXISTS history_logs (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_history_goal ON history_logs(goal_id);
  `);

  // Migration: drop due_date if it exists
  // SQLite 3.35+ supports ALTER TABLE DROP COLUMN
  try {
    sqlite.exec('ALTER TABLE todos DROP COLUMN due_date');
  } catch {
    // Column doesn't exist on fresh installs — safe to ignore
  }
  sqlite.exec('DROP INDEX IF EXISTS idx_todos_due_date');

  // Migration: rename recurring_todos -> habits, recurring_todo_completions -> habit_completions
  try {
    sqlite.exec('ALTER TABLE recurring_todos RENAME TO habits');
  } catch {
    // Table already renamed or doesn't exist
  }
  try {
    sqlite.exec('ALTER TABLE recurring_todo_completions RENAME TO habit_completions');
  } catch {
    // Table already renamed or doesn't exist
  }
}
