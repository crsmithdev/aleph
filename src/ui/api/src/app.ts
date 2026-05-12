import Fastify from 'fastify';
import fastifyStatic from '@fastify/static';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { createDb } from '@construct/data';
import { config } from './config.js';
import { errorHandler } from './plugins/error-handler.js';
import { categoryRoutes } from './routes/categories.js';
import { goalRoutes } from './routes/goals.js';
import { noteRoutes } from './routes/notes.js';
import { historyRoutes } from './routes/history.js';
import { todoRoutes } from './routes/todos.js';
import { habitRoutes } from './routes/habits.js';
import { backupRoutes } from './routes/backup.js';
import { summaryRoutes } from './routes/summary.js';
import { webhookRoutes } from './routes/webhooks.js';
import { observabilityRoutes } from './routes/observability.js';
import { researchRoutes } from './routes/research.js';
import { loopRoutes } from './routes/loops.js';
import { publicRoutes } from './routes/public.js';
import { EventBus, HistoryService, applyDDL } from '@construct/goals';
import { applyResearchDDL } from '@construct/research';
import { webhooks } from './db/schema.js';
import { existsSync } from 'fs';
import { resolve } from 'path';
import { createLogStream, log } from './logger.js';
import { WorkerSupervisor } from './worker-supervisor.js';
import { startResearchLogger } from './research-logger.js';
import { stopAllChildren } from './loop-supervisor.js';
import { getSystemInfo } from './system-info.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof createDb>['db'];
    sqlite: ReturnType<typeof createDb>['sqlite'];
    eventBus: EventBus;
    supervisor: WorkerSupervisor;
  }
}

type SqliteDb = ReturnType<typeof createDb>['sqlite'];

function applyObsDDL(sqlite: SqliteDb) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS obs_memory_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      taken_at TEXT NOT NULL DEFAULT (datetime('now')),
      total INTEGER NOT NULL,
      by_type TEXT NOT NULL,
      health TEXT NOT NULL,
      by_tag TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_obs_memory_taken_at ON obs_memory_snapshots(taken_at);
  `);
}

function applyWebhookDDL(sqlite: SqliteDb) {
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
}

export async function createApp(opts?: { dbUrl?: string; workerCount?: number; skipStatic?: boolean }) {
  const customLogging = opts?.dbUrl !== ':memory:';
  const app = Fastify({
    logger: customLogging ? { stream: createLogStream() } : false,
    disableRequestLogging: customLogging,
  });

  if (customLogging) {
    app.addHook('onResponse', (req, reply, done) => {
      log({
        source: 'api',
        level: reply.statusCode >= 500 ? 'error' : reply.statusCode >= 400 ? 'warn' : 'info',
        msg: `${req.method} ${req.url} → ${reply.statusCode}`,
        method: req.method,
        url: req.url,
        status: reply.statusCode,
        duration_ms: Math.round(reply.elapsedTime * 100) / 100,
      });
      done();
    });
  }

  const { db, sqlite } = createDb(opts?.dbUrl || config.databaseUrl);
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);

  const eventBus = new EventBus();
  app.decorate('eventBus', eventBus);

  // Default 8 workers — 24-core machines have plenty of headroom; the
  // real ceiling is provider rate-limit, not CPU. Override via WORKER_COUNT.
  const workerCount = opts?.workerCount ?? parseInt(process.env.WORKER_COUNT || '8', 10);
  const supervisor = new WorkerSupervisor(workerCount);
  app.decorate('supervisor', supervisor);

  const historyService = new HistoryService(db, eventBus);
  historyService.start();

  // Start background research event logger (only in non-test environments)
  if (opts?.dbUrl !== ':memory:') {
    startResearchLogger(sqlite);
  }

  await app.register(cors, {
    origin: (origin, cb) => {
      if (!origin || origin === 'http://localhost' || origin.startsWith('http://localhost:') ||
          origin === 'http://127.0.0.1' || origin.startsWith('http://127.0.0.1:')) {
        cb(null, true);
      } else {
        cb(new Error('Not allowed'), false);
      }
    },
  });

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
    await api.register(habitRoutes, { prefix: '/habits' });
    await api.register(backupRoutes, { prefix: '/backup' });
    await api.register(summaryRoutes, { prefix: '/summary' });
    await api.register(webhookRoutes, { prefix: '/webhooks' });
    await api.register(observabilityRoutes, { prefix: '/observability' });
    await api.register(researchRoutes, { prefix: '/research' });
    await api.register(loopRoutes, { prefix: '/loops' });

    api.get('/system/info', async function () {
      return getSystemInfo(app.sqlite.filename);
    });
  }, { prefix: '/api' });

  await app.register(publicRoutes, { prefix: '/public' });

  if (!opts?.skipStatic) {
    const webDist = resolve(import.meta.dirname || '.', '../../web/dist');
    if (existsSync(webDist)) {
      await app.register(fastifyStatic, { root: webDist, prefix: '/' });
      app.setNotFoundHandler((req, reply) => {
        if (!req.url.startsWith('/api') && !req.url.startsWith('/public')) {
          return reply.sendFile('index.html');
        }
        reply.status(404).send({ error: 'Not found' });
      });
    }
  }

  app.addHook('onReady', async () => {
    // Start research workers (skip in test mode)
    if (opts?.dbUrl !== ':memory:') supervisor.start();

    // Goals domain DDL
    applyDDL(sqlite);
    // Research domain DDL
    applyResearchDDL(sqlite);
    // Observability DDL — TODO: move to @construct/telemetry as applyObsDDL()
    applyObsDDL(sqlite);
    // Webhooks DDL — TODO: move to dedicated module, types in db/schema.ts
    applyWebhookDDL(sqlite);
  });

  app.addHook('onClose', async () => {
    await stopAllChildren();
    await supervisor.stop();
    sqlite.close();
  });

  return app;
}
