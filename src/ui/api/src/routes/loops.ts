/**
 * Loops API — v1 loop engine HTTP surface (Phase 1).
 *
 * Endpoints:
 *   POST /api/loops/start              — create a loop, kick off the engine
 *   GET  /api/loops/:id                — full loop state (loop + cycles + artifacts + milestones)
 *   GET  /api/loops/:id/stream         — SSE of live loop / cycle / cycle_step / milestone events
 *   GET  /api/loops/:id/events.ndjson  — the persisted event log on disk
 *
 * The engine currently runs in-process via setImmediate. Phase 1 step 4
 * replaces this with a child-process supervisor so a kill mid-run resumes
 * via the cycle ledger.
 */
import type { FastifyPluginAsync } from 'fastify';
import { createReadStream, existsSync } from 'fs';
import {
  createLoop, getLoop, generateDocument, listLoops, listMilestones, readState,
  onResearchEvent,
  listTemplateIds,
  OpenRouterProvider,
  type Envelope,
} from '@construct/research';
import { readSessionLog, sessionLogPath } from '../research-logger.js';
import { spawnLoopChild } from '../loop-supervisor.js';

interface StartBody {
  template_id: string;
  prompt?: string;
  envelope?: Envelope;
  // Test/dev knobs forwarded to the child as CLI args. Not persisted.
  processor_delay_ms?: number;
  cycles_target?: number;
  poll_every?: number;
}

export const loopRoutes: FastifyPluginAsync = async (app) => {
  /**
   * List loops, newest-first. Backs `/research/history`'s unified table —
   * the page merges this list with `/api/research/queries` so a user sees
   * every research run regardless of which engine produced it. Phase 7
   * removes the legacy queries endpoint and this becomes the sole source.
   */
  app.get<{ Querystring: { limit?: string } }>('/', async (req) => {
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 1000) : 200;
    const rows = listLoops(app.sqlite, { limit });
    return rows;
  });

  /**
   * Aggregate stats backing the LandingPage KPI strip + History range strip.
   * Maps cleanly onto loops: total runs, active runs, total cost from
   * envelope_consumed.cost_usd, total findings = COUNT(cycle_output artifacts),
   * grouped by day. Honors `?range=7d|30d|90d|all` for the window.
   *
   * Replaces the legacy `/api/research/stats` which read from research_queries
   * et al; the legacy pass/flag/halt verdict aggregates are dropped (no
   * equivalent in the new system yet).
   */
  app.get<{ Querystring: { range?: string } }>('/stats', async (req) => {
    const range = req.query.range ?? '30d';
    const days = range === '7d' ? 7 : range === '90d' ? 90 : range === 'all' ? 0 : 30;
    const sinceClause = days > 0 ? `WHERE created_at >= datetime('now', '-${days} days')` : '';

    const rows = app.sqlite.prepare(
      `SELECT status, envelope_consumed, date(created_at) AS day FROM loops ${sinceClause}`
    ).all() as Array<{ status: string; envelope_consumed: string; day: string }>;

    let totalSessions = 0;
    let activeSessions = 0;
    let totalCost = 0;
    const byDayMap = new Map<string, { sessions: number; findings: number; cost: number }>();

    for (const row of rows) {
      totalSessions += 1;
      if (row.status === 'running' || row.status === 'pending') activeSessions += 1;
      const consumed = (() => {
        try { return JSON.parse(row.envelope_consumed) as { cost_usd?: number }; }
        catch { return { cost_usd: 0 }; }
      })();
      const cost = consumed.cost_usd ?? 0;
      totalCost += cost;
      const day = row.day;
      const bucket = byDayMap.get(day) ?? { sessions: 0, findings: 0, cost: 0 };
      bucket.sessions += 1;
      bucket.cost += cost;
      byDayMap.set(day, bucket);
    }

    // Findings: cycle_output artifacts in the same window. One per cycle.
    const findingsRows = app.sqlite.prepare(
      `SELECT date(a.created_at) AS day, COUNT(*) AS n
       FROM artifacts a JOIN loops l ON l.id = a.loop_id
       WHERE a.kind = 'cycle_output' ${days > 0 ? `AND l.created_at >= datetime('now', '-${days} days')` : ''}
       GROUP BY day`
    ).all() as Array<{ day: string; n: number }>;

    let totalFindings = 0;
    for (const f of findingsRows) {
      totalFindings += f.n;
      const bucket = byDayMap.get(f.day) ?? { sessions: 0, findings: 0, cost: 0 };
      bucket.findings = f.n;
      byDayMap.set(f.day, bucket);
    }

    const byDay = [...byDayMap.entries()]
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      totalSessions,
      activeSessions,
      totalFindings,
      totalThreads: 0,
      totalCost,
      avgConfidence: 0,
      avgNovelty: 0,
      passRate: 0,
      flagRate: 0,
      haltRate: 0,
      byDay,
      byVerdict: [],
    };
  });

  app.post<{ Body: StartBody }>('/start', async (req, reply) => {
    const { template_id, prompt, envelope, processor_delay_ms, cycles_target, poll_every } = req.body ?? {};
    if (!template_id || typeof template_id !== 'string') {
      return reply.status(400).send({ error: 'template_id required' });
    }
    if (!listTemplateIds().includes(template_id)) {
      return reply.status(400).send({ error: `unknown template_id: ${template_id}` });
    }

    const loop = createLoop(app.sqlite, { template_id, prompt, envelope });
    spawnLoopChild(app.sqlite, loop.id, { processor_delay_ms, cycles_target, poll_every });
    return reply.status(201).send({ id: loop.id });
  });

  /**
   * Manually re-fire the document polish. The engine auto-fires this once on
   * natural completion (run.ts); the regenerate endpoint exists so the user
   * can re-polish after a milestone re-plan adds branches, or just to retry
   * with a different model later. The new document is appended as another
   * `kind: 'document'` artifact — `readLatestDocument` always returns the
   * freshest so the UI seamlessly picks it up.
   */
  app.post<{ Params: { id: string } }>('/:id/regenerate-document', async (req, reply) => {
    const loop = getLoop(app.sqlite, req.params.id);
    if (!loop) return reply.status(404).send({ error: 'loop not found' });
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) return reply.status(500).send({ error: 'OPENROUTER_API_KEY not set' });
    const llm = new OpenRouterProvider({ apiKey, models: [] });
    try {
      const doc = await generateDocument(app.sqlite, loop.id, loop.prompt, llm);
      if (!doc) return reply.status(409).send({ error: 'no render artifact to polish yet' });
      return reply.status(201).send({ id: doc.id, kind: doc.kind, created_at: doc.created_at });
    } catch (err) {
      return reply.status(502).send({ error: `polish failed: ${(err as Error).message}` });
    }
  });

  app.get<{ Params: { id: string } }>('/:id', async (req, reply) => {
    const state = (() => {
      try { return readState(app.sqlite, req.params.id); } catch { return null; }
    })();
    if (!state) return reply.status(404).send({ error: 'loop not found' });
    return {
      loop: state.loop,
      cycles: state.cycles,
      artifacts: state.artifacts,
      milestones: listMilestones(app.sqlite, req.params.id),
      envelope_consumed: state.envelope_consumed,
    };
  });

  app.get<{ Params: { id: string } }>('/:id/stream', async (req, reply) => {
    const loopId = req.params.id;
    if (!getLoop(app.sqlite, loopId)) {
      return reply.status(404).send({ error: 'loop not found' });
    }

    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    reply.raw.flushHeaders();

    let closed = false;
    const send = (type: string, payload: unknown, logged_at: string) => {
      if (!closed) reply.raw.write(`data: ${JSON.stringify({ type, payload, logged_at })}\n\n`);
    };

    // Backfill the entire engine history from the persisted NDJSON log. This
    // is lossless: every emitResearchEvent call writes through research-logger
    // before reaching SSE subscribers, so the file always contains the full
    // sequence (loop / cycle / cycle_step / milestone / artifact) with
    // accurate engine-emit timestamps. Previously the backfill fabricated
    // snapshot frames (loop + cycles + artifacts) from the DB on connect,
    // which dropped cycle_step events entirely and stamped every frame with
    // page-load time.
    try {
      for (const entry of readSessionLog(loopId)) {
        send(entry.type, entry.payload, entry.logged_at);
      }
    } catch { /* non-fatal */ }

    const unsubscribe = onResearchEvent((event) => {
      if (event.session_id !== loopId) return;
      send(event.type, event.payload, event.logged_at);
    });

    const heartbeat = setInterval(() => {
      if (!closed) reply.raw.write(': heartbeat\n\n');
    }, 15_000);

    await new Promise<void>(resolve => req.raw.on('close', resolve));
    closed = true;
    unsubscribe();
    clearInterval(heartbeat);
    if (!reply.raw.writableEnded) reply.raw.end();
  });

  app.get<{ Params: { id: string } }>('/:id/events.ndjson', async (req, reply) => {
    const loopId = req.params.id;
    if (!getLoop(app.sqlite, loopId)) {
      return reply.status(404).send({ error: 'loop not found' });
    }
    const path = sessionLogPath(loopId);
    if (!existsSync(path)) {
      return reply.type('application/x-ndjson').send('');
    }
    return reply.type('application/x-ndjson').send(createReadStream(path));
  });
};
