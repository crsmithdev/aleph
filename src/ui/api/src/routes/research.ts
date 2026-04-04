import type { FastifyPluginAsync } from 'fastify';
import {
  listSessions, getSession, createSession, updateSession, getSessionCost, getResearchStats,
  listThreads, getThread, updateThread, createThread,
  listFindings, getFinding, updateFinding,
  getLatestPlan, addPlanModification,
  getStepCosts, listSteps,
  applyResearchDDL,
  DEFAULT_SESSION_CONFIG,
  // Job imports
  createJob, getJob, getActiveJobForSession, cancelJob, listJobsForSession, cancelAllJobs,
  deleteSession,
  // Monitor imports
  createMonitor, getMonitor, listMonitors, updateMonitor,
  listSnapshots, listAlerts, updateAlert,
  MonitorEngine,
} from '@construct/research';

export const researchRoutes: FastifyPluginAsync = async (app) => {
  // Ensure research tables exist
  applyResearchDDL(app.sqlite);

  // === Reset (dev only — clears all research data) ===
  app.delete('/reset', async () => {
    const tables = [
      'research_monitor_alerts', 'research_monitor_snapshots', 'research_proposed_monitors',
      'research_monitors', 'research_plan_modifications', 'research_plans',
      'research_steps', 'research_findings', 'research_threads', 'research_jobs', 'research_sessions',
    ];
    for (const table of tables) {
      app.sqlite.exec(`DELETE FROM ${table}`);
    }
    return { status: 'cleared' };
  });

  // === Stats (aggregate across all sessions) ===
  app.get<{ Querystring: { range?: string; granularity?: string } }>(
    '/stats',
    async (req) => {
      const range = req.query.range || '30d';
      const granularity = req.query.granularity || 'day';
      return getResearchStats(app.sqlite, range, granularity);
    }
  );

  // === Sessions ===
  app.get('/sessions', async (req) => {
    const { status } = req.query as { status?: string };
    return listSessions(app.sqlite, status);
  });

  app.get<{ Params: { id: string } }>('/sessions/:id', async (req, reply) => {
    const session = getSession(app.sqlite, req.params.id);
    if (!session) return reply.status(404).send({ error: 'Session not found' });
    return session;
  });

  app.post<{ Body: { title?: string; seed_query: string; config?: Record<string, unknown> } }>(
    '/sessions',
    async (req, reply) => {
      const { seed_query, title, config } = req.body;
      if (!seed_query) return reply.status(400).send({ error: 'seed_query is required' });
      const session = createSession(
        app.sqlite,
        title ?? seed_query,
        seed_query,
        config as Partial<typeof DEFAULT_SESSION_CONFIG>
      );
      // Create seed thread
      createThread(app.sqlite, {
        session_id: session.id,
        query: seed_query,
        origin: 'seed',
        priority: 1.0,
        depth: 0,
        max_depth: session.config.max_thread_depth,
        status: 'queued',
      });
      return reply.status(201).send(session);
    }
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/sessions/:id',
    async (req, reply) => {
      const result = updateSession(app.sqlite, req.params.id, req.body);
      if (!result) return reply.status(404).send({ error: 'Session not found' });
      return result;
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/sessions/:id',
    async (req, reply) => {
      const deleted = deleteSession(app.sqlite, req.params.id);
      if (!deleted) return reply.status(404).send({ error: 'Session not found' });
      return { status: 'deleted' };
    }
  );

  // === Threads ===
  app.get<{ Params: { id: string }; Querystring: { status?: string } }>(
    '/sessions/:id/threads',
    async (req) => listThreads(app.sqlite, req.params.id, req.query.status as any)
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/threads/:id',
    async (req, reply) => {
      const result = updateThread(app.sqlite, req.params.id, req.body);
      if (!result) return reply.status(404).send({ error: 'Thread not found' });
      return result;
    }
  );

  app.post<{ Params: { id: string }; Body: { query: string; priority?: number; max_depth?: number } }>(
    '/sessions/:id/threads',
    async (req, reply) => {
      const { query, priority, max_depth } = req.body;
      if (!query) return reply.status(400).send({ error: 'query is required' });
      const thread = createThread(app.sqlite, {
        session_id: req.params.id,
        query,
        origin: 'user_injected',
        priority: priority ?? 0.8,
        max_depth,
      });
      return reply.status(201).send(thread);
    }
  );

  // === Findings ===
  app.get<{ Params: { id: string }; Querystring: { thread_id?: string; limit?: string; sort?: string } }>(
    '/sessions/:id/findings',
    async (req) => {
      const { thread_id, limit, sort } = req.query;
      return listFindings(app.sqlite, req.params.id, {
        threadId: thread_id,
        limit: limit ? parseInt(limit) : undefined,
        sort: sort as 'created_at' | 'novelty' | 'confidence' | undefined,
      });
    }
  );

  app.get<{ Params: { id: string } }>('/findings/:id', async (req, reply) => {
    const finding = getFinding(app.sqlite, req.params.id);
    if (!finding) return reply.status(404).send({ error: 'Finding not found' });
    return finding;
  });

  app.patch<{ Params: { id: string }; Body: { user_rating?: string } }>(
    '/findings/:id',
    async (req, reply) => {
      const result = updateFinding(app.sqlite, req.params.id, req.body as any);
      if (!result) return reply.status(404).send({ error: 'Finding not found' });
      return result;
    }
  );

  // === Steps ===
  app.get<{ Params: { id: string }; Querystring: { thread_id?: string; limit?: string } }>(
    '/sessions/:id/steps',
    async (req) => {
      const { thread_id, limit } = req.query;
      return listSteps(app.sqlite, req.params.id, {
        threadId: thread_id,
        limit: limit ? parseInt(limit) : undefined,
      });
    }
  );

  // === Plan ===
  app.get<{ Params: { id: string } }>(
    '/sessions/:id/plan',
    async (req, reply) => {
      const plan = getLatestPlan(app.sqlite, req.params.id);
      if (!plan) return reply.status(404).send({ error: 'No plan found' });
      return plan;
    }
  );

  app.post<{ Params: { id: string }; Body: { action: string; target_item_rank?: number; target_thread_id?: string; payload?: string } }>(
    '/sessions/:id/plan/modify',
    async (req, reply) => {
      const plan = getLatestPlan(app.sqlite, req.params.id);
      if (!plan) return reply.status(404).send({ error: 'No plan found' });
      const mod = addPlanModification(app.sqlite, {
        plan_id: plan.id,
        action: req.body.action as any,
        target_item_rank: req.body.target_item_rank,
        target_thread_id: req.body.target_thread_id,
        payload: req.body.payload,
        source: 'ui',
      });
      return reply.status(201).send(mod);
    }
  );

  // === Costs ===
  app.get<{ Params: { id: string } }>(
    '/sessions/:id/costs',
    async (req) => {
      const sessionCost = getSessionCost(app.sqlite, req.params.id);
      const stepCosts = getStepCosts(app.sqlite, req.params.id);
      return { ...sessionCost, ...stepCosts };
    }
  );

  // === Jobs & Run ===
  app.post<{ Params: { id: string }; Body: { iterations?: number; mode?: string } }>(
    '/sessions/:id/run',
    async (req, reply) => {
      const sessionId = req.params.id;
      const session = getSession(app.sqlite, sessionId);
      if (!session) return reply.status(404).send({ error: 'Session not found' });

      const existing = getActiveJobForSession(app.sqlite, sessionId);
      if (existing) {
        return reply.status(409).send({ error: 'Session already has an active job', job_id: existing.id });
      }

      const mode = (req.body.mode ?? 'burst') as 'burst' | 'background' | 'scheduled';
      const job = createJob(app.sqlite, {
        session_id: sessionId,
        mode,
        max_iterations: mode === 'burst' ? (req.body.iterations ?? 5) : undefined,
      });

      return reply.status(201).send({ status: 'queued', job_id: job.id, session_id: sessionId });
    }
  );

  app.get<{ Params: { id: string } }>(
    '/sessions/:id/running',
    async (req) => {
      const job = getActiveJobForSession(app.sqlite, req.params.id);
      return {
        running: !!job && (job.status === 'running' || job.status === 'claimed'),
        job: job ? {
          id: job.id,
          status: job.status,
          mode: job.mode,
          iterations_completed: job.iterations_completed,
          max_iterations: job.max_iterations,
          heartbeat_at: job.heartbeat_at,
        } : null,
      };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/sessions/:id/jobs',
    async (req) => listJobsForSession(app.sqlite, req.params.id)
  );

  app.get<{ Params: { id: string } }>(
    '/jobs/:id',
    async (req, reply) => {
      const job = getJob(app.sqlite, req.params.id);
      if (!job) return reply.status(404).send({ error: 'Job not found' });
      return job;
    }
  );

  app.post<{ Params: { id: string } }>(
    '/jobs/:id/cancel',
    async (req, reply) => {
      const cancelled = cancelJob(app.sqlite, req.params.id);
      if (!cancelled) return reply.status(404).send({ error: 'Job not found or already finished' });
      return { status: 'cancelled' };
    }
  );

  app.get<{ Params: { id: string } }>(
    '/sessions/:id/activity',
    async (req) => {
      const sessionId = req.params.id;
      const job = getActiveJobForSession(app.sqlite, sessionId);
      const running = !!job && (job.status === 'running' || job.status === 'claimed');
      const recentSteps = listSteps(app.sqlite, sessionId, { limit: 5 });
      const allThreads = listThreads(app.sqlite, sessionId);
      const activeThread = allThreads.find(t => t.status === 'active');
      const queuedCount = allThreads.filter(t => t.status === 'queued').length;
      const exhaustedCount = allThreads.filter(t => t.status === 'exhausted').length;

      return {
        running,
        job: job ? { id: job.id, status: job.status, iterations_completed: job.iterations_completed, max_iterations: job.max_iterations } : null,
        active_thread: activeThread ? { id: activeThread.id, query: activeThread.query } : null,
        queued_threads: queuedCount,
        exhausted_threads: exhaustedCount,
        recent_steps: recentSteps.map(s => ({
          model: s.model,
          cost_usd: s.cost_usd,
          duration_ms: s.duration_ms,
          error: s.error,
          tool_calls: s.tool_calls,
          created_at: s.created_at,
        })),
      };
    }
  );

  // === Env check ===
  app.get('/env-check', async () => {
    const anthropic = !!process.env.ANTHROPIC_API_KEY;
    const openrouter = !!process.env.OPENROUTER_API_KEY;
    const jinaKey = process.env.JINA_API_KEY;
    const jina = !!jinaKey;
    const tavily = !!process.env.TAVILY_API_KEY;
    const brave = !!process.env.BRAVE_SEARCH_API_KEY;
    const searchProvider = tavily ? 'tavily' : brave ? 'brave' : 'duckduckgo';
    const warnings: string[] = [];
    const errors: string[] = [];
    if (!anthropic && !openrouter && !process.env.OLLAMA_MODEL) {
      warnings.push('No LLM provider configured — set ANTHROPIC_API_KEY, OPENROUTER_API_KEY, or OLLAMA_MODEL');
    }
    if (!jina) errors.push('JINA_API_KEY not set — "Fetch source page text" will throw');
    if (!tavily && !brave) warnings.push('No search API key set — using DuckDuckGo (rate-limited, lower quality)');

    let jina_balance: number | null = null;
    if (jinaKey) {
      try {
        const res = await fetch('https://r.jina.ai', {
          headers: { 'Authorization': `Bearer ${jinaKey}` },
          signal: AbortSignal.timeout(5000),
        });
        const text = await res.text();
        const m = text.match(/\[Balance left\]\s+([\d,]+)/);
        if (m) jina_balance = parseInt(m[1].replace(/,/g, ''), 10);
      } catch { /* network error — leave null */ }
    }

    return { anthropic, openrouter, jina, jina_balance, tavily, brave, searchProvider, warnings, errors };
  });

  // === Worker supervisor ===
  app.get('/workers', async () => app.supervisor.status());

  // === Global run/stop ===
  app.post('/run-all', async () => {
    const allSessions = listSessions(app.sqlite, 'active');
    const created: string[] = [];
    for (const session of allSessions) {
      const existing = getActiveJobForSession(app.sqlite, session.id);
      if (!existing) {
        const job = createJob(app.sqlite, { session_id: session.id, mode: 'background' });
        created.push(job.id);
      }
    }
    return { status: 'started', jobs_created: created.length, job_ids: created };
  });

  app.post('/stop-all', async () => {
    const cancelled = cancelAllJobs(app.sqlite);
    return { status: 'stopped', jobs_cancelled: cancelled };
  });

  // === SSE Stream ===
  app.get<{ Params: { id: string } }>(
    '/sessions/:id/stream',
    async (req, reply) => {
      const sessionId = req.params.id;

      reply.hijack();
      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      reply.raw.flushHeaders();

      let closed = false;
      req.raw.on('close', () => { closed = true; });

      const send = (type: string, payload: unknown) => {
        if (!closed) reply.raw.write(`data: ${JSON.stringify({ type, payload })}\n\n`);
      };

      const sentFindings = new Set<string>();
      const sentThreadState = new Map<string, string>();
      const sentSteps = new Set<string>();
      const sentJobs = new Map<string, string>();

      const poll = () => {
        if (closed) return;
        try {
          const findings = listFindings(app.sqlite, sessionId);
          for (const f of findings) {
            if (!sentFindings.has(f.id)) {
              sentFindings.add(f.id);
              send('finding', f);
            }
          }

          const threads = listThreads(app.sqlite, sessionId);
          for (const t of threads) {
            const state = `${t.status}:${t.updated_at}`;
            if (sentThreadState.get(t.id) !== state) {
              sentThreadState.set(t.id, state);
              send('thread', t);
            }
          }

          const steps = listSteps(app.sqlite, sessionId, { limit: 200 });
          for (const s of steps) {
            if (!sentSteps.has(s.id)) {
              sentSteps.add(s.id);
              send('step', s);
            }
          }

          const jobs = listJobsForSession(app.sqlite, sessionId);
          for (const j of jobs) {
            const state = `${j.status}:${j.updated_at}`;
            if (sentJobs.get(j.id) !== state) {
              sentJobs.set(j.id, state);
              send('job', j);
            }
          }
        } catch {
          // ignore SQLite errors during polling
        }
      };

      const pollInterval = setInterval(poll, 500);
      const heartbeatInterval = setInterval(() => {
        if (!closed) reply.raw.write(': heartbeat\n\n');
      }, 15_000);

      await new Promise<void>(resolve => req.raw.on('close', resolve));
      clearInterval(pollInterval);
      clearInterval(heartbeatInterval);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  );

  // === Monitors ===
  app.get('/monitors', async (req) => {
    const { status } = req.query as { status?: string };
    return listMonitors(app.sqlite, status);
  });

  app.get<{ Params: { id: string } }>('/monitors/:id', async (req, reply) => {
    const monitor = getMonitor(app.sqlite, req.params.id);
    if (!monitor) return reply.status(404).send({ error: 'Monitor not found' });
    return monitor;
  });

  app.post<{ Body: { title: string; queries: string[]; session_id?: string; schedule?: string; match_criteria?: Record<string, unknown> } }>(
    '/monitors',
    async (req, reply) => {
      const { title, queries, session_id, schedule, match_criteria } = req.body;
      if (!queries?.length) return reply.status(400).send({ error: 'queries required' });
      const monitor = createMonitor(app.sqlite, {
        title: title ?? queries[0],
        queries,
        session_id,
        schedule,
        match_criteria: match_criteria as any,
      });
      return reply.status(201).send(monitor);
    }
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/monitors/:id',
    async (req, reply) => {
      const result = updateMonitor(app.sqlite, req.params.id, req.body as any);
      if (!result) return reply.status(404).send({ error: 'Monitor not found' });
      return result;
    }
  );

  app.get<{ Params: { id: string } }>(
    '/monitors/:id/snapshots',
    async (req) => listSnapshots(app.sqlite, req.params.id)
  );

  app.get<{ Params: { id: string }; Querystring: { severity?: string; status?: string } }>(
    '/monitors/:id/alerts',
    async (req) => listAlerts(app.sqlite, req.params.id, req.query)
  );

  app.patch<{ Params: { id: string }; Body: { status?: string } }>(
    '/alerts/:id',
    async (req, reply) => {
      const result = updateAlert(app.sqlite, req.params.id, req.body as any);
      if (!result) return reply.status(404).send({ error: 'Alert not found' });
      return result;
    }
  );

  app.post<{ Params: { id: string }; Body: { api_key?: string } }>(
    '/monitors/:id/run',
    async (req, reply) => {
      const monitor = getMonitor(app.sqlite, req.params.id);
      if (!monitor) return reply.status(404).send({ error: 'Monitor not found' });

      const apiKey = req.body.api_key || process.env.ANTHROPIC_API_KEY;
      if (!apiKey) return reply.status(400).send({ error: 'API key required' });

      const { AnthropicProvider } = await import('@construct/research');
      const engine = new MonitorEngine({
        sqlite: app.sqlite,
        provider: new AnthropicProvider(apiKey),
      });

      const result = await engine.runCycle(monitor.id);
      return result;
    }
  );
};
