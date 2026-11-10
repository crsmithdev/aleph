/** Langfuse reads for the Sessions views: every page of a list, reloaded at most every 30 s; an older answer is served while it reloads. */
import { langfuseConfig, type LangfuseConfig } from "../lib/env.ts";
import { allPages } from "./langfuse-pages.ts";
import { staleAsync } from "./stale.ts";

const CACHE_MS = 30_000;
const cache = staleAsync<any[]>(500, 600_000); // Keys move with the hour and the turn: bound them.

export function clearCache(): void { cache.clear(); }

export class LangfuseError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export function config(): LangfuseConfig {
  const cfg = langfuseConfig();
  if (!cfg) throw new LangfuseError("Langfuse is not configured: LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are missing");
  return cfg;
}

/** Every row of a paged list endpoint, through `allPages`; failures are not cached. */
function getAll(cfg: LangfuseConfig, path: string, query: Record<string, string>): Promise<any[]> {
  return cache.get(`${cfg.baseUrl}${path}?${new URLSearchParams(query)}`, CACHE_MS, async () => {
    try { return (await allPages(cfg, path, query, 15000)).rows; }
    catch (e) { throw new LangfuseError(`Langfuse at ${cfg.baseUrl} failed on ${path}: ${(e as Error).message}`); }
  });
}

export const traces = (cfg: LangfuseConfig, query: Record<string, string>) => getAll(cfg, "/api/public/traces", query);
export const observations = (cfg: LangfuseConfig, traceId: string) => getAll(cfg, "/api/public/observations", { traceId });
