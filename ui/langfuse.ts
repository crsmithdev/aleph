/** Langfuse reads for the Sessions views: one authenticated GET, reloaded at most every 30 s; an older answer is served while it reloads. */
import { langfuseConfig, type LangfuseConfig } from "../hooks/lib/env.ts";
import { staleAsync } from "./stale.ts";

export const CACHE_MS = 30_000;
const cache = staleAsync<unknown>();

export function clearCache(): void { cache.clear(); }

export class LangfuseError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

export function config(): LangfuseConfig {
  const cfg = langfuseConfig();
  if (!cfg) throw new LangfuseError("Langfuse is not configured: LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are missing");
  return cfg;
}

/** GET `path?query` on the public API; failures are not cached. */
export async function get(cfg: LangfuseConfig, path: string, query: Record<string, string>): Promise<any> {
  const url = `${cfg.baseUrl}${path}?${new URLSearchParams(query)}`;
  return cache.get(url, CACHE_MS, async () => {
    const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
    let res: Response;
    try { res = await fetch(url, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(15000) }); }
    catch (e) { throw new LangfuseError(`Langfuse is unreachable at ${cfg.baseUrl}: ${(e as Error).message}`); }
    if (!res.ok) throw new LangfuseError(`Langfuse answered ${res.status} on ${path}`);
    return res.json();
  });
}

/** Every row of a paged list endpoint. */
export async function getAll(cfg: LangfuseConfig, path: string, query: Record<string, string>): Promise<any[]> {
  const rows: any[] = [];
  for (let page = 1; page < 200; page++) {
    const body = await get(cfg, path, { ...query, limit: "100", page: String(page) });
    rows.push(...(body.data ?? []));
    if (!body.meta || page >= (body.meta.totalPages ?? 1)) break;
  }
  return rows;
}

export const traces = (cfg: LangfuseConfig, query: Record<string, string>) => getAll(cfg, "/api/public/traces", query);
export const observations = (cfg: LangfuseConfig, traceId: string) => getAll(cfg, "/api/public/observations", { traceId });
