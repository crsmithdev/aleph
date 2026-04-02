import type { LLMProvider, LLMResult, WebSearchResult } from '../engine.js';
import { fetchSearchResults } from './websearch.js';

export interface OllamaConfig {
  baseUrl?: string;
  model: string;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';

export class OllamaProvider implements LLMProvider {
  private baseUrl: string;
  private model: string;

  constructor(config: OllamaConfig) {
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.model = config.model;
  }

  async complete(model: string, prompt: string, maxTokens: number): Promise<LLMResult> {
    const actualModel = model || this.model;
    const response = await this.fetchWithRetry(actualModel, [
      { role: 'user', content: prompt },
    ], maxTokens);

    return {
      text: response.message?.content ?? '',
      promptTokens: response.prompt_eval_count ?? 0,
      completionTokens: response.eval_count ?? 0,
      model: response.model ?? actualModel,
    };
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) throw new Error(`Ollama embed ${res.status}: ${await res.text()}`);
    const data = await res.json() as { embeddings?: number[][]; embedding?: number[] };
    return data.embeddings?.[0] ?? data.embedding ?? [];
  }

  async searchWeb(model: string, query: string): Promise<WebSearchResult> {
    const actualModel = model || this.model;

    // Fetch real web results, then have the local model synthesize them
    const webResults = await fetchSearchResults(query);

    let prompt: string;
    if (webResults.length > 0) {
      const resultsText = webResults
        .map((r, i) => `[${i + 1}] ${r.title}\nURL: ${r.url}\n${r.snippet}`)
        .join('\n\n');
      prompt = `Based on the following web search results, answer the question: "${query}"\n\nSearch results:\n${resultsText}\n\nProvide a concise summary of what the search results say. Stick to the provided information.`;
    } else {
      // No search API configured — fall back to model knowledge with a warning
      prompt = `Research the following topic: "${query}"\n\nNote: No web search is available. Answer from your training knowledge only, and be explicit about any uncertainty.`;
    }

    const result = await this.complete(actualModel, prompt, 4096);

    return {
      text: result.text,
      sourceUrls: webResults.map(r => r.url).filter(Boolean),
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      model: result.model,
    };
  }

  private async fetchWithRetry(
    model: string,
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
    attempts = 3,
  ): Promise<OllamaResponse> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const res = await fetch(`${this.baseUrl}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            model,
            messages,
            stream: false,
            options: {
              num_predict: maxTokens,
            },
          }),
        });

        if (!res.ok) {
          const body = await res.text();
          if (res.status === 429 && attempt < attempts - 1) {
            await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt + 1) * 2000));
            continue;
          }
          throw new Error(`Ollama ${res.status}: ${body}`);
        }

        return await res.json() as OllamaResponse;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        if (attempt < attempts - 1) {
          await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt + 1) * 1000));
          continue;
        }
        throw lastError;
      }
    }

    throw lastError ?? new Error('Ollama request failed');
  }
}

interface OllamaResponse {
  model: string;
  message: { role: string; content: string };
  done: boolean;
  prompt_eval_count?: number;
  eval_count?: number;
}
