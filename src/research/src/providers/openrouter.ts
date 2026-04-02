import type { LLMProvider, LLMResult, WebSearchResult } from '../engine.js';

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
    ], maxTokens);

    return {
      text: response.choices[0]?.message?.content ?? '',
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      model: response.model ?? actualModel,
    };
  }

  async searchWeb(model: string, query: string): Promise<WebSearchResult> {
    // OpenRouter doesn't have native web search — use a model to generate a response
    // based on its training data (no real-time web access)
    const actualModel = model.includes('/') ? model : this.nextModel();

    const response = await this.fetchWithRetry(actualModel, [
      {
        role: 'user',
        content: `Research the following topic and provide detailed, factual information. Include specific data points, names, dates, and any relevant details you know about:\n\n"${query}"`,
      },
    ], 4096);

    return {
      text: response.choices[0]?.message?.content ?? '',
      sourceTexts: [response.choices[0]?.message?.content ?? ''],
      sourceUrls: [],
      promptTokens: response.usage?.prompt_tokens ?? 0,
      completionTokens: response.usage?.completion_tokens ?? 0,
      model: response.model ?? actualModel,
    };
  }

  private async fetchWithRetry(
    model: string,
    messages: Array<{ role: string; content: string }>,
    maxTokens: number,
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
    message: { role: string; content: string };
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
