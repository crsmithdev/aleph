/**
 * The sources a UI build reads. Each path resolver (records, factory, events, store, registry, usage) and the
 * Langfuse client calls `touch` with its source, so the UI's build Worker learns what a key read; outside it
 * nothing reads `touched`. `once` shares one read between the builds of a pass: it keeps a value until one of
 * its sources changes, by the change counts the updater sends with each build. Outside a pass it is a plain call.
 */

/** The sources touched since the build Worker last cleared the set. */
export const touched = new Set<string>();
export const touch = (source: string): void => { touched.add(source); };

/** Each source's change count, from the updater; null outside a build. */
let gens: Record<string, number> | null = null;
const memo = new Map<string, { v: unknown; sources: string[]; at: number[] }>();
const fresh = (e: { sources: string[]; at: number[] }) => e.sources.every((s, i) => (gens![s] ?? 0) === e.at[i]);

/** Start a build with these change counts. `env` is the environment's fingerprint: a new one drops every kept read. */
let lastEnv = "";
export function openPass(counts: Record<string, number>, env: string): void {
  if (env !== lastEnv) memo.clear();
  lastEnv = env;
  gens = counts;
  for (const [k, e] of memo) if (!fresh(e)) memo.delete(k);
}
export const closePass = (): void => { gens = null; };

/** `fn()`, kept while none of `sources` changes; a rejected promise is not kept. */
export function once<T>(name: string, sources: string[], fn: () => T): T {
  sources.forEach(touch);
  if (!gens) return fn();
  const e = memo.get(name);
  if (e && fresh(e)) return e.v as T;
  const v = fn();
  memo.set(name, { v, sources, at: sources.map((s) => gens![s] ?? 0) });
  if (v instanceof Promise) v.catch(() => { if (memo.get(name)?.v === v) memo.delete(name); });
  return v;
}
