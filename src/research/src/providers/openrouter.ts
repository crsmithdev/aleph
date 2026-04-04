import type { LLMProvider, LLMResult, WebSearchResult } from '../engine.js';
import { fetchSearchResults, fetchPageContent } from './websearch.js';

export interface OpenRouterConfig {
  apiKey: string;
  models: string[];
  siteUrl?: string;
  siteName?: string;
}

const OPENROUTER_BASE = 'https://openrouter.ai/api/v1';

// OpenRouter pricing per 1M tokens (approximate, varies by model)
const OPENROUTER_PRICING: Record<string, { input: number; output: number }> = {
  'deepseek/deepseek-chat': { input: 0.14, output: 0.28 },
  'google/gemini-2.0-flash-001': { input: 0.10, output: 0.40 },
  'meta-llama/llama-3.3-70b-instruct': { input: 0.39, output: 0.39 },
};

export class OpenRouterProvider implements LLMProvider {
  private config: OpenRouterConfig;
  private modelIndex = 0;

  constructor(config: OpenRouterConfig) {
    this.config = config;
  }

  private nextModel(): string {
    const model = this.config.models[this.modelIndex % this.config.models.length];
    this.modelIndex++;
    return model;
  }

  async complete(model: string, prompt: string, maxTokens: number): Promise<LLMResult> {
    // Use specific model if provided and it's an OpenRouter model, else rotate
    const actualModel = model.includes('/') ? model : this.nextModel();

    const response = await this.fetchWithRetry(actualModel, [
      { role: 'user', content: prompt },
    ], maxTokens, undefined);

    return {
      text: response.choices[0]?.message?.content ?? '',
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      model: response.model ?? actualModel,
    };
  }

  async searchWeb(model: string, query: string): Promise<WebSearchResult> {
    const actualModel = model.includes('/') ? model : this.nextModel();

    // 1. Get URLs from search engine (Tavily → Brave → DuckDuckGo)
    const searchResults = await fetchSearchResults(query);

    // 2. Fetch structured page content via Jina for each URL
    const fetchResults = await Promise.all(searchResults.map(r => fetchPageContent(r.url)));

    const sourceUrls = searchResults.map(r => r.url);
    const sourceTexts = fetchResults.map((fr, i) => fr.page?.content ?? searchResults[i].snippet);
    const jinaFetches = fetchResults.map((fr, i) => ({
      url: searchResults[i].url,
      ok: fr.ok,
      content_length: fr.content_length,
    }));

    // 3. Synthesize with the LLM — use Jina's title/date/content structure
    const context = searchResults.map((r, i) => {
      const page = fetchResults[i].page;
      const title = page?.title || r.title;
      const date = page?.publishedTime ? `\nPublished: ${page.publishedTime}` : '';
      const body = (page?.content ?? r.snippet).slice(0, 3000);
      return `### ${title}\nURL: ${r.url}${date}\n\n${body}`;
    }).join('\n\n---\n\n');

    const response = await this.fetchWithRetry(actualModel, [
      {
        role: 'user',
        content: `You are a research assistant. Based on the following web pages, answer this research query:\n\n"${query}"\n\n---\n\n${context}\n\n---\n\nProvide a detailed, factual summary with specific information from the sources above.`,
      },
    ], 4096);

    const text = response.choices[0]?.message?.content ?? '';

    return {
      text,
      sourceTexts,
      sourceUrls,
      jinaFetches,
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      model: response.model ?? actualModel,
    };
  }

  private async fetchWithRetry(
    model: string,
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
    plugins?: Array<{ id: string; max_results?: number }>,
    attempts = 3
  ): Promise<OpenRouterResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
          method: 'POST',
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

        if (!res.ok) {
          const body = await res.text();
          if ((res.status === 429 || res.status === 529) && attempt < attempts - 1) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt + 1) * 5000));
            continue;
          }
          throw new Error(`OpenRouter ${res.status}: ${body}`);
        }

        return await res.json() as OpenRouterResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < attempts - 1) {
          const msg = lastError.message;
          if (msg.includes('429') || msg.includes('rate') || msg.includes('529')) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt + 1) * 5000));
            continue;
          }
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error('OpenRouter request failed');
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
  return OPENROUTER_PRICING[model] ?? { input: 0.50, output: 1.00 }; // conservative default
}
