import {
  sqliteTable,
  text,
  integer,
  primaryKey,
  index,
  unique,
} from 'drizzle-orm/sqlite-core';

export const categories = sqliteTable('categories', {
  id: text('id').primaryKey(),
  name: text('name').notNull().unique(),
  color: text('color'),
  createdAt: text('created_at').notNull(),
});

export const goals = sqliteTable('goals', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  priority: text('priority').notNull().default('medium'),
  state: text('state').notNull().default('not_started'),
  archived: integer('archived', { mode: 'boolean' }).notNull().default(false),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const goalCategories = sqliteTable(
  'goal_categories',
  {
    goalId: text('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    categoryId: text('category_id')
      .notNull()
      .references(() => categories.id, { onDelete: 'cascade' }),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.goalId, t.categoryId] }),
    categoryIdx: index('goal_categories_category_idx').on(t.categoryId),
  })
);

export const notes = sqliteTable(
  'notes',
  {
    id: text('id').primaryKey(),
    goalId: text('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    content: text('content').notNull(),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    goalIdx: index('notes_goal_idx').on(t.goalId),
  })
);

export const todos = sqliteTable(
  'todos',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    done: integer('done', { mode: 'boolean' }).notNull().default(false),
    note: text('note'),
    goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    goalIdx: index('todos_goal_idx').on(t.goalId),
  })
);

export const habits = sqliteTable('habits', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  frequency: text('frequency').notNull(),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  endDate: text('end_date'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const habitCompletions = sqliteTable(
  'habit_completions',
  {
    id: text('id').primaryKey(),
    habitId: text('habit_id')
      .notNull()
      .references(() => habits.id, { onDelete: 'cascade' }),
    periodKey: text('period_key').notNull(),
    completedAt: text('completed_at').notNull(),
  },
  (t) => ({
    habitIdx: index('hc_habit_idx').on(t.habitId),
    uniquePeriod: unique('hc_unique_period').on(t.habitId, t.periodKey),
  })
);

export const historyLogs = sqliteTable(
  'history_logs',
  {
    id: text('id').primaryKey(),
    goalId: text('goal_id')
      .notNull()
      .references(() => goals.id, { onDelete: 'cascade' }),
    eventType: text('event_type').notNull(),
    details: text('details').notNull(),
    createdAt: text('created_at').notNull(),
  },
  (t) => ({
    goalIdx: index('history_logs_goal_idx').on(t.goalId),
  })
);
