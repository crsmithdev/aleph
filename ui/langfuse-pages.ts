/** One paged Langfuse fetch, shared by `activity` and the skills API. */
import type { LangfuseConfig } from "../lib/env.ts";

const PAGE = 100, POOL = 4, MAX_PAGES = 2000;

/**
 * Every row of a paged Langfuse list: page 1 says how many pages there are, the rest are fetched
 * `POOL` at a time, each page tried twice. All pages at once overloaded Langfuse and a full week
 * timed out. A page that fails twice waits for the other requests to end, then throws: no request
 * outlives its caller. `partial` says the list held more pages than `MAX_PAGES`; `pages` is how many were read.
 */
export async function allPages<T = any>(cfg: LangfuseConfig, path: string, params: Record<string, string>, timeout: number): Promise<{ rows: T[]; partial: boolean; pages: number }> {
  const auth = Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64");
  const get = async (n: number) => {
    const res = await fetch(`${cfg.baseUrl}${path}?${new URLSearchParams({ ...params, limit: String(PAGE), page: String(n) })}`, { headers: { authorization: `Basic ${auth}` }, signal: AbortSignal.timeout(timeout) });
    if (!res.ok) throw new Error(`${res.status} on ${path}`);
    return res.json();
  };
  const page = (n: number) => get(n).catch(() => get(n));
  const first = await page(1);
  const total = first.meta ? Number(first.meta.totalPages) || 1 : 1;
  const pages = Math.min(total, MAX_PAGES);
  const rest: any[][] = [];
  let next = 2, failed = false;
  const worker = async () => {
    try { for (let n = next++; n <= pages && !failed; n = next++) rest[n - 2] = (await page(n)).data ?? []; }
    catch (e) { failed = true; throw e; }
  };
  const done = await Promise.allSettled(Array.from({ length: Math.min(POOL, pages - 1) }, worker));
  const bad = done.find((r): r is PromiseRejectedResult => r.status === "rejected");
  if (bad) throw bad.reason;
  return { rows: [first.data ?? [], ...rest].flat(), partial: total > pages, pages };
}
