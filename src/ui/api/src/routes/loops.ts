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
  createLoop, getLoop, generateDocument, listLoopsWithStats, listMilestones, readState,
  updateLoopStatus, updateLoopChildPid,
  onResearchEvent,
  listTemplateIds,
  OpenRouterProvider,
  applyModeEnvelope, isMode,
  createDraftSchedule, updateScheduleArtifact,
  type Envelope, type SchedulePayload,
} from '@aleph/research';
import { readSessionLog, sessionLogPath } from '../research-logger.js';
import { spawnLoopChild, killLoopChild } from '../loop-supervisor.js';

interface StartBody {
  template_id: string;
  prompt?: string;
  envelope?: Envelope;
  /** Mode preset (quick / default / deep / roam / bonkers / dev / eval /
   *  custom). Seeds the envelope (request fields win over preset) and is
   *  recorded as `created_with_mode` on the schedule artifact. Unknown
   *  values are coerced to `default`. */
  mode?: string;
  // Test/dev knobs forwarded to the child as CLI args. Not persisted.
  processor_delay_ms?: number;
  cycles_target?: number;
  poll_every?: number;
}

function validatePositiveInt(val: unknown, name: string, min: number, max: number): number {
  if (val === undefined || val === null) throw new Error(`${name} is required`);
  const n = Number(val);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min || n > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}, got ${val}`);
  }
  return n;
}

export const loopRoutes: FastifyPluginAsync = async (app) => {
  /**
   * List loops, newest-first. Sole source for the `/research/history` table.
   * Rows carry a `stats` object (cost, cycles, sources, last_step_at,
   * latest_post_mortem) joined from artifacts so the UI adapter can populate
   * the verdict / cost / findings columns without N+1 follow-up requests.
   */
  app.get<{ Querystring: { limit?: string } }>('/', async (req) => {
    const raw = Number(req.query.limit);
    const limit = Number.isFinite(raw) && raw > 0 ? Math.min(Math.floor(raw), 1000) : 200;
    const rows = listLoopsWithStats(app.sqlite, { limit });
    return rows;
  });

  /**
   * Aggregate stats backing the LandingPage KPI strip + History range strip.
   * Maps cleanly onto loops: total runs, active runs, total cost from
   * envelope_consumed.cost_usd, total findings = COUNT(cycle_output artifacts),
   * grouped by day. Honors `?range=7d|30d|90d|all` for the window.
   *
   * `passRate / flagRate / haltRate` ship as zero — no loop-side equivalent
   * of the old pass/flag/halt verdict yet; the History summary strip renders
   * them as dashes.
   */
  app.get<{ Querystring: { range?: string } }>('/stats', async (req) => {
    const range = req.query.range ?? '30d';
    const days = range === '7d' ? 7 : range === '90d' ? 90 : range === 'all' ? 0 : 30;

    const rows = (days > 0
      ? app.sqlite.prepare(
          `SELECT status, envelope_consumed, date(created_at) AS day FROM loops WHERE created_at >= datetime('now', ? || ' days')`
        ).all(`-${days}`)
      : app.sqlite.prepare(
          `SELECT status, envelope_consumed, date(created_at) AS day FROM loops`
        ).all()
    ) as Array<{ status: string; envelope_consumed: string; day: string }>;

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
    const findingsRows = (days > 0
      ? app.sqlite.prepare(
          `SELECT date(a.created_at) AS day, COUNT(*) AS n
           FROM artifacts a JOIN loops l ON l.id = a.loop_id
           WHERE a.kind = 'cycle_output' AND l.created_at >= datetime('now', ? || ' days')
           GROUP BY day`
        ).all(`-${days}`)
      : app.sqlite.prepare(
          `SELECT date(a.created_at) AS day, COUNT(*) AS n
           FROM artifacts a JOIN loops l ON l.id = a.loop_id
           WHERE a.kind = 'cycle_output'
           GROUP BY day`
        ).all()
    ) as Array<{ day: string; n: number }>;

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
    const { template_id, prompt, envelope, mode, processor_delay_ms, cycles_target, poll_every } = req.body ?? {};
    if (!template_id || typeof template_id !== 'string') {
      return reply.status(400).send({ error: 'template_id required' });
    }
    if (!listTemplateIds().includes(template_id)) {
      return reply.status(400).send({ error: `unknown template_id: ${template_id}` });
    }

    // Validate mode and merge its envelope preset under the request's envelope.
    // Unknown mode → coerce to default (rather than 400) so client typos don't
    // block a query; the canonical Mode list lives on the engine.
    const resolvedMode = mode && isMode(mode) ? mode : (mode ? 'default' : undefined);
    const mergedEnvelope = applyModeEnvelope(resolvedMode, envelope);

    const loop = createLoop(app.sqlite, {
      template_id, prompt,
      envelope: mergedEnvelope,
      mode: resolvedMode ?? null,
    });

    // Phase 5b — Custom mode: defer child spawn so the user can edit the
    // schedule before the loop runs. Write a draft schedule artifact (no LLM
    // calls) so the Plan tab has something to render and edit; ensureScheduleArtifact
    // is idempotent so the child process will use the (possibly edited) draft
    // verbatim once `/start` fires.
    if (resolvedMode === 'custom' && template_id !== 'noop') {
      createDraftSchedule(app.sqlite, loop.id, prompt ?? '', resolvedMode);
      return reply.status(201).send({ id: loop.id, deferred: true });
    }

    let validatedDelay = processor_delay_ms;
    let validatedCycles = cycles_target;
    let validatedPoll = poll_every;
    try {
      if (processor_delay_ms !== undefined) validatedDelay = validatePositiveInt(processor_delay_ms, 'processor_delay_ms', 100, 60000);
      if (cycles_target !== undefined) validatedCycles = validatePositiveInt(cycles_target, 'cycles_target', 1, 1000);
      if (poll_every !== undefined) validatedPoll = validatePositiveInt(poll_every, 'poll_every', 1, 300);
    } catch (e) {
      return reply.status(400).send({ error: (e as Error).message });
    }

    spawnLoopChild(app.sqlite, loop.id, { processor_delay_ms: validatedDelay, cycles_target: validatedCycles, poll_every: validatedPoll });
    return reply.status(201).send({ id: loop.id });
  });

  /**
   * Manually spawn the supervised child for a deferred loop (Custom mode).
   * Idempotent in spirit — refuses if the loop is already past `pending`.
   */
  app.post<{ Params: { id: string } }>('/:id/start', async (req, reply) => {
    const loop = getLoop(app.sqlite, req.params.id);
    if (!loop) return reply.status(404).send({ error: 'loop not found' });
    if (loop.status !== 'pending') {
      return reply.status(409).send({ error: `loop is not pending: ${loop.status}` });
    }
    spawnLoopChild(app.sqlite, loop.id, {});
    return reply.status(202).send({ id: loop.id });
  });

  /**
   * Update the latest schedule artifact. Only allowed pre-Start (status =
   * `pending`); once cycles have dispatched the loop is locked. v2 will
   * re-open this for paused loops once cooperative cancellation lands.
   * Body is a `Partial<SchedulePayload>`; fields not present are carried
   * forward from the prior payload.
   */
  app.patch<{ Params: { id: string }; Body: Partial<SchedulePayload> }>('/:id/schedule', async (req, reply) => {
    const loop = getLoop(app.sqlite, req.params.id);
    if (!loop) return reply.status(404).send({ error: 'loop not found' });
    if (loop.status !== 'pending') {
      return reply.status(409).send({ error: `loop not editable: ${loop.status}` });
    }
    const next = updateScheduleArtifact(app.sqlite, loop.id, req.body ?? {});
    if (!next) return reply.status(404).send({ error: 'no schedule artifact to update' });
    return reply.status(200).send(next);
  });

  /**
   * Manually re-fire the document polish. The engine auto-fires this once on
   * natural completion (run.ts); the regenerate endpoint exists so the user
   * can re-polish after a milestone re-plan adds branches, or just to retry
   * with a different model later. The new document is appended as another
   * `kind: 'document'` artifact — `readLatestDocument` always returns the
   * freshest so the UI seamlessly picks it up.
   */
  /**
   * Cancel a running loop. Sends SIGTERM to the supervisor child (which
   * marks the loop 'cancelled' on graceful exit) or falls back to flipping
   * the row to 'cancelled' directly if no child is registered (e.g. an
   * orphaned 'running' status from a stale supervisor crash).
   *
   * Backs the Workers page Kill button.
   */
  app.post<{ Params: { id: string } }>('/:id/cancel', async (req, reply) => {
    const loop = getLoop(app.sqlite, req.params.id);
    if (!loop) return reply.status(404).send({ error: 'loop not found' });
    if (loop.status === 'completed' || loop.status === 'cancelled' || loop.status === 'failed') {
      return reply.status(409).send({ error: `loop is already terminal: ${loop.status}` });
    }
    const killed = killLoopChild(loop.id, 'SIGTERM');
    if (!killed) {
      // No active child — orphaned status. Flip the row directly.
      updateLoopStatus(app.sqlite, loop.id, 'cancelled');
      updateLoopChildPid(app.sqlite, loop.id, null);
    }
    return reply.status(202).send({ id: loop.id, killed_child: killed });
  });

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
