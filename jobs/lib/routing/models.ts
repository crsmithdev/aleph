/**
 * The models aleph can run and which model serves each tier. Every model call is `claude -p`; a model that Claude
 * does not serve differs only in the env the call adds, which `modelEnv` gives from MODELS. The tier map lives in
 * models.json in the factory folder as tier -> {enabled, model}; a missing file or tier means enabled on its Claude model.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { layout } from "../infra/layout.ts";
import { openRouterKey } from "../../../hooks/lib/env.ts";
import { NO_SKILLS } from "../roles/role-skill.ts";

/** USD per million tokens. */
export interface Rate { input: number; output: number; cacheRead: number; cacheWrite: number }
/** Who serves a model: Claude on the subscription, the llama-server of aleph-1282 on the one GPU, or OpenRouter. */
export type Via = "claude" | "local" | "openrouter";
export interface Model { via: Via; id: string; price?: Rate }

/** The llama-server of aleph-1282. */
export const LOCAL_URL = "http://127.0.0.1:8012";
const OPENROUTER_URL = "https://openrouter.ai/api";

/** OpenRouter list prices, read 2026-11-05 from /api/v1/models. Where a price is 0 or not listed, the input price stands in. */
const routed = (id: string, input: number, output: number, cacheRead = input, cacheWrite = input): Model =>
  ({ via: "openrouter", id, price: { input, output, cacheRead, cacheWrite } });

/** Every model a tier can use, by the name models.json and the run records carry. */
export const MODELS: Record<string, Model> = {
  haiku: { via: "claude", id: "haiku" },
  sonnet: { via: "claude", id: "sonnet" },
  "gpt-oss-20b": { via: "local", id: "gpt-oss-20b", price: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } },
  "deepseek-v4.1-flash": routed("deepseek/deepseek-v4.1-flash", 0.045, 0.5, 0.018),
  "gpt-6-luna": routed("openai/gpt-6-luna", 0.1, 0.5, 0.01, 0.125),
  "minimax-m3.1-flash": routed("minimax/minimax-m3.1-flash", 0.075, 0.3, 0.0075),
  "step-3.5-flash": routed("stepfun/step-3.5-flash", 0.1, 0.3),
  "mimo-v2.6-flash": routed("xiaomi/mimo-v2.6-flash", 0.14, 0.28, 0.0028),
};

/** Who serves a model; a name not in MODELS (a full Claude id such as the reviewer's) is Claude's. */
export const viaOf = (model: string | undefined): Via => (model && MODELS[model]?.via) || "claude";
/** Whether a model's calls take the GPU slot. */
export const onGpu = (model: string | undefined): boolean => viaOf(model) === "local";

/** The name of a backend in a line Chris reads. */
export const BACKENDS: Record<Via, string> = { claude: "Claude", local: "the local server", openrouter: "OpenRouter" };

/** Who serves a run's calls: its own model's backend or, when its model is a Claude tier model, its tier's model's backend. */
export function viaOfRun(run: { model?: string; merge?: true }, models: Record<Tier, Setting>): Via {
  const own = viaOf(run.model);
  const tier = run.merge ? "merge" : WORKER_TIER[run.model ?? ""];
  return own === "claude" && tier !== undefined ? viaOf(models[tier].model) : own;
}

const MODEL_VARS = ["ANTHROPIC_BASE_URL", "ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_DEFAULT_HAIKU_MODEL", "ANTHROPIC_DEFAULT_SONNET_MODEL", "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL", "CLAUDE_CODE_AUTO_COMPACT_WINDOW", "CLAUDE_CODE_MAX_OUTPUT_TOKENS"];

/** The env a call on `model` adds. A Claude model clears the variables that point a call at another model, so the call runs on the subscription. */
export function modelEnv(model: string | undefined): Record<string, string | undefined> {
  const m = model ? MODELS[model] : undefined;
  if (!m || m.via === "claude") return Object.fromEntries(MODEL_VARS.map((k) => [k, undefined]));
  const ids = { ANTHROPIC_DEFAULT_HAIKU_MODEL: m.id, ANTHROPIC_DEFAULT_SONNET_MODEL: m.id, ANTHROPIC_DEFAULT_OPUS_MODEL: m.id, CLAUDE_CODE_SUBAGENT_MODEL: m.id };
  if (m.via === "local") return {
    ANTHROPIC_BASE_URL: LOCAL_URL, ANTHROPIC_AUTH_TOKEN: "local", ANTHROPIC_API_KEY: "", ...ids,
    // Equal to --ctx-size in jobs/lib/routing/gpt-oss-start.ts. Claude Code compacts at window - min(max output, 20k) - 13k = 23,864.
    CLAUDE_CODE_AUTO_COMPACT_WINDOW: "40960",
    CLAUDE_CODE_MAX_OUTPUT_TOKENS: "4096",
  };
  return { ANTHROPIC_BASE_URL: OPENROUTER_URL, ANTHROPIC_AUTH_TOKEN: openRouterKey() ?? "", ANTHROPIC_API_KEY: "", ...ids };
}

/** The argv of a `claude -p` call on `model` (no `--model` when it is undefined), then the caller's flags. */
export const modelArgv = (cmd: string, model: string | undefined, flags: string[]): string[] =>
  [cmd, "-p", "--strict-mcp-config", NO_SKILLS, ...(model ? ["--model", MODELS[model]?.id ?? model] : []), ...flags];

/** Whether a model's backend can take a call now: the local server answers /health, or an OpenRouter key is set. */
export async function backendUp(model: string): Promise<boolean> {
  const via = viaOf(model);
  if (via === "openrouter") return openRouterKey() !== null;
  if (via !== "local") return true;
  try { return (await fetch(`${LOCAL_URL}/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

/**
 * Whether a backend takes a call now: the local server answers /health, OpenRouter answers a one-token call, and
 * Claude's subscription needs no probe. The credit error the factory holds a backend for is a 402, and a refused
 * key a 401; any other answer means the backend takes calls.
 */
export async function probeBackend(via: Via): Promise<boolean> {
  if (via === "claude") return true;
  const found = Object.entries(MODELS).find(([, m]) => m.via === via);
  if (!found) return true;
  const [name, model] = found;
  if (via === "local") return backendUp(name);
  const key = openRouterKey();
  if (!key) return false;
  try {
    const r = await fetch(`${OPENROUTER_URL}/v1/chat/completions`, {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ model: model.id, messages: [{ role: "user", content: "ok" }], max_tokens: 1 }),
      signal: AbortSignal.timeout(10_000),
    });
    return r.status !== 402 && r.status !== 401;
  } catch { return false; }
}

/** The models that are not Claude's, which every tier offers after its Claude model. */
const OTHERS = Object.keys(MODELS).filter((m) => MODELS[m].via !== "claude");
/** The models each tier offers; the first is its Claude model and the default. */
export const OFFERS = {
  "worker-low": ["haiku", ...OTHERS],
  "worker-medium": ["sonnet", ...OTHERS],
  merge: ["haiku", ...OTHERS],
  title: ["haiku", ...OTHERS],
  judge: ["haiku", ...OTHERS],
};
export type Tier = keyof typeof OFFERS;
export type Setting = { enabled: boolean; model: string };
/** The tiers that can be disabled. */
export const WORKERS = ["worker-low", "worker-medium"] as const;
/** The worker tier of a run's Claude model. */
export const WORKER_TIER: Record<string, Tier | undefined> = { haiku: "worker-low", sonnet: "worker-medium" };
/** The old slot names, read once and converted. */
const OLD: Record<string, Tier> = { "worker.haiku": "worker-low", "worker.sonnet": "worker-medium", merge: "merge", title: "title", judge: "judge" };

const file = (): string => join(layout().factory, "models.json");
const write = (m: Record<Tier, Setting>): void => {
  mkdirSync(layout().factory, { recursive: true });
  writeFileSync(file(), JSON.stringify(m, null, 2) + "\n");
};

/** Every tier with its setting. A file in the old slot shape (slot -> claude|local) is converted and written back. */
export function readModels(): Record<Tier, Setting> {
  let m: any;
  try { m = JSON.parse(readFileSync(file(), "utf8")); } catch { m = {}; }
  const old = Object.values(m).some((v) => typeof v === "string");
  if (old) m = Object.fromEntries(Object.entries(OLD).map(([slot, t]) => [t, { model: m[slot] === "local" ? "gpt-oss-20b" : undefined }]));
  const all = Object.fromEntries((Object.keys(OFFERS) as Tier[]).map((t) => [t, {
    enabled: !(WORKERS as readonly string[]).includes(t) || m[t]?.enabled !== false,
    model: OFFERS[t].includes(m[t]?.model) ? m[t].model : OFFERS[t][0],
  }])) as Record<Tier, Setting>;
  if (old) write(all);
  return all;
}

/** Changes one tier; returns an error text for an unknown tier, a model the tier does not offer, or a disable of a tier that cannot be disabled, else null. */
export function setModel(tier: string, change: Partial<Setting>): string | null {
  if (!Object.hasOwn(OFFERS, tier)) return `unknown tier "${tier}"; tiers: ${Object.keys(OFFERS).join(", ")}`;
  const t = tier as Tier;
  if (change.model !== undefined && !OFFERS[t].includes(change.model)) return `${t} offers ${OFFERS[t].join(", ")}, not "${change.model}"`;
  if (change.enabled === false && !(WORKERS as readonly string[]).includes(t)) return `only ${WORKERS.join(" and ")} can be disabled`;
  const m = readModels();
  write({ ...m, [t]: { ...m[t], ...change } });
  return null;
}
