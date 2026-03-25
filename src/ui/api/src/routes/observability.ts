import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { resolve } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { Database } from 'bun:sqlite';
import {
  parseSessionsForDays,
  aggregateOverview,
  aggregateTools,
  aggregateHooks,
  aggregateSkills,
  aggregateTokens,
  aggregateCost,
  aggregateSessions,
  aggregateToolDetail,
  aggregateHookDetail,
  aggregateSkillDetail,
  aggregateMemoryUsage,
  aggregateHookEvents,
  aggregateCompaction,
  aggregateApiDuration,
  aggregateSessionTrace,
  getRecentEvents,
} from '@construct/telemetry';
import type { Granularity, SessionEntry } from '@construct/telemetry';

type QueryParams = { days?: string; range?: string; granularity?: string; session?: string };
type ObsRequest = FastifyRequest<{ Querystring: QueryParams }> & {
  telemetryEntries: SessionEntry[];
  granularity: Granularity;
};

function parseGranularity(raw?: string): Granularity {
  if (raw === 'minute' || raw === 'hour' || raw === 'day') return raw;
  return 'day';
}

function rangeToDays(range?: string): number | undefined {
  switch (range) {
    case '1h': return 1;      // parse 1 day, filter later
    case '1d': return 1;
    case '7d': return 7;
    case '30d': return 30;
    case 'session': return 7; // parse 7 days, filter to latest session
    default: return undefined;
  }
}

function parseDaysPreHandler(
  req: FastifyRequest<{ Querystring: QueryParams }>,
  reply: { code: (n: number) => { send: (body: unknown) => void } },
  done: () => void,
) {
  const range = req.query.range;
  const days = range ? rangeToDays(range) : parseInt(req.query.days || '30', 10);
  if (!days || Number.isNaN(days) || days < 1 || days > 365) {
    reply.code(400).send({ error: 'invalid days or range parameter' });
    return;
  }
  let entries = parseSessionsForDays(days);

  // For 1h range, filter to entries within the last hour
  if (range === '1h') {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    entries = entries.filter((e) => e.timestamp >= oneHourAgo);
  }

  // For session range, filter to the most recent session
  if (range === 'session') {
    const latest = entries.reduce((best, e) => (e.timestamp > best ? e.timestamp : best), '');
    if (latest) {
      const latestSession = entries.find((e) => e.timestamp === latest)?.sessionId;
      if (latestSession) {
        entries = entries.filter((e) => e.sessionId === latestSession);
      }
    }
  }

  // Filter by explicit session if provided
  const sessionFilter = req.query.session;
  if (sessionFilter) {
    entries = entries.filter((e) => e.sessionId === sessionFilter);
  }

  (req as ObsRequest).telemetryEntries = entries;
  (req as ObsRequest).granularity = parseGranularity(req.query.granularity);
  done();
}

function timed<T>(fn: () => T): { result: T; queryTimeMs: number } {
  const start = performance.now();
  const result = fn();
  const queryTimeMs = Math.round((performance.now() - start) * 100) / 100;
  return { result, queryTimeMs };
}

function extractHookPath(fullCommand: string): string | undefined {
  const parts = fullCommand.split(/\s+/);
  for (const part of parts) {
    if (part.startsWith('/') && (part.endsWith('.ts') || part.endsWith('.js') || part.endsWith('.sh'))) {
      return part;
    }
  }
  return undefined;
}

function checkHookActive(fullCommand: string): boolean {
  const path = extractHookPath(fullCommand);
  return path ? existsSync(path) : false;
}

function readHookSource(fullCommand: string): string | undefined {
  const path = extractHookPath(fullCommand);
  if (!path || !existsSync(path)) return undefined;
  try {
    return readFileSync(path, 'utf-8');
  } catch {
    return undefined;
  }
}

function checkToolActive(toolName: string, lastUsed?: string): boolean {
  const sevenDaysAgo = new Date();
  sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
  if (lastUsed) {
    return new Date(lastUsed) >= sevenDaysAgo;
  }
  return false;
}

export const observabilityRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: QueryParams }>('/overview', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateOverview(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/tools', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateTools(obsReq.telemetryEntries, obsReq.granularity));
    // Add active status
    const ranked = result.ranked.map((t) => ({
      ...t,
      active: checkToolActive(t.name, t.lastUsed),
    }));
    return { ...result, ranked, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/hooks', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateHooks(obsReq.telemetryEntries, obsReq.granularity));
    // Add active status by checking if hook file exists
    const ranked = result.ranked.map((h) => ({
      ...h,
      active: h.fullCommand ? checkHookActive(h.fullCommand) : false,
    }));
    return { ...result, ranked, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/skills', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateSkills(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/tokens', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateTokens(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/cost', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateCost(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/sessions', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateSessions(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Params: { id: string }; Querystring: QueryParams }>(
    '/sessions/:id/trace',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const sessionId = decodeURIComponent(req.params.id);
      const { result, queryTimeMs } = timed(() => aggregateSessionTrace((req as ObsRequest).telemetryEntries, sessionId));
      return { ...result, queryTimeMs };
    },
  );

  app.get<{ Params: { name: string }; Querystring: QueryParams }>(
    '/tools/:name',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const toolName = decodeURIComponent(req.params.name);
      const { result, queryTimeMs } = timed(() => aggregateToolDetail((req as ObsRequest).telemetryEntries, toolName));
      return { ...result, queryTimeMs };
    },
  );

  app.get<{ Querystring: QueryParams }>('/hooks/events', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateHookEvents(obsReq.telemetryEntries));
    return { ...result, queryTimeMs };
  });

  app.get<{ Params: { name: string }; Querystring: QueryParams }>(
    '/hooks/:name',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const hookName = decodeURIComponent(req.params.name);
      const obsReq = req as ObsRequest;
      const { result, queryTimeMs } = timed(() => aggregateHookDetail(obsReq.telemetryEntries, hookName));
      const active = result.fullCommand ? checkHookActive(result.fullCommand) : false;
      const sourceCode = result.fullCommand ? readHookSource(result.fullCommand) : undefined;
      return { ...result, active, sourceCode, queryTimeMs };
    },
  );

  app.get<{ Params: { name: string }; Querystring: QueryParams }>(
    '/skills/:name',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const skillName = decodeURIComponent(req.params.name);
      const { result, queryTimeMs } = timed(() => aggregateSkillDetail((req as ObsRequest).telemetryEntries, skillName));
      // Read skill/command source from ~/.claude/commands/<name>.md
      const commandPath = resolve(homedir(), '.claude/commands', `${skillName}.md`);
      const sourceContent = existsSync(commandPath)
        ? (() => { try { return readFileSync(commandPath, 'utf-8'); } catch { return undefined; } })()
        : undefined;
      return { ...result, sourceContent, queryTimeMs };
    },
  );

  app.get<{ Querystring: QueryParams }>(
    '/memory/usage',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const obsReq = req as ObsRequest;
      const { result, queryTimeMs } = timed(() => aggregateMemoryUsage(obsReq.telemetryEntries, obsReq.granularity));
      return { ...result, queryTimeMs };
    },
  );

  app.get<{ Querystring: { type?: string; tag?: string; q?: string; limit?: string } }>(
    '/memory/items',
    async (req) => {
      const dbPath = resolve(homedir(), '.local/share/mcp-memory/sqlite_vec.db');
      if (!existsSync(dbPath)) {
        return { items: [] };
      }

      const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 500);
      const conditions: string[] = [];
      const params: (string | number)[] = [];

      if (req.query.type) {
        conditions.push('memory_type = ?');
        params.push(req.query.type);
      }
      if (req.query.tag) {
        conditions.push("tags LIKE '%' || ? || '%'");
        params.push(req.query.tag);
      }
      if (req.query.q) {
        conditions.push("content LIKE '%' || ? || '%'");
        params.push(req.query.q);
      }

      const where = conditions.length > 0 ? ' WHERE ' + conditions.join(' AND ') : '';
      const sql = `SELECT id, content, memory_type, tags, created_at, updated_at FROM memories${where} ORDER BY created_at DESC LIMIT ?`;
      params.push(limit);

      let db: Database | null = null;
      try {
        db = new Database(dbPath, { readonly: true });
        const rows = db.query(sql).all(...params) as Array<Record<string, unknown>>;
        const items = rows.map((row) => ({
          ...row,
          created_at: typeof row.created_at === 'number'
            ? new Date(row.created_at * 1000).toISOString()
            : row.created_at,
          updated_at: typeof row.updated_at === 'number'
            ? new Date(row.updated_at * 1000).toISOString()
            : row.updated_at,
        }));
        return { items };
      } catch {
        return { items: [] };
      } finally {
        db?.close();
      }
    },
  );

  app.get<{ Querystring: QueryParams }>('/compaction', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateCompaction(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/api-duration', { preHandler: parseDaysPreHandler }, async (req) => {
    const obsReq = req as ObsRequest;
    const { result, queryTimeMs } = timed(() => aggregateApiDuration(obsReq.telemetryEntries, obsReq.granularity));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams & { type?: string; search?: string; limit?: string; offset?: string } }>(
    '/events',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const limit = Math.min(Math.max(parseInt(req.query.limit || '100', 10) || 100, 1), 500);
      const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);
      const filters: { entryType?: string; search?: string } = {};
      if (req.query.type) filters.entryType = req.query.type;
      if (req.query.search) filters.search = req.query.search;
      const { result, queryTimeMs } = timed(() =>
        getRecentEvents((req as ObsRequest).telemetryEntries, limit, offset, filters),
      );
      return { ...result, queryTimeMs };
    },
  );

  app.get('/memory', async () => {
    const rows = app.sqlite
      .query('SELECT taken_at, total, by_type, health, by_tag FROM obs_memory_snapshots ORDER BY taken_at DESC LIMIT 100')
      .all() as Array<{ taken_at: string; total: number; by_type: string; health: string; by_tag: string }>;

    return {
      snapshots: rows.map((r) => ({
        takenAt: r.taken_at,
        total: r.total,
        byType: JSON.parse(r.by_type),
        health: JSON.parse(r.health),
        byTag: JSON.parse(r.by_tag),
      })),
    };
  });

  app.get('/db-stats', async () => {
    const { statSync } = await import('fs');
    const constructDbPath = resolve(homedir(), '.claude', 'construct', 'data', 'construct.db');
    const memoryDbPath = resolve(homedir(), '.local/share/mcp-memory/sqlite_vec.db');

    type DbInfo = {
      name: string;
      path: string;
      sizeBytes: number;
      walSizeBytes: number;
      tables: Array<{ name: string; rows: number }>;
    };

    function getDbInfo(name: string, dbPath: string): DbInfo | null {
      if (!existsSync(dbPath)) return null;
      const stat = statSync(dbPath);
      const walPath = dbPath + '-wal';
      const walSize = existsSync(walPath) ? statSync(walPath).size : 0;
      let db: Database | null = null;
      try {
        db = new Database(dbPath, { readonly: true });
        const tableNames = db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
        const tables = tableNames.map((t) => {
          const countRow = db!.query(`SELECT count(*) as c FROM "${t.name}"`).get() as { c: number };
          return { name: t.name, rows: countRow.c };
        });
        return { name, path: dbPath, sizeBytes: stat.size, walSizeBytes: walSize, tables };
      } catch {
        return { name, path: dbPath, sizeBytes: stat.size, walSizeBytes: walSize, tables: [] };
      } finally {
        db?.close();
      }
    }

    const databases = [
      getDbInfo('construct', constructDbPath),
      getDbInfo('memory', memoryDbPath),
    ].filter(Boolean);

    return { databases };
  });

  app.post('/memory/snapshot', async () => {
    const { execFileSync } = await import('child_process');
    try {
      const scriptPath = resolve(import.meta.dirname, '../../../../memory/obs-snapshot.ts');
      execFileSync('bun', [scriptPath], {
        timeout: 5000,
        stdio: 'pipe',
      });
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', message: String(err) };
    }
  });
};
