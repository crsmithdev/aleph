/**
 * Which model serves each tier, and whether the tier is on. The map lives in models.json in the factory folder
 * as tier -> {enabled, model}; a missing file or tier means enabled on its Claude model. The local backend is one fixed entry.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { layout } from "../infra/layout.ts";

/** The llama-server of aleph-1282. */
export const LOCAL = { baseUrl: "http://127.0.0.1:8012", model: "gpt-oss-20b" };

/** The models each tier offers; the first is its Claude model and the default. */
export const OFFERS = {
  "worker-low": ["haiku", LOCAL.model],
  "worker-medium": ["sonnet", LOCAL.model],
  merge: ["haiku", LOCAL.model],
  title: ["haiku", LOCAL.model],
  judge: ["haiku", LOCAL.model],
} as const;
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
  if (old) m = Object.fromEntries(Object.entries(OLD).map(([slot, t]) => [t, { model: m[slot] === "local" ? LOCAL.model : undefined }]));
  const all = Object.fromEntries((Object.keys(OFFERS) as Tier[]).map((t) => [t, {
    enabled: !(WORKERS as readonly string[]).includes(t) || m[t]?.enabled !== false,
    model: (OFFERS[t] as readonly string[]).includes(m[t]?.model) ? m[t].model : OFFERS[t][0],
  }])) as Record<Tier, Setting>;
  if (old) write(all);
  return all;
}

/** Changes one tier; returns an error text for an unknown tier, a model the tier does not offer, or a disable of a tier that cannot be disabled, else null. */
export function setModel(tier: string, change: Partial<Setting>): string | null {
  if (!Object.hasOwn(OFFERS, tier)) return `unknown tier "${tier}"; tiers: ${Object.keys(OFFERS).join(", ")}`;
  const t = tier as Tier;
  if (change.model !== undefined && !(OFFERS[t] as readonly string[]).includes(change.model)) return `${t} offers ${OFFERS[t].join(", ")}, not "${change.model}"`;
  if (change.enabled === false && !(WORKERS as readonly string[]).includes(t)) return `only ${WORKERS.join(" and ")} can be disabled`;
  const m = readModels();
  write({ ...m, [t]: { ...m[t], ...change } });
  return null;
}

/** The env a gpt-oss-20b claude call adds: the local base URL and a dummy token. */
export const LOCAL_ENV = {
  ANTHROPIC_BASE_URL: LOCAL.baseUrl,
  ANTHROPIC_AUTH_TOKEN: "local",
  // Equal to --ctx-size in jobs/lib/routing/gpt-oss-start.ts. Claude Code compacts at window - min(max output, 20k) - 13k = 23,864.
  CLAUDE_CODE_AUTO_COMPACT_WINDOW: "40960",
  CLAUDE_CODE_MAX_OUTPUT_TOKENS: "4096",
};
