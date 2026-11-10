/**
 * The one port for Langfuse reads: traces, a trace, observations and a session. `http` reads Langfuse's public API
 * with the keys of `langfuseConfig`; `memory` holds a test's rows. `langfuse()` gives the one in use.
 */
import { langfuseConfig, type LangfuseConfig } from "./env.ts";
import { touch } from "./sources.ts";

export class LangfuseError extends Error {
  constructor(message: string, readonly status = 502) { super(message); }
}

/** A time span: `from` inclusive, `to` exclusive, as Langfuse reads them. */
export interface Span { from?: Date; to?: Date }
/** `core` leaves out each trace's input and output. */
export interface TraceQuery extends Span { session?: string; core?: boolean }
export interface ObservationQuery extends Span { trace?: string; type?: string }
/** Every row of a list; `partial` says the list held more pages than a read takes, `pages` is how many were read. */
export interface Rows { rows: any[]; partial: boolean; pages: number }

/** Reads of one Langfuse. `source` is the source a read counts as (sources.ts). */
export interface Langfuse {
  base: string;
  traces(q: TraceQuery, source?: string): Promise<Rows>;
  observations(q: ObservationQuery, source?: string): Promise<Rows>;
  /** The trace with its observations, or null when Langfuse does not have it. */
  trace(id: string): Promise<any | null>;
  /** True when Langfuse knows the session; false when it does not or does not answer. */
  session(id: string): Promise<boolean>;
}

const TIMEOUT = 30_000;
const iso = (d?: Date) => d?.toISOString();
const params = (q: Record<string, string | undefined>) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as Record<string, string>;

/** The authorization header for Langfuse's API. */
export const auth = (cfg: LangfuseConfig): string => `Basic ${Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64")}`;

/** The Langfuse public API at `cfg.baseUrl`, every page of a list through `allPages`. */
export function http(cfg: LangfuseConfig): Langfuse {
  const headers = { authorization: auth(cfg) };
  return {
    base: cfg.baseUrl,
    traces: (q, source) => allPages(cfg, "/api/public/traces", params({ fromTimestamp: iso(q.from), toTimestamp: iso(q.to), sessionId: q.session, fields: q.core ? "core" : undefined }), source),
    observations: (q, source) => allPages(cfg, "/api/public/observations", params({ fromStartTime: iso(q.from), toStartTime: iso(q.to), traceId: q.trace, type: q.type }), source),
    trace: async (id) => {
      const path = `/api/public/traces/${encodeURIComponent(id)}`;
      const res = await fetch(`${cfg.baseUrl}${path}`, { headers, signal: AbortSignal.timeout(TIMEOUT) });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`${res.status} on ${path}`);
      return res.json();
    },
    session: (id) => fetch(`${cfg.baseUrl}/api/public/sessions/${encodeURIComponent(id)}`, { headers, signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false),
  };
}

/** A Langfuse that holds `rows`, for tests. `asked` lists each list read; a set `down` fails each one. */
export function memory(rows: { traces: any[]; observations: any[] }) {
  const asked: { list: string; q: Span }[] = [];
  const within = (at: string | undefined, q: Span) => { const t = Date.parse(at ?? ""); return (!q.from || t >= q.from.getTime()) && (!q.to || t < q.to.getTime()); };
  const read = async (list: string, q: Span, keep: (r: any) => boolean): Promise<Rows> => {
    asked.push({ list, q });
    if (lf.down) throw lf.down;
    return { rows: (rows as any)[list].filter(keep), partial: false, pages: 1 };
  };
  const lf = {
    base: "http://langfuse.test", asked, down: null as Error | null,
    traces: (q: TraceQuery) => read("traces", q, (t) => within(t.timestamp, q) && (!q.session || t.sessionId === q.session)),
    observations: (q: ObservationQuery) => read("observations", q, (o) => within(o.startTime, q) && (!q.trace || o.traceId === q.trace) && (!q.type || o.type === q.type)),
    trace: async (id: string) => {
      const t = rows.traces.find((t) => t.id === id);
      return t ? { ...t, observations: rows.observations.filter((o) => o.traceId === id) } : null;
    },
    session: async (id: string) => rows.traces.some((t) => t.sessionId === id),
  };
  return lf;
}

let fake: Langfuse | null = null;
/** Makes `langfuse()` give `lf`, for a test; null gives the configured one again. */
export const use = (lf: Langfuse | null) => { fake = lf; };

/** The Langfuse in use, or null when its keys are missing. */
export function langfuse(): Langfuse | null {
  if (fake) return fake;
  const cfg = langfuseConfig();
  return cfg && http(cfg);
}

/** The Langfuse in use; it throws a LangfuseError when its keys are missing. */
export function need(): Langfuse {
  const lf = langfuse();
  if (!lf) throw new LangfuseError("Langfuse is not configured: LANGFUSE_PUBLIC_KEY and LANGFUSE_SECRET_KEY are missing");
  return lf;
}

const PAGE = 100, POOL = 4, MAX_PAGES = 2000;

/**
 * Every row of a paged Langfuse list: page 1 says how many pages there are, the rest are fetched
 * `POOL` at a time, each page tried twice. All pages at once overloaded Langfuse and a full week
 * timed out. A page that fails twice waits for the other requests to end, then throws: no request
 * outlives its caller. `partial` says the list held more pages than `MAX_PAGES`; `pages` is how many were read.
 * `source` is the source the read counts as (sources.ts): the usage fit's read is renewed with the usage, not by the Langfuse poll.
 */
async function allPages(cfg: LangfuseConfig, path: string, params: Record<string, string>, source = "langfuse"): Promise<Rows> {
  touch(source);
  const get = async (n: number) => {
    const res = await fetch(`${cfg.baseUrl}${path}?${new URLSearchParams({ ...params, limit: String(PAGE), page: String(n) })}`, { headers: { authorization: auth(cfg) }, signal: AbortSignal.timeout(TIMEOUT) });
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
