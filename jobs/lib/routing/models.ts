/**
 * The models aleph can run and which model serves each tier. Every model call is `claude -p`; a model that Claude
 * does not serve differs only in the env the call adds, which `modelEnv` gives from MODELS. The tier map lives in
 * the `models` setting as tier -> {enabled, model}; a missing row or tier means enabled on its Claude model.
 */
import { existsSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { conn, getJson, putJson } from "../../../lib/db.ts";
import { logSetting } from "../../../lib/layout.ts";
import { openRouterKey } from "../../../lib/env.ts";
import { MODELS, type Via } from "../../../lib/models.ts";
import { NO_SKILLS } from "../roles/role-skill.ts";

/** The llama-server of aleph-1282. */
const LOCAL_URL = "http://127.0.0.1:8012";
const OPENROUTER_URL = "https://openrouter.ai/api";

/** Who serves a model, by its name or its id (Langfuse has the id); a model not in MODELS (a full Claude id such as the reviewer's) is Claude's. */
export const viaOf = (model: string | undefined): Via =>
  (model && (MODELS[model] ?? Object.values(MODELS).find((m) => m.id === model))?.via) || "claude";
/** Whether a model's calls take the GPU slot. */
export const onGpu = (model: string | undefined): boolean => viaOf(model) === "local";

/** The name of a backend in a line Chris reads. */
export const BACKENDS: Record<Via, string> = { claude: "Claude", local: "the local server", openrouter: "OpenRouter" };

/** Who serves a run's calls: its own model's backend or, when its model is a Claude tier model, its tier's model's backend. */
export function viaOfRun(run: { model?: string; merge?: true }, models: Record<Tier, Setting>): Via {
  const own = viaOf(run.model);
  const tier = WORKER_TIER[run.model ?? ""];
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

/**
 * The settings of every agent role: Chris's own CLAUDE.md is left out, and `ALEPH_AGENT` tells the aleph hooks that
 * a factory agent runs, so they give it identity/AGENT.md in place of that file and skip what is for Chris. The effort
 * is high whatever Chris sets for his own sessions: nobody watches an agent run to raise it.
 */
const userMd = join(homedir(), ".claude", "CLAUDE.md");
export const AGENT_SETTINGS = JSON.stringify({ claudeMdExcludes: [...new Set([userMd, existsSync(userMd) ? realpathSync(userMd) : userMd])], effortLevel: "high", env: { ALEPH_AGENT: "1" } });

/**
 * The argv of a `claude -p` call on `model` (no `--model` when it is undefined), then the caller's flags. With
 * `terminal` the call has neither the agent settings nor `NO_SKILLS`: it runs like Chris's own terminal session.
 */
export const modelArgv = (cmd: string, model: string | undefined, flags: string[], terminal = false): string[] =>
  [cmd, "-p", "--strict-mcp-config", ...(terminal ? [] : [NO_SKILLS, "--settings", AGENT_SETTINGS]), ...(model ? ["--model", MODELS[model]?.id ?? model] : []), ...flags];

/** Whether a model's backend can take a call now: the local server answers /health, or an OpenRouter key is set. */
export async function backendUp(model: string): Promise<boolean> {
  const via = viaOf(model);
  if (via === "openrouter") return openRouterKey() !== null;
  if (via !== "local") return true;
  try { return (await fetch(`${LOCAL_URL}/health`, { signal: AbortSignal.timeout(2000) })).ok; } catch { return false; }
}

/** What OpenRouter charged this key in USD for the current UTC day, week and month, and in all; null with no key or no answer. */
export async function openRouterSpend(): Promise<{ day: number; week: number; month: number; total: number } | null> {
  const key = openRouterKey();
  if (!key) return null;
  try {
    const r = await fetch(`${OPENROUTER_URL}/v1/key`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
    const d = ((await r.json()) as any)?.data;
    return typeof d?.usage_daily === "number" ? { day: d.usage_daily, week: d.usage_weekly, month: d.usage_monthly, total: d.usage } : null;
  } catch {
    return null;
  }
}

/**
 * What OpenRouter bills per dollar of its list price, from the last row of the `openrouter` table (ui/usage.ts: one per poll, the key's lifetime USD and the rate) that has one; 1 with none.
 * The bill ran 1.26x to 1.42x the list price of the transcripts (2026-11-11): providers add fees the list leaves out.
 */
export function openRouterFactor(): number {
  const row = conn().query("SELECT factor FROM openrouter WHERE factor > 0 ORDER BY seq DESC LIMIT 1").get() as { factor: number } | null;
  return row?.factor ?? 1;
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
  reviewer: ["claude-opus-5-5", "sonnet", "haiku", ...OTHERS],
  intake: ["claude-opus-5-5", "sonnet", "haiku", ...OTHERS],
  director: ["claude-opus-5-5", "sonnet", "haiku", ...OTHERS],
  monitor: ["deepseek-v4.1-flash", "haiku", "sonnet", "claude-opus-5-5", ...OTHERS.filter((m) => m !== "deepseek-v4.1-flash")],
  maintainer: ["sonnet", "haiku", "claude-opus-5-5", ...OTHERS],
  title: ["haiku", ...OTHERS],
  judge: ["haiku", ...OTHERS],
};
export type Tier = keyof typeof OFFERS;
export type Setting = { enabled: boolean; model: string };
/** The tiers that can be disabled. */
const WORKERS = ["worker-low", "worker-medium"] as const;
/** The worker tier of a run's Claude model. */
export const WORKER_TIER: Record<string, Tier | undefined> = { haiku: "worker-low", sonnet: "worker-medium" };

const write = (m: Record<Tier, Setting>): void => putJson("settings", "models", m);

/** Every tier with its setting. */
export function readModels(): Record<Tier, Setting> {
  const m: any = getJson("settings", "models", {});
  const all = Object.fromEntries((Object.keys(OFFERS) as Tier[]).map((t) => [t, {
    enabled: !(WORKERS as readonly string[]).includes(t) || m[t]?.enabled !== false,
    model: OFFERS[t].includes(m[t]?.model) ? m[t].model : OFFERS[t][0],
  }])) as Record<Tier, Setting>;
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
  logSetting(`${t}: ${Object.entries(change).map(([k, v]) => `${k} ${v}`).join(", ")}`);
  return null;
}
