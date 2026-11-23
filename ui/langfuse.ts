/** The UI's use of the Langfuse port (lib/langfuse.ts): a list read once per build pass, and the rows kept between passes. */
import { LangfuseError, type Langfuse, type Lists, type Observation, type ObservationQuery, type Rows, type TraceQuery } from "../lib/langfuse.ts";
import { once, passEnv } from "../lib/sources.ts";
import { readJsonOr, writeJson } from "../lib/json.ts";
import { errText } from "../lib/errtext.ts";
import { observationsStore } from "../jobs/lib/infra/settings.ts";

/** Every row of a list, read once per pass of the UI's builds (sources.ts); failures are not kept. */
export function list<K extends keyof Lists>(lf: Langfuse, kind: K, q: TraceQuery & ObservationQuery, source = "langfuse"): Promise<Rows<Lists[K]>> {
  return once(`${source}:${lf.base}:${kind}:${JSON.stringify(q)}`, [source], async () => {
    try { return await (lf[kind] as (q: TraceQuery & ObservationQuery, source: string) => Promise<Rows<Lists[K]>>)(q, source); }
    catch (e) { throw new LangfuseError(`Langfuse at ${lf.base} failed on ${kind}: ${(e as Error).message}`); }
  });
}

/**
 * The rows the build Worker keeps between passes, and on disk for each Langfuse base so that a restart keeps them.
 * A pass reads only the last `LAG` and the part of its window not read yet; each `HOUR` it reads the last two
 * hours, which takes in late writes; each `DAY` it reads all of the window again. A full 7-day read is 1,218
 * pages and a 30-day read is 2,000 (2026-11-10), too much for each 30 s poll.
 * `from` and `to` are the start and end of the rows read, `since` and `hour` the ends of the last full read and
 * last hourly one. `cut` is the oldest row of a read that stopped at the page limit: a window that starts before it is partial.
 */
const LAG = 10 * 60_000, HOUR = 3600_000, DAY = 24 * HOUR;
interface Kept { env: string; rows: Map<string, Observation>; from: number; to: number; since: number; hour: number; cut: number }
let kept: Kept | null = null;
let reads: Promise<unknown> = Promise.resolve();

const file = (base: string) => observationsStore().replace(/\.json$/, `.${base.replace(/\W+/g, "-")}.json`);
const load = (env: string, base: string): Kept | null => {
  const d = readJsonOr<any>(file(base), null);
  // v2: rows keep `metadata.error`, so a v1 file is read again in full.
  return d?.v === 2 ? { ...d, env, rows: new Map(d.rows.map((o: Observation) => [o.id, o])) } : null;
};

/** The observations of [from, to) of the `types`, as `slim` keeps them; inside a build pass, through the kept rows. Langfuse filters on one type per read. */
export async function recent(lf: Langfuse, from: number, to: number, types: string[], slim: (o: Observation) => Observation): Promise<{ rows: Observation[]; partial: boolean }> {
  const oldest = (rows: Observation[]) => rows.reduce((m, o) => Math.min(m, Date.parse(o.startTime ?? "") || Infinity), Infinity);
  // `cut` is the newest of the oldest rows of the types that stopped at the page limit.
  const read = async (a: number, b: number) => {
    const gots = await Promise.all(types.map(async (type) => {
      const got = await lf.observations({ from: new Date(a), to: new Date(b), type });
      return { rows: got.rows.map(slim), partial: got.partial };
    }));
    return { rows: gots.flatMap((g) => g.rows), partial: gots.some((g) => g.partial), cut: Math.max(-Infinity, ...gots.filter((g) => g.partial).map((g) => oldest(g.rows))) };
  };
  const env = passEnv();
  if (env === null) return read(from, to);
  // One read at a time: two windows of one pass would otherwise both change the kept rows.
  const run = reads.then(async () => {
    const old = kept?.env === env ? kept : load(env, lf.base);
    const full = !old || to - old.since > DAY;
    const hourly = !full && to - old.hour >= HOUR;
    const next: Kept = full ? { env, rows: new Map(), from, to, since: to, hour: to, cut: -Infinity } : { ...old, rows: new Map(old.rows), from: Math.min(old.from, from), to, hour: hourly ? to : old.hour };
    const ranges = full ? [[from, to]] : [[Math.min(old.to - LAG, hourly ? to - 2 * HOUR : Infinity), to], ...(from < old.from ? [[from, old.from]] : [])];
    // A failed read leaves the kept rows as they were, so the next pass reads from where they end.
    for (const got of await Promise.all(ranges.map(([a, b]) => read(a, b)))) {
      for (const o of got.rows) next.rows.set(o.id!, o);
      next.cut = Math.max(next.cut, got.cut);
    }
    kept = next;
    try { writeJson(file(lf.base), { v: 2, ...next, env: undefined, rows: [...next.rows.values()] }); }
    catch (e) { console.error(`activity: rows not saved: ${errText(e)}`); }
    return { rows: [...next.rows.values()].filter((o) => Date.parse(o.startTime ?? "") >= from), partial: from < next.cut };
  });
  reads = run.catch(() => {});
  return run;
}
