import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { resolve } from 'path';
import { homedir } from 'os';
import { existsSync, readdirSync } from 'fs';
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
} from '@construct/telemetry';
import type { Granularity, SessionEntry } from '@construct/telemetry';

type QueryParams = { days?: string; granularity?: string; session?: string };
type ObsRequest = FastifyRequest<{ Querystring: QueryParams }> & {
  telemetryEntries: SessionEntry[];
  granularity: Granularity;
};

function parseGranularity(raw?: string): Granularity {
  if (raw === 'minute' || raw === 'hour' || raw === 'day') return raw;
  return 'day';
}

function parseDaysPreHandler(
  req: FastifyRequest<{ Querystring: QueryParams }>,
  reply: { code: (n: number) => { send: (body: unknown) => void } },
  done: () => void,
) {
  const raw = req.query.days || '30';
  const days = parseInt(raw, 10);
  if (Number.isNaN(days) || days < 1 || days > 365) {
    reply.code(400).send({ error: 'days must be an integer between 1 and 365' });
    return;
  }
  let entries = parseSessionsForDays(days);

  // Filter by session if provided
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

function checkHookActive(fullCommand: string): boolean {
  // Hook commands look like: bun /path/to/file.ts
  const parts = fullCommand.split(/\s+/);
  for (const part of parts) {
    if (part.startsWith('/') && (part.endsWith('.ts') || part.endsWith('.js') || part.endsWith('.sh'))) {
      return existsSync(part);
    }
  }
  return false;
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
    const { result, queryTimeMs } = timed(() => aggregateOverview((req as ObsRequest).telemetryEntries));
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
    const skillsDir = resolve(homedir(), '.claude/construct/skills');
    const validSkills = new Set(
      existsSync(skillsDir)
        ? readdirSync(skillsDir, { withFileTypes: true })
            .filter(d => d.isDirectory() && existsSync(resolve(skillsDir, d.name, 'SKILL.md')))
            .map(d => d.name)
        : []
    );
    const { result, queryTimeMs } = timed(() => aggregateSkills(obsReq.telemetryEntries, obsReq.granularity, validSkills.size > 0 ? validSkills : undefined));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/tokens', { preHandler: parseDaysPreHandler }, async (req) => {
    const { result, queryTimeMs } = timed(() => aggregateTokens((req as ObsRequest).telemetryEntries));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/cost', { preHandler: parseDaysPreHandler }, async (req) => {
    const { result, queryTimeMs } = timed(() => aggregateCost((req as ObsRequest).telemetryEntries));
    return { ...result, queryTimeMs };
  });

  app.get<{ Querystring: QueryParams }>('/sessions', { preHandler: parseDaysPreHandler }, async (req) => {
    const { result, queryTimeMs } = timed(() => aggregateSessions((req as ObsRequest).telemetryEntries));
    return { ...result, queryTimeMs };
  });

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
      return { ...result, active, queryTimeMs };
    },
  );

  app.get<{ Params: { name: string }; Querystring: QueryParams }>(
    '/skills/:name',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const skillName = decodeURIComponent(req.params.name);
      const { result, queryTimeMs } = timed(() => aggregateSkillDetail((req as ObsRequest).telemetryEntries, skillName));
      return { ...result, queryTimeMs };
    },
  );

  app.get<{ Querystring: QueryParams }>(
    '/memory/usage',
    { preHandler: parseDaysPreHandler },
    async (req) => {
      const { result, queryTimeMs } = timed(() => aggregateMemoryUsage((req as ObsRequest).telemetryEntries));
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
