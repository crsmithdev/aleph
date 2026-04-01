import Anthropic from '@anthropic-ai/sdk';
import type { Sqlite } from '@construct/data';
import type {
  ResearchSession, ResearchThread, ResearchFinding,
  ResearchPlanItem, PerturbationStrategy, SessionConfig, ToolCallRecord,
} from './types.js';
import { MODEL_PRICING } from './types.js';
import * as sessions from './services/sessions.js';
import * as threads from './services/threads.js';
import * as findings from './services/findings.js';
import * as steps from './services/steps.js';
import * as plans from './services/plans.js';

export interface LLMProvider {
  complete(model: string, prompt: string, maxTokens: number): Promise<LLMResult>;
  searchWeb(model: string, query: string): Promise<WebSearchResult>;
}

export interface LLMResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface WebSearchResult {
  text: string;
  sourceUrls: string[];
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

function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING['claude-sonnet-4-6'];
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}

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
    for (const block of response!.content) {
      if (block.type === 'web_search_tool_result') {
        const searchBlock = block as unknown as { content: Array<{ type: string; url?: string }> };
        if (searchBlock.content) {
          for (const item of searchBlock.content) {
            if (item.url) sourceUrls.push(item.url);
          }
        }
      }
    }

    return {
      text: textContent,
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

  async startSession(title: string, seedQuery: string, config?: Partial<SessionConfig>): Promise<ResearchSession> {
    const session = sessions.createSession(this.sqlite, title, seedQuery, config);

    // Create seed thread
    threads.createThread(this.sqlite, {
      session_id: session.id,
      query: seedQuery,
      origin: 'seed',
      priority: 1.0,
      depth: 0,
      max_depth: session.config.max_thread_depth,
      status: 'queued',
    });

    return session;
  }

  async runIterations(sessionId: string): Promise<{ iterations: number; findings: number; cost: number }> {
    const session = sessions.getSession(this.sqlite, sessionId);
    if (!session || session.status !== 'active') {
      throw new Error(`Session ${sessionId} not found or not active`);
    }

    let iterationCount = 0;
    let findingCount = 0;
    let totalCost = 0;

    while (iterationCount < this.maxIterations) {
      if (this.signal?.aborted) break;

      const currentSession = sessions.getSession(this.sqlite, sessionId)!;
      if (currentSession.status !== 'active') break;

      // Check budget
      const cost = sessions.getSessionCost(this.sqlite, sessionId);
      if (currentSession.config.budget_daily_usd && cost.today_cost >= currentSession.config.budget_daily_usd) {
        sessions.updateSession(this.sqlite, sessionId, { status: 'paused' });
        break;
      }
      if (currentSession.config.budget_total_usd && cost.total_cost >= currentSession.config.budget_total_usd) {
        sessions.updateSession(this.sqlite, sessionId, { status: 'paused' });
        break;
      }

      // Apply pending plan modifications
      await this.applyPlanModifications(sessionId);

      // Select next thread
      const thread = threads.selectNextThread(this.sqlite, sessionId);
      if (!thread) {
        // No threads left — try spawning perturbation threads
        const allThreads = threads.listThreads(this.sqlite, sessionId);
        const exhaustedWithFindings = allThreads.filter(t => t.status === 'exhausted');
        if (exhaustedWithFindings.length > 0) {
          await this.spawnPerturbationThreads(sessionId, currentSession.config, true);
          const newThread = threads.selectNextThread(this.sqlite, sessionId);
          if (!newThread) break;
        } else {
          break;
        }
        continue;
      }

      // Mark thread active
      threads.updateThread(this.sqlite, thread.id, { status: 'active' });

      try {
        const result = await this.runIteration(sessionId, thread, currentSession.config);
        iterationCount++;
        if (result.finding) findingCount++;
        totalCost += result.cost;

        this.onIteration?.(iterationCount, thread, result.finding);

        // Check thread exhaustion
        await this.checkThreadExhaustion(thread);

        // Perturbation check
        await this.maybePerturbate(sessionId, thread, currentSession.config);

        // Regenerate plan
        await this.generatePlan(sessionId, currentSession.config);

        // Update session summary periodically
        if (iterationCount % 5 === 0) {
          await this.updateSummary(sessionId);
        }

        // Delay between steps
        if (currentSession.config.min_delay_between_steps_ms > 0) {
          await new Promise(resolve => setTimeout(resolve, currentSession.config.min_delay_between_steps_ms));
        }
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        this.onError?.(err, thread);

        // Log the error as a step
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

        // Continue to next iteration rather than stopping
        iterationCount++;
        continue;
      }
    }

    // Final plan generation
    const finalSession = sessions.getSession(this.sqlite, sessionId)!;
    await this.generatePlan(sessionId, finalSession.config);

    return { iterations: iterationCount, findings: findingCount, cost: totalCost };
  }

  private async runIteration(
    sessionId: string,
    thread: ResearchThread,
    config: SessionConfig
  ): Promise<{ finding: ResearchFinding | null; cost: number }> {
    const startTime = Date.now();

    // Step 1: Formulate search queries
    const queries = await this.formulateQueries(thread, config);

    // Step 2: Execute web searches
    const searchResults = await this.executeSearches(queries, sessionId, thread.id, config);

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
    const synthesisResult = await this.synthesizeFinding(thread, searchResults, sessionId, config);
    if (!synthesisResult) return { finding: null, cost: 0 };

    // Step 4: Check for duplicates
    const isDuplicate = await this.checkDuplicate(sessionId, synthesisResult.summary, config);
    if (isDuplicate) {
      synthesisResult.novelty = Math.min(synthesisResult.novelty, 0.2);
    }

    // Step 5: Store finding
    const finding = findings.createFinding(this.sqlite, {
      thread_id: thread.id,
      session_id: sessionId,
      content: synthesisResult.content,
      summary: synthesisResult.summary,
      source_urls: synthesisResult.sourceUrls,
      source_quality: synthesisResult.sourceQuality,
      tags: synthesisResult.tags,
      confidence: synthesisResult.confidence,
      novelty: synthesisResult.novelty,
      actionability: synthesisResult.actionability,
      follow_up_questions: synthesisResult.followUpQuestions,
    });

    // Step 6: Spawn child threads from follow-up questions.
    // Always create them so the graph is complete, but defer those that exceed
    // max_depth so they don't run until (if ever) the depth limit is raised.
    for (const question of synthesisResult.followUpQuestions) {
      const childDepth = thread.depth + 1;
      threads.createThread(this.sqlite, {
        session_id: sessionId,
        query: question,
        origin: 'follow_up',
        parent_thread_id: thread.id,
        spawned_from_finding_id: finding.id,
        priority: this.calculateChildPriority(thread, finding),
        depth: childDepth,
        max_depth: thread.max_depth,
        status: childDepth > thread.max_depth ? 'deferred' : 'queued',
      });
    }

    const totalCost = synthesisResult.totalCost;
    return { finding, cost: totalCost };
  }

  private async formulateQueries(thread: ResearchThread, config: SessionConfig): Promise<string[]> {
    const startTime = Date.now();

    // Get existing findings for context
    const existingFindings = findings.listFindings(this.sqlite, thread.session_id, {
      threadId: thread.id,
      limit: 5,
    });

    const context = existingFindings.length > 0
      ? `Previous findings for this thread:\n${existingFindings.map(f => `- ${f.summary}`).join('\n')}`
      : 'This is the first search for this thread.';

    const result = await this.callLLM(
      config.model,
      `You are a research query formulator. Given a research topic/question, generate 2-3 diverse search queries.

Rules:
- One query should be a direct search for the topic
- One should be a reformulated version (different angle, broader or more specific)
- If previous findings exist, the third should explore gaps in current knowledge

Topic: ${thread.query}

${context}

Return ONLY a JSON array of search query strings. No other text.`,
      thread.session_id,
      thread.id,
      config
    );

    try {
      const parsed = JSON.parse(result.text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
      return Array.isArray(parsed) ? parsed.slice(0, 4) : [thread.query];
    } catch {
      return [thread.query];
    }
  }

  protected async executeSearches(
    queries: string[],
    sessionId: string,
    threadId: string,
    config: SessionConfig
  ): Promise<Array<{ query: string; results: string }>> {
    const allResults: Array<{ query: string; results: string }> = [];

    for (const query of queries) {
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
          tool_calls: [{ tool: 'web_search', input: { query }, output: result.text.slice(0, 500) }],
          duration_ms: Date.now() - startTime,
        });

        if (result.text.trim()) {
          allResults.push({
            query,
            results: result.text + (result.sourceUrls.length > 0 ? `\n\nSources: ${result.sourceUrls.join(', ')}` : ''),
          });
        }
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
      }
    }

    return allResults;
  }

  private async synthesizeFinding(
    thread: ResearchThread,
    searchResults: Array<{ query: string; results: string }>,
    sessionId: string,
    config: SessionConfig
  ): Promise<{
    content: string;
    summary: string;
    sourceUrls: string[];
    sourceQuality: number;
    tags: string[];
    confidence: number;
    novelty: number;
    actionability: number;
    followUpQuestions: string[];
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
- follow_up_questions: string[] (2-4 questions worth investigating next — be specific, not generic)

Return ONLY valid JSON. No markdown fences.`,
      sessionId,
      thread.id,
      config
    );

    try {
      const text = result.text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(text);
      return {
        content: parsed.content ?? '',
        summary: parsed.summary ?? '',
        sourceUrls: parsed.source_urls ?? [],
        sourceQuality: parsed.source_quality ?? 0.5,
        tags: parsed.tags ?? [],
        confidence: parsed.confidence ?? 0.5,
        novelty: parsed.novelty ?? 0.5,
        actionability: parsed.actionability ?? 0.5,
        followUpQuestions: parsed.follow_up_questions ?? [],
        totalCost: result.cost,
      };
    } catch {
      return null;
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

  private async checkThreadExhaustion(thread: ResearchThread): void {
    const recentFindings = findings.listFindings(this.sqlite, thread.session_id, {
      threadId: thread.id,
      limit: 3,
      sort: 'created_at',
    });

    if (recentFindings.length >= 3) {
      const allLowNovelty = recentFindings.every(f => f.novelty < 0.3);
      if (allLowNovelty) {
        threads.updateThread(this.sqlite, thread.id, { status: 'exhausted' });
        return;
      }
    }

    if (thread.depth >= thread.max_depth) {
      threads.updateThread(this.sqlite, thread.id, { status: 'exhausted' });
    }
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
    const session = sessions.getSession(this.sqlite, sessionId)!;
    const recentFindings = findings.getRecentFindings(this.sqlite, sessionId, 10);
    const context = recentFindings.length > 0
      ? recentFindings.map(f => f.summary).join('\n')
      : session.seed_query;

    const tangentQuery = await this.generatePerturbation(strategy, session.seed_query, context, config);
    if (!tangentQuery) return;

    // Find a parent — use the most recent active/exhausted thread with findings
    const allThreads = threads.listThreads(this.sqlite, sessionId);
    const parentThread = allThreads.find(t => t.status !== 'pruned') ?? allThreads[0];

    threads.createThread(this.sqlite, {
      session_id: sessionId,
      query: tangentQuery,
      origin: 'perturbation',
      perturbation_strategy: strategy,
      parent_thread_id: parentThread?.id ?? null,
      priority: 0.6 + (forced ? 0.1 : 0),
      depth: (parentThread?.depth ?? 0) + 1,
      max_depth: config.max_thread_depth,
    });
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

    const items: ResearchPlanItem[] = allThreads.map((thread, i) => {
      const parentThread = thread.parent_thread_id
        ? threads.getThread(this.sqlite, thread.parent_thread_id)
        : null;

      return {
        rank: i + 1,
        thread_id: thread.id,
        thread_query: thread.query,
        parent_thread_title: parentThread?.query ?? null,
        origin: thread.origin as ResearchPlanItem['origin'],
        perturbation_strategy: thread.perturbation_strategy as PerturbationStrategy | null,
        estimated_cost: 0.02, // rough estimate per iteration
        rationale: thread.origin === 'perturbation'
          ? `Tangent via ${thread.perturbation_strategy} strategy`
          : thread.origin === 'follow_up'
            ? `Follow-up from: ${parentThread?.query ?? 'unknown'}`
            : thread.origin === 'user_injected'
              ? 'User-injected question'
              : 'Seed research thread',
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
    const session = sessions.getSession(this.sqlite, sessionId)!;
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
      session.config
    );

    sessions.updateSession(this.sqlite, sessionId, { summary: result.text });
  }

  protected async callLLM(
    model: string,
    prompt: string,
    sessionId: string,
    threadId: string,
    config: SessionConfig
  ): Promise<LLMResult & { cost: number }> {
    const startTime = Date.now();
    const result = await this.provider.complete(model, prompt, 4096);

    const cost = calculateCost(result.model, result.promptTokens, result.completionTokens);

    if (sessionId && threadId) {
      steps.createStep(this.sqlite, {
        thread_id: threadId,
        session_id: sessionId,
        model: result.model,
        prompt_tokens: result.promptTokens,
        completion_tokens: result.completionTokens,
        cost_usd: cost,
        duration_ms: Date.now() - startTime,
      });
    }

    return { ...result, cost };
  }
}
