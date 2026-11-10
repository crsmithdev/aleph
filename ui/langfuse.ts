/**
 * The one port for the UI's Langfuse reads: traces, observations and a session. `http` reads Langfuse's public API
 * with the keys of `langfuseConfig`; `memory` holds a test's rows. `langfuse()` gives the one in use.
 */
import { langfuseConfig, type LangfuseConfig } from "../lib/env.ts";
import type { Observation } from "../lib/otlp.ts";
import { once, passEnv } from "../jobs/lib/infra/sources.ts";
import { allPages } from "./langfuse-pages.ts";

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
  /** True when Langfuse knows the session; false when it does not or does not answer. */
  session(id: string): Promise<boolean>;
}

const TIMEOUT = 30_000;
const iso = (d?: Date) => d?.toISOString();
const params = (q: Record<string, string | undefined>) => Object.fromEntries(Object.entries(q).filter(([, v]) => v !== undefined)) as Record<string, string>;

/** The Langfuse public API at `cfg.baseUrl`, every page of a list through `allPages`. */
export function http(cfg: LangfuseConfig): Langfuse {
  const auth = `Basic ${Buffer.from(`${cfg.publicKey}:${cfg.secretKey}`).toString("base64")}`;
  return {
    base: cfg.baseUrl,
    traces: (q, source) => allPages(cfg, "/api/public/traces", params({ fromTimestamp: iso(q.from), toTimestamp: iso(q.to), sessionId: q.session, fields: q.core ? "core" : undefined }), TIMEOUT, source),
    observations: (q, source) => allPages(cfg, "/api/public/observations", params({ fromStartTime: iso(q.from), toStartTime: iso(q.to), traceId: q.trace, type: q.type }), TIMEOUT, source),
    session: (id) => fetch(`${cfg.baseUrl}/api/public/sessions/${encodeURIComponent(id)}`, { headers: { authorization: auth }, signal: AbortSignal.timeout(1500) }).then((r) => r.ok, () => false),
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

/** Every row of a list, read once per pass of the UI's builds (sources.ts); failures are not kept. */
export function list(lf: Langfuse, kind: "traces" | "observations", q: TraceQuery & ObservationQuery, source = "langfuse"): Promise<Rows> {
  return once(`${source}:${lf.base}:${kind}:${JSON.stringify(q)}`, [source], async () => {
    try { return await lf[kind](q, source); }
    catch (e) { throw new LangfuseError(`Langfuse at ${lf.base} failed on ${kind}: ${(e as Error).message}`); }
  });
}

/**
 * The rows the build Worker keeps between passes. A pass reads only the last `LAG` and the part of its window
 * not read yet; it reads all of it again each `FULL`, which takes in late writes older than `LAG`. A full
 * 7-day read is 1,218 pages and a 30-day read is 2,000 (2026-11-10), too much for each 30 s poll.
 * `cut` is the oldest row of a read that stopped at the page limit: a window that starts before it is partial.
 */
const LAG = 10 * 60_000, FULL = 3600_000;
let kept: { env: string; rows: Map<string, Observation>; from: number; to: number; since: number; cut: number } | null = null;
let reads: Promise<unknown> = Promise.resolve();

/** The observations of [from, to) as `slim` keeps them; inside a build pass, through the kept rows. */
export async function recent(lf: Langfuse, from: number, to: number, slim: (o: any) => Observation): Promise<{ rows: Observation[]; partial: boolean }> {
  const read = async (a: number) => {
    const got = await lf.observations({ from: new Date(a), to: new Date(to) });
    return { rows: got.rows.map(slim), partial: got.partial };
  };
  const env = passEnv();
  if (env === null) return read(from);
  // One read at a time: two windows of one pass would otherwise both reset the kept rows.
  const run = reads.then(async () => {
    if (!kept || kept.env !== env || to - kept.since > FULL || from < kept.from) kept = { env, rows: new Map(), from, to: from + LAG, since: to, cut: -Infinity };
    const k = kept, got = await read(Math.max(k.from, k.to - LAG));
    for (const o of got.rows) k.rows.set(o.id!, o);
    if (got.partial) k.cut = Math.max(k.cut, got.rows.reduce((m, o) => Math.min(m, Date.parse(o.startTime ?? "") || Infinity), Infinity));
    k.to = to;
    return { rows: [...k.rows.values()].filter((o) => Date.parse(o.startTime ?? "") >= from), partial: from < k.cut };
  });
  reads = run.catch(() => {});
  return run;
}
