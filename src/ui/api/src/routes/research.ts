import type { FastifyPluginAsync } from 'fastify';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { readSessionLog, sessionLogPath } from '../research-logger.js';
import { resolve, dirname } from 'path';
import {
  listQueries, getQuery, createQuery, updateQuery, getQueryCost, getResearchStats,
  listThreads, getThread, updateThread, createThread,
  listFindings, getFinding, updateFinding, updateFindingSourceTexts, clearThreadFindings,
  getLatestPlan, addPlanModification,
  getStepCosts, listSteps,
  applyResearchDDL,
  DEFAULT_SESSION_CONFIG,
  getDefaults, updateDefaults, resetDefaults,
  listConcepts, listConceptLinks, getConcept, listFindingsForConcept, getSourcesForConcept,
  fetchPageText, JS_RENDERED_FLAG,
  // Job imports
  createJob, getJob, getActiveJobForSession, cancelJob, listJobsForSession, cancelAllJobs, listAllJobs, listActiveJobs, jobStats,
  type JobStatus, type ThreadStatus,
  type SessionConfig,
  deleteQuery,
  OpenRouterProvider,
  // Monitor imports
  createMonitor, getMonitor, listMonitors, updateMonitor,
  listSnapshots, listAlerts, updateAlert,
  MonitorEngine,
} from '@construct/research';

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

function heuristicSeedQueryShort(query: string): string {
  const t = query.trim();
  // First sentence ending with punctuation
  const sentEnd = t.search(/[?!.]/);
  if (sentEnd > 10 && sentEnd < 150) return t.slice(0, sentEnd + 1).trim();
  // Fall back to first 120 chars
  return t.length <= 120 ? t : t.slice(0, 120) + '…';
}

function heuristicSeedQuerySuperShort(query: string): string {
  return summarizeQuery(query);
}

function placeholderShortQuery(query: string): string {
  const t = query.trim();
  const MAX = 80;
  if (t.length <= MAX) return t;
  return t.slice(0, MAX) + '…';
}

async function generateSeedQueryShort(query: string): Promise<string | null> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) return null;
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat',
        messages: [{ role: 'user', content: `Restate this research question as a single clear sentence. Return ONLY the sentence, no quotes:\n\n${query}` }],
        max_tokens: 60,
      }),
    });
    if (resp.ok) {
      const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
      const result = data.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
      if (result && result.length <= 200) return result;
    }
  } catch { /* fall through */ }
  return null;
}

async function generateShortQuery(query: string): Promise<string | null> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  if (!openrouterKey) return null;
  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat',
        messages: [{ role: 'user', content: `Give a short conceptual section title (1-5 words) for this research topic. Like a Wikipedia section heading — a noun phrase, not a question. No quotes, no punctuation. Return ONLY the title:\n\n${query}` }],
        max_tokens: 20,
      }),
    });
    if (resp.ok) {
      const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
      const summary = data.choices[0]?.message?.content?.trim().replace(/^["']|["']$/g, '');
      if (summary && summary.length <= 60) return summary;
    }
  } catch { /* fall through */ }
  return null;
}

async function generateQueryTitle(seedQuery: string): Promise<string> {
  const openrouterKey = process.env.OPENROUTER_API_KEY;
  const heuristic = summarizeQuery(seedQuery);

  if (!openrouterKey) return heuristic;

  try {
    const resp = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${openrouterKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'deepseek/deepseek-chat',
        messages: [{ role: 'user', content: `Give a short title (5-8 words) for this research query. Return ONLY the title, no quotes, no punctuation at end:\n\n${seedQuery}` }],
        max_tokens: 30,
      }),
    });
    if (resp.ok) {
      const data = await resp.json() as { choices: Array<{ message: { content: string } }> };
      const title = data.choices[0]?.message?.content?.trim();
      if (title) return title;
    }
  } catch { /* fall through to heuristic */ }

  return heuristic;
}

export const researchRoutes: FastifyPluginAsync = async (app) => {
  // Ensure research tables exist
  applyResearchDDL(app.sqlite);

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

  // === Queries ===
  app.get('/queries', async (req) => {
    const { status } = req.query as { status?: string };
    return listQueries(app.sqlite, status);
  });

  app.get<{ Params: { id: string } }>('/queries/:id', async (req, reply) => {
    const query = getQuery(app.sqlite, req.params.id);
    if (!query) return reply.status(404).send({ error: 'Query not found' });
    return query;
  });

  app.post<{ Body: { title?: string; seed_query: string; config?: Record<string, unknown> } }>(
    '/queries',
    async (req, reply) => {
      const { seed_query: rawQuery, title, config } = req.body;
      const seed_query = sanitizeQuery(rawQuery ?? '');
      if (!seed_query) return reply.status(400).send({ error: 'seed_query is required' });
      const seed_query_short = heuristicSeedQueryShort(seed_query);
      const seed_query_super_short = heuristicSeedQuerySuperShort(seed_query);
      const query = createQuery(
        app.sqlite,
        title ?? summarizeQuery(seed_query),
        seed_query,
        config as Partial<typeof DEFAULT_SESSION_CONFIG>,
        seed_query_short,
        seed_query_super_short,
      );
      // Create seed thread
      const seedThread = createThread(app.sqlite, {
        session_id: query.id,
        query: seed_query,
        short_query: placeholderShortQuery(seed_query),
        origin: 'seed',
        priority: 1.0,
        depth: 0,
        max_depth: query.config.max_thread_depth,
        status: query.config.max_thread_depth > 0 ? 'queued' : 'deferred',
      });
      // Fire async LLM summarization for the seed thread
      generateShortQuery(seed_query).then(summary => {
        if (summary) updateThread(app.sqlite, seedThread.id, { short_query: summary });
      }).catch(() => { /* ignore */ });
      // Fire async LLM title generation (don't await — return immediately)
      generateQueryTitle(seed_query).then(llmTitle => {
        if (llmTitle !== query.title) {
          updateQuery(app.sqlite, query.id, { title: llmTitle });
        }
      }).catch(() => { /* ignore */ });
      // Fire async LLM short/super-short generation for the query itself
      generateSeedQueryShort(seed_query).then(short => {
        if (short) updateQuery(app.sqlite, query.id, { seed_query_short: short });
      }).catch(() => { /* ignore */ });
      generateShortQuery(seed_query).then(superShort => {
        if (superShort) updateQuery(app.sqlite, query.id, { seed_query_super_short: superShort });
      }).catch(() => { /* ignore */ });
      // Auto-create a burst job so workers pick it up immediately
      createJob(app.sqlite, { session_id: query.id, mode: 'burst' });
      return reply.status(201).send(query);
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

      const slug = (query.title ?? query.seed_query).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);
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
      lines.push(`*${query.seed_query}*`);
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

  // === Export: thread activity log (.md) — session or single thread ===
  app.get<{ Params: { id: string }; Querystring: { thread_id?: string } }>(
    '/queries/:id/export/log',
    async (req, reply) => {
      const { id } = req.params;
      const { thread_id } = req.query;

      const query = getQuery(app.sqlite, id);
      if (!query) return reply.status(404).send({ error: 'Query not found' });

      const allThreads = listThreads(app.sqlite, id);
      const threads = thread_id ? allThreads.filter(t => t.id === thread_id) : allThreads;

      if (thread_id && threads.length === 0) return reply.status(404).send({ error: 'Thread not found' });

      const findings = listFindings(app.sqlite, id);
      const steps = listSteps(app.sqlite, id);

      const findingsByThread = new Map<string, typeof findings>();
      for (const f of findings) {
        if (!findingsByThread.has(f.thread_id)) findingsByThread.set(f.thread_id, []);
        findingsByThread.get(f.thread_id)!.push(f);
      }
      const stepsByThread = new Map<string, typeof steps>();
      for (const s of steps) {
        if (!stepsByThread.has(s.thread_id)) stepsByThread.set(s.thread_id, []);
        stepsByThread.get(s.thread_id)!.push(s);
      }
      const threadById = new Map(allThreads.map(t => [t.id, t]));

      const slug = (query.title ?? query.seed_query).replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60);
      const suffix = thread_id ? `-thread-${thread_id.slice(0, 8)}` : '';
      const filename = `${slug}-log${suffix}-${id.slice(0, 8)}`;

      const lines: string[] = [];
      lines.push(`# Activity Log: ${query.title}${thread_id ? ` — thread ${thread_id.slice(0, 8)}` : ''}`);
      lines.push('');
      lines.push(`**Session:** ${id}`);
      lines.push(`**Generated:** ${new Date().toISOString()}`);
      lines.push('');

      // Sort depth-first for session log
      function buildOrder(parentId: string | null): (typeof allThreads)[0][] {
        return allThreads
          .filter(t => t.parent_thread_id === parentId)
          .sort((a, b) => a.created_at.localeCompare(b.created_at))
          .flatMap(t => [t, ...buildOrder(t.id)]);
      }
      const ordered = thread_id ? threads : buildOrder(null);

      for (const t of ordered) {
        const tSteps = (stepsByThread.get(t.id) ?? []).sort((a, b) => a.created_at.localeCompare(b.created_at));
        const tFindings = findingsByThread.get(t.id) ?? [];

        lines.push(`## Thread: ${t.short_query ?? t.query.slice(0, 80)}`);
        lines.push('');
        lines.push(`> ${t.query}`);
        lines.push('');

        const parentThread = t.parent_thread_id ? threadById.get(t.parent_thread_id) : null;
        const meta: string[] = [
          `depth ${t.depth}`,
          `origin: ${t.origin}`,
          `status: **${t.status}**`,
        ];
        if (parentThread) meta.push(`parent: *${parentThread.short_query ?? parentThread.query.slice(0, 60)}*`);
        if (t.perturbation_strategy) meta.push(`perturbation: ${t.perturbation_strategy}`);
        lines.push(meta.join(' · '));
        lines.push('');

        if (tSteps.length > 0) {
          lines.push('### Steps');
          lines.push('');
          for (const s of tSteps) {
            const time = new Date(s.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
            const tokStr = s.prompt_tokens != null ? ` · ${s.prompt_tokens}+${s.completion_tokens} tok` : '';
            const costStr = s.cost_usd > 0 ? ` · $${s.cost_usd.toFixed(4)}` : '';
            const durStr = s.duration_ms ? ` · ${s.duration_ms}ms` : '';
            lines.push(`- \`${time}\` **${s.label ?? s.model ?? 'step'}** — ${s.model ?? ''}${tokStr}${costStr}${durStr}${s.error ? ` ⚠ ${s.error}` : ''}`);
            if (s.tool_calls?.length) {
              for (const tc of s.tool_calls as Array<{ tool?: string; name?: string; input?: Record<string, unknown> }>) {
                const toolName = tc.tool ?? tc.name ?? 'unknown';
                const query = tc.input?.query as string | undefined;
                const detail = query ? ` "${query}"` : '';
                lines.push(`  - \`${toolName}\`${detail}`);
              }
            }
          }
          lines.push('');
        }

        if (tFindings.length > 0) {
          lines.push('### Findings');
          lines.push('');
          for (const f of tFindings) {
            const conf = `conf ${(f.confidence * 100).toFixed(0)}%`;
            const novel = `novelty ${(f.novelty * 100).toFixed(0)}%`;
            lines.push(`#### ${f.summary ?? 'Finding'} [${conf}, ${novel}]`);
            lines.push('');
            lines.push(f.content);
            lines.push('');
            if (f.source_urls?.length) {
              lines.push('**Sources:**');
              for (const u of f.source_urls) lines.push(`- ${u}`);
              lines.push('');
            }
            if (f.tags?.length) lines.push(`*Tags: ${f.tags.join(', ')}*`);
            if (f.follow_ups?.length) {
              lines.push('');
              lines.push('**Follow-up questions spawned:**');
              for (const fu of f.follow_ups as string[]) lines.push(`- ${fu}`);
            }
            lines.push('');
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
      // Fire async LLM summarization
      generateShortQuery(query).then(summary => {
        if (summary) updateThread(app.sqlite, thread.id, { short_query: summary });
      }).catch(() => { /* ignore */ });
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
  app.get<{ Params: { id: string }; Querystring: { thread_id?: string; limit?: string; sort?: string } }>(
    '/queries/:id/findings',
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
      const plan = getLatestPlan(app.sqlite, req.params.id);
      if (!plan) return reply.status(404).send({ error: 'No plan found' });
      return plan;
    }
  );

  app.post<{ Params: { id: string }; Body: { action: string; target_item_rank?: number; target_thread_id?: string; payload?: string } }>(
    '/queries/:id/plan/modify',
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

  // === Document generation ===
  app.post<{ Params: { id: string } }>(
    '/queries/:id/generate-document',
    async (req, reply) => {
      const queryId = req.params.id;
      const query = getQuery(app.sqlite, queryId);
      if (!query) return reply.status(404).send({ error: 'Query not found' });

      const allQueryFindings = listFindings(app.sqlite, queryId);
      const allQueryThreads = listThreads(app.sqlite, queryId);

      if (allQueryFindings.length < 1) {
        return reply.status(400).send({ error: 'No findings to generate an article from' });
      }

      const openrouterKey = process.env.OPENROUTER_API_KEY;
      if (!openrouterKey) return reply.status(400).send({ error: 'OpenRouter API key required' });

      // Build source material
      const threadMap = new Map(allQueryThreads.map(t => [t.id, t]));
      const material = allQueryFindings.map(f => {
        const thread = threadMap.get(f.thread_id);
        return `[Section: ${thread?.short_query ?? thread?.query ?? 'unknown'}]\n${f.content}`;
      }).join('\n\n---\n\n');

      // Collect sources
      const allUrls = new Map<string, { url: string; title: string }>();
      for (const f of allQueryFindings) {
        for (const url of f.source_urls) {
          if (!allUrls.has(url)) {
            const meta = (f.source_url_meta as Array<{ url: string; title: string }>)?.find(m => m.url === url);
            allUrls.set(url, { url, title: meta?.title ?? url });
          }
        }
      }

      const cfg = query.config as any;
      const primaryModel: string = cfg?.model || 'deepseek/deepseek-chat';
      const poolModels: string[] = cfg?.providers?.openrouter_models ?? [];
      // Use all available models (primary first if not already in pool, then pool) for rotation
      const allModels = poolModels.includes(primaryModel)
        ? poolModels
        : [primaryModel, ...poolModels];

      const provider = new OpenRouterProvider({ apiKey: openrouterKey, models: allModels });

      const prompt = `You are a skilled encyclopedia editor. Using the research findings below as source material, write a comprehensive, well-structured article about: "${query.seed_query}"

Write it like a Wikipedia article:
- Start with a concise lead section (2-3 paragraphs) that summarizes the entire topic
- Organize the body into logical sections with short heading titles (1-5 words each, ## level)
- Use subsections (### level) where appropriate
- Write in flowing, connected prose — not bullet points or lists
- Weave findings together into a coherent narrative; don't just list them sequentially
- Use transitional phrases between paragraphs and sections
- Where sources are relevant, cite them using numbered references like [1], [2] etc.
- End with a "## References" section listing all cited sources as numbered items
- Do NOT include confidence scores, tags, metadata, or any research-process artifacts
- The tone should be encyclopedic: neutral, informative, authoritative

Source material (${allQueryFindings.length} findings):

${material}

Available sources for citation:
${Array.from(allUrls.values()).map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n')}

Write the full article in markdown.`;

      let result: { text: string };
      try {
        result = await provider.complete(allModels[0], prompt, 4096);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return reply.status(502).send({ error: `LLM call failed: ${msg}` });
      }

      let doc = result.text.trim();
      // Strip markdown code fences if the LLM wrapped the output
      doc = doc.replace(/^```(?:markdown)?\s*\n?/i, '').replace(/\n?```\s*$/, '');

      updateQuery(app.sqlite, queryId, { document: doc });
      return reply.send({ document: doc });
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
        return reply.status(409).send({ error: 'Query already has an active job', job_id: existing.id });
      }

      const mode = (req.body.mode ?? 'burst') as 'burst' | 'background' | 'scheduled';
      const job = createJob(app.sqlite, {
        session_id: queryId,
        mode,
        max_iterations: mode === 'burst' ? (req.body.iterations ?? 5) : undefined,
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
        const job = createJob(app.sqlite, { session_id: query.id, mode: 'background' });
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
          const findings = listFindings(app.sqlite, queryId);
          for (const f of findings) {
            if (!sentFindings.has(f.id)) {
              sentFindings.add(f.id);
              send('finding', f);
            }
          }

          const threads = listThreads(app.sqlite, queryId);
          for (const t of threads) {
            const state = `${t.status}:${t.updated_at}`;
            if (sentThreadState.get(t.id) !== state) {
              sentThreadState.set(t.id, state);
              send('thread', t);
            }
          }

          const steps = listSteps(app.sqlite, queryId, { limit: 1000 });
          for (const s of steps) {
            if (!sentSteps.has(s.id)) {
              sentSteps.add(s.id);
              send('step', s);
            }
          }

          const jobs = listJobsForSession(app.sqlite, queryId);
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

  // === Event log (pre-built, served for fast initial load) ===
  app.get<{ Params: { id: string } }>(
    '/queries/:id/events',
    async (req, reply) => {
      const query = getQuery(app.sqlite, req.params.id);
      if (!query) return reply.status(404).send({ error: 'Query not found' });
      const events = readSessionLog(req.params.id);
      return { events, log_path: existsSync(sessionLogPath(req.params.id)) ? sessionLogPath(req.params.id) : null };
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
