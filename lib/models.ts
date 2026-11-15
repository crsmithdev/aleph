/** The model table: what each model is called, who serves it and, for a model Claude does not serve, what it costs. */

/** USD per million tokens. */
export interface Rate { input: number; output: number; cacheRead: number; cacheWrite: number }
/** Who serves a model: Claude on the subscription, the llama-server of aleph-1282 on the one GPU, or OpenRouter. */
export type Via = "claude" | "local" | "openrouter";
export interface Model { via: Via; id: string; price?: Rate }

export const OPUS_MODEL = "claude-opus-5-5";

/** OpenRouter list prices, read 2026-11-05 from /api/v1/models. Where a price is 0 or not listed, the input price stands in. */
const routed = (id: string, input: number, output: number, cacheRead = input, cacheWrite = input): Model =>
  ({ via: "openrouter", id, price: { input, output, cacheRead, cacheWrite } });

/** Every model a size or role model can use, by the name the `models` setting and the run records carry. */
export const MODELS: Record<string, Model> = {
  haiku: { via: "claude", id: "haiku" },
  sonnet: { via: "claude", id: "sonnet" },
  opus: { via: "claude", id: OPUS_MODEL },
  "claude-opus-5-5": { via: "claude", id: OPUS_MODEL },
  "gpt-oss-20b": { via: "local", id: "gpt-oss-20b", price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  "deepseek-v4.1-flash": routed("deepseek/deepseek-v4.1-flash", 0.045, 0.5, 0.018),
  "gpt-6-luna": routed("openai/gpt-6-luna", 0.1, 0.5, 0.01, 0.125),
  "minimax-m3.1-flash": routed("minimax/minimax-m3.1-flash", 0.075, 0.3, 0.0075),
  "step-3.5-flash": routed("stepfun/step-3.5-flash", 0.1, 0.3),
  "mimo-v2.6-flash": routed("xiaomi/mimo-v2.6-flash", 0.14, 0.28, 0.0028),
};
