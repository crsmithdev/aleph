import Anthropic from '@anthropic-ai/sdk';
import { fetchPageText, JS_RENDERED_FLAG } from './providers/websearch.js';
import type { Sqlite } from '@construct/data';
import type {
  ResearchQuery, ResearchThread, ResearchFinding,
  ResearchPlanItem, PerturbationStrategy, PerturbationTrigger, SessionConfig, ToolCallRecord,
  FollowUpCandidate, FollowUpAnalysis,
  QuestionShape, ShapeAnalysis,
} from './types.js';
import { MODEL_PRICING } from './types.js';
import { jaccardSimilarity, computeSimilarity } from './similarity.js';
import * as sessions from './services/queries.js';
import * as threads from './services/threads.js';
import * as findings from './services/findings.js';
import * as steps from './services/steps.js';
import { TrackedLLM, type CallContext } from './services/llm.js';
import * as plans from './services/plans.js';
import * as steering from './services/steering.js';
import * as concepts from './services/concepts.js';
import * as sources from './services/sources.js';
import * as perturbationState from './services/perturbation-state.js';
import {
  selectStrategyWithDetails,
  generatePerturbationPrompt,
} from './perturbation.js';

export interface SearchOptions {
  synthesisChars: number;
  displayChars: number;
}

export interface LLMProvider {
  complete(model: string, prompt: string, maxTokens: number, systemPrompt?: string | null): Promise<LLMResult>;
  searchWeb(model: string, query: string, options?: SearchOptions): Promise<WebSearchResult>;
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

// Cap on evidence-driven perturbations within a recent-finding window. Keeps
// reactive triggers from devouring the perturbation budget when the engine
// is in a stuck/clustered state — probabilistic firing can still happen but
// the dice roll has the same odds as before, so creativity injection isn't
// pinched. Tuned conservatively: at most 2 reactive perturbations per 10
// findings, after which evidence triggers write a rate-limit step instead
// of spawning.
const EVIDENCE_TRIGGER_RATE_LIMIT_WINDOW = 10;
const EVIDENCE_TRIGGER_RATE_LIMIT_MAX = 2;

export function classify(s: string): 'question' | 'topic' {
  const t = s.trim();
  if (t.endsWith('?')) return 'question';
  if (/\b(what|how|why|when|where|who|which)\b/i.test(t)) return 'question';
  if (/^(is|are|does|do|can|should|will|would|has|have|was|were)\b/i.test(t)) return 'question';
  return 'topic';
}

/** Pick a domain agent role for the query — modeled on GPT-Researcher's
 *  auto_agent_instructions. Returns the role label + a system-prompt body
 *  used as a "voice floor" on answer-shaping LLM calls (synthesis, document,
 *  follow-up framing). Returns null on parse/network failure — callers should
 *  treat that as "no role priming" and proceed unchanged.
 *
 *  Records a session-scope step (label='pick role') automatically via the
 *  TrackedLLM wrapper, so the call is visible in the events log. */
export async function pickAgentRole(
  llm: TrackedLLM,
  sessionId: string,
  model: string,
  query: string,
): Promise<{ label: string; prompt: string } | null> {
  const instruction = `You are picking a domain expert agent for a research task.

Research task: "${query}"

Choose a single role — a 1–4 word title (e.g. "Finance Analyst", "Travel Researcher", "Climate Policy Researcher") — and write a one-sentence system prompt describing how that expert approaches research: their tone, the kinds of sources they prefer, what they emphasize.

Return ONLY a JSON object on a single line, no prose, no code fences:
{"label": "...", "prompt": "You are a ... You ..."}`;

  try {
    const result = await llm.complete(
      { session_id: sessionId, thread_id: null, label: 'pick role' },
      model,
      instruction,
      256,
    );
    const stripped = stripLLMFences(result.text).trim();
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(stripped.slice(start, end + 1)) as { label?: unknown; prompt?: unknown };
    if (typeof obj.label !== 'string' || typeof obj.prompt !== 'string') return null;
    const label = obj.label.trim().slice(0, 60);
    const prompt = obj.prompt.trim().slice(0, 800);
    if (!label || !prompt) return null;
    // Attach the picked role to the step's metadata so the events log shows
    // what was decided (label is the headline, prompt is on expansion).
    steps.updateStepMetadata(llm.sqlite, result.stepId, { decision: 'pick_role', role_label: label, role_prompt: prompt });
    return { label, prompt };
  } catch {
    return null;
  }
}

/** Classify a research prompt's structural shape. Mirrors `pickAgentRole`:
 *  one-shot LLM call at session creation, fire-and-forget, returns null on
 *  parse/network failure. The planner uses this to choose strategies
 *  (canon-first for survey/list/timeline; parity for comparison; etc.).
 *
 *  A prompt may have multiple shapes when mixed (e.g. "history of X and key
 *  artists" → timeline + list). Each detected shape gets a one-sentence
 *  completeness criterion the planner can check against.
 *
 *  Records a session-scope step (label='detect shape') automatically via
 *  the TrackedLLM wrapper. */
const VALID_SHAPES: ReadonlySet<QuestionShape> = new Set([
  'survey', 'timeline', 'list', 'dynamics', 'comparison', 'lookup', 'audit',
]);

export async function detectQuestionShape(
  llm: TrackedLLM,
  sessionId: string,
  model: string,
  query: string,
): Promise<ShapeAnalysis | null> {
  const instruction = `You are classifying the structural shape of a research question. Identify which of these shapes apply to the prompt:

- survey: "overview of X", "what is X", "introduce me to" — wants breadth + canonical examples
- timeline: "history of X", "evolution of", "how X emerged" — wants chronological events
- list: "key X", "examples of", "top N" — wants enumerated items with completeness
- dynamics: "how does X work", "why did X happen", "mechanics of" — wants causal narrative
- comparison: "X vs Y", "tradeoffs between" — wants axes with parity per side
- lookup: a single-fact query — one answer + source
- audit: "is X complete/true", "verify that X" — wants checklist + verification

A prompt may have multiple shapes when mixed (e.g. "history of EDM and key artists" → timeline + list). For each detected shape, write a one-sentence completeness criterion describing what "covered" looks like; be specific about counts/coverage where appropriate (e.g. "list at least 10 key artists with breakthrough tracks", "events for each year 1990–1999").

Return ONLY a JSON object on a single line, no prose, no code fences:
{"shapes": ["..."], "lenses": [{"shape": "...", "criterion": "..."}], "confidence": 0.0-1.0}

Prompt: "${query.replace(/"/g, '\\"')}"`;

  try {
    const result = await llm.complete(
      { session_id: sessionId, thread_id: null, label: 'detect shape' },
      model,
      instruction,
      400,
    );
    const stripped = stripLLMFences(result.text).trim();
    const start = stripped.indexOf('{');
    const end = stripped.lastIndexOf('}');
    if (start < 0 || end <= start) return null;
    const obj = JSON.parse(stripped.slice(start, end + 1)) as {
      shapes?: unknown; lenses?: unknown; confidence?: unknown;
    };
    if (!Array.isArray(obj.shapes) || !Array.isArray(obj.lenses)) return null;
    const shapes = obj.shapes
      .filter((s): s is QuestionShape => typeof s === 'string' && VALID_SHAPES.has(s as QuestionShape));
    if (shapes.length === 0) return null;
    const lenses = obj.lenses
      .filter((l): l is { shape: QuestionShape; criterion: string } =>
        typeof l === 'object' && l !== null
        && typeof (l as { shape?: unknown }).shape === 'string'
        && VALID_SHAPES.has((l as { shape: string }).shape as QuestionShape)
        && typeof (l as { criterion?: unknown }).criterion === 'string')
      .map(l => ({ shape: l.shape, criterion: l.criterion.trim().slice(0, 400) }));
    const confidence = typeof obj.confidence === 'number' && obj.confidence >= 0 && obj.confidence <= 1
      ? obj.confidence : 0.5;
    const analysis: ShapeAnalysis = { shapes, lenses, confidence };
    steps.updateStepMetadata(llm.sqlite, result.stepId, { decision: 'detect_shape', shapes, confidence });
    return analysis;
  } catch {
    return null;
  }
}

/** Enumerate canonical artifacts/people/events for a survey/list/timeline
 *  prompt. Mirrors `pickAgentRole` / `detectQuestionShape`: one-shot LLM call,
 *  fire-and-forget, returns null on parse failure.
 *
 *  Returned items become canon-slot threads (one per item) so the engine's
 *  default depth-first crawl is forced to cover the canon before converging.
 *  This addresses the dogfooded EDM failure mode — survey questions where
 *  the planner went deep on chart mechanics and missed Moby's Play,
 *  Underworld's Born Slippy, Daft Punk's Homework.
 *
 *  Records a session-scope step (label='enumerate canon') with the items
 *  list and target count in metadata, so the Events tab shows the choice. */
export interface CanonItem {
  item: string;
  context: string;
}

export async function enumerateCanon(
  llm: TrackedLLM,
  sessionId: string,
  model: string,
  prompt: string,
  shapeHint: string,
): Promise<CanonItem[] | null> {
  const instruction = `You are listing the canonical artifacts/people/events/eras a research prompt is known for. The downstream system will spawn one research thread per item to ensure the canon is covered before converging.

Constraints:
- Return 10–15 items. Fewer if the topic is genuinely narrow; more (up to 20) if it's broad.
- Each item must be a SPECIFIC name (e.g. "Moby — Play (1999)", "Daft Punk — Homework", "Detroit techno scene 1985–1995"), not a generic category.
- Items should span the full breadth of what an expert would consider canon for this prompt.
- For timelines: pick inflection points across the full date range.
- For lists/surveys: pick the most-referenced/most-influential examples first.
- Each item gets a one-sentence context explaining WHY it's canon (so downstream threads can scope correctly).

Return ONLY a JSON array on a single line, no prose, no code fences:
[{"item": "...", "context": "..."}]

Shape hint: ${shapeHint}
Prompt: "${prompt.replace(/"/g, '\\"')}"`;

  try {
    const result = await llm.complete(
      { session_id: sessionId, thread_id: null, label: 'enumerate canon' },
      model,
      instruction,
      2000,
    );
    const stripped = stripLLMFences(result.text).trim();
    const start = stripped.indexOf('[');
    const end = stripped.lastIndexOf(']');
    if (start < 0 || end <= start) return null;
    const arr = JSON.parse(stripped.slice(start, end + 1));
    if (!Array.isArray(arr)) return null;
    const items: CanonItem[] = arr
      .filter((x): x is { item: string; context: string } =>
        typeof x === 'object' && x !== null
        && typeof (x as { item?: unknown }).item === 'string'
        && typeof (x as { context?: unknown }).context === 'string'
        && (x as { item: string }).item.trim().length > 0)
      .map(x => ({ item: x.item.trim().slice(0, 200), context: x.context.trim().slice(0, 400) }));
    if (items.length === 0) return null;
    steps.updateStepMetadata(llm.sqlite, result.stepId, {
      decision: 'enumerate_canon',
      items,
      shape_hint: shapeHint,
      target_count: items.length,
    });
    return items;
  } catch {
    return null;
  }
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

export function calculateCost(model: string, promptTokens: number, completionTokens: number): number {
  // Provider responses sometimes carry dated SKU suffixes (e.g.
  // "deepseek/deepseek-v3.2-20251201"). Strip a trailing "-YYYYMMDD" so the
  // pricing table doesn't need to track every dated re-release.
  const pricing = MODEL_PRICING[model] ?? MODEL_PRICING[model.replace(/-\d{8}$/, '')];
  if (!pricing) return 0; // local/unknown models are free
  return (promptTokens * pricing.input + completionTokens * pricing.output) / 1_000_000;
}

/** Run async map with bounded concurrency. Order of `results` matches input. */
async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = cursor++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

export function isCovered(threadFindings: ResearchFinding[]): boolean {
  if (threadFindings.length < 3) return false;
  const avgConf = threadFindings.reduce((s, f) => s + f.confidence, 0) / threadFindings.length;
  const avgNovelty = threadFindings.reduce((s, f) => s + f.novelty, 0) / threadFindings.length;
  return avgConf > 0.65 && avgNovelty < 0.3;
}

/** Structured classification of provider/upstream errors.
 *  Drives telemetry (which kind of failure) and the isTransient gate (which
 *  kinds back off vs. exhaust). 402 stays in the transient group because the
 *  user tops up the balance and wants the thread to resume automatically. */
export type ErrorKind =
  | 'credit_exhausted'
  | 'rate_limit'
  | 'overload'
  | 'model_disabled'
  | 'transient_other'
  | 'permanent'
  | 'unknown';

// Which kinds trigger exponential backoff (retry_after) vs. exhaust the thread.
// Keep this aligned with the original isTransient string matcher: 402/429/529
// and explicit rate-limit text. Network timeouts / 5xx wrappers classify as
// `transient_other` for telemetry but exhaust (no backoff) — matches prior behavior.
const TRANSIENT_KINDS: ReadonlySet<ErrorKind> = new Set([
  'credit_exhausted', 'rate_limit', 'overload',
]);

export function classifyError(msg: string): ErrorKind {
  const m = msg.toLowerCase();

  if (m.includes('402') && /credit|afford|balance|insufficient/.test(m)) return 'credit_exhausted';
  if (m.includes('402')) return 'credit_exhausted';

  if (m.includes('429') || /rate[ _-]?limit/.test(m) || m.includes('too many requests')) return 'rate_limit';

  if (m.includes('529') || m.includes('503') || m.includes('overload')) return 'overload';

  if (m.includes('404') || /no endpoints|model.*(not found|unavailable|disabled|deprecated)|not a valid model/.test(m)) {
    return 'model_disabled';
  }

  if (m.includes('timeout') || m.includes('timed out') || m.includes('etimedout')
    || m.includes('econnreset') || m.includes('econnrefused')
    || m.includes('aborterror') || m.includes('fetch failed')
    || m.includes('502') || m.includes('504')) {
    return 'transient_other';
  }

  if (m.includes('401') || m.includes('403') || m.includes('unauthorized') || m.includes('forbidden')
    || m.includes('400') || m.includes('invalid_request')) {
    return 'permanent';
  }

  return 'unknown';
}

export function isTransientError(kind: ErrorKind): boolean {
  return TRANSIENT_KINDS.has(kind);
}

type TaskAction = 'broad_search' | 'targeted_lookup' | 'verification';

export class AnthropicProvider implements LLMProvider {
  private client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  async complete(model: string, prompt: string, maxTokens: number, systemPrompt?: string | null): Promise<LLMResult> {
    let response: Anthropic.Message;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        response = await this.client.messages.create({
          model,
          max_tokens: maxTokens,
          ...(systemPrompt ? { system: systemPrompt } : {}),
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
  private tracked: TrackedLLM;
  private maxIterations: number;
  private onIteration?: EngineOptions['onIteration'];
  private onError?: EngineOptions['onError'];
  private signal?: AbortSignal;

  constructor(opts: EngineOptions) {
    this.sqlite = opts.sqlite;
    this.provider = opts.provider ?? new AnthropicProvider(opts.apiKey!);
    this.tracked = new TrackedLLM(this.provider, this.sqlite);
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

        // Check budget — hard stop goes to 'halted' (distinct from user-initiated 'paused')
        const cost = sessions.getQueryCost(this.sqlite, sessionId);
        if (currentSession.config.budget_daily_usd && cost.today_cost >= currentSession.config.budget_daily_usd) {
          sessions.updateQuery(this.sqlite, sessionId, { status: 'halted' });
          break;
        }
        if (currentSession.config.budget_total_usd && cost.total_cost >= currentSession.config.budget_total_usd) {
          sessions.updateQuery(this.sqlite, sessionId, { status: 'halted' });
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

          // Regenerate every 3 iterations. Combined with updateDocument's
          // threshold being lowered to >=1 finding, this surfaces a document
          // inside the first few findings instead of making the user wait for 5
          // (the old cadence) or 30+ (the old threshold+cadence interaction).
          if (iterationCount % 3 === 0) {
            await this.updateSummary(sessionId);
            await this.updateDocument(sessionId);
          }

          // Apply any pending steering nudges and run the periodic lead review.
          // This path is reached by session (burst) jobs — the thread-job path
          // runs the same call from runThread. Attach to the just-completed
          // thread so the resulting step is visible in observability.
          await this.maybeRunLeadReview(sessionId, currentSession.config, thread.id);

          if (currentSession.config.min_delay_between_steps_ms > 0) {
            await new Promise(resolve => setTimeout(resolve, currentSession.config.min_delay_between_steps_ms));
          }
        } catch (error) {
          const err = error instanceof Error ? error : new Error(String(error));
          this.onError?.(err, thread);

          const kind = classifyError(err.message);
          steps.createStep(this.sqlite, {
            thread_id: thread.id,
            session_id: sessionId,
            model: currentSession.config.model,
            prompt_tokens: 0,
            completion_tokens: 0,
            cost_usd: 0,
            duration_ms: 0,
            error: err.message,
            error_kind: kind,
            label: 'iteration error',
          });

          const isRateLimit = isTransientError(kind);
          const allSteps = steps.listSteps(this.sqlite, sessionId, { threadId: thread.id });
          const priorErrors = allSteps.filter(s => s.error).length;

          if (isRateLimit) {
            let rateLimitStreak = 0;
            for (const s of allSteps) {  // DESC order — newest first
              if (s.error && isTransientError(classifyError(s.error))) { rateLimitStreak++; } else { break; }
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

    // Exhaustion detection — if the session is still 'active' but has no
    // queued or active threads left, mark it 'exhausted'. The loop has
    // already tried a perturbation pass; anything less than 'active' means a
    // budget halt / pause already ran and should not be overwritten.
    if (finalSession.status === 'active' && !this.signal?.aborted) {
      const remaining = threads.listThreads(this.sqlite, sessionId)
        .filter(t => t.status === 'queued' || t.status === 'active');
      if (remaining.length === 0) {
        sessions.updateQuery(this.sqlite, sessionId, { status: 'exhausted' });
      }
    }

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

    const existing = threads.getThread(this.sqlite, threadId);
    if (!existing) throw new Error(`Thread ${threadId} not found`);

    // Atomically claim queued → active. If the thread is already being processed
    // by another path (e.g. runIterations' slot loop) this returns null, and we
    // bail out to avoid running runIteration twice on the same thread.
    const thread = threads.tryClaimThread(this.sqlite, threadId);
    if (!thread) {
      console.log(`[engine] runThread skip ${threadId.slice(0, 8)}: not in queued state (status=${existing.status})`);
      return { finding: null, cost: 0 };
    }

    // Apply any pending plan modifications before running
    await this.applyPlanModifications(sessionId);

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

      const kind = classifyError(err.message);
      steps.createStep(this.sqlite, {
        thread_id: threadId,
        session_id: sessionId,
        model: session.config.model,
        prompt_tokens: 0,
        completion_tokens: 0,
        cost_usd: 0,
        duration_ms: 0,
        error: err.message,
        error_kind: kind,
        label: 'thread error',
      });

      const isRateLimit = isTransientError(kind);
      const allSteps = steps.listSteps(this.sqlite, sessionId, { threadId });
      const priorErrors = allSteps.filter(s => s.error).length;

      // Count consecutive transient errors from the most recent step backward
      // allSteps is ORDER BY created_at DESC — iterate newest-first
      let rateLimitStreak = 0;
      for (const s of allSteps) {
        if (s.error && isTransientError(classifyError(s.error))) {
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

    // Periodic summary/document — keep it fresh on early threads, then every
    // 3 exhausted threads. Cheap enough to regenerate frequently; avoids the
    // "no document visible at 30+ findings" complaint.
    const exhausted = threads.countExhaustedThreads(this.sqlite, sessionId);
    if (exhausted <= 3 || exhausted % 3 === 0) {
      await this.updateSummary(sessionId);
      await this.updateDocument(sessionId);
    }

    // Periodic lead review — check coverage & spawn a small batch of targeted
    // threads every N findings. Replaces per-finding gap-analysis by default.
    // Attach to the just-completed thread so the resulting step is visible.
    await this.maybeRunLeadReview(sessionId, session.config, thread.id);

    // Canon coverage check — count findings per canon-slot thread so the
    // user can see which slots have evidence and which are still empty.
    // Visible in the Events tab as a decision='coverage_check' step.
    this.runCoverageCheck(sessionId, thread.id);

    return result;
  }

  /** Counts findings per canon-slot thread and writes a coverage_check step.
   *  Cheap: pure SQL aggregate, no LLM call. Runs after every finding so the
   *  UI can render up-to-date coverage indicators. Public so tests can call
   *  it without driving a full engine iteration. */
  runCoverageCheck(sessionId: string, attachThreadId: string | null): void {
    const slotThreads = threads.listThreads(this.sqlite, sessionId)
      .filter(t => t.origin === 'canon_slot');
    if (slotThreads.length === 0) return;

    const slots = slotThreads.map(t => {
      const count = findings.countFindings(this.sqlite, sessionId, { thread_id: t.id });
      return {
        thread_id: t.id,
        item: t.short_query ?? t.query.slice(0, 80),
        finding_count: count,
        covered: count > 0,
      };
    });
    const coveredCount = slots.filter(s => s.covered).length;

    steps.createStep(this.sqlite, {
      thread_id: attachThreadId,
      session_id: sessionId,
      model: 'system',
      provider: 'system',
      prompt_tokens: 0,
      completion_tokens: 0,
      cost_usd: 0,
      duration_ms: 0,
      label: 'canon coverage',
      metadata: {
        decision: 'coverage_check',
        slots,
        covered_count: coveredCount,
        total_count: slots.length,
      },
    });
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
        label: 'empty search',
      });
      return { finding: null, cost: 0 };
    }

    // Step 3: Synthesize finding from results
    let synthesisResult = await this.synthesizeFinding(thread, searchResults, sessionId, config);
    if (!synthesisResult) return { finding: null, cost: 0 };

    // Step 4: Check for duplicates
    const isDuplicate = await this.checkDuplicate(sessionId, thread.id, synthesisResult.summary, config);
    if (isDuplicate) {
      synthesisResult.novelty = Math.min(synthesisResult.novelty, 0.2);
    }

    // Step 4b: Detect gaps and evaluate/score follow-up questions
    const { accepted: followUpQuestions, analysis: followUpAnalysis } = await this.evaluateFollowUps(
      thread, searchResults, synthesisResult, config
    );
    const lastFollowUpStep = steps.getLatestStepByLabel(this.sqlite, thread.id, 'evaluate follow-ups');
    if (lastFollowUpStep) {
      // Roll up which similarity methods resolved each pair so the events view
      // can show the jaccard / embedding / llm split.
      const methodCounts: Record<string, number> = { jaccard: 0, embedding: 0, llm: 0 };
      for (const c of followUpAnalysis.candidates) {
        methodCounts[c.similarity_method] = (methodCounts[c.similarity_method] ?? 0) + 1;
      }
      steps.updateStepMetadata(this.sqlite, lastFollowUpStep.id, {
        decision: 'follow_up_eval',
        accepted_count: followUpQuestions.length,
        rejected_count: followUpAnalysis.candidates.filter((c: { accepted: boolean }) => !c.accepted).length,
        retry_count: followUpAnalysis.retry_count,
        similarity_threshold: followUpAnalysis.similarity_threshold,
        method_counts: methodCounts,
        candidates: followUpAnalysis.candidates.map((c: {
          text: string; accepted: boolean; rejection_reason: string | null;
          dedup_similarity: number; rank_score: number; similarity_method: string;
        }) => ({
          text: c.text.slice(0, 120),
          accepted: c.accepted,
          reason: c.rejection_reason,
          sim: Math.round(c.dedup_similarity * 100) / 100,
          rank: Math.round(c.rank_score * 100) / 100,
          method: c.similarity_method,
        })),
      });
    }

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

    // Record perturbation outcome: a finding emerged from a perturbation
    // thread. Updates research_perturbation_state so future selectStrategy
    // calls can boost strategies that produced novel/confident findings.
    if (thread.origin === 'perturbation' && thread.perturbation_strategy) {
      perturbationState.recordOutcome(
        this.sqlite,
        sessionId,
        thread.perturbation_strategy,
        finding.novelty,
        finding.confidence,
      );
    }

    // Step 5a: Register source URLs in the extraction queue so the worker
    // can fetch full text independently of the synthesis path.
    if (synthesisResult.sourceUrlMeta && synthesisResult.sourceUrlMeta.length > 0) {
      try {
        sources.registerSources(this.sqlite, sessionId, synthesisResult.sourceUrlMeta, 'pending');
      } catch (err) {
        console.warn(`[sources] register failed for finding ${finding.id}:`, err);
      }
    }

    // Step 5b: Extract concepts from the finding — non-blocking. The doc
    // generator runs every 3 iterations and tolerates lag; backfillConcepts
    // catches anything missed. Awaiting here was 24% of total LLM time.
    this.extractConceptsForFinding(finding, thread, config).catch(err => {
      console.warn(`[concepts] extraction failed for ${finding.id}:`, err);
    });

    // Step 5b: Spawn verify thread for low-confidence findings (non-recursive).
    // Skip if the verify child would land at/past max_depth — dead inventory.
    if (synthesisResult.confidence < 0.4 && thread.origin !== 'verify') {
      const childDepth = thread.depth + 1;
      if (childDepth < thread.max_depth) {
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
          status: 'queued',
        });
        this.summarizeThreadAsync(vThread.id, verifyQuery, sessionId, config);
      }
    }

    // Step 6: Spawn child threads from accepted follow-up questions (skip if covered).
    // Always create them so the graph is complete, but defer those that exceed
    // max_depth so they don't run until (if ever) the depth limit is raised.
    const updatedFindings = findings.listFindings(this.sqlite, thread.session_id, { threadId: thread.id });
    if (!isCovered(updatedFindings)) {
      const maxTotal = config.max_total_threads ?? 200;
      const totalNow = threads.countAllThreads(this.sqlite, sessionId);
      if (maxTotal > 0 && totalNow >= maxTotal) {
        console.log(`[follow_up] skip all — total threads ${totalNow} >= max_total_threads ${maxTotal}`);
      } else {
        const session = sessions.getQuery(this.sqlite, sessionId)!;
        const seedQuery = session.prompt;
        const tc = config.topic_coherence;
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
          // Topic coherence: per-hop similarity gate (how related is this to the parent thread?)
          const hopSim = jaccardSimilarity(question, thread.query);
          if (tc && tc.hop_similarity_min > 0 && hopSim < tc.hop_similarity_min) {
            console.log(`[follow_up] skip "${question}" — hop_sim=${hopSim.toFixed(3)} < ${tc.hop_similarity_min}`);
            continue;
          }
          // Topic coherence: seed similarity gate (how related is this to the original topic?)
          const seedSim = jaccardSimilarity(question, seedQuery);
          if (tc && tc.seed_similarity_min > 0 && seedSim < tc.seed_similarity_min) {
            console.log(`[follow_up] skip "${question}" — seed_sim=${seedSim.toFixed(3)} < ${tc.seed_similarity_min}`);
            continue;
          }
          // Re-check total cap before each spawn (other concurrent threads may have spawned)
          if (maxTotal > 0 && threads.countAllThreads(this.sqlite, sessionId) >= maxTotal) {
            console.log(`[follow_up] skip remaining — hit max_total_threads ${maxTotal}`);
            break;
          }
          const childDepth = thread.depth + 1;
          // Skip creation if this child would land at or past max_depth — it
          // would only sit as 'deferred' inventory and never run.
          if (childDepth >= thread.max_depth) {
            console.log(`[follow_up] skip "${question.slice(0, 60)}" — would be deferred at depth ${childDepth} ≥ max_depth ${thread.max_depth}`);
            continue;
          }
          console.log(`[follow_up] childDepth=${childDepth} max_depth=${thread.max_depth} seed_sim=${seedSim.toFixed(3)} hop_sim=${hopSim.toFixed(3)} → queued`);
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
            seed_similarity: seedSim,
            status: 'queued',
          });
          this.summarizeThreadAsync(fuThread.id, question, sessionId, config);
        }
      }
    }

    // Step 7: Per-finding gap analysis (legacy mode).
    // Default is 'periodic' — see maybeRunLeadReview() called from runThread().
    if (config.gap_analysis?.enabled && (config.gap_analysis.mode ?? 'periodic') === 'per_finding') {
      const maxTotal = config.max_total_threads ?? 200;
      const totalNow = threads.countAllThreads(this.sqlite, sessionId);
      if (maxTotal > 0 && totalNow >= maxTotal) {
        console.log(`[gap_analysis] skip all — total threads ${totalNow} >= max_total_threads ${maxTotal}`);
      } else {
        const gapQueries = await this.identifyGaps(thread, searchResults, synthesisResult, config);
        for (const query of gapQueries) {
          if (maxTotal > 0 && threads.countAllThreads(this.sqlite, sessionId) >= maxTotal) {
            console.log(`[gap_analysis] skip remaining — hit max_total_threads ${maxTotal}`);
            break;
          }
          const gapThread = threads.createThread(this.sqlite, {
            session_id: sessionId,
            query,
            short_query: placeholderShortQuery(query),
            node_type: 'question',
            origin: 'gap_analysis',
            parent_thread_id: thread.id,
            spawned_from_finding_id: finding.id,
            priority: Math.min(1.0, (thread.priority ?? 0.5) + 0.15),
            depth: thread.depth,
            max_depth: thread.max_depth,
            status: 'queued',
          });
          this.summarizeThreadAsync(gapThread.id, query, sessionId, config);
        }
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
      'formulate'
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
      if (result.stepId) steps.updateStepMetadata(this.sqlite, result.stepId, {
        decision: 'formulate_queries',
        queries: deduped,
        total_candidates: candidates.length,
        skipped_duplicates: candidates.length - deduped.length,
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
        const result = await this.provider.searchWeb(config.model, query, {
          synthesisChars: config.snippet_synthesis_chars,
          displayChars: config.snippet_display_chars,
        });
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
          label: 'web search',
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
          error_kind: classifyError(err.message),
          label: 'web search (failed)',
        });
        return null;
      }
    }));

    return results.filter((r): r is { query: string; results: string; sourceTexts: string[]; sourceUrls: string[]; sourceUrlMeta: Array<{ url: string; title: string; snippet: string }> } => r !== null);
  }

  /** Periodic lead review — orchestrator-style pass that looks at the session's
   *  compressed corpus (summary + recent finding summaries + open threads) and
   *  decides whether to spawn a small batch of targeted gap queries. Runs on a
   *  cadence instead of per-finding to avoid combinatorial thread explosion. */
  private async maybeRunLeadReview(sessionId: string, config: SessionConfig, attachThreadId: string | null = null): Promise<void> {
    const log = (msg: string) => {
      try { require('fs').appendFileSync('/tmp/leader-debug.log', `${new Date().toISOString()} ${msg}\n`); } catch {}
    };
    log(`entered: session=${sessionId.slice(0,8)} enabled=${config.gap_analysis?.enabled} mode=${config.gap_analysis?.mode ?? 'periodic'} attach=${attachThreadId?.slice(0,8)}`);
    if (!config.gap_analysis?.enabled) { log('skip: not enabled'); return; }
    if ((config.gap_analysis.mode ?? 'periodic') !== 'periodic') { log('skip: mode not periodic'); return; }

    const cadence = Math.max(1, config.gap_analysis.every_n_findings ?? 10);
    const findingCount = findings.countFindings(this.sqlite, sessionId);
    const unappliedNotes = steering.listUnappliedSteeringNotes(this.sqlite, sessionId);
    const dueByCadence = findingCount > 0 && findingCount % cadence === 0;
    log(`cadence=${cadence} findings=${findingCount} unapplied=${unappliedNotes.length} dueByCadence=${dueByCadence}`);
    // Also run early if the user just dropped a steering note — don't make them
    // wait 10 findings for their nudge to land.
    if (!dueByCadence && unappliedNotes.length === 0) { log('skip: not due and no notes'); return; }
    log(`proceeding to LLM call (attachThreadId=${attachThreadId?.slice(0,8)})`);

    const maxTotal = config.max_total_threads ?? 200;
    const totalNow = threads.countAllThreads(this.sqlite, sessionId);

    const session = sessions.getQuery(this.sqlite, sessionId);
    if (!session) return;

    const recentFindings = findings.listFindings(this.sqlite, sessionId, { limit: 12 });
    if (recentFindings.length === 0 && unappliedNotes.length === 0) return;

    // Include both queued/active threads AND exhausted ones — the leader can
    // prune any of them. Sort stable by created_at so thread_ids are referable.
    const candidateThreads = threads.listThreads(this.sqlite, sessionId)
      .filter(t => t.status === 'queued' || t.status === 'active' || t.status === 'exhausted')
      .slice(0, 40);

    const maxSpawn = Math.max(1, config.gap_analysis.max_gap_searches ?? 2);
    const roomForSpawn = Math.max(0, maxTotal > 0 ? maxTotal - totalNow : maxSpawn);
    const effectiveMaxSpawn = Math.min(maxSpawn, roomForSpawn);

    const notesBlock = unappliedNotes.length > 0
      ? `\nNew steering notes from the user (unapplied — act on these NOW):\n${unappliedNotes.map(n => `- ${n.text}`).join('\n')}`
      : '';

    const prompt = `You are the lead researcher for this session. Your job is to keep the research on-track for what the user actually wants, not to chase every interesting tangent.

Session prompt: "${session.prompt}"${notesBlock}

Recent findings (most recent first):
${recentFindings.map((f, i) => `${i + 1}. ${f.summary}`).join('\n')}

Open / recent threads (id → query, status). You may prune/boost/deprioritize any of these by id:
${candidateThreads.map(t => `- ${t.id} [${t.status}]: ${t.query}`).join('\n')}

Decide three things:
1. Are any threads DRIFTING from the intent/shape? List their ids to prune. Be willing to prune — tangents waste budget.
2. Are any threads CORE to the intent but low-priority? List their ids to boost.
3. Are there specific gaps that would materially improve the final answer? Propose AT MOST ${effectiveMaxSpawn} new queries.

Respond with JSON only:
{
  "reason": string,
  "prune_thread_ids": string[],
  "boost_thread_ids": string[],
  "deprioritize_thread_ids": string[],
  "gap_queries": string[]
}

Rules:
- Only use thread ids that appear in the list above.
- gap_queries: at most ${effectiveMaxSpawn} entries. Return [] if coverage is adequate.
- If the user's intent is a practical/list-style request, favor pruning academic/historical tangents.`;

    const result = await this.callLLM(
      config.model, prompt, sessionId, attachThreadId, config, 'lead review'
    );

    let pruneIds: string[] = [];
    let boostIds: string[] = [];
    let deprioritizeIds: string[] = [];
    let gapQueries: string[] = [];
    let reason = '';
    try {
      const parsed = JSON.parse(stripLLMFences(result.text));
      if (Array.isArray(parsed.prune_thread_ids)) pruneIds = parsed.prune_thread_ids.filter((s: unknown) => typeof s === 'string');
      if (Array.isArray(parsed.boost_thread_ids)) boostIds = parsed.boost_thread_ids.filter((s: unknown) => typeof s === 'string');
      if (Array.isArray(parsed.deprioritize_thread_ids)) deprioritizeIds = parsed.deprioritize_thread_ids.filter((s: unknown) => typeof s === 'string');
      if (Array.isArray(parsed.gap_queries)) gapQueries = parsed.gap_queries.slice(0, effectiveMaxSpawn);
      if (typeof parsed.reason === 'string') reason = parsed.reason;
    } catch (err) {
      console.warn(`[lead_review] JSON parse failed for session ${sessionId.slice(0, 8)} — notes stay unapplied for retry. raw[0:200]: ${result.text?.slice(0, 200)}`);
      if (result.stepId) steps.updateStepMetadata(this.sqlite, result.stepId, {
        decision: 'lead_review',
        parse_error: err instanceof Error ? err.message : String(err),
        raw_prefix: result.text?.slice(0, 500) ?? '',
        unapplied_notes: unappliedNotes.length,
      });
      return;
    }

    // Constrain plan-mod targets to threads we actually showed the model.
    const validIds = new Set(candidateThreads.map(t => t.id));
    pruneIds = pruneIds.filter(id => validIds.has(id));
    boostIds = boostIds.filter(id => validIds.has(id));
    deprioritizeIds = deprioritizeIds.filter(id => validIds.has(id));

    // Record step metadata before side effects so the decision is visible even if later ops fail.
    if (result.stepId) steps.updateStepMetadata(this.sqlite, result.stepId, {
      decision: 'lead_review',
      has_gaps: gapQueries.length > 0,
      gap_count: gapQueries.length,
      gap_max: effectiveMaxSpawn,
      gap_queries: gapQueries,
      prune_count: pruneIds.length,
      boost_count: boostIds.length,
      deprioritize_count: deprioritizeIds.length,
      unapplied_notes: unappliedNotes.length,
      finding_count: findingCount,
      cadence,
      reason,
    });

    // Emit plan modifications. applyPlanModifications() runs on the next iteration
    // boundary and handles status transitions; we use source 'lead_review' so UI
    // can distinguish user-driven vs. leader-driven mods.
    const latestPlan = plans.getLatestPlan(this.sqlite, sessionId);
    if (latestPlan) {
      for (const tid of pruneIds) {
        plans.addPlanModification(this.sqlite, {
          plan_id: latestPlan.id, action: 'veto',
          target_thread_id: tid, source: 'lead_review', payload: reason.slice(0, 500),
        });
      }
      for (const tid of boostIds) {
        plans.addPlanModification(this.sqlite, {
          plan_id: latestPlan.id, action: 'boost',
          target_thread_id: tid, source: 'lead_review', payload: reason.slice(0, 500),
        });
      }
      for (const tid of deprioritizeIds) {
        plans.addPlanModification(this.sqlite, {
          plan_id: latestPlan.id, action: 'deprioritize',
          target_thread_id: tid, source: 'lead_review', payload: reason.slice(0, 500),
        });
      }
    }

    // Spawn gap queries.
    if (gapQueries.length > 0) {
      const existingQueries = new Set(
        threads.listThreads(this.sqlite, sessionId).map(t => t.query.toLowerCase().trim())
      );
      for (const query of gapQueries) {
        if (typeof query !== 'string' || query.trim().length < 10) continue;
        if (existingQueries.has(query.toLowerCase().trim())) continue;
        if (maxTotal > 0 && threads.countAllThreads(this.sqlite, sessionId) >= maxTotal) {
          console.log(`[lead_review] skip remaining — hit max_total_threads ${maxTotal}`);
          break;
        }
        const t = threads.createThread(this.sqlite, {
          session_id: sessionId,
          query,
          short_query: placeholderShortQuery(query),
          node_type: 'question',
          origin: 'lead_review',
          priority: 0.75,
          depth: 0,
          max_depth: config.max_thread_depth ?? 2,
          status: 'queued',
        });
        this.summarizeThreadAsync(t.id, query, sessionId, config);
      }
    }

    // Mark notes applied so the next tick doesn't re-fire on them.
    if (unappliedNotes.length > 0) {
      steering.markSteeringNotesApplied(this.sqlite, unappliedNotes.map(n => n.id));
    }
  }

  private async identifyGaps(
    thread: ResearchThread,
    searchResults: Array<{ query: string; results: string; sourceTexts: string[]; sourceUrls: string[] }>,
    finding: { content: string; summary: string },
    config: SessionConfig
  ): Promise<string[]> {
    if (!config.gap_analysis?.enabled) return [];

    const result = await this.callLLM(
      config.model,
      `You are evaluating a research finding for completeness.

Research question: "${thread.query}"

Draft finding:
${finding.content}

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
      if (result.stepId) steps.updateStepMetadata(this.sqlite, result.stepId, {
        decision: 'gap_analysis', has_gaps: gapQueries.length > 0,
        gap_count: gapQueries.length, gap_max: config.gap_analysis.max_gap_searches ?? 2, gap_queries: gapQueries
      });
    } catch {
      return [];
    }

    return gapQueries;
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
      if (result.stepId) steps.updateStepMetadata(this.sqlite, result.stepId, {
        decision: 'synthesis',
        confidence: parsed.confidence ?? 0.5,
        novelty: parsed.novelty ?? 0.5,
        actionability: parsed.actionability ?? 0.5,
        tags: parsed.tags ?? [],
        summary: parsed.summary ?? '',
        content_preview: (parsed.content ?? '').slice(0, 400),
      });
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
        thread.session_id,
        thread.id,
        config,
        'dedup judge',
        { bypassRole: true, fast: true },
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
          dedup_similarity: 1.0,
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
        // Short-circuit: once we know it's decisively above threshold, no
        // need to scan the rest. Saves O(N) jaccards (and any LLM judges they'd trigger).
        if (maxSimilarity >= threshold + 0.10) break;
      }

      const accepted = maxSimilarity < threshold;
      const rank_score = 0.40 * quality_score + 0.30 * distance_from_parent + 0.30 * (1 - maxSimilarity);

      const candidate: FollowUpCandidate = {
        text: question,
        quality_score,
        dedup_similarity: maxSimilarity,
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

  private async checkDuplicate(sessionId: string, threadId: string, newSummary: string, config: SessionConfig): Promise<boolean> {
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
      threadId,
      config,
      'dedup check',
      { bypassRole: true, fast: true },
    );

    const isDuplicate = result.text.trim().toLowerCase() === 'true';
    if (result.stepId) steps.updateStepMetadata(this.sqlite, result.stepId, {
      decision: 'dedup', is_duplicate: isDuplicate, existing_count: existing.length,
      new_summary: newSummary.slice(0, 120),
      compared_to: existing.slice(0, 5).map(f => f.summary.slice(0, 100)),
    });
    return isDuplicate;
  }

  private async maybePerturbate(
    sessionId: string,
    thread: ResearchThread,
    config: SessionConfig
  ): Promise<void> {
    // Evidence-driven triggers fire FIRST. If any signal in the session state
    // says we should perturb (regardless of dice), force one — but rate-limit
    // so reactive triggers don't burn the entire perturbation budget. Falls
    // through to probabilistic firing when no evidence trigger fires; the
    // dice roll preserves baseline creativity injection.
    const evidenceTrigger = this.detectEvidenceTrigger(sessionId, config);
    if (evidenceTrigger) {
      const recentCount = this.recentPerturbationCount(sessionId);
      if (recentCount >= EVIDENCE_TRIGGER_RATE_LIMIT_MAX) {
        steps.createStep(this.sqlite, {
          thread_id: null,
          session_id: sessionId,
          model: 'system',
          provider: 'system',
          prompt_tokens: 0,
          completion_tokens: 0,
          cost_usd: 0,
          duration_ms: 0,
          label: 'perturbation rate-limited',
          metadata: {
            decision: 'perturbation_rate_limited',
            trigger: evidenceTrigger.trigger,
            reason: 'recent perturbation count exceeds rate limit',
            recent_perturbations: recentCount,
            window: EVIDENCE_TRIGGER_RATE_LIMIT_WINDOW,
          },
        });
        return;
      }
      await this.spawnPerturbationThreads(sessionId, config, true, evidenceTrigger.trigger, evidenceTrigger.signal);
      return;
    }

    // Depth-scaled probability: decreases at depth so shallow threads explore more freely
    // than deep threads that have already wandered from the seed.
    const depthFactor = config.max_thread_depth > 0 ? 1 - (thread.depth / config.max_thread_depth) * 0.5 : 1;
    const p = config.p_serendipity * depthFactor;
    if (Math.random() > p) return;

    await this.spawnPerturbationThreads(sessionId, config, false, 'probabilistic');
  }

  /** Inspects the session state for an evidence-based reason to perturb.
   *  Returns the first trigger that fires (in priority order: stuck_novelty,
   *  cluster, coverage_met) along with the signal values for visibility, or
   *  null when no trigger applies. Pure read — no side effects. Public so
   *  tests can drive it without orchestrating a full engine iteration. */
  detectEvidenceTrigger(
    sessionId: string,
    config: SessionConfig
  ): { trigger: PerturbationTrigger; signal: Record<string, unknown> } | null {
    // Stuck-novelty: rolling-avg novelty over the last `diminishing_returns_window`
    // findings is below `diminishing_returns_threshold`. Catches the case where
    // findings have stopped saying anything new.
    const window = config.diminishing_returns_window ?? 0;
    const noveltyThreshold = config.diminishing_returns_threshold ?? 0;
    if (window > 0 && noveltyThreshold > 0) {
      const recent = findings.getRecentFindings(this.sqlite, sessionId, window);
      if (recent.length >= window) {
        const avgNovelty = recent.reduce((s, f) => s + f.novelty, 0) / recent.length;
        if (avgNovelty < noveltyThreshold) {
          return {
            trigger: 'stuck_novelty',
            signal: { rolling_avg_novelty: avgNovelty, threshold: noveltyThreshold, window },
          };
        }
      }
    }

    // Cluster: last N findings share a dominant tag (>50% of their tag votes).
    // Uses forced_diversity_threshold from PerturbationConfig as the window
    // size — same knob the dormant in-memory tracker used. Bias toward
    // strategies that diverge from the cluster is left to the selector;
    // we just signal "force a perturbation".
    const clusterWindow = config.perturbation?.forced_diversity_threshold ?? 0;
    if (clusterWindow > 0) {
      const recent = findings.getRecentFindings(this.sqlite, sessionId, clusterWindow);
      if (recent.length >= clusterWindow) {
        const tagCounts = new Map<string, number>();
        let totalTags = 0;
        for (const f of recent) {
          for (const tag of f.tags) {
            tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
            totalTags++;
          }
        }
        if (totalTags > 0) {
          let dominantTag = '';
          let dominantCount = 0;
          for (const [tag, count] of tagCounts) {
            if (count > dominantCount) { dominantTag = tag; dominantCount = count; }
          }
          const ratio = dominantCount / totalTags;
          if (ratio > 0.5) {
            return {
              trigger: 'cluster',
              signal: { dominant_tag: dominantTag, dominant_ratio: ratio },
            };
          }
        }
      }
    }

    // Coverage-met: canon-slot coverage criterion is satisfied. Spawned
    // perturbations after coverage gives the run a creative-angle pass before
    // converging. Skip if no canon slots exist (non-survey shape).
    const canonSlots = threads.listThreads(this.sqlite, sessionId)
      .filter(t => t.origin === 'canon_slot');
    if (canonSlots.length > 0) {
      const covered = canonSlots.filter(t =>
        findings.countFindings(this.sqlite, sessionId, { thread_id: t.id }) > 0
      ).length;
      if (covered === canonSlots.length) {
        // Only fire once per session — check if a coverage_met perturbation
        // step already exists. Otherwise we'd retrigger after every finding
        // once coverage is hit.
        const existing = this.sqlite.prepare(
          `SELECT 1 FROM research_steps WHERE session_id = ? AND label = 'select perturbation'
           AND metadata LIKE '%"trigger":"coverage_met"%' LIMIT 1`
        ).get(sessionId);
        if (!existing) {
          return {
            trigger: 'coverage_met',
            signal: { canon_covered: covered, canon_total: canonSlots.length },
          };
        }
      }
    }

    return null;
  }

  /** Counts perturbation threads spawned since the oldest of the last
   *  EVIDENCE_TRIGGER_RATE_LIMIT_WINDOW findings. Used to bound reactive
   *  triggers so they don't burn the perturbation budget — probabilistic
   *  firing isn't subject to this cap. Returns 0 when there are no findings
   *  yet (rate limit is only meaningful after the first findings land).
   *  Public so tests can verify the rate-limit math directly. */
  recentPerturbationCount(sessionId: string): number {
    const window = EVIDENCE_TRIGGER_RATE_LIMIT_WINDOW;
    const recent = findings.getRecentFindings(this.sqlite, sessionId, window);
    if (recent.length === 0) return 0;
    const oldestTime = recent[recent.length - 1].created_at;
    return (this.sqlite.prepare(
      `SELECT COUNT(*) as c FROM research_threads
       WHERE session_id = ? AND origin = 'perturbation' AND created_at >= ?`
    ).get(sessionId, oldestTime) as { c: number }).c;
  }

  private async spawnPerturbationThreads(
    sessionId: string,
    config: SessionConfig,
    forced: boolean,
    trigger: PerturbationTrigger = 'probabilistic',
    signal?: Record<string, unknown>
  ): Promise<void> {
    // Respect total thread cap
    const maxTotal = config.max_total_threads ?? 200;
    if (maxTotal > 0 && threads.countAllThreads(this.sqlite, sessionId) >= maxTotal) {
      console.log(`[perturbation] skip — hit max_total_threads ${maxTotal}`);
      return;
    }

    // Load persistent state (counters survive engine restarts) and pick a
    // strategy via perturbation.ts/selectStrategyWithDetails — same selector
    // logic that's covered by phase2.test.ts, but the WithDetails variant
    // returns the candidate weights and cooldown set so the engine can write
    // them into a select_perturbation step (visible in the Events tab).
    const pState = perturbationState.loadPerturbationState(this.sqlite, sessionId, config.perturbation);
    const selection = selectStrategyWithDetails(config.perturbation, pState);
    const strategy = selection.strategy;

    // Audit step BEFORE we generate the query. This lands even if the
    // tangent fails generation or rejection downstream — the user still
    // sees the strategy choice and what drove it.
    steps.createStep(this.sqlite, {
      thread_id: null,
      session_id: sessionId,
      model: 'system',
      provider: 'system',
      prompt_tokens: 0,
      completion_tokens: 0,
      cost_usd: 0,
      duration_ms: 0,
      label: 'select perturbation',
      metadata: {
        decision: 'select_perturbation',
        strategy,
        trigger,
        candidates: selection.candidates,
        cooldown_excluded: selection.cooldown_excluded,
        ...(signal ? { signal } : {}),
      },
    });

    // Get context for perturbation
    const session = sessions.getQuery(this.sqlite, sessionId)!;
    const recentFindings = findings.getRecentFindings(this.sqlite, sessionId, 10);
    const context = recentFindings.length > 0
      ? recentFindings.map(f => f.summary).join('\n')
      : session.prompt;

    let tangentQuery = await this.generatePerturbation(strategy, session.prompt, context, config);
    if (!tangentQuery) return;

    // Coherence floor: tangent must retain *some* connection to the seed.
    // Tuned loose so creative angles still pass; the goal is catching
    // pure-tangent drift (e.g. a "By 2040..." finding from a non-temporal
    // strategy that wandered too far). Regenerate once, then reject.
    const floor = config.perturbation_coherence_floor ?? 0;
    if (floor > 0) {
      let sim = jaccardSimilarity(tangentQuery, session.prompt);
      if (sim < floor) {
        const retry = await this.generatePerturbation(strategy, session.prompt, context, config);
        if (retry && retry !== tangentQuery) {
          const retrySim = jaccardSimilarity(retry, session.prompt);
          if (retrySim >= floor) {
            tangentQuery = retry;
            sim = retrySim;
          } else {
            sim = retrySim;
          }
        }
        if (sim < floor) {
          // Both attempts off-topic — record the rejection and bail. Visible
          // in the Events tab so the user knows we wanted to perturb but
          // the candidate query was too tangential.
          steps.createStep(this.sqlite, {
            thread_id: null,
            session_id: sessionId,
            model: config.model_fast ?? config.model,
            prompt_tokens: 0,
            completion_tokens: 0,
            cost_usd: 0,
            duration_ms: 0,
            label: 'perturbation rejected',
            metadata: {
              decision: 'perturbation_rejected',
              strategy,
              trigger,
              attempted_query: tangentQuery,
              retry_query: retry ?? null,
              similarity: sim,
              floor,
              reason: 'below coherence floor',
            },
          });
          console.log(`[perturbation] rejected — strategy=${strategy} sim=${sim.toFixed(3)} < floor=${floor}`);
          return;
        }
      }
    }

    // Find a parent — use the most recent active/exhausted thread with findings
    const allThreads = threads.listThreads(this.sqlite, sessionId);
    const parentThread = allThreads.find(t => t.status !== 'pruned') ?? allThreads[0];

    const pertDepth = (parentThread?.depth ?? 0) + 1;
    console.log(`[perturbation] pertDepth=${pertDepth} max_thread_depth=${config.max_thread_depth} gate=${pertDepth >= config.max_thread_depth} → ${pertDepth >= config.max_thread_depth ? 'deferred' : 'queued'}`);

    // Persist attempt before spawning the thread. recordOutcome (called when
    // a finding emerges) reads the row to compute fruitfulness.
    perturbationState.recordAttempt(this.sqlite, sessionId, strategy);

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
    // Single source of truth for prompts: perturbation.ts/generatePerturbationPrompt
    // covers all 21 strategies and includes the backwards-only temporal_shift
    // constraint. The engine previously had its own 4-strategy dictionary that
    // only ever fired analogical/contrarian/failure_post_mortem/temporal_shift.
    const prompt = generatePerturbationPrompt(strategy, seedQuery, context);

    const result = await this.callLLM(
      config.model,
      prompt,
      '',
      '',
      config,
      'perturbation query',
      { bypassRole: true, fast: true },
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

Research topic: "${session.prompt}"

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
    const appliedIds: string[] = [];
    for (const mod of mods) {
      const targetThread = mod.target_thread_id
        ? threads.getThread(this.sqlite, mod.target_thread_id)
        : latestPlan.items.find(i => i.rank === mod.target_item_rank)
          ? threads.getThread(this.sqlite, latestPlan.items.find(i => i.rank === mod.target_item_rank)!.thread_id)
          : null;

      if (!targetThread) { appliedIds.push(mod.id); continue; }

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
      appliedIds.push(mod.id);
    }

    if (appliedIds.length > 0) {
      plans.markModificationsApplied(this.sqlite, appliedIds);
      plans.updatePlanStatus(this.sqlite, latestPlan.id, 'modified');
    }
  }

  /** Extract concepts from a finding, upsert them into the session's knowledge graph,
   *  and attach them (and any relations the LLM returns) to the finding. */
  private async extractConceptsForFinding(
    finding: ResearchFinding,
    thread: ResearchThread,
    config: SessionConfig,
    extraSources: Array<{ url: string; text: string }> = [],
  ): Promise<void> {
    const sessionId = finding.session_id;
    const extraBlock = extraSources.length > 0
      ? `\n\nFull source text (newly extracted — prefer these for grounding concrete key_facts):\n${extraSources
          .map(s => `--- ${s.url} ---\n${s.text.slice(0, 4000)}`)
          .join('\n\n')}`
      : '';
    const prompt = `Extract the distinct concepts this finding is about. A concept is a noun phrase that names a thing, idea, practice, organism, place, person, technique, or principle — something that could appear as a section title in an encyclopedia.

Return ONLY JSON of the form:
{
  "concepts": [
    { "name": "Canonical Name", "aliases": ["alt name", "abbrev"], "summary": "one-sentence definition grounded in this finding", "key_facts": ["concrete fact 1", "concrete fact 2"] }
  ],
  "relations": [
    { "from": "Canonical Name", "to": "Other Canonical Name", "relation": "short lowercase verb phrase (uses, contrasts_with, depends_on, part_of, example_of)" }
  ]
}

Guidelines:
- 1 to 5 concepts. Pick the most load-bearing nouns only — not every mentioned term.
- Concept names: title-case, no quotes, no trailing punctuation. Prefer the most canonical form (e.g. "Mycorrhizal Fungi" not "mycorrhizal fungi partners").
- summary: one sentence, ≤ 160 chars, based on this finding alone.
- key_facts: 0–4 short declarative sentences. Each must be grounded in the finding, not general knowledge.
- relations: optional; only if the finding itself asserts the relation. Skip otherwise.
- Do NOT invent concepts that aren't present. Do NOT include the research session title unless the finding explicitly elaborates on it.

Thread context: "${thread.query}"

Finding:
${finding.content}${extraBlock}

Return JSON only, no preamble.`;

    const result = await this.callLLM(
      config.model,
      prompt,
      sessionId,
      thread.id,
      config,
      'extract concepts',
      { bypassRole: true },
    );

    const parsed = parseConceptExtraction(result.text);
    if (!parsed) return;

    const nameToId = new Map<string, string>();
    const conceptNames: string[] = [];
    for (const c of parsed.concepts) {
      if (!c.name || typeof c.name !== 'string') continue;
      const concept = concepts.upsertConcept(this.sqlite, sessionId, {
        canonical_name: c.name,
        aliases: Array.isArray(c.aliases) ? c.aliases.filter((a: unknown) => typeof a === 'string') as string[] : [],
        summary: typeof c.summary === 'string' ? c.summary : '',
        key_facts: Array.isArray(c.key_facts) ? c.key_facts.filter((f: unknown) => typeof f === 'string') as string[] : [],
      });
      concepts.linkFindingToConcept(this.sqlite, sessionId, finding.id, concept.id);
      nameToId.set(c.name.trim().toLowerCase(), concept.id);
      conceptNames.push(c.name);
    }

    let relationCount = 0;
    const relationRecords: Array<{ from: string; to: string; relation: string }> = [];
    for (const r of parsed.relations) {
      if (!r.from || !r.to || !r.relation) continue;
      const fromId = nameToId.get(r.from.trim().toLowerCase())
        ?? concepts.findConceptByName(this.sqlite, sessionId, r.from)?.id;
      const toId = nameToId.get(r.to.trim().toLowerCase())
        ?? concepts.findConceptByName(this.sqlite, sessionId, r.to)?.id;
      if (!fromId || !toId) continue;
      concepts.linkConcepts(this.sqlite, sessionId, fromId, toId, r.relation, [finding.id]);
      relationCount++;
      relationRecords.push({ from: r.from, to: r.to, relation: r.relation });
    }

    if (result.stepId) steps.updateStepMetadata(this.sqlite, result.stepId, {
      decision: 'extract_concepts',
      finding_id: finding.id,
      finding_summary: (finding.summary || finding.content).slice(0, 200),
      concepts: conceptNames,
      concept_count: conceptNames.length,
      relation_count: relationCount,
      relations: relationRecords.slice(0, 12),
    });
  }

  /** Extract concepts for findings that don't have any concept links yet.
   *  Used by the worker to catch up findings that predate the concept feature
   *  or whose initial extraction failed. Runs one finding at a time so a single
   *  bad response doesn't poison a whole batch. Returns count successfully
   *  processed (linked ≥1 concept). */
  async backfillConcepts(sessionId: string, batchSize: number = 10): Promise<number> {
    const session = sessions.getQuery(this.sqlite, sessionId);
    if (!session) return 0;

    const missing = concepts.findingsMissingConcepts(this.sqlite, sessionId, batchSize);
    if (missing.length === 0) return 0;

    // Parallel batch — concept extraction has no inter-finding dependency.
    let processed = 0;
    await mapWithConcurrency(missing, 8, async ({ id }) => {
      if (this.signal?.aborted) return;
      const finding = findings.getFinding(this.sqlite, id);
      if (!finding) return;
      const thread = threads.getThread(this.sqlite, finding.thread_id);
      if (!thread) return;
      try {
        await this.extractConceptsForFinding(finding, thread, session.config);
        processed++;
      } catch (err) {
        console.warn(`[concepts] backfill failed for ${id}:`, err);
      }
    });
    return processed;
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

Topic: "${session.prompt}"
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

  /** Generate a structured article from the session's concepts.
   *  Walks concepts ordered by finding count, generating one section per concept
   *  with a per-section token budget from config.llm_max_output_tokens.
   *  Falls back to a single-pass article when no concepts exist yet. */
  async updateDocument(sessionId: string): Promise<void> {
    const session = sessions.getQuery(this.sqlite, sessionId)!;
    const allFindings = findings.listFindings(this.sqlite, sessionId);
    if (allFindings.length < 1) return;

    const conceptStats = concepts.listConcepts(this.sqlite, sessionId);

    // Cap the per-concept doc at 15 sections to bound cost. Rare topics get folded
    // into an "Other" section (simple concat of their finding summaries).
    const MAX_CONCEPT_SECTIONS = 15;
    const topConcepts = conceptStats.filter(c => c.finding_count > 0).slice(0, MAX_CONCEPT_SECTIONS);

    if (topConcepts.length === 0) {
      await this.generateDocumentLegacy(sessionId, session, allFindings);
      return;
    }

    // Build the global citation index once so every section uses the same numbering.
    const citationIndex = buildCitationIndex(allFindings);

    const findingMap = new Map(allFindings.map(f => [f.id, f]));

    // Lead section is independent of body sections — fire it in parallel
    // with the per-concept fan-out. Await both at the end.
    const leadPromise = this.generateLeadSection(sessionId, session.prompt, topConcepts, session.config);

    // Parallel per-concept section generation with bounded concurrency.
    // Sequential awaits were the dominant cost in updateDocument runs:
    // ~260s for 10 concepts → ~50s with limit=6.
    const sectionResults = await mapWithConcurrency(topConcepts, 6, async (c) => {
      const findingIds = concepts.listFindingsForConcept(this.sqlite, c.id);
      const conceptFindings = findingIds.map(id => findingMap.get(id)).filter((f): f is ResearchFinding => !!f);
      if (conceptFindings.length === 0) return null;

      const material = conceptFindings.map(f => f.content).join('\n\n---\n\n');
      const conceptSources = concepts.getSourcesForConcept(this.sqlite, c.id);
      const citationNumbers: number[] = [];
      const citationLines: string[] = [];
      for (const s of conceptSources) {
        const n = citationIndex.get(s.url);
        if (n === undefined) continue;
        citationNumbers.push(n);
        citationLines.push(`[${n}] ${s.title} — ${s.url}`);
      }

      const relatedConceptNames = topConcepts
        .filter(other => other.id !== c.id)
        .map(other => other.canonical_name)
        .slice(0, 12);

      const prompt = `You are writing one section of an encyclopedia article about "${session.prompt}".

This section is about: ${c.canonical_name}${c.aliases.length ? ` (aka ${c.aliases.slice(0, 3).join(', ')})` : ''}

Write the section as flowing prose:
- Start with "## ${c.canonical_name}" as the heading. Do not repeat the heading.
- Do NOT include a lead section or references section — those are composed elsewhere. Absolutely no "## References" heading.
- Write 2–4 paragraphs. Use ### subsections only if the finding material genuinely covers multiple aspects.
- REQUIRED: Every factual claim must end with an inline citation marker like [3] (square brackets, bare integer). Use only the numbers from the "Citations available" list below — never invent new numbers, never renumber. Aim for at least one [N] per paragraph.
  Example sentence: "Berkeley Youth Alternatives runs a flagship mentorship program for local teens [4]."
- Do not add confidence scores, tags, or research-process artifacts.
- Encyclopedic tone: neutral, informative, specific.

Optional typographic constructs (use only when the material warrants, never forced):
- Cross-reference another covered concept by wrapping its name in double brackets: [[Concept Name]]. Use only for names in the related-concepts list below.
- A single short blockquote (\`> \`) may carry a striking source quotation that would lose impact as paraphrase. At most one per section.
- A fenced \`\`\`facts block may list 3–6 compact key–value rows in "Term = Value [n]" form when the findings contain clean numeric or categorical facts. Omit the block entirely if the facts are already prose-shaped.

Related concepts available for [[wiki-link]] cross-reference: ${relatedConceptNames.length ? relatedConceptNames.join(', ') : '(none)'}

Concept summary (from prior extractions): ${c.summary || '(none yet)'}
Key facts (do not copy verbatim; weave in as prose): ${c.key_facts.slice(0, 8).join(' | ') || '(none)'}

Source findings (${conceptFindings.length}):
${material}

Citations available for this section:
${citationLines.length ? citationLines.join('\n') : '(no sources attached)'}

Write only the section, starting with "## ${c.canonical_name}".`;

      try {
        const result = await this.callLLM(
          session.config.model,
          prompt,
          sessionId,
          '',
          session.config,
          `generate section: ${c.canonical_name}`,
        );
        return ensureSectionCitations(result.text.trim(), citationNumbers);
      } catch (err) {
        console.warn(`[doc] section failed for "${c.canonical_name}":`, err);
        return null;
      }
    });

    const sectionBodies = sectionResults.filter((s): s is string => s !== null);
    if (sectionBodies.length === 0) return;

    const lead = await leadPromise;
    const bodyText = [lead, ...sectionBodies].filter(Boolean).join('\n\n');
    const referencesSection = buildReferencesSection(citationIndex, allFindings, bodyText);
    const doc = [bodyText, referencesSection].filter(Boolean).join('\n\n');

    sessions.updateQuery(this.sqlite, sessionId, { document: doc });
  }

  private async generateLeadSection(
    sessionId: string,
    seedQuery: string,
    topConcepts: ConceptSummary[],
    config: SessionConfig,
  ): Promise<string> {
    const bullets = topConcepts.slice(0, 10)
      .map(c => `- ${c.canonical_name}: ${c.summary || '(no summary)'}`)
      .join('\n');

    const result = await this.callLLM(
      config.model,
      `Write a 2-3 paragraph lead section for an encyclopedia article about: "${seedQuery}"

The article's body covers these concepts (for orientation only — do not enumerate them):
${bullets}

Write only the lead section in flowing prose. Do not include a heading — the lead has no "##" line. Do not cite specific sources; the body sections handle citations. Do not mention "this article" or meta-commentary.`,
      sessionId,
      '',
      config,
      'generate lead section',
    );
    return result.text.trim();
  }

  /** Fallback used only when no concepts have been extracted yet.
   *  Produces the old-style single-pass article. */
  private async generateDocumentLegacy(
    sessionId: string,
    session: ResearchQuery,
    allFindings: ResearchFinding[],
  ): Promise<void> {
    const allThreads = threads.listThreads(this.sqlite, sessionId);
    const threadMap = new Map(allThreads.map(t => [t.id, t]));
    const material = allFindings.map(f => {
      const thread = threadMap.get(f.thread_id);
      return `[Thread: ${thread?.short_query ?? thread?.query ?? 'unknown'}]\n${f.content}`;
    }).join('\n\n---\n\n');

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
      `You are a skilled encyclopedia editor. Using the research findings below as source material, write a comprehensive, well-structured article about: "${session.prompt}"

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
      'summarize thread',
      { bypassRole: true, fast: true },
    ).then(result => {
      const title = result.text.trim().replace(/^["']|["']$/g, '');
      const accepted = title && title.length <= 60;
      if (accepted) {
        threads.updateThread(this.sqlite, threadId, { short_query: title });
      }
      if (result.stepId) steps.updateStepMetadata(this.sqlite, result.stepId, {
        decision: 'summarize_thread',
        title: accepted ? title : null,
        raw_output: title,
        query,
        accepted,
      });
    }).catch(() => { /* non-critical — placeholder remains */ });
  }

  protected async callLLM(
    model: string,
    prompt: string,
    sessionId: string,
    threadId: string | null,
    config: SessionConfig,
    label?: string,
    opts?: { bypassRole?: boolean; systemPromptOverride?: string | null; fast?: boolean }
  ): Promise<LLMResult & { cost: number; stepId: string | null }> {
    // Layering rule: callers can opt out (perturbation, judges, structural extractors)
    // or override (pickAgentRole uses its own system prompt).
    let systemPrompt: string | null | undefined;
    if (opts?.systemPromptOverride !== undefined) {
      systemPrompt = opts.systemPromptOverride;
    } else if (opts?.bypassRole) {
      systemPrompt = null;
    } else {
      systemPrompt = config.role_prompt ?? null;
    }
    // opts.fast routes to the cheap/fast utility model (config.model_fast).
    // Falls back to the requested model if model_fast is unset, so callers
    // never need to branch on its presence.
    const effectiveModel = opts?.fast && config.model_fast ? config.model_fast : model;
    if (!sessionId) {
      // No session context: rare path used by ad-hoc utility calls. Fall back
      // to raw provider — no step recorded (nothing to attach it to).
      const result = await this.provider.complete(effectiveModel, prompt, config.llm_max_output_tokens, systemPrompt);
      const cost = calculateCost(result.model, result.promptTokens, result.completionTokens);
      return { ...result, cost, stepId: null };
    }
    const ctx: CallContext = {
      session_id: sessionId,
      // Some callers pass an empty string for session-scope work (updateSummary,
      // updateDocument, generateLeadSection); coerce to null so the FK is happy.
      thread_id: threadId || null,
      label: label ?? 'llm',
    };
    const out = await this.tracked.complete(ctx, effectiveModel, prompt, config.llm_max_output_tokens, { systemPrompt });
    return { ...out, stepId: out.stepId };
  }

  /** After a source is extracted, re-run concept extraction for each finding that
   *  cites the URL — now with the newly-extracted full text as additional context.
   *  Caller is responsible for only invoking this on successful extractions. */
  async relinkConceptsForSource(source: import('./types.js').Source): Promise<void> {
    if (!source.extracted_text) return;
    const citingIds = sources.findingsCitingSource(this.sqlite, source);
    if (citingIds.length === 0) return;

    const session = sessions.getQuery(this.sqlite, source.session_id);
    if (!session) return;

    for (const fid of citingIds) {
      const finding = findings.getFinding(this.sqlite, fid);
      if (!finding) continue;
      const thread = threads.getThread(this.sqlite, finding.thread_id);
      if (!thread) continue;
      try {
        await this.extractConceptsForFinding(finding, thread, session.config, [
          { url: source.url, text: source.extracted_text },
        ]);
      } catch (err) {
        console.warn(`[concepts] relink failed for finding ${fid} / source ${source.id}:`, err);
      }
    }
  }
}

interface ConceptSummary {
  id: string;
  canonical_name: string;
  aliases: string[];
  summary: string;
  key_facts: string[];
  finding_count: number;
}

/** Build { url → citation_number } across all findings, in stable insertion order. */
function buildCitationIndex(allFindings: ResearchFinding[]): Map<string, number> {
  const idx = new Map<string, number>();
  let n = 1;
  for (const f of allFindings) {
    for (const url of f.source_urls) {
      if (!idx.has(url)) idx.set(url, n++);
    }
  }
  return idx;
}

/** Post-process a generated section:
 *  - Strip any "## References" block the model injected despite being told not to.
 *  - Normalize GFM-footnote [^N] → [N].
 *  - If the section has no [N] citations at all, append a citation cluster using
 *    the section's available numbers so the bibliography can link something.
 */
function ensureSectionCitations(text: string, available: number[]): string {
  let out = text.replace(/\n+##\s+References\b[\s\S]*$/i, '').trimEnd();
  out = out.replace(/\[\^(\d+)\]/g, '[$1]');
  const hasCitation = /\[\d+\](?!\()/.test(out);
  if (!hasCitation && available.length > 0) {
    const cluster = available.slice(0, 5).map(n => `[${n}]`).join(' ');
    out = `${out}\n\n${cluster}`;
  }
  return out;
}

function buildReferencesSection(
  citationIndex: Map<string, number>,
  allFindings: ResearchFinding[],
  bodyText: string,
): string {
  if (citationIndex.size === 0) return '';

  // Only include references the body actually cites. Accept both [N] and
  // GFM-footnote [^N] forms — the generator occasionally emits the latter.
  const used = new Set<number>();
  for (const m of bodyText.matchAll(/\[\^?(\d+)\](?!\()/g)) {
    used.add(parseInt(m[1], 10));
  }
  if (used.size === 0) return '';

  const titleByUrl = new Map<string, string>();
  for (const f of allFindings) {
    for (const m of f.source_url_meta ?? []) {
      if (!titleByUrl.has(m.url)) titleByUrl.set(m.url, m.title || m.url);
    }
  }

  const lines = [...citationIndex.entries()]
    .filter(([, n]) => used.has(n))
    .sort((a, b) => a[1] - b[1])
    .map(([url, n]) => `${n}. [${titleByUrl.get(url) ?? url}](${url})`);

  if (lines.length === 0) return '';
  return `## References\n\n${lines.join('\n')}`;
}

interface ConceptExtraction {
  concepts: Array<{ name: string; aliases?: string[]; summary?: string; key_facts?: string[] }>;
  relations: Array<{ from: string; to: string; relation: string }>;
}

/** Parse the JSON returned by the concept extraction LLM call.
 *  Tolerant of code fences and preamble — finds the first balanced JSON object. */
export function parseConceptExtraction(text: string): ConceptExtraction | null {
  if (!text) return null;
  const stripped = text.replace(/^\s*```(?:json)?/i, '').replace(/```\s*$/, '').trim();

  // Find the first balanced {...}
  let start = stripped.indexOf('{');
  if (start < 0) return null;
  let depth = 0;
  let end = -1;
  for (let i = start; i < stripped.length; i++) {
    const ch = stripped[i];
    if (ch === '{') depth++;
    else if (ch === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  if (end < 0) return null;

  try {
    const obj = JSON.parse(stripped.slice(start, end + 1)) as Partial<ConceptExtraction>;
    const conceptsArr = Array.isArray(obj.concepts) ? obj.concepts : [];
    const relationsArr = Array.isArray(obj.relations) ? obj.relations : [];
    return { concepts: conceptsArr as ConceptExtraction['concepts'], relations: relationsArr as ConceptExtraction['relations'] };
  } catch {
    return null;
  }
}
