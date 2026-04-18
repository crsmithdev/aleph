import type { LLMProvider, LLMResult, SearchOptions, WebSearchResult } from '../engine.js';
import { OpenRouterProvider } from './openrouter.js';

export type TaskType =
  | 'query_formulation'
  | 'search'
  | 'synthesis'
  | 'evaluation'
  | 'tangent_generation'
  | 'dedup'
  | 'summary'
  | 'perturbation';

export interface ModelConfig {
  model: string;
}

export interface ProviderConfig {
  openrouterApiKey?: string;
  openrouterModels?: string[];
}


export class ModelRouter implements LLMProvider {
  private openrouter: LLMProvider | null;
  private modelConfig: ModelConfig;

  constructor(
    modelConfig: ModelConfig,
    providerConfig: ProviderConfig
  ) {
    this.modelConfig = modelConfig;

    this.openrouter = providerConfig.openrouterApiKey
      ? new OpenRouterProvider({
          apiKey: providerConfig.openrouterApiKey,
          models: providerConfig.openrouterModels ?? [],
        })
      : null;
  }

  resolveModel(_taskType: TaskType): { model: string; provider: 'openrouter' } {
    const model = this.modelConfig.model;
    return { model, provider: 'openrouter' };
  }

  private getProvider(): LLMProvider {
    if (this.openrouter) return this.openrouter;
    throw new Error('No OpenRouter provider configured');
  }

  async complete(model: string, prompt: string, maxTokens: number): Promise<LLMResult> {
    return this.getProvider().complete(model, prompt, maxTokens);
  }

  async searchWeb(model: string, query: string, options?: SearchOptions): Promise<WebSearchResult> {
    return this.getProvider().searchWeb(model, query, options);
  }

  completeForTask(taskType: TaskType, prompt: string, maxTokens = 4096): Promise<LLMResult> {
    const { model } = this.resolveModel(taskType);
    return this.complete(model, prompt, maxTokens);
  }
}
