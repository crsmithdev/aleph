import Fastify from 'fastify';
import cors from '@fastify/cors';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import fastifyStatic from '@fastify/static';
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
import { EventBus, HistoryService, applyDDL } from '@construct/goals';
import { webhooks } from './db/schema.js';
import { existsSync, readFileSync, statSync } from 'fs';
import { resolve } from 'path';
import { execSync } from 'child_process';
import { claudePaths, dataPaths, getMemoryDbPath } from '@construct/data';
import { createLogStream } from './logger.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: ReturnType<typeof createDb>['db'];
    sqlite: ReturnType<typeof createDb>['sqlite'];
    eventBus: EventBus;
  }
}

function git(cmd: string, cwd?: string): string {
  try {
    return execSync(`git ${cmd}`, { cwd, encoding: 'utf-8', timeout: 5000 }).trim();
  } catch { return ''; }
}

function liveGitInfo(repoDir: string): Record<string, string> {
  const short = git('rev-parse --short HEAD', repoDir);
  if (!short) return {};

  // One call for hash, refs/branch info, subject, date
  const logLine = git('log -1 --format=%H%n%D%n%s%n%ci', repoDir);
  const [revision, refs, last_commit, last_commit_date] = logLine.split('\n');

  // Extract branch from refs string (e.g. "HEAD -> main, origin/main")
  const branchMatch = refs?.match(/HEAD -> ([^,]+)/);
  const branch = branchMatch ? branchMatch[1] : git('rev-parse --abbrev-ref HEAD', repoDir);

  const dirty = String(git('status --porcelain', repoDir).length > 0);
  const commit_count = git('rev-list --count HEAD', repoDir);

  const latestTag = git('describe --tags --abbrev=0 HEAD', repoDir);
  const commits_since_tag = latestTag
    ? git(`rev-list --count ${latestTag}..HEAD`, repoDir)
    : 'n/a';

  return { revision, short, dirty, branch, commit_count, commits_since_tag, last_commit, last_commit_date };
}

export async function createApp(opts?: { dbUrl?: string }) {
  const customLogging = opts?.dbUrl !== ':memory:';
  const app = Fastify({
    logger: customLogging ? { stream: createLogStream() } : false,
    disableRequestLogging: customLogging,
  });

  if (customLogging) {
    app.addHook('onResponse', (req, reply, done) => {
      const ms = reply.elapsedTime < 1000
        ? `${Math.round(reply.elapsedTime)}ms`
        : `${(reply.elapsedTime / 1000).toFixed(1)}s`;
      req.log.info(`${req.method} ${req.url} → ${reply.statusCode} (${ms})`);
      done();
    });
  }

  const { db, sqlite } = createDb(opts?.dbUrl || config.databaseUrl);
  app.decorate('db', db);
  app.decorate('sqlite', sqlite);

  const eventBus = new EventBus();
  app.decorate('eventBus', eventBus);

  const historyService = new HistoryService(db, eventBus);
  historyService.start();

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

    api.get('/system/info', async function () {
      // Parse manifest: INI-like file with [section] headers and key = value pairs
      let manifest: Record<string, Record<string, string>> = {};
      try {
        const content = readFileSync(claudePaths.manifest, 'utf-8');
        let current = '';
        for (const line of content.split('\n')) {
          if (line.startsWith('#') || !line.trim()) continue;
          const sectionMatch = line.match(/^\[(.+)]$/);
          if (sectionMatch) { current = sectionMatch[1]; manifest[current] = {}; continue; }
          const kvMatch = line.match(/^(\S+) = (.*)$/);
          if (kvMatch && current) manifest[current][kvMatch[1]] = kvMatch[2];
        }
      } catch { manifest = {}; }

      const hasManifest = Object.keys(manifest).length > 0;

      // Detect repo dir for live git info when no manifest
      const repoDir = manifest.paths?.repo ?? (() => {
        const candidate = resolve(import.meta.dirname || '.', '../../../..');
        return existsSync(resolve(candidate, '.git')) ? candidate : undefined;
      })();

      const liveGit = !hasManifest && repoDir ? liveGitInfo(repoDir) : {};
      const g = hasManifest ? manifest.git ?? {} : liveGit;

      const runtimeDbPath = app.sqlite.filename;
      const dbSize = (() => {
        try { return statSync(runtimeDbPath).size; } catch { return 0; }
      })();

      return {
        git: {
          revision: g.revision ?? 'unknown',
          short: g.short ?? 'unknown',
          dirty: g.dirty === 'true',
          branch: g.branch ?? 'unknown',
          commitCount: g.commit_count ?? 'unknown',
          commitsSinceTag: g.commits_since_tag ?? 'n/a',
          lastCommit: g.last_commit ?? 'unknown',
          lastCommitDate: g.last_commit_date ?? 'unknown',
        },
        paths: {
          repo: repoDir ?? 'unknown',
          claudeRoot: manifest.paths?.claude_root ?? claudePaths.root,
          dataRoot: manifest.paths?.data_root ?? dataPaths.root,
          construct: manifest.paths?.construct ?? claudePaths.construct,
          commands: manifest.paths?.commands ?? claudePaths.commands,
          skills: manifest.paths?.skills ?? claudePaths.skills,
          db: runtimeDbPath,
          memoryDb: (manifest.paths?.memory_db) ?? getMemoryDbPath(),
          sessions: (manifest.paths?.sessions) ?? dataPaths.sessions,
          telemetry: claudePaths.projects,
          signals: dataPaths.signals,
          ratings: (manifest.paths?.ratings) ?? dataPaths.ratings,
          backups: (manifest.paths?.backups) ?? dataPaths.backups,
        },
        install: {
          timestamp: manifest.install?.timestamp ?? 'unknown',
          bunVersion: manifest.install?.bun_version ?? Bun.version,
          platform: manifest.install?.platform ?? process.platform,
          arch: manifest.install?.arch ?? process.arch,
        },
        runtime: {
          nodeEnv: process.env.NODE_ENV || 'development',
          port: config.port,
          dbSizeBytes: dbSize,
        },
      };
    });
  }, { prefix: '/api' });

  const webDist = resolve(import.meta.dirname || '.', '../../web/dist');
  if (existsSync(webDist)) {
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
    // Observability DDL
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
    // Webhooks DDL (UI infrastructure) — schema types: see db/schema.ts
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
