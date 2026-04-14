import Anthropic from '@anthropic-ai/sdk';
import { fetchPageText, JS_RENDERED_FLAG } from './providers/websearch.js';
import type { Sqlite } from '@construct/data';
import type {
  ResearchQuery, ResearchThread, ResearchFinding,
  ResearchPlanItem, PerturbationStrategy, SessionConfig, ToolCallRecord,
  FollowUpCandidate, FollowUpAnalysis,
} from './types.js';
import { MODEL_PRICING } from './types.js';
import { jaccardSimilarity, computeSimilarity } from './similarity.js';
import * as sessions from './services/queries.js';
import * as threads from './services/threads.js';
import * as findings from './services/findings.js';
import * as steps from './services/steps.js';
import * as plans from './services/plans.js';

export interface LLMProvider {
  complete(model: string, prompt: string, maxTokens: number): Promise<LLMResult>;
  searchWeb(model: string, query: string): Promise<WebSearchResult>;
  embed?(text: string): Promise<number[]>;
}

export interface LLMResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface WebSearchResult {
  text: string;
  sourceTexts: string[];
  sourceUrls: string[];
  sourceUrlMeta?: Array<{ url: string; title: string; snippet: string }>;
  jinaFetches?: Array<{ url: string; ok: boolean; content_length: number; error?: string }>;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface EngineOptions {
  sqlite: Sqlite;
  apiKey?: string;
  provider?: LLMProvider;
  maxIterations?: number;
  onIteration?: (iteration: number, thread: ResearchThread, finding: ResearchFinding | null) => void;
  onError?: (error: Error, thread: ResearchThread | null) => void;
  signal?: AbortSignal;
}

const PERTURBATION_STRATEGIES: PerturbationStrategy[] = [
  'analogical', 'contrarian', 'failure_post_mortem', 'temporal_shift',
];

export function classify(s: string): 'question' | 'topic' {
  const t = s.trim();
  if (t.endsWith('?')) return 'question';
  if (/\b(what|how|why|when|where|who|which)\b/i.test(t)) return 'question';
  if (/^(is|are|does|do|can|should|will|would|has|have|was|were)\b/i.test(t)) return 'question';
  return 'topic';
}

function stripLLMFences(text: string): string {
  // Remove <think> blocks first
  const noThink = text.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
  // Try to extract content from a code fence (```json ... ``` or ``` ... ```)
  const fenceMatch = noThink.match(/`{1,3}(?:json)?\s*\n?([\s\S]*?)`{1,3}/);
  if (fenceMatch) return fenceMatch[1].trim();
  // No fence — find the first { or [ and take from there to the end
  const jsonStart = noThink.search(/[{[]/);
  if (jsonStart !== -1) return noThink.slice(jsonStart).trim();
  return noThink;
}

/** Placeholder short_query: first 80 chars of first sentence, elided if truncated.
 *  Replaced by LLM-generated summary once the summarize worker processes it. */
function placeholderShortQuery(query: string): string {
  const t = query.trim();
  const MAX = 80;
  if (t.length <= MAX) return t;
  return t.slice(0, MAX) + '…';
}

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model];
  if (!pricing) return 0; // local/unknown models are free
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}

export function isCovered(threadFindings: ResearchFinding[]): boolean {
  if (threadFindings.length < 3) return false;
  const avgConf = threadFindings.reduce((s, f) => s + f.confidence, 0) / threadFindings.length;
  const avgNovelty = threadFindings.reduce((s, f) => s + f.novelty, 0) / threadFindings.length;
  return avgConf > 0.65 && avgNovelty < 0.3;
}

type TaskAction = 'broad_search' | 'targeted_lookup' | 'verification';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(model: string, prompt: string, maxTokens: number): Promise<LLMResult> {
    let response: Anthropic.Message;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await this.client.messages.create({
          model,
          max_tokens: maxTokens,
          messages: [{ role: 'user', content: prompt }],
        });
        break;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if ((msg.includes('429') || msg.includes('rate_limit') || msg.includes('529') || msg.includes('overloaded')) && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt + 1) * 5000));
          continue;
        }
        throw error;
      }
    }

    const text = response!.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('\n');

    return {
      text,
      promptTokens: response!.usage.input_tokens,
      completionTokens: response!.usage.output_tokens,
      model: response!.model,
    };
  }

  async searchWeb(model: string, query: string): Promise<WebSearchResult> {
    let response: Anthropic.Message;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await this.client.messages.create({
          model,
          max_tokens: 4096,
          tools: [{
            type: 'web_search_20250305',
            name: 'web_search',
            max_uses: 5,
          } as unknown as Anthropic.Tool],
          messages: [{
            role: 'user',
            content: `Search the web for: "${query}"\n\nSummarize the key information you find. Include specific facts, data points, and source URLs.`,
          }],
        });
        break;
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        if ((msg.includes('429') || msg.includes('rate_limit') || msg.includes('529') || msg.includes('overloaded')) && attempt < 2) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt + 1) * 5000));
          continue;
        }
        throw error;
      }
    }

    const textContent = response!.content
      .filter(b => b.type === 'text')
      .map(b => (b as Anthropic.TextBlock).text)
      .join('\n');

    const sourceUrls: string[] = [];
    const sourceTexts: string[] = [];
    for (const block of response!.content) {
      if (block.type === 'web_search_tool_result') {
        const searchBlock = block as unknown as { content: Array<{ type: string; url?: string; text?: string; title?: string }> };
        if (searchBlock.content) {
          for (const item of searchBlock.content) {
            if (item.url) sourceUrls.push(item.url);
            if (item.text) sourceTexts.push(item.text);
          }
        }
      }
    }
    // If no per-source texts were extracted, use the model's full synthesis text
    if (sourceTexts.length === 0 && textContent) sourceTexts.push(textContent);

    return {
      text: textContent,
      sourceTexts,
      sourceUrls,
      promptTokens: response!.usage.input_tokens,
      completionTokens: response!.usage.output_tokens,
      model: response!.model,
    };
  }
}

export class ResearchEngine {
  private sqlite: Sqlite;
  private provider: LLMProvider;
  private maxIterations: number;
  private onIteration?: EngineOptions['onIteration'];
  private onError?: EngineOptions['onError'];
  private signal?: AbortSignal;
  private recentPerturbationStrategies: PerturbationStrategy[] = [];

  constructor(opts: EngineOptions) {
    this.sqlite = opts.sqlite;
    this.provider = opts.provider ?? new AnthropicProvider(opts.apiKey!);
    this.maxIterations = opts.maxIterations ?? Infinity;
    this.onIteration = opts.onIteration;
    this.onError = opts.onError;
    this.signal = opts.signal;
  }

  private routeTask(thread: ResearchThread, threadFindings: ResearchFinding[]): TaskAction {
    if (thread.origin === 'verify') return 'verification';
    if (threadFindings.length === 0) return 'broad_search';
    return 'targeted_lookup';
  }

  async startSession(title: string, seedQuery: string, config?: Partial<SessionConfig>): Promise<ResearchQuery> {
    const session = sessions.createQuery(this.sqlite, title, seedQuery, config);

    // Create seed thread
    const seedThread = threads.createThread(this.sqlite, {
      session_id: session.id,
      query: seedQuery,
      short_query: placeholderShortQuery(seedQuery),
      node_type: classify(seedQuery),
      origin: 'seed',
      priority: 1.0,
      depth: 0,
      max_depth: session.config.max_thread_depth,
      status: session.config.max_thread_depth > 0 ? 'queued' : 'deferred',
    });
    this.summarizeThreadAsync(seedThread.id, seedQuery, session.id, session.config);

    return session;
  }

  async runIterations(sessionId: string): Promise<{ iterations: number; findings: number; cost: number }> {
    const session = sessions.getQuery(this.sqlite, sessionId);
    if (!session || session.status !== 'active') {
      throw new Error(`Session ${sessionId} not found or not active`);
    }

    let iterationCount = 0;
    let findingCount = 0;
    let totalCost = 0;

    const concurrency = session.config.max_concurrent_threads ?? 3;

    // Run threads concurrently up to the concurrency limit.
    // Each slot claims a thread, runs it, then immediately claims the next.
    const runSlot = async (): Promise<void> => {
      while (iterationCount < this.maxIterations) {
        if (this.signal?.aborted) break;

        const currentSession = sessions.getQuery(this.sqlite, sessionId)!;
        if (currentSession.status !== 'active') break;

        // Check budget
        const cost = sessions.getQueryCost(this.sqlite, sessionId);
        if (currentSession.config.budget_daily_usd && cost.today_cost >= currentSession.config.budget_daily_usd) {
          sessions.updateQuery(this.sqlite, sessionId, { status: 'paused' });
          break;
        }
        if (currentSession.config.budget_total_usd && cost.total_cost >= currentSession.config.budget_total_usd) {
          sessions.updateQuery(this.sqlite, sessionId, { status: 'paused' });
          break;
        }

        await this.applyPlanModifications(sessionId);

        // Atomically claim a thread (mark active) so concurrent slots don't double-claim
        const thread = threads.claimNextThread(this.sqlite, sessionId);
        if (!thread) break;

        try {
          const result = await this.runIteration(sessionId, thread, currentSession.config);
          iterationCount++;
          if (result.finding) findingCount++;
          totalCost += result.cost;

          this.onIteration?.(iterationCount, thread, result.finding);
          threads.updateThread(this.sqlite, thread.id, { status: 'exhausted' });

          await this.maybePerturbate(sessionId, thread, currentSession.config);
          await this.generatePlan(sessionId, currentSession.config);

          if (iterationCount % 5 === 0) {
            await this.updateSummary(sessionId);
            await this.updateDocument(sessionId);
          }

          if (currentSession.config.min_delay_between_steps_ms > 0) {
            await new Promise(resolve => setTimeout(resolve, currentSession.config.min_delay_between_steps_ms));
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.onError?.(err, thread);

          steps.createStep(this.sqlite, {
            thread_id: thread.id,
            session_id: sessionId,
            model: currentSession.config.model,
            prompt_tokens: 0,
            completion_tokens: 0,
            cost_usd: 0,
            duration_ms: 0,
            error: err.message,
          });

          const isTransient = (msg: string) =>
            msg.includes('429') || msg.includes('402') || msg.includes('529') || msg.toLowerCase().includes('rate');
          const isRateLimit = isTransient(err.message);
          const allSteps = steps.listSteps(this.sqlite, sessionId, { threadId: thread.id });
          const priorErrors = allSteps.filter(s => s.error).length;

          if (isRateLimit) {
            let rateLimitStreak = 0;
            for (const s of allSteps) {  // DESC order — newest first
              if (s.error && isTransient(s.error)) { rateLimitStreak++; } else { break; }
            }
            const backoffMs = Math.min(30_000 * Math.pow(2, rateLimitStreak - 1), 600_000);
            const retryAfter = new Date(Date.now() + backoffMs).toISOString().replace('T', ' ').replace('Z', '');
            threads.updateThread(this.sqlite, thread.id, { status: 'queued', retry_after: retryAfter });
          } else {
            threads.updateThread(this.sqlite, thread.id, {
              status: priorErrors <= 1 ? 'queued' : 'exhausted',
              retry_after: null,
            });
          }

          iterationCount++;
        }
      }
    };

    // Run all slots concurrently; when all slots run dry, try one perturbation pass
    await Promise.all(Array.from({ length: concurrency }, runSlot));

    if (iterationCount < this.maxIterations && !this.signal?.aborted) {
      const currentSession = sessions.getQuery(this.sqlite, sessionId)!;
      if (currentSession.status === 'active') {
        const allThreads = threads.listThreads(this.sqlite, sessionId);
        if (allThreads.some(t => t.status === 'exhausted')) {
          await this.spawnPerturbationThreads(sessionId, currentSession.config, true);
          await Promise.all(Array.from({ length: concurrency }, runSlot));
        }
      }
    }

    // Final plan generation
    const finalSession = sessions.getQuery(this.sqlite, sessionId)!;
    await this.generatePlan(sessionId, finalSession.config);

    return { iterations: iterationCount, findings: findingCount, cost: totalCost };
  }

  /** Run a single thread iteration — used by thread-level jobs.
   *  Handles the full lifecycle: plan mods, iteration, bookkeeping, perturbation, plan/summary updates. */
  async runThread(
    sessionId: string,
    threadId: string
  ): Promise<{ finding: ResearchFinding | null; cost: number }> {
    const session = sessions.getQuery(this.sqlite, sessionId);
    if (!session || session.status !== 'active') {
      throw new Error(`Session ${sessionId} not found or not active`);
    }

    const thread = threads.getThread(this.sqlite, threadId);
    if (!thread) throw new Error(`Thread ${threadId} not found`);

    // Apply any pending plan modifications before running
    await this.applyPlanModifications(sessionId);

    // Mark thread active so plan generation shows it as in-progress
    threads.updateThread(this.sqlite, threadId, { status: 'active' });

    let result: { finding: ResearchFinding | null; cost: number };
    try {
      result = await this.runIteration(sessionId, thread, session.config);
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.onError?.(err, thread);

      // Abort/cancel: job was externally cancelled — leave thread queued, don't record a step
      const isAbort = err.message === 'This operation was aborted' || err.message.includes('AbortError');
      if (isAbort) {
        threads.updateThread(this.sqlite, threadId, { status: 'queued', retry_after: null });
        throw err;
      }

      steps.createStep(this.sqlite, {
        thread_id: threadId,
        session_id: sessionId,
        model: session.config.model,
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_usd: 0,
        duration_ms: 0,
        error: err.message,
      });

      const isTransient = (msg: string) =>
        msg.includes('429') || msg.includes('402') || msg.includes('529') || msg.toLowerCase().includes('rate');

      const isRateLimit = isTransient(err.message);
      const allSteps = steps.listSteps(this.sqlite, sessionId, { threadId });
      const priorErrors = allSteps.filter(s => s.error).length;

      // Count consecutive transient errors from the most recent step backward
      // allSteps is ORDER BY created_at DESC — iterate newest-first
      let rateLimitStreak = 0;
      for (const s of allSteps) {
        if (s.error && isTransient(s.error)) {
          rateLimitStreak++;
        } else {
          break;
        }
      }

      if (isRateLimit) {
        // Exponential backoff: 30s, 60s, 120s, 240s, cap at 10 min (streak is 1-based)
        const backoffMs = Math.min(30_000 * Math.pow(2, rateLimitStreak - 1), 600_000);
        const retryAfter = new Date(Date.now() + backoffMs).toISOString().replace('T', ' ').replace('Z', '');
        threads.updateThread(this.sqlite, threadId, { status: 'queued', retry_after: retryAfter });
      } else {
        threads.updateThread(this.sqlite, threadId, {
          status: priorErrors <= 1 ? 'queued' : 'exhausted',
          retry_after: null,
        });
      }
      throw err;
    }

    threads.updateThread(this.sqlite, threadId, { status: 'exhausted' });

    this.onIteration?.(1, thread, result.finding);

    // Perturbation and plan generation
    await this.maybePerturbate(sessionId, thread, session.config);
    await this.generatePlan(sessionId, session.config);

    // Periodic summary/document — every 5 exhausted threads, or on the first
    const exhausted = threads.countExhaustedThreads(this.sqlite, sessionId);
    if (exhausted === 1 || exhausted % 5 === 0) {
      await this.updateSummary(sessionId);
      await this.updateDocument(sessionId);
    }

    return result;
  }

  private async runIteration(
    sessionId: string,
    thread: ResearchThread,
    config: SessionConfig
  ): Promise<{ finding: ResearchFinding | null; cost: number }> {
    const startTime = Date.now();

    // Get existing findings for this thread early (needed for routing)
    const threadFindings = findings.listFindings(this.sqlite, thread.session_id, { threadId: thread.id });

    // Step 1: Formulate search queries (task-routed)
    const action = this.routeTask(thread, threadFindings);
    const queries = await this.formulateQueries(thread, config, action);

    // Step 2: Execute web searches
    const searchResults = await this.executeSearches(queries, sessionId, thread.id, config, thread.fetch_source_text ?? null);

    if (searchResults.length === 0) {
      // No results — mark as potential exhaustion signal
      steps.createStep(this.sqlite, {
        thread_id: thread.id,
        session_id: sessionId,
        model: config.model,
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_usd: 0,
        duration_ms: Date.now() - startTime,
        error: 'No search results returned',
      });
      return { finding: null, cost: 0 };
    }

    // Step 3: Synthesize finding from results
    let synthesisResult = await this.synthesizeFinding(thread, searchResults, sessionId, config);
    if (!synthesisResult) return { finding: null, cost: 0 };

    // Step 3b: Gap analysis — identify missing information and search for it
    let allSearchResults = searchResults;
    if (config.gap_analysis?.enabled && synthesisResult) {
      const gapResults = await this.gapAnalysis(thread, searchResults, synthesisResult, config);
      if (gapResults.length > 0) {
        allSearchResults = [...searchResults, ...gapResults];
        // Re-synthesize with all results combined
        const augmented = await this.synthesizeFinding(thread, allSearchResults, sessionId, config);
        if (augmented) Object.assign(synthesisResult, augmented);
      }
    }

    // Step 4: Check for duplicates
    const isDuplicate = await this.checkDuplicate(sessionId, synthesisResult.summary, config);
    if (isDuplicate) {
      synthesisResult.novelty = Math.min(synthesisResult.novelty, 0.2);
    }

    // Step 4b: Detect gaps and evaluate/score follow-up questions
    const { accepted: followUpQuestions, analysis: followUpAnalysis } = await this.evaluateFollowUps(
      thread, allSearchResults, synthesisResult, config
    );

    // Step 5: Store finding
    const finding = findings.createFinding(this.sqlite, {
      thread_id: thread.id,
      session_id: sessionId,
      content: synthesisResult.content,
      summary: synthesisResult.summary,
      source_urls: synthesisResult.sourceUrls,
      source_texts: synthesisResult.sourceTexts,
      source_url_meta: synthesisResult.sourceUrlMeta,
      source_quality: synthesisResult.sourceQuality,
      tags: synthesisResult.tags,
      confidence: synthesisResult.confidence,
      novelty: synthesisResult.novelty,
      actionability: synthesisResult.actionability,
      follow_ups: followUpQuestions,
      follow_up_analysis: followUpAnalysis,
    });

    // Step 5b: Spawn verify thread for low-confidence findings (non-recursive)
    if (synthesisResult.confidence < 0.4 && thread.origin !== 'verify') {
      const childDepth = thread.depth + 1;
      const verifyQuery = `Verify: ${finding.summary}`;
      const vThread = threads.createThread(this.sqlite, {
        session_id: sessionId,
        query: verifyQuery,
        short_query: placeholderShortQuery(verifyQuery),
        node_type: 'question',
        origin: 'verify',
        parent_thread_id: thread.id,
        spawned_from_finding_id: finding.id,
        priority: 0.8,
        depth: childDepth,
        max_depth: thread.max_depth,
        status: childDepth >= thread.max_depth ? 'deferred' : 'queued',
      });
      this.summarizeThreadAsync(vThread.id, verifyQuery, sessionId, config);
    }

    // Step 6: Spawn child threads from accepted follow-up questions (skip if covered).
    // Always create them so the graph is complete, but defer those that exceed
    // max_depth so they don't run until (if ever) the depth limit is raised.
    const updatedFindings = findings.listFindings(this.sqlite, thread.session_id, { threadId: thread.id });
    if (!isCovered(updatedFindings)) {
      const existingQuerySet = new Set(
        threads.listThreads(this.sqlite, thread.session_id).map(t => t.query.toLowerCase().trim())
      );
      for (const question of followUpQuestions) {
        // Skip malformed or context-dependent questions
        if (typeof question !== 'string' || question.trim().length < 10) continue;
        // Reject questions with unresolved pronouns — they can't stand alone as search queries
        if (/\b(they|them|their|it|its|this|these|those|such)\b/i.test(question.trim())) continue;
        // Skip if a thread with the same query already exists (case-insensitive)
        if (existingQuerySet.has(question.toLowerCase().trim())) continue;
        const childDepth = thread.depth + 1;
        console.log(`[follow_up] childDepth=${childDepth} max_depth=${thread.max_depth} gate=${childDepth >= thread.max_depth} → ${childDepth >= thread.max_depth ? 'deferred' : 'queued'}`);
        const fuThread = threads.createThread(this.sqlite, {
          session_id: sessionId,
          query: question,
          short_query: placeholderShortQuery(question),
          node_type: classify(question),
          origin: 'follow_up',
          parent_thread_id: thread.id,
          spawned_from_finding_id: finding.id,
          priority: this.calculateChildPriority(thread, finding),
          depth: childDepth,
          max_depth: thread.max_depth,
          status: childDepth >= thread.max_depth ? 'deferred' : 'queued',
        });
        this.summarizeThreadAsync(fuThread.id, question, sessionId, config);
      }
    }

    const totalCost = synthesisResult.totalCost;
    return { finding, cost: totalCost };
  }

  private async formulateQueries(thread: ResearchThread, config: SessionConfig, action: TaskAction = 'broad_search'): Promise<string[]> {
    const startTime = Date.now();

    // Get existing findings for context
    const existingFindings = findings.listFindings(this.sqlite, thread.session_id, {
      threadId: thread.id,
      limit: 5,
    });

    // Get already-searched queries across the entire session to avoid cross-thread repetition
    const priorSteps = steps.listSteps(this.sqlite, thread.session_id);
    const searchedQueries = priorSteps
      .flatMap(s => s.tool_calls.filter(t => t.tool === 'web_search').map(t => (t.input as Record<string, unknown>)?.query as string))
      .filter(Boolean);

    const context = existingFindings.length > 0
      ? `Previous findings for this thread:\n${existingFindings.map(f => `- ${f.summary}`).join('\n')}`
      : 'This is the first search for this thread.';

    const alreadySearched = searchedQueries.length > 0
      ? `\nAlready searched (DO NOT repeat these):\n${searchedQueries.map(q => `- ${q}`).join('\n')}`
      : '';

    const minSearches = thread.min_searches ?? config.min_searches_per_thread ?? 2;

    let taskInstruction: string;
    if (action === 'broad_search') {
      taskInstruction = `Generate at least ${Math.max(minSearches, 3)} diverse queries exploring different angles of this topic`;
    } else if (action === 'targeted_lookup') {
      taskInstruction = `Generate at least ${Math.max(minSearches, 2)} targeted queries to fill gaps not yet covered by existing findings`;
    } else {
      // verification — look up parent finding claim
      const parentFinding = thread.spawned_from_finding_id
        ? findings.getFinding(this.sqlite, thread.spawned_from_finding_id)
        : null;
      const claim = parentFinding?.summary ?? thread.query;
      taskInstruction = `Generate ${Math.max(minSearches, 2)} queries to confirm or refute the specific claim being verified: "${claim}"`;
    }

    const result = await this.callLLM(
      config.model,
      `You are a research query formulator. Given a research topic/question, generate search queries.

Task: ${taskInstruction}

Rules:
- Queries must be meaningfully different from each other and from any already-searched queries
- Explore different angles: specific facts, comparisons, examples, edge cases
- If previous findings exist, focus on gaps not yet covered

Topic: ${thread.query}

${context}${alreadySearched}

Return ONLY a JSON array of search query strings. No other text.`,
      thread.session_id,
      thread.id,
      config,
      'formulate queries'
    );

    try {
      const parsed = JSON.parse(stripLLMFences(result.text));
      const minSearches = thread.min_searches ?? config.min_searches_per_thread ?? 2;
      const candidates: string[] = Array.isArray(parsed) ? parsed.slice(0, Math.max(6, minSearches + 2)) : [thread.query];
      const searchedLower = new Set(searchedQueries.map(q => q.toLowerCase()));
      const seen = new Set<string>();
      const deduped = candidates.filter(q => {
        const lower = q.toLowerCase();
        if (seen.has(lower) || searchedLower.has(lower)) return false;
        seen.add(lower);
        return true;
      });
      if (deduped.length > 0) return deduped;
      // All LLM suggestions already searched — only fall back to thread.query if not yet searched
      if (!searchedLower.has(thread.query.toLowerCase())) return [thread.query];
      return []; // nothing new to search — caller marks thread exhausted
    } catch {
      return [thread.query];
    }
  }

  protected async executeSearches(
    queries: string[],
    sessionId: string,
    threadId: string,
    config: SessionConfig,
    fetchSourceTextOverride?: boolean | null
  ): Promise<Array<{ query: string; results: string; sourceTexts: string[]; sourceUrls: string[]; sourceUrlMeta: Array<{ url: string; title: string; snippet: string }> }>> {
    const results = await Promise.all(queries.map(async (query) => {
      const startTime = Date.now();
      try {
        const result = await this.provider.searchWeb(config.model, query);
        const cost = calculateCost(result.model, result.promptTokens, result.completionTokens);

        steps.createStep(this.sqlite, {
          thread_id: threadId,
          session_id: sessionId,
          model: result.model,
          prompt_tokens: result.promptTokens,
          completion_tokens: result.completionTokens,
          cost_usd: cost,
          tool_calls: [{ tool: 'web_search', input: { query }, output: result.text.slice(0, 2000), jina_fetches: result.jinaFetches }],
          duration_ms: Date.now() - startTime,
        });

        if (!result.text.trim()) return null;

        let sourceTexts = result.sourceTexts;
        const shouldFetchText = fetchSourceTextOverride !== undefined && fetchSourceTextOverride !== null
          ? fetchSourceTextOverride
          : config.fetch_source_text;
        if (shouldFetchText && result.sourceUrls.length > 0) {
          const fetched = await Promise.all(result.sourceUrls.map(url => fetchPageText(url)));
          sourceTexts = fetched.map((full, i) => {
            if (!full || full === JS_RENDERED_FLAG) return result.sourceTexts[i] ?? '';
            return full;
          });
        }

        return {
          query,
          results: result.text + (result.sourceUrls.length > 0 ? `\n\nSources: ${result.sourceUrls.join(', ')}` : ''),
          sourceTexts,
          sourceUrls: result.sourceUrls,
          sourceUrlMeta: result.sourceUrlMeta ?? [],
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        steps.createStep(this.sqlite, {
          thread_id: threadId,
          session_id: sessionId,
          model: config.model,
          prompt_tokens: 0,
          completion_tokens: 0,
          cost_usd: 0,
          tool_calls: [{ tool: 'web_search', input: { query }, error: err.message }],
          duration_ms: Date.now() - startTime,
          error: err.message,
        });
        return null;
      }
    }));

    return results.filter((r): r is { query: string; results: string; sourceTexts: string[]; sourceUrls: string[]; sourceUrlMeta: Array<{ url: string; title: string; snippet: string }> } => r !== null);
  }

  private async gapAnalysis(
    thread: ResearchThread,
    initialSearchResults: Array<{ query: string; results: string; sourceTexts: string[]; sourceUrls: string[]; sourceUrlMeta: Array<{ url: string; title: string; snippet: string }> }>,
    draftFinding: { content: string; summary: string },
    config: SessionConfig
  ): Promise<Array<{ query: string; results: string; sourceTexts: string[]; sourceUrls: string[]; sourceUrlMeta: Array<{ url: string; title: string; snippet: string }> }>> {
    if (!config.gap_analysis?.enabled) return [];

    const result = await this.callLLM(
      config.model,
      `You are evaluating a research finding for completeness.

Research question: "${thread.query}"

Draft finding:
${draftFinding.content}

Identify specific gaps. What important facts, data points, or aspects are still unclear or missing that would make this finding more complete?

Respond with JSON only:
{
  "has_gaps": boolean,
  "gap_queries": string[]
}

If has_gaps is false, gap_queries must be [].
If has_gaps is true, gap_queries must contain ${config.gap_analysis.max_gap_searches ?? 2} targeted search queries addressing specific missing information. Do NOT generate broad or redundant queries.`,
      thread.session_id,
      thread.id,
      config,
      'gap analysis'
    );

    let gapQueries: string[] = [];
    try {
      const parsed = JSON.parse(stripLLMFences(result.text));
      if (parsed.has_gaps && Array.isArray(parsed.gap_queries)) {
        gapQueries = parsed.gap_queries.slice(0, config.gap_analysis.max_gap_searches ?? 2);
      }
    } catch {
      return [];
    }

    if (gapQueries.length === 0) return [];
    return this.executeSearches(gapQueries, thread.session_id, thread.id, config, thread.fetch_source_text ?? null);
  }

  private async synthesizeFinding(
    thread: ResearchThread,
    searchResults: Array<{ query: string; results: string; sourceTexts: string[]; sourceUrls: string[]; sourceUrlMeta: Array<{ url: string; title: string; snippet: string }> }>,
    sessionId: string,
    config: SessionConfig
  ): Promise<{
    content: string;
    summary: string;
    sourceUrls: string[];
    sourceTexts: string[];
    sourceUrlMeta: Array<{ url: string; title: string; snippet: string }>;
    sourceQuality: number;
    tags: string[];
    confidence: number;
    novelty: number;
    actionability: number;
    totalCost: number;
  } | null> {
    const resultsText = searchResults
      .map(r => `### Search: "${r.query}"\n${r.results}`)
      .join('\n\n---\n\n');

    const result = await this.callLLM(
      config.model,
      `You are a research synthesizer. Analyze search results and produce a structured finding.

Research thread: "${thread.query}"
Thread origin: ${thread.origin}${thread.perturbation_strategy ? ` (perturbation: ${thread.perturbation_strategy})` : ''}

Search results:
${resultsText}

Produce a JSON object with these fields:
- content: string (1-3 paragraphs of synthesized insight — not just summarizing, but connecting and interpreting)
- summary: string (one clear sentence)
- source_urls: string[] (URLs from the search results)
- source_quality: number 0-1 (how reliable/authoritative are these sources?)
- tags: string[] (3-5 topic tags)
- confidence: number 0-1 (how confident are you in this finding?)
- novelty: number 0-1 (how surprising/non-obvious is this? 1 = very novel)
- actionability: number 0-1 (how directly useful is this for decision-making?)

Return ONLY valid JSON. No markdown fences.`,
      sessionId,
      thread.id,
      config,
      'synthesize finding'
    );

    try {
      const text = stripLLMFences(result.text);
      const parsed = JSON.parse(text);
      // Collect all sourceUrlMeta from search results
      const allMeta = searchResults.flatMap(r => r.sourceUrlMeta ?? []);
      return {
        content: parsed.content ?? '',
        summary: parsed.summary ?? '',
        sourceUrls: parsed.source_urls ?? [],
        sourceTexts: [],
        sourceUrlMeta: allMeta,
        sourceQuality: parsed.source_quality ?? 0.5,
        tags: parsed.tags ?? [],
        confidence: parsed.confidence ?? 0.5,
        novelty: parsed.novelty ?? 0.5,
        actionability: parsed.actionability ?? 0.5,
        totalCost: result.cost,
      };
    } catch {
      return null;
    }
  }

  private async evaluateFollowUps(
    thread: ResearchThread,
    searchResults: Array<{ query: string; results: string; sourceTexts: string[]; sourceUrls: string[]; sourceUrlMeta: Array<{ url: string; title: string; snippet: string }> }>,
    finding: { content: string; summary: string },
    config: SessionConfig
  ): Promise<{ accepted: string[]; analysis: FollowUpAnalysis }> {
    const followUpConfig = config.follow_up ?? { min_count: 2, max_count: 5, max_retries: 3, similarity_threshold: 0.75 };
    const threshold = followUpConfig.similarity_threshold;
    const minCount = followUpConfig.min_count;
    const maxCount = followUpConfig.max_count ?? 5;
    const maxRetries = followUpConfig.max_retries;

    let retryCount = 0;
    let allCandidates: FollowUpCandidate[] = [];
    const acceptedQuestions: string[] = [];

    // Initial detectGaps call
    let rawQuestions = await this.detectGaps(thread, searchResults, finding, config);

    while (true) {
      const newCandidates = await this.scoreAndRankFollowUps(
        rawQuestions, thread, acceptedQuestions, config, retryCount
      );

      allCandidates = [...allCandidates, ...newCandidates];

      // Add newly accepted questions (up to max_count)
      for (const c of newCandidates) {
        if (c.accepted && acceptedQuestions.length < maxCount) acceptedQuestions.push(c.text);
      }

      const acceptedCount = acceptedQuestions.length;

      // Check if we have enough, hit max, or hit retry limit
      if (acceptedCount >= maxCount || acceptedCount >= minCount || retryCount >= maxRetries) break;

      // Not enough accepted — retry with rejection context
      const rejected = allCandidates.filter(c => !c.accepted);
      if (rejected.length === 0) break;

      const rejectionContext = rejected
        .map(c => `- "${c.text}" (${c.rejection_reason ?? 'rejected'})`)
        .join('\n');

      rawQuestions = await this.detectGaps(
        thread,
        searchResults,
        finding,
        config,
        `\nPreviously rejected questions (DO NOT repeat these or similar ones):\n${rejectionContext}`
      );

      retryCount++;
    }

    return {
      accepted: acceptedQuestions,
      analysis: {
        candidates: allCandidates,
        similarity_threshold: threshold,
        retry_count: retryCount,
        min_required: minCount,
      },
    };
  }

  private async scoreAndRankFollowUps(
    questions: string[],
    thread: ResearchThread,
    existingAccepted: string[],
    config: SessionConfig,
    retryCount: number
  ): Promise<FollowUpCandidate[]> {
    const followUpConfig = config.follow_up ?? { min_count: 2, max_retries: 3, similarity_threshold: 0.75 };
    const threshold = followUpConfig.similarity_threshold;

    const embedFn = this.provider.embed?.bind(this.provider) ?? null;

    const llmJudge = async (a: string, b: string): Promise<number> => {
      const result = await this.callLLM(
        config.model,
        `Are these two research questions semantically equivalent or asking about the same thing?\nQ1: ${a}\nQ2: ${b}\nReply with only: YES or NO`,
        '',
        '',
        config
      );
      return result.text.trim().toUpperCase().startsWith('YES') ? 1.0 : 0.0;
    };

    const existingQuerySet = new Set(
      threads.listThreads(this.sqlite, thread.session_id).map(t => t.query.toLowerCase().trim())
    );

    const candidates: FollowUpCandidate[] = [];
    const localAccepted: string[] = [...existingAccepted];
    const parentWords = thread.query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    for (const question of questions) {
      // Quality score heuristics
      const words = question.trim().split(/\s+/);
      const hasCapitalized = /\b[A-Z][a-z]+\b/.test(question);
      const hasNumbers = /\d/.test(question);
      const specificityScore = words.length >= 5 && (hasCapitalized || hasNumbers)
        ? 1.0
        : words.length >= 3 && words.length <= 4
          ? 0.6
          : 0.3;

      // Relevance to parent: Jaccard for question parents, keyword containment for topic parents
      let relevanceScore: number;
      if (thread.node_type === 'topic') {
        const qLow = question.toLowerCase();
        const hits = parentWords.filter(w => qLow.includes(w)).length;
        relevanceScore = parentWords.length > 0 ? Math.min(1, (hits / parentWords.length) * 1.2) : 0.5;
      } else {
        relevanceScore = Math.min(1, jaccardSimilarity(question, thread.query) * 2);
      }

      // Focus score: how well-defined/searchable is this item?
      const childType = classify(question);
      let focusScore: number;
      if (childType === 'question') {
        const hasQuestionWords = /\b(what|how|why|when|where|who|which)\b/i.test(question);
        focusScore = question.trim().endsWith('?') ? 1.0 : hasQuestionWords ? 0.7 : 0.4;
      } else {
        // Topic: score by noun phrase specificity (2-6 words with a meaningful term is ideal)
        const hasSpecificTerm = /\b[A-Z][a-z]+\b/.test(question) || /\b\w{7,}\b/.test(question);
        focusScore = words.length >= 3 && words.length <= 6 && hasSpecificTerm
          ? 1.0
          : words.length >= 2 && words.length <= 8
            ? 0.7
            : 0.4;
      }

      const quality_score = 0.4 * specificityScore + 0.3 * relevanceScore + 0.3 * focusScore;
      const distance_from_parent = 1 - jaccardSimilarity(question, thread.query);

      // Fast exact-match check first
      const qLower = question.toLowerCase().trim();
      if (existingQuerySet.has(qLower) || localAccepted.some(a => a.toLowerCase().trim() === qLower)) {
        candidates.push({
          text: question,
          quality_score,
          jaccard_similarity: 1.0,
          embedding_similarity: null,
          llm_similarity: null,
          similarity_method: 'jaccard',
          distance_from_parent,
          rank_score: 0,
          accepted: false,
          rejection_reason: 'exact duplicate',
        });
        continue;
      }

      // Compute similarity against all accepted items
      let maxSimilarity = 0;
      let maxSimilarQuestion = '';
      let usedMethod: 'jaccard' | 'embedding' | 'llm' = 'jaccard';
      let embeddingSim: number | null = null;
      let llmSim: number | null = null;

      for (const accepted of localAccepted) {
        const result = await computeSimilarity(question, accepted, threshold, embedFn, llmJudge);
        if (result.score > maxSimilarity) {
          maxSimilarity = result.score;
          maxSimilarQuestion = accepted;
          usedMethod = result.method;
          embeddingSim = result.embedding;
          llmSim = result.llm;
        }
      }

      const accepted = maxSimilarity < threshold;
      const rank_score = 0.40 * quality_score + 0.30 * distance_from_parent + 0.30 * (1 - maxSimilarity);

      const candidate: FollowUpCandidate = {
        text: question,
        quality_score,
        jaccard_similarity: maxSimilarity,
        embedding_similarity: embeddingSim,
        llm_similarity: llmSim,
        similarity_method: usedMethod,
        distance_from_parent,
        rank_score,
        accepted,
        rejection_reason: accepted ? null : `too similar to: "${maxSimilarQuestion}"`,
      };

      candidates.push(candidate);
      if (accepted) localAccepted.push(question);
    }

    // Sort by rank_score descending
    candidates.sort((a, b) => b.rank_score - a.rank_score);

    return candidates;
  }

  private async detectGaps(
    thread: ResearchThread,
    searchResults: Array<{ query: string; results: string; sourceTexts: string[]; sourceUrls: string[] }>,
    finding: { content: string; summary: string },
    config: SessionConfig,
    rejectionContext?: string
  ): Promise<string[]> {
    const resultsText = searchResults
      .map(r => `### Search: "${r.query}"\n${r.results.slice(0, 500)}`)
      .join('\n\n---\n\n');

    const maxCount = config.follow_up?.max_count ?? 5;

    const prompt = thread.node_type === 'topic'
      ? `You are a research scope analyst. Given a research topic and what was found, identify related subtopics that still need coverage.

Research topic: "${thread.query}"

What was found:
${finding.summary}

Search results summary:
${resultsText}

What specific subtopics, aspects, or related concepts of "${thread.query}" still need detailed coverage?

Rules:
- Return exactly ${maxCount} or fewer items
- Return focused noun phrases or named concepts (2-6 words each)
- Each phrase must be fully self-contained and searchable on its own
- Do not repeat what was already covered in the finding
- Name the specific concept explicitly in each phrase${rejectionContext ?? ''}

Return ONLY a JSON array of topic phrase strings. No other text.`
      : `You are a research gap analyst. Given the research question and what was found, identify unanswered questions.

Research question: "${thread.query}"

What was found:
${finding.summary}

Search results summary:
${resultsText}

Given the research question and what was found, what specific questions remain unanswered or need verification?

Rules:
- Return exactly ${maxCount} or fewer questions
- Each question must be fully self-contained and searchable on its own
- NO pronouns like "they/it/these/those/this" that refer back to the finding
- Name the specific topic explicitly in each question${rejectionContext ?? ''}

Return ONLY a JSON array of question strings. No other text.`;

    const result = await this.callLLM(
      config.model,
      prompt,
      thread.session_id,
      thread.id,
      config,
      'evaluate follow-ups'
    );

    try {
      const text = stripLLMFences(result.text);
      const parsed = JSON.parse(text);
      return Array.isArray(parsed) ? parsed.filter((q): q is string => typeof q === 'string') : [];
    } catch {
      return [];
    }
  }

  private async checkDuplicate(sessionId: string, newSummary: string, config: SessionConfig): Promise<boolean> {
    const existing = findings.getRecentFindings(this.sqlite, sessionId, 50);
    if (existing.length === 0) return false;

    const existingSummaries = existing.map(f => f.summary).join('\n- ');

    const result = await this.callLLM(
      config.model,
      `Compare this new finding against existing findings. Is it essentially the same information as any existing finding?

New finding: "${newSummary}"

Existing findings:
- ${existingSummaries}

Respond with ONLY "true" if this is a duplicate or near-duplicate, "false" otherwise.`,
      sessionId,
      '',
      config
    );

    return result.text.trim().toLowerCase() === 'true';
  }

  private async maybePerturbate(
    sessionId: string,
    thread: ResearchThread,
    config: SessionConfig
  ): Promise<void> {
    // Depth-scaled probability
    const p = config.p_serendipity + (thread.depth / config.max_thread_depth) * 0.15;
    if (Math.random() > p) return;

    await this.spawnPerturbationThreads(sessionId, config, false);
  }

  private async spawnPerturbationThreads(
    sessionId: string,
    config: SessionConfig,
    forced: boolean
  ): Promise<void> {
    // Pick a strategy not recently used (cooldown)
    const available = PERTURBATION_STRATEGIES.filter(
      s => !this.recentPerturbationStrategies.includes(s)
    );
    const strategy = available.length > 0
      ? available[Math.floor(Math.random() * available.length)]
      : PERTURBATION_STRATEGIES[Math.floor(Math.random() * PERTURBATION_STRATEGIES.length)];

    this.recentPerturbationStrategies.push(strategy);
    if (this.recentPerturbationStrategies.length > 3) {
      this.recentPerturbationStrategies.shift();
    }

    // Get context for perturbation
    const session = sessions.getQuery(this.sqlite, sessionId)!;
    const recentFindings = findings.getRecentFindings(this.sqlite, sessionId, 10);
    const context = recentFindings.length > 0
      ? recentFindings.map(f => f.summary).join('\n')
      : session.seed_query;

    const tangentQuery = await this.generatePerturbation(strategy, session.seed_query, context, config);
    if (!tangentQuery) return;

    // Find a parent — use the most recent active/exhausted thread with findings
    const allThreads = threads.listThreads(this.sqlite, sessionId);
    const parentThread = allThreads.find(t => t.status !== 'pruned') ?? allThreads[0];

    const pertDepth = (parentThread?.depth ?? 0) + 1;
    console.log(`[perturbation] pertDepth=${pertDepth} max_thread_depth=${config.max_thread_depth} gate=${pertDepth >= config.max_thread_depth} → ${pertDepth >= config.max_thread_depth ? 'deferred' : 'queued'}`);
    const pertThread = threads.createThread(this.sqlite, {
      session_id: sessionId,
      query: tangentQuery,
      short_query: placeholderShortQuery(tangentQuery),
      node_type: classify(tangentQuery),
      origin: 'perturbation',
      perturbation_strategy: strategy,
      parent_thread_id: parentThread?.id ?? null,
      priority: 0.6 + (forced ? 0.1 : 0),
      depth: pertDepth,
      max_depth: config.max_thread_depth,
      status: pertDepth >= config.max_thread_depth ? 'deferred' : 'queued',
    });
    this.summarizeThreadAsync(pertThread.id, tangentQuery, sessionId, config);
  }

  private async generatePerturbation(
    strategy: PerturbationStrategy,
    seedQuery: string,
    context: string,
    config: SessionConfig
  ): Promise<string | null> {
    const prompts: Record<PerturbationStrategy, string> = {
      analogical: `Given this research topic: "${seedQuery}"
And these recent findings:
${context}

Think of a completely different field or domain that has solved a similar problem or faced analogous challenges. Generate ONE specific search query to explore that analogy. The query should be self-contained and searchable.`,

      contrarian: `Given this research topic: "${seedQuery}"
And these recent findings:
${context}

Generate ONE specific search query that explores the strongest counterargument, opposing viewpoint, or reason why the premise might be wrong. Be specific — not just "criticism of X" but a concrete contrarian angle.`,

      failure_post_mortem: `Given this research topic: "${seedQuery}"
And these recent findings:
${context}

Generate ONE specific search query to find stories of failure, post-mortems, or things that went wrong related to this topic. Look for specific incidents, case studies, or cautionary tales.`,

      temporal_shift: `Given this research topic: "${seedQuery}"
And these recent findings:
${context}

Generate ONE specific search query that shifts the temporal frame — either looking at how this topic was understood 20-50 years ago, or projecting forward to how it might change in the next 10-20 years. Be specific.`,
    };

    const result = await this.callLLM(
      config.model,
      `${prompts[strategy]}

Return ONLY the search query text, nothing else.`,
      '',
      '',
      config
    );

    const query = result.text.replace(/^["']|["']$/g, '').trim();
    return query.length > 5 ? query : null;
  }

  private calculateChildPriority(parentThread: ResearchThread, finding: ResearchFinding): number {
    return (
      0.25 * (finding.confidence + finding.novelty) / 2
      + 0.20 * finding.actionability
      + 0.15 * parentThread.priority
      - 0.10 * (parentThread.depth / parentThread.max_depth)
      + 0.05 * Math.random()
    );
  }

  async generatePlan(sessionId: string, config: SessionConfig): Promise<void> {
    const queuedThreads = threads.listThreads(this.sqlite, sessionId, 'queued');
    const activeThreads = threads.listThreads(this.sqlite, sessionId, 'active');
    const allThreads = [...activeThreads, ...queuedThreads]
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 15);

    if (allThreads.length === 0) return;

    const session = sessions.getQuery(this.sqlite, sessionId);

    // Build parent thread map
    const parentMap = new Map<string, string | null>();
    for (const thread of allThreads) {
      if (thread.parent_thread_id) {
        const parentThread = threads.getThread(this.sqlite, thread.parent_thread_id);
        parentMap.set(thread.id, parentThread?.query ?? null);
      } else {
        parentMap.set(thread.id, null);
      }
    }

    const staticRationale = (thread: ResearchThread): string => {
      const parentQuery = parentMap.get(thread.id) ?? null;
      return thread.origin === 'perturbation'
        ? `Tangent via ${thread.perturbation_strategy} strategy`
        : thread.origin === 'follow_up'
          ? `Follow-up from: ${parentQuery ?? 'unknown'}`
          : thread.origin === 'user_injected'
            ? 'User-injected question'
            : thread.origin === 'verify'
              ? `Verification thread`
              : 'Seed research thread';
    };

    // If session has a summary, use LLM to re-rank and generate contextual rationale
    if (session?.summary) {
      try {
        const result = await this.callLLM(
          config.model,
          `You are a research planner. Given what has been learned so far, re-rank these pending research threads by importance and explain why each matters.

Research topic: "${session.seed_query}"

What has been learned:
${session.summary}

Pending threads (current priority order):
${allThreads.map((t, i) => `${i + 1}. [${t.origin}] ${t.query}`).join('\n')}

Return a JSON array of objects: { thread_index: number (0-based), rationale: string }
Ordered from most to least important. Each rationale should explain relevance to filling gaps in what's been learned.`,
          sessionId,
          '',
          config,
          'generate plan'
        );

        const text = stripLLMFences(result.text);
        const parsed: Array<{ thread_index: number; rationale: string }> = JSON.parse(text);

        if (Array.isArray(parsed) && parsed.length > 0) {
          const items: ResearchPlanItem[] = parsed.map((item, rank) => {
            const thread = allThreads[item.thread_index] ?? allThreads[rank];
            const parentQuery = thread ? (parentMap.get(thread.id) ?? null) : null;
            return {
              rank: rank + 1,
              thread_id: thread?.id ?? '',
              thread_query: thread?.query ?? '',
              parent_thread_title: parentQuery,
              origin: (thread?.origin ?? 'seed') as ResearchPlanItem['origin'],
              perturbation_strategy: (thread?.perturbation_strategy ?? null) as PerturbationStrategy | null,
              estimated_cost: 0.02,
              rationale: item.rationale,
            };
          });

          plans.createPlan(this.sqlite, sessionId, items);
          return;
        }
      } catch {
        // fall through to static rationale
      }
    }

    // Fallback: static rationale, priority-score ordering
    const items: ResearchPlanItem[] = allThreads.map((thread, i) => {
      return {
        rank: i + 1,
        thread_id: thread.id,
        thread_query: thread.query,
        parent_thread_title: parentMap.get(thread.id) ?? null,
        origin: thread.origin as ResearchPlanItem['origin'],
        perturbation_strategy: thread.perturbation_strategy as PerturbationStrategy | null,
        estimated_cost: 0.02,
        rationale: staticRationale(thread),
      };
    });

    plans.createPlan(this.sqlite, sessionId, items);
  }

  private async applyPlanModifications(sessionId: string): Promise<void> {
    const latestPlan = plans.getLatestPlan(this.sqlite, sessionId);
    if (!latestPlan) return;

    const mods = plans.getPendingModifications(this.sqlite, latestPlan.id);
    for (const mod of mods) {
      const targetThread = mod.target_thread_id
        ? threads.getThread(this.sqlite, mod.target_thread_id)
        : latestPlan.items.find(i => i.rank === mod.target_item_rank)
          ? threads.getThread(this.sqlite, latestPlan.items.find(i => i.rank === mod.target_item_rank)!.thread_id)
          : null;

      if (!targetThread) continue;

      switch (mod.action) {
        case 'veto':
          threads.updateThread(this.sqlite, targetThread.id, { status: 'pruned' });
          break;
        case 'boost':
          if (targetThread.status === 'exhausted') {
            threads.updateThread(this.sqlite, targetThread.id, {
              status: 'queued',
              priority: Math.min(1.0, targetThread.priority + 0.3),
              max_depth: targetThread.max_depth + 2,
            });
          } else {
            threads.updateThread(this.sqlite, targetThread.id, {
              priority: Math.min(1.0, targetThread.priority + 0.3),
            });
          }
          break;
        case 'deprioritize':
          threads.updateThread(this.sqlite, targetThread.id, {
            priority: Math.max(0, targetThread.priority - 0.3),
          });
          break;
      }
    }

    if (mods.length > 0) {
      plans.updatePlanStatus(this.sqlite, latestPlan.id, 'modified');
    }
  }

  private async updateSummary(sessionId: string): Promise<void> {
    const session = sessions.getQuery(this.sqlite, sessionId)!;
    const recentFindings = findings.getRecentFindings(this.sqlite, sessionId, 20);
    const findingCount = findings.countFindings(this.sqlite, sessionId);
    const threadCounts = threads.countThreadsByOrigin(this.sqlite, sessionId);

    if (recentFindings.length === 0) return;

    const result = await this.callLLM(
      session.config.model,
      `Summarize the current state of this research session in 2-3 paragraphs.

Topic: "${session.seed_query}"
Total findings: ${findingCount}
Thread breakdown: ${JSON.stringify(threadCounts)}

Recent findings (newest first):
${recentFindings.map(f => `- ${f.summary}`).join('\n')}

${session.summary ? `Previous summary:\n${session.summary}` : ''}

Write a concise, informative summary of what has been discovered so far, key themes, and interesting tangents.`,
      sessionId,
      '',
      session.config,
      'update summary'
    );

    sessions.updateQuery(this.sqlite, sessionId, { summary: result.text });
  }

  /** Generate a structured article from all findings.
   *  Called periodically alongside updateSummary. */
  async updateDocument(sessionId: string): Promise<void> {
    const session = sessions.getQuery(this.sqlite, sessionId)!;
    const allFindings = findings.listFindings(this.sqlite, sessionId);
    const allThreads = threads.listThreads(this.sqlite, sessionId);

    if (allFindings.length < 3) return; // not enough material

    // Build source material: findings grouped with thread context
    const threadMap = new Map(allThreads.map(t => [t.id, t]));
    const material = allFindings.map(f => {
      const thread = threadMap.get(f.thread_id);
      return `[Thread: ${thread?.short_query ?? thread?.query ?? 'unknown'}]\n${f.content}`;
    }).join('\n\n---\n\n');

    // Collect all unique sources
    const allUrls = new Map<string, { url: string; title: string }>();
    for (const f of allFindings) {
      for (const url of f.source_urls) {
        if (!allUrls.has(url)) {
          const meta = f.source_url_meta?.find(m => m.url === url);
          allUrls.set(url, { url, title: meta?.title ?? url });
        }
      }
    }

    const result = await this.callLLM(
      session.config.model,
      `You are a skilled encyclopedia editor. Using the research findings below as source material, write a comprehensive, well-structured article about: "${session.seed_query}"

Write it like a Wikipedia article:
- Start with a concise lead section (2-3 paragraphs) that summarizes the entire topic
- Organize the body into logical sections with short heading titles (1-5 words each, ## level)
- Use subsections (### level) where appropriate
- Write in flowing, connected prose — not bullet points or lists
- Weave findings together into a coherent narrative; don't just list them sequentially
- Use transitional phrases between paragraphs and sections
- Where appropriate, cite sources using numbered references like [1], [2] etc.
- End with a "## References" section listing all cited sources as numbered items
- Do NOT include confidence scores, tags, metadata, or any research-process artifacts
- The tone should be encyclopedic: neutral, informative, authoritative

Source material (${allFindings.length} findings):

${material}

Available sources for citation:
${Array.from(allUrls.values()).map((s, i) => `[${i + 1}] ${s.title} — ${s.url}`).join('\n')}

Write the full article in markdown.`,
      sessionId,
      '',
      session.config,
      'generate document'
    );

    sessions.updateQuery(this.sqlite, sessionId, { document: result.text });
  }

  /** Fire-and-forget LLM title generation for a thread's query.
   *  Produces a short conceptual section title (1-5 words) like a Wikipedia heading. */
  private summarizeThreadAsync(threadId: string, query: string, sessionId: string, config: SessionConfig): void {
    this.callLLM(
      config.model,
      `Give a short conceptual section title (1-5 words) for this research topic. Like a Wikipedia section heading — a noun phrase, not a question. No quotes, no punctuation. Return ONLY the title:\n\n${query}`,
      sessionId,
      threadId,
      config,
      'summarize thread'
    ).then(result => {
      const title = result.text.trim().replace(/^["']|["']$/g, '');
      if (title && title.length <= 60) {
        threads.updateThread(this.sqlite, threadId, { short_query: title });
      }
    }).catch(() => { /* non-critical — placeholder remains */ });
  }

  protected async callLLM(
    model: string,
    prompt: string,
    sessionId: string,
    threadId: string,
    config: SessionConfig,
    label?: string
  ): Promise<LLMResult & { cost: number }> {
    const startTime = Date.now();
    const result = await this.provider.complete(model, prompt, 8192);

    const cost = calculateCost(result.model, result.promptTokens, result.completionTokens);

    if (sessionId && threadId) {
      steps.createStep(this.sqlite, {
        thread_id: threadId,
        session_id: sessionId,
        model: result.model,
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        cost_usd: cost,
        label: label ?? null,
        duration_ms: Date.now() - startTime,
      });
    }

    return { ...result, cost };
  }
}
