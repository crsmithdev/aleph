/** Langfuse reads for the Sessions views: every page of a list, read once per pass of the UI's builds (sources.ts). */
import { langfuseConfig, type LangfuseConfig } from "../lib/env.ts";
import { once } from "../jobs/lib/infra/sources.ts";
import { allPages } from "./langfuse-pages.ts";

export class LangfuseError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export function config(): LangfuseConfig {
  const cfg = langfuseConfig();
  if (!cfg) throw new LangfuseError("Langfuse is not configured: LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are missing");
  return cfg;
}

/** Every row of a paged list endpoint, through `allPages`; failures are not kept. */
function getAll(cfg: LangfuseConfig, path: string, query: Record<string, string>, source = "langfuse"): Promise<any[]> {
  return once(`${source}:${cfg.baseUrl}${path}?${new URLSearchParams(query)}`, [source], async () => {
    try { return (await allPages(cfg, path, query, 15000, source)).rows; }
    catch (e) { throw new LangfuseError(`Langfuse at ${cfg.baseUrl} failed on ${path}: ${(e as Error).message}`); }
  });
}

export const traces = (cfg: LangfuseConfig, query: Record<string, string>, source?: string) => getAll(cfg, "/api/public/traces", query, source);
export const observations = (cfg: LangfuseConfig, traceId: string) => getAll(cfg, "/api/public/observations", { traceId });
