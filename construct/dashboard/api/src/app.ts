import Fastify from 'fastify';
import cors from '@fastify/cors';
import secureSession from '@fastify/secure-session';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import { createDb } from './db/client.js';
import { config } from './config.js';
import { errorHandler } from './plugins/error-handler.js';
import { authPlugin } from './plugins/auth.js';
import { categoryRoutes } from './routes/categories.js';
import { goalRoutes } from './routes/goals.js';
import { noteRoutes } from './routes/notes.js';
import { historyRoutes } from './routes/history.js';
import { todoRoutes } from './routes/todos.js';
import { recurringTodoRoutes } from './routes/recurring-todos.js';
import { authRoutes } from './routes/auth.js';
import { backupRoutes } from './routes/backup.js';
import { summaryRoutes } from './routes/summary.js';
import { webhookRoutes } from './routes/webhooks.js';
import { apiTokenRoutes } from './routes/api-tokens.js';
import { EventBus } from './services/event-bus.js';
import { HistoryService } from './services/history.js';
import { existsSync } from 'fs';
import { join, resolve } from 'path';

// Extend Fastify types
declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof createDb>['db'];
    sqlite: ReturnType<typeof createDb>['sqlite'];
    eventBus: EventBus;
  }
}

declare module '@fastify/secure-session' {
  interface SessionData {
    userId?: string;
    challenge?: string;
  }
}

export async function createApp(opts?: { dbUrl?: string }) {
  const app = Fastify({ logger: opts?.dbUrl === ':memory:' ? false : true });

  const { db, sqlite } = createDb(opts?.dbUrl || config.databaseUrl);
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);

  const eventBus = new EventBus();
  app.decorate('eventBus', eventBus);

  // Start history service listener
  const historyService = new HistoryService(db, eventBus);
  historyService.start();

  await app.register(cors, { origin: true, credentials: true });

  // Session - pad/slice key to 32 bytes
  const key = Buffer.alloc(32);
  const src = Buffer.from(config.sessionSecret);
  src.copy(key, 0, 0, Math.min(src.length, 32));
  await app.register(secureSession, { key, cookie: { path: '/', httpOnly: true, secure: config.nodeEnv === 'production' } });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Goal Tracker API', version: '0.1.0' },
      servers: [{ url: '/api' }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  await app.register(errorHandler);
  await app.register(authPlugin);

  // API routes - all under /api prefix
  await app.register(async (api) => {
    await api.register(authRoutes, { prefix: '/auth' });
    await api.register(categoryRoutes, { prefix: '/categories' });
    await api.register(goalRoutes, { prefix: '/goals' });
    await api.register(noteRoutes, { prefix: '/goals' });
    await api.register(historyRoutes, { prefix: '/goals' });
    await api.register(todoRoutes, { prefix: '/todos' });
    await api.register(recurringTodoRoutes, { prefix: '/recurring-todos' });
    await api.register(backupRoutes, { prefix: '/backup' });
    await api.register(summaryRoutes, { prefix: '/summary' });
    await api.register(webhookRoutes, { prefix: '/webhooks' });
    await api.register(apiTokenRoutes, { prefix: '/api-tokens' });
  }, { prefix: '/api' });

  // Serve frontend in production
  const webDist = resolve(import.meta.dirname || '.', '../../../web/dist');
  if (config.nodeEnv === 'production' && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (!req.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      reply.status(404).send({ error: 'Not found' });
    });
  }

  // Run migrations on ready
  app.addHook('onReady', async () => {
    // Apply schema directly using sqlite
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
      CREATE INDEX IF NOT EXISTS idx_todos_due_date ON todos(due_date);
      CREATE TABLE IF NOT EXISTS recurring_todos (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        frequency TEXT NOT NULL,
        goal_id TEXT REFERENCES goals(id) ON DELETE SET NULL,
        end_date TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS recurring_todo_completions (
        id TEXT PRIMARY KEY,
        recurring_todo_id TEXT NOT NULL REFERENCES recurring_todos(id) ON DELETE CASCADE,
        period_key TEXT NOT NULL,
        completed_at TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(recurring_todo_id, period_key)
      );
      CREATE INDEX IF NOT EXISTS idx_rtc_recurring ON recurring_todo_completions(recurring_todo_id);
      CREATE TABLE IF NOT EXISTS history_logs (
        id TEXT PRIMARY KEY,
        goal_id TEXT NOT NULL REFERENCES goals(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        details TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_history_goal ON history_logs(goal_id);
      CREATE TABLE IF NOT EXISTS webauthn_credentials (
        id TEXT PRIMARY KEY,
        credential_id TEXT NOT NULL UNIQUE,
        public_key TEXT NOT NULL,
        counter INTEGER NOT NULL DEFAULT 0,
        transports TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS api_tokens (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        token_hash TEXT NOT NULL UNIQUE,
        last_used_at TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS webhooks (
        id TEXT PRIMARY KEY,
        url TEXT NOT NULL,
        events TEXT NOT NULL DEFAULT '[]',
        secret TEXT,
        active INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  });

  app.addHook('onClose', () => {
    sqlite.close();
  });

  return app;
}
