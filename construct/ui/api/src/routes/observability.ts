import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { resolve } from 'path';
import { homedir } from 'os';
import { existsSync } from 'fs';
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
  aggregateMemoryUsage,
} from '@construct/telemetry';

type DaysQuerystring = { days?: string };
type ObsRequest = FastifyRequest<{ Querystring: DaysQuerystring }> & {
  telemetryEntries: ReturnType<typeof parseSessionsForDays>;
};

function parseDaysPreHandler(
  req: FastifyRequest<{ Querystring: DaysQuerystring }>,
  reply: { code: (n: number) => { send: (body: unknown) => void } },
  done: () => void,
) {
  const raw = req.query.days || '30';
  const days = parseInt(raw, 10);
  if (Number.isNaN(days) || days < 1 || days > 365) {
    reply.code(400).send({ error: 'days must be an integer between 1 and 365' });
    return;
  }
  (req as ObsRequest).telemetryEntries = parseSessionsForDays(days);
  done();
}

export const observabilityRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: DaysQuerystring }>('/overview', { preHandler: parseDaysPreHandler }, async (req) => {
    return aggregateOverview((req as ObsRequest).telemetryEntries);
  });

  app.get<{ Querystring: DaysQuerystring }>('/tools', { preHandler: parseDaysPreHandler }, async (req) => {
    return aggregateTools((req as ObsRequest).telemetryEntries);
  });

  app.get<{ Querystring: DaysQuerystring }>('/hooks', { preHandler: parseDaysPreHandler }, async (req) => {
    return aggregateHooks((req as ObsRequest).telemetryEntries);
  });

  app.get<{ Querystring: DaysQuerystring }>('/skills', { preHandler: parseDaysPreHandler }, async (req) => {
    return aggregateSkills((req as ObsRequest).telemetryEntries);
  });

  app.get<{ Querystring: DaysQuerystring }>('/tokens', { preHandler: parseDaysPreHandler }, async (req) => {
    return aggregateTokens((req as ObsRequest).telemetryEntries);
  });

  app.get<{ Querystring: DaysQuerystring }>('/cost', { preHandler: parseDaysPreHandler }, async (req) => {
    return aggregateCost((req as ObsRequest).telemetryEntries);
  });

  app.get<{ Querystring: DaysQuerystring }>('/sessions', { preHandler: parseDaysPreHandler }, async (req) => {
    return aggregateSessions((req as ObsRequest).telemetryEntries);
  });

  app.get<{ Params: { name: string }; Querystring: DaysQuerystring }>(
    '/tools/:name',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const toolName = decodeURIComponent(req.params.name);
      return aggregateToolDetail((req as ObsRequest).telemetryEntries, toolName);
    },
  );

  app.get<{ Params: { name: string }; Querystring: DaysQuerystring }>(
    '/hooks/:name',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const hookName = decodeURIComponent(req.params.name);
      return aggregateHookDetail((req as ObsRequest).telemetryEntries, hookName);
    },
  );

  app.get<{ Querystring: DaysQuerystring }>(
    '/memory/usage',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      return aggregateMemoryUsage((req as ObsRequest).telemetryEntries);
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
        const items = db.query(sql).all(...params);
        return { items };
      } catch {
        return { items: [] };
      } finally {
        db?.close();
      }
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

  app.post('/memory/snapshot', async () => {
    const { execSync } = await import('child_process');
    try {
      const scriptPath = resolve(import.meta.dirname, '../../../../memory/obs-snapshot.ts');
      execSync('bun ' + scriptPath, {
        timeout: 5000,
        stdio: 'pipe',
      });
      return { status: 'ok' };
    } catch (err) {
      return { status: 'error', message: String(err) };
    }
  });
};
