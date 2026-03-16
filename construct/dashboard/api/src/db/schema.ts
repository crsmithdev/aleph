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
    dueDate: text('due_date'),
    goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
    createdAt: text('created_at').notNull(),
    updatedAt: text('updated_at').notNull(),
  },
  (t) => ({
    goalIdx: index('todos_goal_idx').on(t.goalId),
    dueDateIdx: index('todos_due_date_idx').on(t.dueDate),
  })
);

export const recurringTodos = sqliteTable('recurring_todos', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  frequency: text('frequency').notNull(),
  goalId: text('goal_id').references(() => goals.id, { onDelete: 'set null' }),
  endDate: text('end_date'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});

export const recurringTodoCompletions = sqliteTable(
  'recurring_todo_completions',
  {
    id: text('id').primaryKey(),
    recurringTodoId: text('recurring_todo_id')
      .notNull()
      .references(() => recurringTodos.id, { onDelete: 'cascade' }),
    periodKey: text('period_key').notNull(),
    completedAt: text('completed_at').notNull(),
  },
  (t) => ({
    recurringTodoIdx: index('rtc_recurring_todo_idx').on(t.recurringTodoId),
    uniquePeriod: unique('rtc_unique_period').on(t.recurringTodoId, t.periodKey),
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

export const webauthnCredentials = sqliteTable('webauthn_credentials', {
  id: text('id').primaryKey(),
  credentialId: text('credential_id').notNull().unique(),
  publicKey: text('public_key').notNull(),
  counter: integer('counter').notNull(),
  transports: text('transports'),
  createdAt: text('created_at').notNull(),
});

export const apiTokens = sqliteTable('api_tokens', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  tokenHash: text('token_hash').notNull().unique(),
  lastUsedAt: text('last_used_at'),
  createdAt: text('created_at').notNull(),
});

export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  events: text('events').notNull(),
  secret: text('secret'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
