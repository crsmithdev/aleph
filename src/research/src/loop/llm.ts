/**
 * LLM provider abstraction for the v1 loop layer.
 *
 * Per `docs/plans/research-system-principles.md` §Verification:
 *   "All real model calls go through one provider abstraction; tests run
 *    against a fake or recorded LLM by default."
 *
 * Phase 2 introduces this interface. Production wires `OpenRouterProvider`
 * (in `src/research/src/providers/openrouter.ts`) — which already matches
 * this shape structurally, so no adapter is needed. Tests build the
 * `FakeLLMProvider` below or a per-test bespoke fake.
 *
 * Templates receive their provider via the `deps` parameter passed to
 * `buildTemplate(...)`. The engine itself never touches an LLM — model
 * access lives entirely in template hooks, keeping the engine deterministic.
 */

export interface SearchOptions {
  /** Max characters of source snippet handed to the model. */
  synthesisChars?: number;
  /** Max characters of source snippet returned for display. */
  displayChars?: number;
}

export interface LLMResult {
  text: string;
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface SourceMeta {
  url: string;
  title: string;
  snippet: string;
}

export interface WebSearchResult {
  text: string;
  sourceUrls: string[];
  sourceUrlMeta?: SourceMeta[];
  promptTokens: number;
  completionTokens: number;
  model: string;
}

export interface LLMProvider {
  complete(
    model: string,
    prompt: string,
    maxTokens: number,
    systemPrompt?: string | null,
  ): Promise<LLMResult>;
  searchWeb(
    model: string,
    query: string,
    options?: SearchOptions,
  ): Promise<WebSearchResult>;
}

// ---- Fake provider for tests ----------------------------------------------

type CompleteHandler = (model: string, prompt: string, maxTokens: number, systemPrompt?: string | null) => string;
type SearchHandler = (model: string, query: string) => { text: string; sources: SourceMeta[] };

/**
 * In-process fake LLM. Tests construct one of these and pass it via deps;
 * no HTTP server is needed for unit tests.
 *
 * Handlers run synchronously; both `complete` and `searchWeb` return after a
 * microtask so callers exercise the async code path. Each call increments the
 * matching counter for assertions like "did the template call searchWeb?".
 */
export class FakeLLMProvider implements LLMProvider {
  completeCalls = 0;
  searchCalls = 0;
  lastCompletePrompt: string | null = null;
  lastSearchQuery: string | null = null;

  constructor(
    private handlers: {
      complete?: CompleteHandler;
      searchWeb?: SearchHandler;
    } = {},
  ) {}

  async complete(model: string, prompt: string, maxTokens: number, systemPrompt?: string | null): Promise<LLMResult> {
    this.completeCalls++;
    this.lastCompletePrompt = prompt;
    const text = this.handlers.complete?.(model, prompt, maxTokens, systemPrompt) ?? '[]';
    return { text, promptTokens: 100, completionTokens: 50, model };
  }

  async searchWeb(model: string, query: string, _options?: SearchOptions): Promise<WebSearchResult> {
    this.searchCalls++;
    this.lastSearchQuery = query;
    const result = this.handlers.searchWeb?.(model, query) ?? {
      text: `fake search results for "${query}"`,
      sources: [{ url: `https://example.test/${encodeURIComponent(query)}`, title: query, snippet: 'fake snippet' }],
    };
    return {
      text: result.text,
      sourceUrls: result.sources.map(s => s.url),
      sourceUrlMeta: result.sources,
      promptTokens: 120,
      completionTokens: 80,
      model,
    };
  }
}
