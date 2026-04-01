import type { LLMProvider, LLMResult, WebSearchResult } from '../engine.js';

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

  async searchWeb(model: string, query: string): Promise<WebSearchResult> {
    const actualModel = model || this.model;
    const result = await this.complete(actualModel, [
      `Research the following topic and provide detailed, factual information.`,
      `Include specific data points, names, dates, and any relevant details you know about:`,
      `\n"${query}"`,
    ].join(' '), 4096);

    return {
      text: result.text,
      sourceUrls: [],
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
