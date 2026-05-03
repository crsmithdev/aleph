import type { FastifyPluginAsync } from 'fastify';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { readSessionLog, sessionLogPath } from '../research-logger.js';
import { resolve, dirname } from 'path';
import {
  listQueries, listQueriesWithStats, getQuery, getQueryWithStats, createQuery, updateQuery, getQueryCost, getResearchStats, getResearchSummary,
  listThreads, getThread, updateThread, createThread,
  listFindings, getFinding, updateFinding, updateFindingSourceTexts, clearThreadFindings,
  getLatestPlan, addPlanModification,
  getStepCosts, listSteps,
  applyResearchDDL,
  DEFAULT_SESSION_CONFIG,
  getDefaults, updateDefaults, resetDefaults,
  listConcepts, listConceptLinks, getConcept, listFindingsForConcept, getSourcesForConcept,
  listSources, getSource, countSourcesByStatus, retrySource, skipSource,
  fetchPageText, JS_RENDERED_FLAG,
  // Job imports
  createJob, getJob, getActiveJobForSession, cancelJob, listJobsForSession, cancelAllJobs, listAllJobs, listActiveJobs, jobStats,
  type JobStatus, type ThreadStatus,
  type SessionConfig,
  deleteQuery,
  OpenRouterProvider,
  ResearchEngine,
  // Monitor imports
  createMonitor, getMonitor, listMonitors, updateMonitor,
  listSnapshots, listAlerts, updateAlert,
  MonitorEngine,
  // Metrics imports
  computeJobMetrics, computeSourceHealth, computeThreadStateMetrics,
  computeJobTrace, computeSessionCostTrajectory, computeErrorStatus,
  type PromptHints,
  registerBuiltinHooks,
  hasHooks,
  // Agent-hook records
  listIterationChecks, listPostMortems, runPostMortem,
  pickAgentRole,
  detectQuestionShape,
  detectTopicCluster,
  enumerateCanon,
  getStrategyStats,
  TrackedLLM,
  suggestRunPlan,
  QUESTION_SHAPES,
  TOPIC_CLUSTERS,
  type TopicCluster,
  onResearchEvent,
} from '@construct/research';
import type { QuestionShape } from '@construct/research';

function sanitizeQuery(q: string): string {
  let t = q.trim().replace(/\s+/g, ' ');
  // Remove outer quotes (straight and curly)
  t = t.replace(/^[\u201C\u201D\u2018\u2019"']+|[\u201C\u201D\u2018\u2019"']+$/g, '').trim();
  // Replace underscores with spaces
  t = t.replace(/_/g, ' ');
  if (!t) return t;
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function summarizeQuery(query: string): string {
  const t = query.trim();
  // Take text before a colon if it's a reasonable length (e.g. "Topic: details...")
  const colon = t.indexOf(':');
  if (colon > 10 && colon < 80) return t.slice(0, colon).trim();
  // Take first sentence/clause
  const sentEnd = t.search(/[?!.]\s/);
  if (sentEnd > 10 && sentEnd < 80) return t.slice(0, sentEnd).trim();
  // Fall back to first 8 words
  const words = t.split(/\s+/);
  return words.length > 8 ? words.slice(0, 8).join(' ') : t;
}

function heuristicPromptShort(query: string): string {
  const t = query.trim();
  // First sentence ending with punctuation
  const sentEnd = t.search(/[?!.]/);
  if (sentEnd > 10 && sentEnd < 150) return t.slice(0, sentEnd + 1).trim();
  // Fall back to first 120 chars
  return t.length <= 120 ? t : t.slice(0, 120) + '…';
}

function heuristicPromptSuperShort(query: string): string {
  return summarizeQuery(query);
}

function placeholderShortQuery(query: string): string {
  const t = query.trim();
  const MAX = 80;
  if (t.length <= MAX) return t;
  return t.slice(0, MAX) + '…';
}

// Helpers for the small one-shot LLM calls fired at session creation. They go
// through TrackedLLM so each call records a research_steps row + emits a step
// SSE event automatically — no separate "log it too" step at the call site.

async function generatePromptShort(llm: TrackedLLM, sessionId: string, model: string, query: string): Promise<string | null> {
  try {
    const result = await llm.complete(
      { session_id: sessionId, thread_id: null, label: 'restate prompt' },
      model,
      `Restate this research question as a single clear sentence. Return ONLY the sentence, no quotes:\n\n${query}`,
      60,
    );
    const out = result.text.trim().replace(/^["']|["']$/g, '');
    if (out && out.length <= 200) return out;
  } catch { /* fall through */ }
  return null;
}

async function generateShortQuery(llm: TrackedLLM, sessionId: string, model: string, query: string): Promise<string | null> {
  try {
    const result = await llm.complete(
      { session_id: sessionId, thread_id: null, label: 'short title' },
      model,
      `Give a short conceptual section title (1-5 words) for this research topic. Like a Wikipedia section heading — a noun phrase, not a question. No quotes, no punctuation. Return ONLY the title:\n\n${query}`,
      20,
    );
    const out = result.text.trim().replace(/^["']|["']$/g, '');
    if (out && out.length <= 60) return out;
  } catch { /* fall through */ }
  return null;
}

async function generateQueryTitle(llm: TrackedLLM, sessionId: string, model: string, prompt: string): Promise<string> {
  const heuristic = summarizeQuery(prompt);
  try {
    const result = await llm.complete(
      { session_id: sessionId, thread_id: null, label: 'query title' },
      model,
      `Give a short title (5-8 words) for this research query. Return ONLY the title, no quotes, no punctuation at end:\n\n${prompt}`,
      30,
    );
    const title = result.text.trim();
    if (title) return title;
  } catch { /* fall through to heuristic */ }
  return heuristic;
}

export const researchRoutes: FastifyPluginAsync = async (app) => {
  // Ensure research tables exist
  applyResearchDDL(app.sqlite);

  // Register agent hooks (iteration_check, post_mortem).
  // Idempotent — no-op if already registered or if no API key is present.
  registerBuiltinHooks();

  // === Reset (dev only — clears all research data) ===
  app.delete('/reset', async () => {
    const tables = [
      'research_monitor_alerts', 'research_monitor_snapshots', 'research_proposed_monitors',
      'research_monitors', 'research_plan_modifications', 'research_plans',
      'research_steps', 'research_findings', 'research_threads', 'research_jobs', 'research_queries',
    ];
    // Disable FK enforcement during wipe: some tables may have stale FK references
    // to renamed tables (e.g. research_monitors still references research_sessions).
    app.sqlite.exec('PRAGMA foreign_keys = OFF');
    try {
      for (const table of tables) {
        app.sqlite.exec(`DELETE FROM ${table}`);
      }
    } finally {
      app.sqlite.exec('PRAGMA foreign_keys = ON');
    }
    return { status: 'cleared' };
  });

  // === Stats (aggregate across all queries) ===
  app.get<{ Querystring: { range?: string; granularity?: string } }>(
    '/stats',
    async (req) => {
      const range = req.query.range || '30d';
      const granularity = req.query.granularity || 'day';
      return getResearchStats(app.sqlite, range, granularity);
    }
  );

  app.get('/summary', async () => getResearchSummary(app.sqlite));

  // Run-plan suggester: deterministic (shape × topic) → RunPlan lookup, no LLM.
  // API choice (a): standalone GET so the landing-page compose box can preview
  // suggested defaults before submit, without first creating a query.
  app.get<{ Querystring: { shape?: string; topic?: string } }>(
    '/suggest-plan',
    async (req) => {
      const rawShape = req.query.shape;
      const rawTopic = req.query.topic;
      const shape = rawShape && (QUESTION_SHAPES as readonly string[]).includes(rawShape)
        ? (rawShape as QuestionShape) : null;
      const topic = rawTopic && (TOPIC_CLUSTERS as readonly string[]).includes(rawTopic)
        ? (rawTopic as TopicCluster) : null;
      return suggestRunPlan(shape, topic);
    }
  );

  // === Queries ===
  app.get('/queries', async (req) => {
    const { status } = req.query as { status?: string };
    return listQueriesWithStats(app.sqlite, status);
  });

  app.get<{ Params: { id: string } }>('/queries/:id', async (req, reply) => {
    const query = getQueryWithStats(app.sqlite, req.params.id);
    if (!query) return reply.status(404).send({ error: 'Query not found' });
    return query;
  });

  // Live mode preset — tight caps so a 5–10 min run produces a coherent
  // best-effort report. Promotion (POST /queries/:id/promote) lifts these.
  const LIVE_PRESET: Partial<SessionConfig> = {
    max_total_threads: 8,
    max_thread_depth: 1,
    follow_up: { min_count: 2, max_count: 3, max_retries: 1, similarity_threshold: 0.75 },
    gap_analysis: { enabled: false, max_gap_searches: 0, mode: 'periodic', every_n_findings: 999 },
    role_priming_enabled: true,
    schedule: {
      mode: 'default',
      active_windows: [],
      timezone: 'America/Los_Angeles',
      max_session_duration_minutes: 7,
    },
    on_duration_expiry: 'pause',
  };

  app.post<{ Body: { title?: string; prompt: string; hints?: PromptHints; mode?: 'live' | 'deep'; config?: Record<string, unknown> } }>(
    '/queries',
    async (req, reply) => {
      const { prompt: rawPrompt, hints, title, config, mode } = req.body;
      const prompt = sanitizeQuery(rawPrompt ?? '');
      if (!prompt) return reply.status(400).send({ error: 'prompt is required' });
      const prompt_short = heuristicPromptShort(prompt);
      const prompt_super_short = heuristicPromptSuperShort(prompt);

      // Merge live preset under any caller-provided config.
      const callerConfig = (config ?? {}) as Partial<SessionConfig>;
      const baseConfig: Partial<SessionConfig> = mode === 'live'
        ? {
            ...LIVE_PRESET,
            ...callerConfig,
            schedule: { ...LIVE_PRESET.schedule!, ...(callerConfig.schedule ?? {}) },
            follow_up: { ...LIVE_PRESET.follow_up!, ...(callerConfig.follow_up ?? {}) },
            gap_analysis: { ...LIVE_PRESET.gap_analysis!, ...(callerConfig.gap_analysis ?? {}) },
          }
        : callerConfig;

      const query = createQuery(
        app.sqlite,
        title ?? summarizeQuery(prompt),
        prompt,
        baseConfig,
        prompt_short,
        prompt_super_short,
        hints ?? {},
      );

      // Create seed thread
      const seedThread = createThread(app.sqlite, {
        session_id: query.id,
        query: prompt,
        short_query: placeholderShortQuery(prompt),
        origin: 'seed',
        priority: 1.0,
        depth: 0,
        max_depth: query.config.max_thread_depth,
        status: query.config.max_thread_depth > 0 ? 'queued' : 'deferred',
      });
      // Build a tracked LLM ONCE for the session-creation fan-out. Every
      // .complete() through it auto-records a research_steps row + emits a
      // step SSE event, so the title/role/short-query calls show up in the
      // events log without per-call wiring.
      const openrouterKey = process.env.OPENROUTER_API_KEY;
      const utilityModel = query.config.model_fast ?? query.config.model;
      const llm = openrouterKey
        ? new TrackedLLM(
            new OpenRouterProvider({ apiKey: openrouterKey, models: [utilityModel] }),
            app.sqlite,
          )
        : null;

      if (llm) {
        // Fire-and-forget: each call auto-logs as a step.
        generateShortQuery(llm, query.id, utilityModel, prompt).then(summary => {
          if (summary) updateThread(app.sqlite, seedThread.id, { short_query: summary });
        }).catch(() => { /* ignore */ });
        generateQueryTitle(llm, query.id, utilityModel, prompt).then(llmTitle => {
          if (llmTitle !== query.title) {
            updateQuery(app.sqlite, query.id, { title: llmTitle });
          }
        }).catch(() => { /* ignore */ });
        generatePromptShort(llm, query.id, utilityModel, prompt).then(short => {
          if (short) updateQuery(app.sqlite, query.id, { prompt_short: short });
        }).catch(() => { /* ignore */ });
        generateShortQuery(llm, query.id, utilityModel, prompt).then(superShort => {
          if (superShort) updateQuery(app.sqlite, query.id, { prompt_super_short: superShort });
        }).catch(() => { /* ignore */ });

        // Role priming (GPT-Researcher style): pick a domain agent role and
        // patch the config so downstream LLM calls inherit a system-prompt floor.
        if (query.config.role_priming_enabled && !query.config.role_prompt) {
          (async () => {
            try {
              const role = await pickAgentRole(llm, query.id, query.config.model, prompt);
              if (role) {
                updateQuery(app.sqlite, query.id, {
                  config: { role_label: role.label, role_prompt: role.prompt },
                });
                console.log(`[research] picked agent role for ${query.id}: ${role.label}`);
              }
            } catch (err) {
              console.warn(`[research] pickAgentRole failed for ${query.id}:`, err);
            }
          })();
        }

        // Question-shape detection: classify the prompt into one or more
        // structural shapes (survey/timeline/list/dynamics/comparison/
        // lookup/audit) so downstream planning can pick the right strategy.
        // Fire-and-forget; failure leaves question_shape NULL and the
        // planner falls back to its current generic behavior.
        //
        // After shape lands, if the prompt is survey/list/timeline-shaped
        // with confidence ≥ 0.5, enumerate canonical artifacts/people/events
        // and spawn one canon-slot thread per item so the engine's depth-first
        // crawl is forced to cover the canon before converging. This addresses
        // the dogfooded EDM failure mode (planner went deep on chart mechanics,
        // missed Moby's Play / Underworld / Daft Punk).
        // Topic-cluster classification: coarse subject-matter label
        // (AI / LLM tooling | Music history | Databases | Audio & DSP |
        // Personal infra | Misc) for downstream UI grouping. Fire-and-forget;
        // failure leaves topic_cluster NULL.
        if (!query.topic_cluster) {
          (async () => {
            try {
              const cluster = await detectTopicCluster(llm, query.id, utilityModel, prompt);
              if (cluster) {
                updateQuery(app.sqlite, query.id, { topic_cluster: cluster });
                console.log(`[research] detected topic cluster for ${query.id}: ${cluster.cluster} (${cluster.confidence.toFixed(2)})`);
              }
            } catch (err) {
              console.warn(`[research] detectTopicCluster failed for ${query.id}:`, err);
            }
          })();
        }

        if (!query.question_shape) {
          (async () => {
            try {
              const shape = await detectQuestionShape(llm, query.id, utilityModel, prompt);
              if (shape) {
                updateQuery(app.sqlite, query.id, { question_shape: shape });
                console.log(`[research] detected shape for ${query.id}: ${shape.shapes.join('+')} (${shape.confidence.toFixed(2)})`);

                const CANON_SHAPES = new Set(['survey', 'list', 'timeline']);
                const triggers = shape.shapes.filter(s => CANON_SHAPES.has(s));
                if (triggers.length > 0 && shape.confidence >= 0.5) {
                  try {
                    const lensCriterion = shape.lenses
                      .filter(l => CANON_SHAPES.has(l.shape))
                      .map(l => `${l.shape}: ${l.criterion}`)
                      .join(' | ');
                    const shapeHint = `${triggers.join('+')} (${lensCriterion || 'no specific criterion'})`;
                    const items = await enumerateCanon(llm, query.id, utilityModel, prompt, shapeHint);
                    if (items && items.length > 0) {
                      // Spawn one canon-slot thread per item. Each is a sibling
                      // of the seed (depth 1, parent = seed) so the worker pool
                      // can pick them up in parallel. Priority is 0.85 — below
                      // seed (1.0) so the seed's lead thread runs first, but
                      // above default follow-ups so canon coverage isn't
                      // starved.
                      for (const it of items) {
                        const slotQuery = `${it.item} — ${it.context}`;
                        createThread(app.sqlite, {
                          session_id: query.id,
                          query: slotQuery,
                          short_query: placeholderShortQuery(it.item),
                          origin: 'canon_slot',
                          parent_thread_id: seedThread.id,
                          priority: 0.85,
                          depth: 1,
                          max_depth: query.config.max_thread_depth,
                          status: query.config.max_thread_depth > 1 ? 'queued' : 'deferred',
                        });
                      }
                      console.log(`[research] enumerated ${items.length} canon items for ${query.id}`);
                    }
                  } catch (err) {
                    console.warn(`[research] enumerateCanon failed for ${query.id}:`, err);
                  }
                }
              }
            } catch (err) {
              console.warn(`[research] detectQuestionShape failed for ${query.id}:`, err);
            }
          })();
        }
      }

      // Auto-create a burst job so workers pick it up immediately
      createJob(app.sqlite, { session_id: query.id, mode: 'priority', max_iterations: 1 });
      return reply.status(201).send(query);
    }
  );

  // Promote a paused/live session to long-lived: clears the wall-clock cap,
  // widens limits back toward defaults, and flips status to 'active' so
  // workers resume on the next poll. Idempotent.
  app.post<{ Params: { id: string } }>(
    '/queries/:id/promote',
    async (req, reply) => {
      const query = getQuery(app.sqlite, req.params.id);
      if (!query) return reply.status(404).send({ error: 'Query not found' });

      const updated = updateQuery(app.sqlite, req.params.id, {
        status: 'active',
        config: {
          max_total_threads: Math.max(query.config.max_total_threads, DEFAULT_SESSION_CONFIG.max_total_threads),
          max_thread_depth: Math.max(query.config.max_thread_depth, DEFAULT_SESSION_CONFIG.max_thread_depth),
          gap_analysis: { ...query.config.gap_analysis, enabled: true, max_gap_searches: 2 },
          schedule: { ...query.config.schedule, max_session_duration_minutes: null },
          on_duration_expiry: 'pause',
        },
      });
      // Ensure a job exists so workers actually pick it up.
      const active = getActiveJobForSession(app.sqlite, req.params.id);
      if (!active) {
        createJob(app.sqlite, { session_id: req.params.id, mode: 'default' });
      }
      return updated;
    }
  );

  app.patch<{ Params: { id: string }; Body: Record<string, unknown> }>(
    '/queries/:id',
    async (req, reply) => {
      const result = updateQuery(app.sqlite, req.params.id, req.body);
      if (!result) return reply.status(404).send({ error: 'Query not found' });
      return result;
    }
  );

  app.delete<{ Params: { id: string } }>(
    '/queries/:id',
    async (req, reply) => {
      const deleted = deleteQuery(app.sqlite, req.params.id);
      if (!deleted) return reply.status(404).send({ error: 'Query not found' });
      return { status: 'deleted' };
    }
  );

  // === Export: document (.md) ===
  app.get<{ Params: { id: string } }>(
    '/queries/:id/export/document',
    async (req, reply) => {
      const { id } = req.params;
      const query = getQuery(app.sqlite, id);
      if (!query) return reply.status(404).send({ error: 'Query not found' });

      const slug = (query.title ?? query.prompt).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);
      const filename = `${slug}-${id.slice(0, 8)}`;

      // Use pre-generated document if available
      const doc = query.document as string | undefined;
      if (doc) {
        reply.header('Content-Type', 'text/markdown; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="${filename}.md"`);
        return reply.send(doc);
      }

      // Fall back: minimal document from findings
      const findings = listFindings(app.sqlite, id).filter(f => f.confidence >= 0.5);
      const lines: string[] = [];
      lines.push(`# ${query.title}`);
      lines.push('');
      lines.push(`*${query.prompt}*`);
      lines.push('');
      if (findings.length === 0) {
        lines.push('*No findings yet.*');
      } else {
        for (const f of findings) {
          lines.push(`## Finding`);
          lines.push('');
          if (f.summary) { lines.push(`**${f.summary}**`); lines.push(''); }
          lines.push(f.content);
          lines.push('');
          if (f.source_urls?.length) lines.push(`*Sources: ${f.source_urls.join(', ')}*`);
          lines.push('');
        }
      }
      reply.header('Content-Type', 'text/markdown; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filename}.md"`);
      return reply.send(lines.join('\n'));
    }
  );

  // === Export: thread activity log — session or single thread ===
  // Formats:
  //   default (no ?format)          → enhanced Markdown with IDs, ms timestamps,
  //                                    step metadata, jobs, sources, config,
  //                                    thread status history
  //   ?format=ndjson                → raw NDJSON log file (finding/step/thread
  //                                    events from research-logger) — the same
  //                                    stream the backend tails, ideal for grep/jq
  app.get<{ Params: { id: string }; Querystring: { thread_id?: string; format?: string } }>(
    '/queries/:id/export/log',
    async (req, reply) => {
      const { id } = req.params;
      const { thread_id, format } = req.query;

      const query = getQuery(app.sqlite, id);
      if (!query) return reply.status(404).send({ error: 'Query not found' });

      const slug = (query.title ?? query.prompt).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);
      const suffix = thread_id ? `-thread-${thread_id.slice(0, 8)}` : '';
      const filename = `${slug}-log${suffix}-${id.slice(0, 8)}`;

      // --- NDJSON format: stream the raw session log file ---
      if (format === 'ndjson') {
        const path = sessionLogPath(id);
        if (!existsSync(path)) return reply.status(404).send({ error: 'No log file for this session' });
        const raw = readFileSync(path, 'utf-8');
        // If the caller wants a single thread, filter down
        let body = raw;
        if (thread_id) {
          body = raw.split('\n').filter(line => {
            if (!line) return false;
            try {
              const e = JSON.parse(line);
              const p = e.payload as Record<string, unknown> | undefined;
              if (!p) return false;
              if (e.type === 'thread') return p.id === thread_id;
              return p.thread_id === thread_id;
            } catch { return false; }
          }).join('\n') + '\n';
        }
        reply.header('Content-Type', 'application/x-ndjson; charset=utf-8');
        reply.header('Content-Disposition', `attachment; filename="${filename}.ndjson"`);
        return reply.send(body);
      }

      // --- Markdown format ---
      const allThreads = listThreads(app.sqlite, id);
      const threads = thread_id ? allThreads.filter(t => t.id === thread_id) : allThreads;

      if (thread_id && threads.length === 0) return reply.status(404).send({ error: 'Thread not found' });

      const findings = listFindings(app.sqlite, id);
      const steps = listSteps(app.sqlite, id);
      const jobs = listJobsForSession(app.sqlite, id);
      const sources = listSources(app.sqlite, id);

      // Thread status history is reconstructed from the NDJSON log. The logger
      // only samples every 3s so intermediate transitions may be missed — the
      // markdown notes this so readers don't mistake gaps for correctness.
      const logEvents = readSessionLog(id);
      const threadHistory = new Map<string, Array<{ logged_at: string; status: string; updated_at: string }>>();
      for (const ev of logEvents) {
        if (ev.type !== 'thread') continue;
        const p = ev.payload as { id: string; status: string; updated_at: string };
        if (!threadHistory.has(p.id)) threadHistory.set(p.id, []);
        threadHistory.get(p.id)!.push({ logged_at: ev.logged_at, status: p.status, updated_at: p.updated_at });
      }

      const findingsByThread = new Map<string, typeof findings>();
      for (const f of findings) {
        if (!findingsByThread.has(f.thread_id)) findingsByThread.set(f.thread_id, []);
        findingsByThread.get(f.thread_id)!.push(f);
      }
      const stepsByThread = new Map<string, typeof steps>();
      for (const s of steps) {
        if (s.thread_id === null) continue; // session-scope steps don't belong to any thread
        if (!stepsByThread.has(s.thread_id)) stepsByThread.set(s.thread_id, []);
        stepsByThread.get(s.thread_id)!.push(s);
      }
      const threadById = new Map(allThreads.map(t => [t.id, t]));
      const findingById = new Map(findings.map(f => [f.id, f]));

      // Millisecond-precision clock — two events 23ms apart are the smoking gun
      // for concurrency races. The old HH:MM:SS format would collapse them.
      //
      // Accept two input shapes WITHOUT calling `new Date()` on naive strings
      // (JS treats `YYYY-MM-DD HH:MM:SS` as local and timezone-shifts on ISO
      // conversion — produced `01:37:31.000` for what the DB stored as `18:37`).
      //   ISO with zone:  "2026-04-19T18:01:09.676Z" → "18:01:09.676"
      //   SQLite naive:   "2026-04-19 18:37:31"       → "18:37:31"
      function fmtTime(iso: string): string {
        if (!iso) return iso;
        // ISO-with-T-and-Z — extract the HH:MM:SS.mmm slice directly.
        const tIdx = iso.indexOf('T');
        if (tIdx !== -1) {
          const rest = iso.slice(tIdx + 1);
          const dotMs = rest.match(/^(\d{2}:\d{2}:\d{2})(\.\d{1,3})?/);
          if (dotMs) return dotMs[1] + (dotMs[2] ?? '');
        }
        // SQLite naive datetime — "YYYY-MM-DD HH:MM:SS".
        const spaceMatch = iso.match(/^\d{4}-\d{2}-\d{2}\s+(\d{2}:\d{2}:\d{2})/);
        if (spaceMatch) return spaceMatch[1];
        return iso;
      }
      function fmtJson(v: unknown, indent = 2): string {
        try { return JSON.stringify(v, null, indent); } catch { return String(v); }
      }

      const lines: string[] = [];
      lines.push(`# Activity Log: ${query.title}${thread_id ? ` — thread ${thread_id.slice(0, 8)}` : ''}`);
      lines.push('');
      lines.push(`**Session:** \`${id}\``);
      lines.push(`**Status:** ${query.status}`);
      lines.push(`**Prompt:** ${query.prompt}`);
      lines.push(`**Generated:** ${new Date().toISOString()}`);
      lines.push('');
      lines.push(`**Counts:** ${allThreads.length} threads · ${findings.length} findings · ${steps.length} steps · ${jobs.length} jobs · ${sources.length} sources`);
      lines.push('');
      lines.push('> **Tip:** for machine-readable traces suitable for grep/jq, download `?format=ndjson` — it emits one event per line from the same stream this report was rendered from.');
      lines.push('');

      // --- Session config snapshot ---
      if (!thread_id) {
        lines.push('## Session Config');
        lines.push('');
        lines.push('```json');
        lines.push(fmtJson(query.config));
        lines.push('```');
        lines.push('');
      }

      // --- Jobs section (session-level view only; per-thread view filters below) ---
      const relevantJobs = thread_id
        ? jobs.filter(j => j.thread_id === thread_id || j.thread_id === null)
        : jobs;
      if (relevantJobs.length > 0) {
        lines.push('## Jobs');
        lines.push('');
        lines.push('| id | thread_id | mode | status | claimed_by | created | claimed | started | completed | iters | error |');
        lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
        for (const j of relevantJobs) {
          const row = [
            `\`${j.id}\``,
            j.thread_id ? `\`${j.thread_id}\`` : '*session*',
            j.mode,
            `**${j.status}**`,
            j.claimed_by ?? '—',
            fmtTime(j.created_at),
            j.claimed_at ? fmtTime(j.claimed_at) : '—',
            j.started_at ? fmtTime(j.started_at) : '—',
            j.completed_at ? fmtTime(j.completed_at) : '—',
            `${j.iterations_completed}${j.max_iterations ? `/${j.max_iterations}` : ''}`,
            j.error ? `⚠ ${j.error.slice(0, 80)}` : '',
          ];
          lines.push(`| ${row.join(' | ')} |`);
        }
        lines.push('');
      }

      // --- Sources section (extraction health) ---
      if (!thread_id && sources.length > 0) {
        const byStatus = new Map<string, number>();
        for (const s of sources) byStatus.set(s.extraction_status, (byStatus.get(s.extraction_status) ?? 0) + 1);
        lines.push('## Sources');
        lines.push('');
        const summary = [...byStatus.entries()].map(([k, v]) => `${v} ${k}`).join(' · ');
        lines.push(`**Total:** ${sources.length} · ${summary}`);
        lines.push('');
        const failed = sources.filter(s => s.extraction_status === 'failed');
        if (failed.length > 0) {
          lines.push('**Failed extractions:**');
          lines.push('');
          for (const s of failed.slice(0, 50)) {
            lines.push(`- \`${s.id}\` ${s.url} — ${s.error ?? 'no error message'} (${s.attempt_count} attempts)`);
          }
          if (failed.length > 50) lines.push(`- … and ${failed.length - 50} more`);
          lines.push('');
        }
      }

      // Sort depth-first for session log
      function buildOrder(parentId: string | null): (typeof allThreads)[0][] {
        return allThreads
          .filter(t => t.parent_thread_id === parentId)
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .flatMap(t => [t, ...buildOrder(t.id)]);
      }
      const ordered = thread_id ? threads : buildOrder(null);

      lines.push('## Threads');
      lines.push('');

      for (const t of ordered) {
        const tSteps = (stepsByThread.get(t.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
        const tFindings = findingsByThread.get(t.id) ?? [];

        lines.push(`### \`${t.id}\` — ${t.short_query ?? t.query.slice(0, 80)}`);
        lines.push('');
        lines.push(`> ${t.query}`);
        lines.push('');

        const parentThread = t.parent_thread_id ? threadById.get(t.parent_thread_id) : null;
        const spawnedFromFinding = t.spawned_from_finding_id ? findingById.get(t.spawned_from_finding_id) : null;
        const meta: string[] = [
          `depth ${t.depth}/${t.max_depth}`,
          `origin: ${t.origin}`,
          `status: **${t.status}**`,
          `priority: ${t.priority.toFixed(2)}`,
          `node_type: ${t.node_type}`,
        ];
        if (parentThread) meta.push(`parent: \`${parentThread.id}\``);
        if (spawnedFromFinding) meta.push(`spawned from finding \`${spawnedFromFinding.id}\``);
        if (t.perturbation_strategy) meta.push(`perturbation: ${t.perturbation_strategy}`);
        if (t.seed_similarity != null) meta.push(`seed_sim: ${t.seed_similarity.toFixed(3)}`);
        if (t.min_searches != null) meta.push(`min_searches: ${t.min_searches}`);
        if (t.fetch_source_text === true) meta.push(`fetch_source_text: true`);
        if (t.retry_after) meta.push(`retry_after: ${t.retry_after}`);
        meta.push(`created: ${fmtTime(t.created_at)}`);
        lines.push(meta.join(' · '));
        lines.push('');

        // Thread status history (from NDJSON log). Skip if only one state observed.
        const history = threadHistory.get(t.id) ?? [];
        if (history.length > 1) {
          lines.push('**Status history** *(sampled — intermediate transitions may be missed; logger polls every 3s)*');
          lines.push('');
          lines.push('| observed_at | status | thread_updated_at |');
          lines.push('|---|---|---|');
          for (const h of history) {
            lines.push(`| ${fmtTime(h.logged_at)} | ${h.status} | ${h.updated_at} |`);
          }
          lines.push('');
        }

        if (tSteps.length > 0) {
          lines.push('**Steps**');
          lines.push('');
          for (const s of tSteps) {
            const time = fmtTime(s.created_at);
            const tokStr = s.prompt_tokens != null ? ` · ${s.prompt_tokens}+${s.completion_tokens} tok` : '';
            const costStr = s.cost_usd > 0 ? ` · $${s.cost_usd.toFixed(4)}` : '';
            const durStr = s.duration_ms ? ` · ${s.duration_ms}ms` : '';
            const providerStr = s.provider ? ` · ${s.provider}` : '';
            lines.push(`- \`${time}\` \`${s.id}\` **${s.label ?? s.model ?? 'step'}** — ${s.model ?? ''}${providerStr}${tokStr}${costStr}${durStr}${s.error ? ` ⚠ ${s.error}` : ''}`);
            if (s.tool_calls?.length) {
              for (const tc of s.tool_calls as Array<{ tool?: string; name?: string; input?: Record<string, unknown> }>) {
                const toolName = tc.tool ?? tc.name ?? 'unknown';
                const q = tc.input?.query as string | undefined;
                const detail = q ? ` "${q}"` : '';
                lines.push(`  - \`${toolName}\`${detail}`);
              }
            }
            if (s.metadata && Object.keys(s.metadata).length > 0) {
              lines.push('  <details><summary>metadata</summary>');
              lines.push('');
              lines.push('  ```json');
              const metaJson = fmtJson(s.metadata).split('\n').map(l => '  ' + l).join('\n');
              lines.push(metaJson);
              lines.push('  ```');
              lines.push('  </details>');
            }
          }
          lines.push('');
        }

        if (tFindings.length > 0) {
          lines.push('**Findings**');
          lines.push('');
          for (const f of tFindings) {
            const conf = `conf ${(f.confidence * 100).toFixed(0)}%`;
            const novel = `novelty ${(f.novelty * 100).toFixed(0)}%`;
            const act = `act ${(f.actionability * 100).toFixed(0)}%`;
            lines.push(`#### \`${f.id}\` — ${f.summary ?? 'Finding'} [${conf}, ${novel}, ${act}]`);
            lines.push('');
            lines.push(`*created ${fmtTime(f.created_at)}*`);
            lines.push('');
            lines.push(f.content);
            lines.push('');
            if (f.source_urls?.length) {
              lines.push('**Sources:**');
              for (const u of f.source_urls) lines.push(`- ${u}`);
              lines.push('');
            }
            if (f.tags?.length) { lines.push(`*Tags: ${f.tags.join(', ')}*`); lines.push(''); }
            if (f.user_rating) { lines.push(`*User rating: ${f.user_rating}*`); lines.push(''); }
            if (f.follow_ups?.length) {
              lines.push('**Follow-up questions spawned:**');
              for (const fu of f.follow_ups as string[]) lines.push(`- ${fu}`);
              lines.push('');
            }
            if (f.follow_up_analysis) {
              lines.push('<details><summary>follow_up_analysis</summary>');
              lines.push('');
              lines.push('```json');
              lines.push(fmtJson(f.follow_up_analysis));
              lines.push('```');
              lines.push('</details>');
              lines.push('');
            }
          }
        }

        lines.push('---');
        lines.push('');
      }

      const md = lines.join('\n');
      reply.header('Content-Type', 'text/markdown; charset=utf-8');
      reply.header('Content-Disposition', `attachment; filename="${filename}.md"`);
      return reply.send(md);
    }
  );

  // Legacy export alias — kept for any existing bookmarks
  app.get<{ Params: { id: string }; Querystring: { format?: string } }>(
    '/queries/:id/export',
    async (req, reply) => {
      const dest = req.query.format === 'md'
        ? `/api/research/queries/${req.params.id}/export/document`
        : `/api/research/queries/${req.params.id}/export/log`;
      return reply.redirect(dest);
    }
  );

  // === Threads ===
  app.get<{ Params: { id: string }; Querystring: { status?: string } }>(
    '/queries/:id/threads',
    async (req) => listThreads(app.sqlite, req.params.id, req.query.status as ThreadStatus | undefined)
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
    '/queries/:id/threads',
    async (req, reply) => {
      const { query: rawQuery, priority, max_depth } = req.body;
      const query = sanitizeQuery(rawQuery ?? '');
      if (!query) return reply.status(400).send({ error: 'query is required' });
      const thread = createThread(app.sqlite, {
        session_id: req.params.id,
        query,
        short_query: placeholderShortQuery(query),
        origin: 'user_injected',
        priority: priority ?? 0.8,
        max_depth,
      });
      // Fire async LLM summarization. Goes through TrackedLLM so the call shows
      // up in the events log automatically.
      const session = getQuery(app.sqlite, req.params.id);
      const openrouterKey = process.env.OPENROUTER_API_KEY;
      if (session && openrouterKey) {
        const utilityModel = session.config.model_fast ?? session.config.model;
        const llm = new TrackedLLM(
          new OpenRouterProvider({ apiKey: openrouterKey, models: [utilityModel] }),
          app.sqlite,
        );
        generateShortQuery(llm, req.params.id, utilityModel, query).then(summary => {
          if (summary) updateThread(app.sqlite, thread.id, { short_query: summary });
        }).catch(() => { /* ignore */ });
      }
      return reply.status(201).send(thread);
    }
  );

  app.post<{ Params: { id: string; threadId: string } }>(
    '/queries/:id/threads/:threadId/fetch-text',
    async (req, reply) => {
      const { id: sessionId, threadId } = req.params;
      const thread = getThread(app.sqlite, threadId);
      if (!thread) return reply.status(404).send({ error: 'Thread not found' });

      const threadFindings = listFindings(app.sqlite, sessionId, { threadId });
      if (threadFindings.length === 0) return reply.send({ updated: 0 });

      let updated = 0;
      for (const finding of threadFindings) {
        if (finding.source_urls.length === 0) continue;
        const fetched = await Promise.all(finding.source_urls.map(url => fetchPageText(url)));
        const sourceTexts = fetched.map((full, i) => {
          if (!full || full === JS_RENDERED_FLAG) return finding.source_texts[i] ?? '';
          return full;
        });
        updateFindingSourceTexts(app.sqlite, finding.id, sourceTexts);
        updated++;
      }

      return reply.send({ updated });
    }
  );

  app.post<{ Params: { id: string; threadId: string }; Body: { fetch_source_text?: boolean } }>(
    '/queries/:id/threads/:threadId/redo',
    async (req, reply) => {
      const { threadId } = req.params;
      const thread = getThread(app.sqlite, threadId);
      if (!thread) return reply.status(404).send({ error: 'Thread not found' });
      clearThreadFindings(app.sqlite, threadId);
      const patch: Record<string, unknown> = { status: 'queued' };
      if (req.body?.fetch_source_text !== undefined) patch.fetch_source_text = req.body.fetch_source_text;
      const updated = updateThread(app.sqlite, threadId, patch);
      return reply.send(updated);
    }
  );

  app.post<{ Params: { id: string } }>(
    '/findings/:id/fetch-text',
    async (req, reply) => {
      const finding = getFinding(app.sqlite, req.params.id);
      if (!finding) return reply.status(404).send({ error: 'Finding not found' });
      if (finding.source_urls.length === 0) return reply.send({ updated: false });
      const fetched = await Promise.all(finding.source_urls.map(url => fetchPageText(url)));
      const sourceTexts = fetched.map((full, i) => {
        if (!full || full === JS_RENDERED_FLAG) return finding.source_texts[i] ?? '';
        return full;
      });
      updateFindingSourceTexts(app.sqlite, finding.id, sourceTexts);
      return reply.send({ updated: true });
    }
  );

  // === Findings ===
  app.get<{ Params: { id: string }; Querystring: { thread_id?: string; limit?: string; sort?: string; envelope?: string } }>(
    '/queries/:id/findings',
    async (req) => {
      const { thread_id, limit, sort, envelope } = req.query;
      const items = listFindings(app.sqlite, req.params.id, {
        threadId: thread_id,
        limit: limit ? parseInt(limit) : undefined,
        sort: sort as 'created_at' | 'novelty' | 'confidence' | undefined,
      });
      // Default response is the bare array (back-compat). Pass ?envelope=1 to
      // get { total, items } — useful for clients that need the count without
      // a second round-trip and for symmetry with single-resource endpoints.
      if (envelope === '1' || envelope === 'true') {
        return { total: items.length, items };
      }
      return items;
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
      const result = updateFinding(app.sqlite, req.params.id, req.body);
      if (!result) return reply.status(404).send({ error: 'Finding not found' });
      return result;
    }
  );

  // === Concepts (knowledge graph) ===
  app.get<{ Params: { id: string } }>('/queries/:id/concepts', async (req) => {
    return listConcepts(app.sqlite, req.params.id);
  });

  app.get<{ Params: { id: string } }>('/queries/:id/concept-links', async (req) => {
    return listConceptLinks(app.sqlite, req.params.id);
  });

  app.get<{ Params: { id: string; conceptId: string } }>(
    '/queries/:id/concepts/:conceptId',
    async (req, reply) => {
      const concept = getConcept(app.sqlite, req.params.conceptId);
      if (!concept || concept.session_id !== req.params.id) {
        return reply.status(404).send({ error: 'Concept not found' });
      }
      const findingIds = listFindingsForConcept(app.sqlite, concept.id);
      const sources = getSourcesForConcept(app.sqlite, concept.id);
      return { ...concept, finding_ids: findingIds, sources };
    }
  );

  // === Sources (extraction queue) ===
  app.get<{ Params: { id: string }; Querystring: { status?: string; limit?: string } }>(
    '/queries/:id/sources',
    async (req) => {
      const status = req.query.status as 'pending' | 'extracted' | 'failed' | 'skipped' | 'all' | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit) : undefined;
      const items = listSources(app.sqlite, req.params.id, { status, limit });
      const counts = countSourcesByStatus(app.sqlite, req.params.id);
      return { items, counts };
    }
  );

  app.post<{ Params: { sourceId: string } }>(
    '/sources/:sourceId/retry',
    async (req, reply) => {
      const source = getSource(app.sqlite, req.params.sourceId);
      if (!source) return reply.status(404).send({ error: 'Source not found' });
      return retrySource(app.sqlite, req.params.sourceId);
    }
  );

  app.post<{ Params: { sourceId: string } }>(
    '/sources/:sourceId/skip',
    async (req, reply) => {
      const source = getSource(app.sqlite, req.params.sourceId);
      if (!source) return reply.status(404).send({ error: 'Source not found' });
      return skipSource(app.sqlite, req.params.sourceId);
    }
  );

  // === Steps ===
  app.get<{ Params: { id: string }; Querystring: { thread_id?: string; limit?: string } }>(
    '/queries/:id/steps',
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
    '/queries/:id/plan',
    async (req, reply) => {
      const query = getQuery(app.sqlite, req.params.id);
      if (!query) return reply.status(404).send({ error: 'Query not found' });
      const plan = getLatestPlan(app.sqlite, req.params.id);
      if (!plan) return reply.status(200).send({ plan: null, status: 'pending' });
      return { plan, status: 'ready' };
    }
  );

  app.post<{ Params: { id: string }; Body: { action: string; target_item_rank?: number; target_thread_id?: string; payload?: string } }>(
    '/queries/:id/plan/modify',
    async (req, reply) => {
      const plan = getLatestPlan(app.sqlite, req.params.id);
      if (!plan) return reply.status(409).send({ error: 'Plan not yet generated; cannot modify', status: 'pending' });
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

  // === Document generation ===
  app.post<{ Params: { id: string } }>(
    '/queries/:id/generate-document',
    async (req, reply) => {
      const queryId = req.params.id;
      const query = getQuery(app.sqlite, queryId);
      if (!query) return reply.status(404).send({ error: 'Query not found' });

      const allQueryFindings = listFindings(app.sqlite, queryId);
      if (allQueryFindings.length < 1) {
        return reply.status(400).send({ error: 'No findings to generate an article from' });
      }

      const openrouterKey = process.env.OPENROUTER_API_KEY;
      if (!openrouterKey) return reply.status(400).send({ error: 'OpenRouter API key required' });

      const cfg = query.config as any;
      const primaryModel: string = cfg?.model || 'deepseek/deepseek-chat';
      const poolModels: string[] = cfg?.providers?.openrouter_models ?? [];
      const allModels = poolModels.includes(primaryModel)
        ? poolModels
        : [primaryModel, ...poolModels];

      const provider = new OpenRouterProvider({ apiKey: openrouterKey, models: allModels });
      const engine = new ResearchEngine({ sqlite: app.sqlite, provider });

      try {
        await engine.updateDocument(queryId);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({ error: `document generation failed: ${msg}` });
      }

      const updated = getQuery(app.sqlite, queryId);
      return reply.send({ document: updated?.document ?? '' });
    }
  );

  // === Costs ===
  app.get<{ Params: { id: string } }>(
    '/queries/:id/costs',
    async (req) => {
      const queryCost = getQueryCost(app.sqlite, req.params.id);
      const stepCosts = getStepCosts(app.sqlite, req.params.id);
      return { ...queryCost, ...stepCosts };
    }
  );

  // === Jobs & Run ===
  app.post<{ Params: { id: string }; Body: { iterations?: number; mode?: string } }>(
    '/queries/:id/run',
    async (req, reply) => {
      const queryId = req.params.id;
      const query = getQuery(app.sqlite, queryId);
      if (!query) return reply.status(404).send({ error: 'Query not found' });

      const existing = getActiveJobForSession(app.sqlite, queryId);
      if (existing) {
        return reply.status(200).send({ status: 'already_running', job_id: existing.id, session_id: queryId });
      }

      const mode = (req.body.mode ?? 'priority') as 'priority' | 'default' | 'scheduled';
      const job = createJob(app.sqlite, {
        session_id: queryId,
        mode,
        max_iterations: mode === 'priority' ? (req.body.iterations ?? 5) : undefined,
      });

      return reply.status(201).send({ status: 'queued', job_id: job.id, session_id: queryId });
    }
  );

  app.get<{ Params: { id: string } }>(
    '/queries/:id/running',
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
    '/queries/:id/jobs',
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
    '/queries/:id/activity',
    async (req) => {
      const queryId = req.params.id;
      const job = getActiveJobForSession(app.sqlite, queryId);
      const running = !!job && (job.status === 'running' || job.status === 'claimed');
      const recentSteps = listSteps(app.sqlite, queryId, { limit: 5 });
      const allThreads = listThreads(app.sqlite, queryId);
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

  // === Provider config (persisted to ~/.construct/research-config.json) ===
  const configPath = resolve(process.env.HOME ?? '', '.construct', 'research-config.json');

  function loadProviderConfig(): Record<string, unknown> {
    try { return JSON.parse(readFileSync(configPath, 'utf-8')); } catch { return {}; }
  }

  function saveProviderConfig(patch: Record<string, unknown>) {
    const existing = loadProviderConfig();
    const merged = { ...existing, ...patch };
    mkdirSync(dirname(configPath), { recursive: true });
    writeFileSync(configPath, JSON.stringify(merged, null, 2));
    // Apply API keys to process.env so research module picks them up
    const keyMap: Record<string, string> = {
      anthropic_api_key: 'ANTHROPIC_API_KEY',
      openrouter_api_key: 'OPENROUTER_API_KEY',
      tavily_api_key: 'TAVILY_API_KEY',
      brave_api_key: 'BRAVE_SEARCH_API_KEY',
      jina_api_key: 'JINA_API_KEY',
    };
    for (const [configKey, envKey] of Object.entries(keyMap)) {
      if (typeof merged[configKey] === 'string' && merged[configKey]) {
        process.env[envKey] = merged[configKey] as string;
      }
    }
    return merged;
  }

  // Apply stored keys on startup
  (() => {
    const cfg = loadProviderConfig();
    const keyMap: Record<string, string> = {
      anthropic_api_key: 'ANTHROPIC_API_KEY',
      openrouter_api_key: 'OPENROUTER_API_KEY',
      tavily_api_key: 'TAVILY_API_KEY',
      brave_api_key: 'BRAVE_SEARCH_API_KEY',
      jina_api_key: 'JINA_API_KEY',
    };
    for (const [configKey, envKey] of Object.entries(keyMap)) {
      if (typeof cfg[configKey] === 'string' && cfg[configKey] && !process.env[envKey]) {
        process.env[envKey] = cfg[configKey] as string;
      }
    }
  })();

  function maskKey(key: string | undefined): string {
    if (!key) return '';
    if (key.length <= 8) return '*'.repeat(key.length);
    return key.slice(0, 4) + '····' + key.slice(-4);
  }

  app.get('/config', async () => {
    const cfg = loadProviderConfig();
    const recentModels = (app.sqlite.prepare(
      `SELECT model FROM research_steps WHERE model != '' GROUP BY model ORDER BY MAX(created_at) DESC LIMIT 10`
    ).all() as { model: string }[]).map(r => r.model);
    return {
      llm_provider: cfg.llm_provider ?? (process.env.ANTHROPIC_API_KEY ? 'anthropic' : 'openrouter'),
      model: cfg.model ?? '',
      recent_models: recentModels,
      search_provider: cfg.search_provider ?? (process.env.TAVILY_API_KEY ? 'tavily' : process.env.BRAVE_SEARCH_API_KEY ? 'brave' : 'duckduckgo'),
      fulltext_provider: cfg.fulltext_provider ?? (process.env.JINA_API_KEY ? 'jina' : 'local'),
      // Masked keys — indicate whether set
      keys: {
        anthropic: { set: !!process.env.ANTHROPIC_API_KEY, masked: maskKey(process.env.ANTHROPIC_API_KEY) },
        openrouter: { set: !!process.env.OPENROUTER_API_KEY, masked: maskKey(process.env.OPENROUTER_API_KEY) },
        tavily: { set: !!process.env.TAVILY_API_KEY, masked: maskKey(process.env.TAVILY_API_KEY) },
        brave: { set: !!process.env.BRAVE_SEARCH_API_KEY, masked: maskKey(process.env.BRAVE_SEARCH_API_KEY) },
        jina: { set: !!process.env.JINA_API_KEY, masked: maskKey(process.env.JINA_API_KEY) },
      },
      // Research defaults
      max_thread_depth: cfg.max_thread_depth ?? 9,
      min_searches: cfg.min_searches ?? 2,
      fetch_source_text: cfg.fetch_source_text ?? false,
      gap_analysis: cfg.gap_analysis ?? true,
      max_gap_searches: cfg.max_gap_searches ?? 3,
      daily_limit: cfg.daily_limit ?? '',
    };
  });

  app.patch<{ Body: Record<string, unknown> }>('/config', async (req) => {
    const patch = req.body;
    saveProviderConfig(patch);
    return { status: 'saved' };
  });

  // === Research defaults (persisted SessionConfig) ===
  app.get('/defaults', async () => {
    return getDefaults(app.sqlite);
  });

  app.put<{ Body: Partial<SessionConfig> }>('/defaults', async (req) => {
    return updateDefaults(app.sqlite, req.body ?? {});
  });

  app.post('/defaults/reset', async () => {
    return resetDefaults(app.sqlite);
  });

  // === Env check (kept for backward compat + consumer-page warnings) ===
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
    if (!anthropic && !openrouter) {
      warnings.push('No LLM provider configured — set an API key in Providers');
    }
    if (!tavily && !brave) warnings.push('Using DuckDuckGo for search (rate-limited) — configure a search provider in Providers');

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
  app.get('/workers', async () => {
    const supervisorWorkers = app.supervisor.status();
    const activeJobs = listActiveJobs(app.sqlite);

    // Match supervisor workers to their claimed jobs
    const knownPids = new Set(supervisorWorkers.map(w => w.pid).filter(p => p != null));
    const result = supervisorWorkers.map(w => {
      const currentJob = w.pid != null
        ? activeJobs.find(j => j.claimed_by != null && j.claimed_by.startsWith(`worker-${w.pid}-`)) ?? null
        : null;
      return { ...w, currentJob };
    });

    // Add synthetic entries for jobs claimed by workers not in this supervisor
    let nextId = Math.max(...supervisorWorkers.map(w => w.id), -1) + 1;
    for (const job of activeJobs) {
      if (!job.claimed_by) continue;
      const m = job.claimed_by.match(/^worker-(\d+)-/);
      if (!m) continue;
      const pid = parseInt(m[1], 10);
      if (knownPids.has(pid)) continue;
      knownPids.add(pid);
      result.push({ id: nextId++, pid, status: 'running', restarts: 0, uptimeMs: null, currentJob: job });
    }

    return result;
  });
  app.post('/workers/start', async () => { app.supervisor.start(); return app.supervisor.status(); });

  // Worker scaling
  app.post('/workers/add', async () => {
    const w = app.supervisor.addWorker();
    return w;
  });

  app.post('/workers/remove', async () => {
    const id = await app.supervisor.removeWorker();
    return { removed: id };
  });

  app.post<{ Params: { id: string } }>('/workers/:id/kill', async (req) => {
    const id = parseInt(req.params.id, 10);
    const ok = await app.supervisor.killWorker(id);
    return { killed: ok };
  });

  // Job history & stats
  app.get('/jobs', async (req) => {
    const url = new URL(req.url, 'http://localhost');
    const limit = parseInt(url.searchParams.get('limit') ?? '50', 10);
    const offset = parseInt(url.searchParams.get('offset') ?? '0', 10);
    const status = url.searchParams.get('status') as JobStatus | null;
    return listAllJobs(app.sqlite, { limit, offset, status: status || undefined });
  });

  app.get('/jobs/stats', async () => {
    return jobStats(app.sqlite);
  });

  // === Global run/stop ===
  app.post('/run-all', async () => {
    const allQueries = listQueries(app.sqlite, 'active');
    const created: string[] = [];
    for (const query of allQueries) {
      const existing = getActiveJobForSession(app.sqlite, query.id);
      if (!existing) {
        const job = createJob(app.sqlite, { session_id: query.id, mode: 'default' });
        created.push(job.id);
      }
    }
    return { status: 'started', jobs_created: created.length, job_ids: created };
  });

  app.post('/stop-all', async () => {
    const cancelled = cancelAllJobs(app.sqlite);
    return { status: 'stopped', jobs_cancelled: cancelled };
  });

  // === SSE Stream (push-driven) ===
  //
  // Subscribes to `onResearchEvent` and forwards every mutation for this
  // session to the client. Initial state is fetched by the UI via react-query
  // before subscribing, so this stream only carries deltas.
  //
  // Events forwarded: query, finding, thread, step, job, source, concept, concept_link.
  app.get<{ Params: { id: string } }>(
    '/queries/:id/stream',
    async (req, reply) => {
      const queryId = req.params.id;

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

      // Send the current query snapshot once on connect so the UI gets
      // status/role/document/summary immediately without an extra GET.
      try {
        const q = getQuery(app.sqlite, queryId);
        if (q) send('query', q);
      } catch { /* non-fatal */ }

      const unsubscribe = onResearchEvent((event) => {
        if (event.session_id !== queryId) return;
        send(event.type, event.payload);
      });

      const heartbeatInterval = setInterval(() => {
        if (!closed) reply.raw.write(': heartbeat\n\n');
      }, 15_000);

      await new Promise<void>(resolve => req.raw.on('close', resolve));
      closed = true;
      unsubscribe();
      clearInterval(heartbeatInterval);
      if (!reply.raw.writableEnded) reply.raw.end();
    }
  );

  // === Cross-session SSE stream (push-driven) ===
  //
  // Forwards every research event across every session. Only deltas — initial
  // state is fetched by the UI on mount. The 'session' event is mapped from
  // 'query' events for legacy listeners that key on session-level updates.
  app.get('/stream', async (req, reply) => {
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

    const unsubscribe = onResearchEvent((event) => {
      send(event.type, event.payload);
      // Legacy: cross-session consumers also expect a 'session' event when
      // a query updates. Mirror it without an extra emit at the call site.
      if (event.type === 'query') send('session', event.payload);
    });

    const heartbeatInterval = setInterval(() => {
      if (!closed) reply.raw.write(': heartbeat\n\n');
    }, 15_000);

    await new Promise<void>(resolve => req.raw.on('close', resolve));
    closed = true;
    unsubscribe();
    clearInterval(heartbeatInterval);
    if (!reply.raw.writableEnded) reply.raw.end();
  });

  // === Event log (pre-built, served for fast initial load) ===
  //
  // Query params:
  //   ?since=<iso>     — only events with logged_at > since  (for tailing)
  //   ?thread_id=<id>  — filter to a single thread
  //   ?type=<t>        — filter to a single event type (thread|job|step|finding|source)
  //   ?limit=<n>       — cap the returned list (default: no cap)
  //
  // The combination `?since=<last_logged_at>` is how tools should poll — it
  // lets a caller replay missed events after reconnecting without refetching
  // the whole log.
  app.get<{
    Params: { id: string };
    Querystring: { since?: string; thread_id?: string; type?: string; limit?: string }
  }>(
    '/queries/:id/events',
    async (req, reply) => {
      const query = getQuery(app.sqlite, req.params.id);
      if (!query) return reply.status(404).send({ error: 'Query not found' });

      const { since, thread_id, type, limit } = req.query;
      let events = readSessionLog(req.params.id);

      if (since) events = events.filter(e => e.logged_at > since);
      if (type) events = events.filter(e => e.type === type);
      if (thread_id) {
        events = events.filter(e => {
          const p = e.payload as Record<string, unknown> | undefined;
          if (!p) return false;
          if (e.type === 'thread') return p.id === thread_id;
          return p.thread_id === thread_id;
        });
      }
      if (limit) {
        const n = Math.max(1, Math.min(10000, parseInt(limit, 10) || 500));
        events = events.slice(-n);
      }

      return {
        events,
        count: events.length,
        latest_logged_at: events.length > 0 ? events[events.length - 1].logged_at : null,
        log_path: existsSync(sessionLogPath(req.params.id)) ? sessionLogPath(req.params.id) : null,
      };
    }
  );

  // === Metrics: jobs (lifecycle timing, per-worker throughput + cost) ===
  app.get<{ Params: { id: string } }>(
    '/queries/:id/metrics/jobs',
    async (req, reply) => {
      if (!getQuery(app.sqlite, req.params.id)) return reply.status(404).send({ error: 'Query not found' });
      return computeJobMetrics(app.sqlite, { sessionId: req.params.id });
    }
  );

  app.get('/metrics/jobs', async () => computeJobMetrics(app.sqlite));

  // === Error status: credit/rate/overload across active sessions ===
  app.get<{ Querystring: { lookback_minutes?: string } }>(
    '/error-status',
    async (req) => {
      const lookback = req.query.lookback_minutes ? parseInt(req.query.lookback_minutes, 10) : 30;
      return computeErrorStatus(app.sqlite, lookback);
    }
  );

  // === Metrics: source extraction health ===
  app.get<{ Params: { id: string }; Querystring: { limit?: string } }>(
    '/queries/:id/metrics/sources',
    async (req, reply) => {
      if (!getQuery(app.sqlite, req.params.id)) return reply.status(404).send({ error: 'Query not found' });
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
      return computeSourceHealth(app.sqlite, { sessionId: req.params.id, limit });
    }
  );

  app.get<{ Querystring: { limit?: string } }>(
    '/metrics/sources',
    async (req) => {
      const limit = req.query.limit ? parseInt(req.query.limit, 10) : undefined;
      return computeSourceHealth(app.sqlite, { limit });
    }
  );

  // === Metrics: thread state-machine + stuck detection ===
  app.get<{ Params: { id: string }; Querystring: { stuck_threshold_ms?: string } }>(
    '/queries/:id/metrics/threads',
    async (req, reply) => {
      if (!getQuery(app.sqlite, req.params.id)) return reply.status(404).send({ error: 'Query not found' });
      const stuckThresholdMs = req.query.stuck_threshold_ms
        ? Math.max(1000, parseInt(req.query.stuck_threshold_ms, 10))
        : undefined;
      return computeThreadStateMetrics(app.sqlite, { sessionId: req.params.id, stuckThresholdMs });
    }
  );

  // === Metrics: session cost trajectory (per-step cumulative) ===
  app.get<{ Params: { id: string } }>(
    '/queries/:id/metrics/cost-trajectory',
    async (req, reply) => {
      if (!getQuery(app.sqlite, req.params.id)) return reply.status(404).send({ error: 'Query not found' });
      return computeSessionCostTrajectory(app.sqlite, req.params.id);
    }
  );

  // === Agent hooks: iteration checks (mid-run drift detection) ===
  app.get<{ Params: { id: string } }>(
    '/queries/:id/iteration-checks',
    async (req, reply) => {
      if (!getQuery(app.sqlite, req.params.id)) return reply.status(404).send({ error: 'Query not found' });
      return listIterationChecks(app.sqlite, req.params.id);
    }
  );

  // === Per-strategy perturbation outcomes (B2 fruitfulness + B3 triggers) ===
  // Powers the Telemetry tab's strategy outcomes table: attempts, successes,
  // avg novelty/confidence, and the fruitfulness multiplier the selector is
  // currently applying. Empty when no perturbation has fired yet.
  app.get<{ Params: { id: string } }>(
    '/queries/:id/perturbation-stats',
    async (req, reply) => {
      if (!getQuery(app.sqlite, req.params.id)) return reply.status(404).send({ error: 'Query not found' });
      return getStrategyStats(app.sqlite, req.params.id);
    }
  );

  // === Agent hooks: post-mortems (completion reviews) ===
  app.get<{ Params: { id: string } }>(
    '/queries/:id/post-mortems',
    async (req, reply) => {
      if (!getQuery(app.sqlite, req.params.id)) return reply.status(404).send({ error: 'Query not found' });
      return listPostMortems(app.sqlite, req.params.id);
    }
  );

  // Manual re-review: forces a fresh post-mortem against current session state.
  // Mirrors the document-regenerate pattern. job_id is null because there's no
  // job boundary; duration_ms is the wall-clock since session creation.
  app.post<{ Params: { id: string } }>(
    '/queries/:id/post-mortem',
    async (req, reply) => {
      const query = getQuery(app.sqlite, req.params.id);
      if (!query) return reply.status(404).send({ error: 'Query not found' });
      if (!hasHooks('post_mortem')) {
        return reply.status(503).send({ error: 'post_mortem hook not registered (missing OPENROUTER_API_KEY?)' });
      }
      const durationMs = Date.now() - new Date(query.created_at).getTime();
      await runPostMortem(app.sqlite, req.params.id, null, durationMs);
      const records = listPostMortems(app.sqlite, req.params.id);
      // listPostMortems returns DESC, so [0] is the freshly-recorded one (or
      // the latest existing one if the run produced no result, which is rare).
      return reply.send(records[0] ?? null);
    }
  );

  // === Job-level trace (claimed → started → steps → completed) ===
  app.get<{ Params: { id: string } }>(
    '/jobs/:id/trace',
    async (req, reply) => {
      const trace = computeJobTrace(app.sqlite, req.params.id);
      if (!trace) return reply.status(404).send({ error: 'Job not found' });
      return trace;
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
