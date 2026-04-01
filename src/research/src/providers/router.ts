import type { LLMProvider, LLMResult, WebSearchResult } from '../engine.js';
import { AnthropicProvider } from '../engine.js';
import { OpenRouterProvider, type OpenRouterConfig } from './openrouter.js';

export type TaskType =
  | 'query_formulation'
  | 'search'
  | 'synthesis'
  | 'evaluation'
  | 'tangent_generation'
  | 'dedup'
  | 'summary'
  | 'perturbation';

export type ModelTier = 'cheap' | 'mid' | 'expensive' | 'rotate';

export interface ModelConfig {
  cheap: string;
  mid: string;
  expensive: string;
  tangent: 'rotate' | string;
}

export interface ProviderConfig {
  primary: 'anthropic' | 'openrouter';
  fallback?: 'anthropic' | 'openrouter';
  anthropicApiKey?: string;
  openrouterApiKey?: string;
  openrouterModels?: string[];
}

// Maps task types to model tiers per spec §4
const TASK_TIER_MAP: Record<TaskType, ModelTier> = {
  query_formulation: 'cheap',
  search: 'mid',        // web search needs comprehension
  synthesis: 'mid',
  evaluation: 'mid',
  tangent_generation: 'rotate',
  dedup: 'cheap',
  summary: 'mid',
  perturbation: 'rotate',
};

export class ModelRouter implements LLMProvider {
  private anthropic: LLMProvider | null;
  private openrouter: LLMProvider | null;
  private modelConfig: ModelConfig;
  private providerConfig: ProviderConfig;
  private rotationIndex = 0;
  private rotationModels: string[];

  constructor(
    modelConfig: ModelConfig,
    providerConfig: ProviderConfig
  ) {
    this.modelConfig = modelConfig;
    this.providerConfig = providerConfig;

    this.anthropic = providerConfig.anthropicApiKey
      ? new AnthropicProvider(providerConfig.anthropicApiKey)
      : null;

    this.openrouter = providerConfig.openrouterApiKey
      ? new OpenRouterProvider({
          apiKey: providerConfig.openrouterApiKey,
          models: providerConfig.openrouterModels ?? [],
        })
      : null;

    // Build rotation pool: OpenRouter models + Anthropic models for diversity
    this.rotationModels = [
      ...(providerConfig.openrouterModels ?? []),
      modelConfig.mid,
      modelConfig.cheap,
    ];
  }

  resolveModel(taskType: TaskType): { model: string; provider: 'anthropic' | 'openrouter' } {
    const tier = TASK_TIER_MAP[taskType];

    if (tier === 'rotate') {
      const model = this.rotationModels[this.rotationIndex % this.rotationModels.length];
      this.rotationIndex++;
      const isOpenRouter = model.includes('/');
      return {
        model,
        provider: isOpenRouter ? 'openrouter' : 'anthropic',
      };
    }

    const model = this.modelConfig[tier];
    // Determine provider: if model contains '/', it's an OpenRouter model
    const isOpenRouter = model.includes('/');
    return {
      model,
      provider: isOpenRouter ? 'openrouter' : 'anthropic',
    };
  }

  private getProvider(providerName: 'anthropic' | 'openrouter'): LLMProvider {
    if (providerName === 'anthropic' && this.anthropic) return this.anthropic;
    if (providerName === 'openrouter' && this.openrouter) return this.openrouter;

    // Fallback
    const fallback = providerName === 'anthropic' ? this.openrouter : this.anthropic;
    if (fallback) return fallback;

    throw new Error(`No provider available for ${providerName}`);
  }

  async complete(model: string, prompt: string, maxTokens: number): Promise<LLMResult> {
    const isOpenRouter = model.includes('/');
    const provider = this.getProvider(isOpenRouter ? 'openrouter' : 'anthropic');
    return provider.complete(model, prompt, maxTokens);
  }

  async searchWeb(model: string, query: string): Promise<WebSearchResult> {
    // Web search only works with Anthropic (has native web_search tool)
    if (this.anthropic) {
      return this.anthropic.searchWeb(model, query);
    }
    // Fallback: use OpenRouter model but without real web search
    if (this.openrouter) {
      return this.openrouter.searchWeb(model, query);
    }
    throw new Error('No provider available for web search');
  }

  completeForTask(taskType: TaskType, prompt: string, maxTokens = 4096): Promise<LLMResult> {
    const { model } = this.resolveModel(taskType);
    return this.complete(model, prompt, maxTokens);
  }
}
