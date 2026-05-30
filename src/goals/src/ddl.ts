import type { Sqlite } from '@aleph/data';

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
      due_date TEXT,
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
    CREATE TABLE IF NOT EXISTS history_logs (
      id TEXT PRIMARY KEY,
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      event_type TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '{}',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_history_goal ON history_logs(goal_id);
    CREATE TABLE IF NOT EXISTS goal_links (
      goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      linked_goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
      PRIMARY KEY (goal_id, linked_goal_id)
    );
    CREATE INDEX IF NOT EXISTS idx_goal_links_linked ON goal_links(linked_goal_id);
  `);

  // Migrations — guarded to only run when needed, never concurrently
  // SQLite ALTER TABLE DROP COLUMN rebuilds the table internally;
  // running it concurrently from two processes causes data loss.

  const dueDateExists = sqlite.prepare("SELECT count(*) as c FROM pragma_table_info('todos') WHERE name='due_date'").get() as { c: number } | null;
  if (!dueDateExists || dueDateExists.c === 0) {
    sqlite.exec('ALTER TABLE todos ADD COLUMN due_date TEXT');
  }
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date)');

  // Rename recurring_todos -> habits (only if old table exists AND new doesn't)
  const hasOldTable = sqlite.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='recurring_todos'").get() as { c: number } | null;
  const hasNewTable = sqlite.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='habits'").get() as { c: number } | null;
  if (hasOldTable && hasOldTable.c > 0) {
    if (hasNewTable && hasNewTable.c > 0) {
      // Both exist — new table was created empty by CREATE IF NOT EXISTS, drop it and rename old
      sqlite.exec('DROP TABLE habits');
    }
    sqlite.exec('ALTER TABLE recurring_todos RENAME TO habits');
  }

  const hasOldCompletions = sqlite.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='recurring_todo_completions'").get() as { c: number } | null;
  const hasNewCompletions = sqlite.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='habit_completions'").get() as { c: number } | null;
  if (hasOldCompletions && hasOldCompletions.c > 0) {
    if (hasNewCompletions && hasNewCompletions.c > 0) {
      sqlite.exec('DROP TABLE habit_completions');
    }
    sqlite.exec('ALTER TABLE recurring_todo_completions RENAME TO habit_completions');
  }

  // Rename recurring_todo_id -> habit_id in habit_completions
  const hasOldCol = sqlite.prepare("SELECT count(*) as c FROM pragma_table_info('habit_completions') WHERE name='recurring_todo_id'").get() as { c: number } | null;
  if (hasOldCol && hasOldCol.c > 0) {
    sqlite.exec('ALTER TABLE habit_completions RENAME COLUMN recurring_todo_id TO habit_id');
  }

  // Create index after migrations (depends on habit_id column existing)
  sqlite.exec('CREATE INDEX IF NOT EXISTS idx_hc_habit ON habit_completions(habit_id)');
}
