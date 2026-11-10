/** The UI's use of the Langfuse port (lib/langfuse.ts): a list read once per build pass, and the rows kept between passes. */
import { LangfuseError, type Langfuse, type ObservationQuery, type Rows, type TraceQuery } from "../lib/langfuse.ts";
import type { Observation } from "../lib/otlp.ts";
import { once, passEnv } from "../lib/sources.ts";

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
