import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
import { createDb } from './db/client.js';
import { config } from './config.js';
import { errorHandler } from './plugins/error-handler.js';
import { categoryRoutes } from './routes/categories.js';
import { goalRoutes } from './routes/goals.js';
import { noteRoutes } from './routes/notes.js';
import { historyRoutes } from './routes/history.js';
import { todoRoutes } from './routes/todos.js';
import { recurringTodoRoutes } from './routes/recurring-todos.js';
import { backupRoutes } from './routes/backup.js';
import { summaryRoutes } from './routes/summary.js';
import { webhookRoutes } from './routes/webhooks.js';
import { EventBus, HistoryService, applyDDL } from '@construct/goals';
import { webhooks } from './db/schema.js';
import { existsSync } from 'fs';
import { resolve } from 'path';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof createDb>['db'];
    sqlite: ReturnType<typeof createDb>['sqlite'];
    eventBus: EventBus;
  }
}

export async function createApp(opts?: { dbUrl?: string }) {
  const app = Fastify({ logger: opts?.dbUrl === ':memory:' ? false : true });

  const { db, sqlite } = createDb(opts?.dbUrl || config.databaseUrl);
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);

  const eventBus = new EventBus();
  app.decorate('eventBus', eventBus);

  const historyService = new HistoryService(db, eventBus);
  historyService.start();

  await app.register(cors, { origin: true });

  await app.register(swagger, {
    openapi: {
      info: { title: 'Construct UI API', version: '0.2.0' },
      servers: [{ url: '/api' }],
    },
  });
  await app.register(swaggerUi, { routePrefix: '/api/docs' });

  await app.register(errorHandler);

  await app.register(async (api) => {
    await api.register(categoryRoutes, { prefix: '/categories' });
    await api.register(goalRoutes, { prefix: '/goals' });
    await api.register(noteRoutes, { prefix: '/goals' });
    await api.register(historyRoutes, { prefix: '/goals' });
    await api.register(todoRoutes, { prefix: '/todos' });
    await api.register(recurringTodoRoutes, { prefix: '/recurring-todos' });
    await api.register(backupRoutes, { prefix: '/backup' });
    await api.register(summaryRoutes, { prefix: '/summary' });
    await api.register(webhookRoutes, { prefix: '/webhooks' });
  }, { prefix: '/api' });

  const webDist = resolve(import.meta.dirname || '.', '../../web/dist');
  if (config.nodeEnv === 'production' && existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((req, reply) => {
      if (!req.url.startsWith('/api')) {
        return reply.sendFile('index.html');
      }
      reply.status(404).send({ error: 'Not found' });
    });
  }

  app.addHook('onReady', async () => {
    // Goals domain DDL
    applyDDL(sqlite);
    // Webhooks DDL (UI infrastructure)
    sqlite.exec(`
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
