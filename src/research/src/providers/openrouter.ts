import type { LLMProvider, LLMResult, SearchOptions, WebSearchResult } from '../engine.js';
import { fetchSearchResults } from './websearch.js';

export interface OpenRouterConfig {
  apiKey: string;
  models: string[];
  siteUrl?: string;
  siteName?: string;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// OpenRouter model metadata: pricing per 1M tokens + context window size
const OPENROUTER_MODELS: Record<string, { input: number; output: number; contextWindow: number }> = {
  'deepseek/deepseek-chat':                          { input: 0.14, output: 0.28, contextWindow: 32768 },
  'deepseek/deepseek-r1-0528':                       { input: 0.50, output: 2.19, contextWindow: 65536 },
  'google/gemini-2.0-flash-001':                     { input: 0.10, output: 0.40, contextWindow: 1048576 },
  'meta-llama/llama-3.3-70b-instruct':               { input: 0.39, output: 0.39, contextWindow: 131072 },
  'qwen/qwen-2.5-72b-instruct':                      { input: 0.13, output: 0.40, contextWindow: 131072 },
  'mistralai/mixtral-8x7b-instruct':                 { input: 0.24, output: 0.24, contextWindow: 32768  },
  // Free tier models (no credit cost, subject to rate limits — use rotation)
  'openrouter/free':                                  { input: 0,    output: 0,    contextWindow: 200000 },
  'meta-llama/llama-3.3-70b-instruct:free':          { input: 0,    output: 0,    contextWindow: 65536 },
  'google/gemma-3-27b-it:free':                      { input: 0,    output: 0,    contextWindow: 131072 },
  'nousresearch/hermes-3-llama-3.1-405b:free':       { input: 0,    output: 0,    contextWindow: 131072 },
  'qwen/qwen3-next-80b-a3b-instruct:free':           { input: 0,    output: 0,    contextWindow: 262144 },
};

// Conservative default for unknown models (OpenRouter enforces 32k on some routes)
const DEFAULT_CONTEXT_WINDOW = 32768;

export class OpenRouterProvider implements LLMProvider {
  private config: OpenRouterConfig;

  constructor(config: OpenRouterConfig) {
    this.config = config;
  }

  async complete(model: string, prompt: string, maxTokens: number, systemPrompt?: string | null): Promise<LLMResult> {
    const contextWindow = OPENROUTER_MODELS[model]?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    // Reserve a small slice of the budget for the system prompt so we don't blow context.
    const sysOverhead = systemPrompt ? Math.ceil(systemPrompt.length / 4) + 50 : 0;
    const truncatedPrompt = truncateToTokens(prompt, contextWindow - maxTokens - 200 - sysOverhead);
    const messages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) messages.push({ role: 'system', content: systemPrompt });
    messages.push({ role: 'user', content: truncatedPrompt });
    const response = await this.fetchWithRetry(model, messages, maxTokens);
    return {
      text: response.choices[0]?.message?.content ?? '',
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      model: response.model ?? model,
    };
  }

  async searchWeb(model: string, query: string, options?: SearchOptions): Promise<WebSearchResult> {
    const synthesisChars = options?.synthesisChars ?? 3000;
    const displayChars = options?.displayChars ?? 200;

    const searchResults = await fetchSearchResults(query);
    const sourceUrls = searchResults.map(r => r.url);

    const context = searchResults.map(r =>
      `### ${r.title}\nURL: ${r.url}\n\n${r.snippet.slice(0, synthesisChars)}`
    ).join('\n\n---\n\n');

    const searchMaxTokens = 4096;
    const contextWindow = OPENROUTER_MODELS[model]?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
    const fullPrompt = `You are a research assistant. Based on the following web pages, answer this research query:\n\n"${query}"\n\n---\n\n${context}\n\n---\n\nProvide a detailed, factual summary with specific information from the sources above.`;
    const response = await this.fetchWithRetry(model, [
      { role: 'user', content: truncateToTokens(fullPrompt, contextWindow - searchMaxTokens - 200) },
    ], searchMaxTokens);

    const actualModelUsed = response.model ?? model;

    const text = response.choices[0]?.message?.content ?? '';

    return {
      text,
      sourceTexts: [],
      sourceUrls,
      sourceUrlMeta: searchResults.map(r => ({ url: r.url, title: r.title, snippet: r.snippet.slice(0, displayChars) })),
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      model: actualModelUsed,
    };
  }

  private async fetchWithRetry(
    model: string,
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
    plugins?: Array<{ id: string; max_results?: number }>
  ): Promise<OpenRouterResponse> {
    const abort = new AbortController();
    const timeout = setTimeout(() => abort.abort(), 120_000);
    let res: Response;
    try {
      res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
        method: 'POST',
        signal: abort.signal,
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`,
          ...(this.config.siteUrl ? { 'HTTP-Referer': this.config.siteUrl } : {}),
          ...(this.config.siteName ? { 'X-Title': this.config.siteName } : {}),
        },
        body: JSON.stringify({
          model,
          messages,
          max_tokens: maxTokens,
          ...(plugins ? { plugins } : {}),
        }),
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!res.ok) {
      const body = await res.text();
      // Try to surface the upstream error message clearly (502 wraps upstream 400/5xx)
      if (res.status === 502) {
        try {
          const parsed = JSON.parse(body);
          const upstream = parsed?.error?.message ?? body;
          throw new Error(`OpenRouter 502 (upstream error): ${upstream}`);
        } catch { /* fall through to generic */ }
      }
      throw new Error(`OpenRouter ${res.status}: ${body}`);
    }

    const data = await res.json() as OpenRouterResponse;
    if (!data.choices || !Array.isArray(data.choices)) {
      throw new Error(`OpenRouter bad response (no choices): ${JSON.stringify(data).slice(0, 300)}`);
    }
    return data;
  }
}

interface OpenRouterResponse {
  id: string;
  model: string;
  choices: Array<{
    message: {
      role: string;
      content: string;
      annotations?: Array<{
        type: string;
        url_citation?: { url: string; title?: string; content?: string };
      }>;
    };
    finish_reason: string;
  }>;
  usage?: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export function getOpenRouterPricing(model: string): { input: number; output: number } {
  const m = OPENROUTER_MODELS[model];
  return m ? { input: m.input, output: m.output } : { input: 0.50, output: 1.00 };
}

export function getContextWindow(model: string): number {
  return OPENROUTER_MODELS[model]?.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
}

// Estimate tokens (~4 chars per token) and truncate at a word boundary.
// Truncates from the middle to preserve both the instruction header and
// the tail (which often contains the actual question/directive).
function truncateToTokens(text: string, maxTokens: number): string {
  const estimatedTokens = Math.ceil(text.length / 4);
  if (estimatedTokens <= maxTokens) return text;

  const notice = '\n\n[...content truncated to fit context window...]\n\n';
  const maxChars = maxTokens * 4 - notice.length;
  const keepEachSide = Math.floor(maxChars / 2);

  const head = text.slice(0, keepEachSide);
  const tail = text.slice(-keepEachSide);

  return head + notice + tail;
}
