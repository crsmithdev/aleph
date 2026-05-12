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
  createLoop, getLoop, listArtifacts, listCycles, listMilestones, readState,
  runLoop, makeNoopTemplate, onResearchEvent,
  type Envelope, type Template,
} from '@construct/research';
import { sessionLogPath } from '../research-logger.js';

// Template registry. Phase 2 lands `research` and `monitor` templates here.
function makeTemplate(template_id: string, _prompt: string): Template | null {
  if (template_id === 'noop') return makeNoopTemplate({ cycles_target: 5 });
  return null;
}

interface StartBody {
  template_id: string;
  prompt?: string;
  envelope?: Envelope;
}

export const loopRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: StartBody }>('/start', async (req, reply) => {
    const { template_id, prompt, envelope } = req.body ?? {};
    if (!template_id || typeof template_id !== 'string') {
      return reply.status(400).send({ error: 'template_id required' });
    }
    const template = makeTemplate(template_id, prompt ?? '');
    if (!template) {
      return reply.status(400).send({ error: `unknown template_id: ${template_id}` });
    }
    const loop = createLoop(app.sqlite, { template_id, prompt, envelope });

    // Fire-and-forget. The supervisor (step 4) will replace this with a
    // real child process so the loop survives the API restarting.
    setImmediate(() => {
      void runLoop(app.sqlite, template, loop.id).catch(err => {
        app.log?.error({ err, loop_id: loop.id }, 'runLoop failed');
      });
    });

    return reply.status(201).send({ id: loop.id });
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
    const send = (type: string, payload: unknown) => {
      if (!closed) reply.raw.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
    };

    // Initial snapshot so the client doesn't need a separate GET on connect.
    try {
      const loop = getLoop(app.sqlite, loopId);
      if (loop) send('loop', loop);
      for (const c of listCycles(app.sqlite, loopId)) send('cycle', c);
      for (const a of listArtifacts(app.sqlite, loopId)) send('artifact', a);
    } catch { /* non-fatal */ }

    const unsubscribe = onResearchEvent((event) => {
      if (event.session_id !== loopId) return;
      send(event.type, event.payload);
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
