import {
  sqliteTable,
  text,
  integer,
} from 'drizzle-orm/sqlite-core';

// DDL source of truth: see onReady hook in app.ts
export const webhooks = sqliteTable('webhooks', {
  id: text('id').primaryKey(),
  url: text('url').notNull(),
  events: text('events').notNull(),
  secret: text('secret'),
  active: integer('active', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
});
