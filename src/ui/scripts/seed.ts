import Database from 'better-sqlite3';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { nanoid } from 'nanoid';
import * as schema from '../api/src/db/schema.js';
import { mkdirSync } from 'fs';

const dbPath = process.env.DATABASE_URL || './data/goals.db';
mkdirSync('data', { recursive: true });
const sqlite = new Database(dbPath);
sqlite.pragma('journal_mode = WAL');
sqlite.pragma('foreign_keys = ON');

// Create tables
sqlite.exec(`
  CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE, color TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS goals (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'medium',
    state TEXT NOT NULL DEFAULT 'not_started', archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS goal_categories (
    goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    PRIMARY KEY (goal_id, category_id)
  );
  CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    content TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS todos (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, done INTEGER NOT NULL DEFAULT 0,
    note TEXT, due_date TEXT, goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS recurring_todos (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, frequency TEXT NOT NULL,
    goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL, end_date TEXT,
    active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS recurring_todo_completions (
    id TEXT PRIMARY KEY, recurring_todo_id TEXT NOT NULL REFERENCES recurring_todos(id) ON DELETE CASCADE,
    period_key TEXT NOT NULL, completed_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(recurring_todo_id, period_key)
  );
  CREATE TABLE IF NOT EXISTS history_logs (
    id TEXT PRIMARY KEY, goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
    event_type TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS webauthn_credentials (
    id TEXT PRIMARY KEY, credential_id TEXT NOT NULL UNIQUE, public_key TEXT NOT NULL,
    counter INTEGER NOT NULL DEFAULT 0, transports TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS api_tokens (
    id TEXT PRIMARY KEY, name TEXT NOT NULL, token_hash TEXT NOT NULL UNIQUE,
    last_used_at TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS webhooks (
    id TEXT PRIMARY KEY, url TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]',
    secret TEXT, active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

const db = drizzle(sqlite, { schema });
const now = new Date().toISOString();

// Categories
const categories = [
  { id: nanoid(), name: 'Health', color: '#22c55e', createdAt: now },
  { id: nanoid(), name: 'Career', color: '#3b82f6', createdAt: now },
  { id: nanoid(), name: 'Finance', color: '#eab308', createdAt: now },
  { id: nanoid(), name: 'Learning', color: '#a855f7', createdAt: now },
  { id: nanoid(), name: 'Personal', color: '#f97316', createdAt: now },
];
for (const cat of categories) {
  db.insert(schema.categories).values(cat).run();
}
console.log(`Created ${categories.length} categories`);

// Goals
const goals = [
  { id: nanoid(), title: 'Run a half marathon', priority: 'high', state: 'actionable', archived: false, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Get promoted to senior engineer', priority: 'critical', state: 'actionable', archived: false, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Build emergency fund (6 months)', priority: 'high', state: 'scheduled', archived: false, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Learn Rust fundamentals', priority: 'medium', state: 'not_started', archived: false, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Read 24 books this year', priority: 'low', state: 'actionable', archived: false, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Meditate daily for 30 days', priority: 'medium', state: 'done', archived: false, createdAt: now, updatedAt: now },
];
for (const goal of goals) {
  db.insert(schema.goals).values(goal).run();
}
console.log(`Created ${goals.length} goals`);

// Goal-Category assignments
const assignments: [number, number][] = [
  [0, 0], [1, 1], [2, 2], [3, 3], [4, 3], [4, 4], [5, 0], [5, 4],
];
for (const [gi, ci] of assignments) {
  db.insert(schema.goalCategories).values({ goalId: goals[gi].id, categoryId: categories[ci].id }).run();
}
console.log(`Created ${assignments.length} category assignments`);

// Notes
const notes = [
  { id: nanoid(), goalId: goals[0].id, content: 'Signed up for the local half marathon in October. Starting a 16-week training plan next Monday.', createdAt: now, updatedAt: now },
  { id: nanoid(), goalId: goals[0].id, content: 'Week 1 done. Ran 3x this week, longest run was 5k. Feeling good about the pace.', createdAt: now, updatedAt: now },
  { id: nanoid(), goalId: goals[1].id, content: 'Had 1:1 with manager. Key areas: system design visibility and mentoring juniors.', createdAt: now, updatedAt: now },
  { id: nanoid(), goalId: goals[3].id, content: 'Found a good Rust course on exercism.org. Will start with the basics track.', createdAt: now, updatedAt: now },
  { id: nanoid(), goalId: goals[5].id, content: 'Completed 30 days! Used Headspace app, 10 minutes each morning. Noticeable reduction in anxiety.', createdAt: now, updatedAt: now },
];
for (const note of notes) {
  db.insert(schema.notes).values(note).run();
}
console.log(`Created ${notes.length} notes`);

// Todos
const today = now.slice(0, 10);
const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);

const todos = [
  { id: nanoid(), title: 'Morning 5k run', done: false, note: null, dueDate: today, goalId: goals[0].id, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Review PR #42', done: false, note: 'The auth refactor PR', dueDate: today, goalId: goals[1].id, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Transfer $500 to savings', done: false, note: null, dueDate: today, goalId: goals[2].id, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Read chapter 4 of Rust book', done: false, note: null, dueDate: tomorrow, goalId: goals[3].id, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Buy groceries', done: false, note: 'Chicken, rice, broccoli, eggs', dueDate: today, goalId: null, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Call dentist', done: false, note: null, dueDate: yesterday, goalId: null, createdAt: now, updatedAt: now },
];
for (const todo of todos) {
  db.insert(schema.todos).values(todo).run();
}
console.log(`Created ${todos.length} todos`);

// Recurring todos
const recurring = [
  { id: nanoid(), title: 'Morning run', frequency: 'daily', goalId: goals[0].id, endDate: null, active: true, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Weekly meal prep', frequency: 'weekly', goalId: null, endDate: null, active: true, createdAt: now, updatedAt: now },
  { id: nanoid(), title: 'Monthly budget review', frequency: 'monthly', goalId: goals[2].id, endDate: null, active: true, createdAt: now, updatedAt: now },
];
for (const rt of recurring) {
  db.insert(schema.recurringTodos).values(rt).run();
}
console.log(`Created ${recurring.length} recurring todos`);

// History logs
const historyEntries = goals.map(g => ({
  id: nanoid(),
  goalId: g.id,
  eventType: 'goal_created',
  details: JSON.stringify({ title: g.title }),
  createdAt: now,
}));
for (const h of historyEntries) {
  db.insert(schema.historyLogs).values(h).run();
}
console.log(`Created ${historyEntries.length} history entries`);

sqlite.close();
console.log('Seed complete!');
