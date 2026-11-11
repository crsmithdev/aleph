/** The UI's use of the Langfuse port (lib/langfuse.ts): a list read once per build pass, and the rows kept between passes. */
import { LangfuseError, type Langfuse, type ObservationQuery, type Rows, type TraceQuery } from "../lib/langfuse.ts";
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
const kept = new Map<string, { env: string; rows: Map<string, any>; from: number; to: number; since: number; cut: number }>();
let reads: Promise<unknown> = Promise.resolve();

/** The observations or traces of [from, to) as `slim` keeps them; inside a build pass, through the kept rows. */
export async function recent<T extends { id?: string }>(lf: Langfuse, from: number, to: number, slim: (o: any) => T, kind: "traces" | "observations" = "observations"): Promise<{ rows: T[]; partial: boolean }> {
  const read = async (a: number) => {
    const got = await lf[kind]({ from: new Date(a), to: new Date(to) });
    return { rows: got.rows.map(slim), partial: got.partial };
  };
  const env = passEnv();
  if (env === null) return read(from);
  const at = (o: any) => Date.parse((kind === "traces" ? o.timestamp : o.startTime) ?? "");
  // One read at a time: two windows of one pass would otherwise both reset the kept rows.
  const run = reads.then(async () => {
    let k = kept.get(kind);
    if (!k || k.env !== env || to - k.since > FULL || from < k.from) kept.set(kind, k = { env, rows: new Map(), from, to: from + LAG, since: to, cut: -Infinity });
    const got = await read(Math.max(k.from, k.to - LAG));
    for (const o of got.rows) k.rows.set(o.id!, o);
    if (got.partial) k.cut = Math.max(k.cut, got.rows.reduce((m, o) => Math.min(m, at(o) || Infinity), Infinity));
    k.to = to;
    return { rows: [...k.rows.values()].filter((o) => at(o) >= from), partial: from < k.cut };
  });
  reads = run.catch(() => {});
  return run;
}
