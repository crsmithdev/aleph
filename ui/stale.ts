/**
 * Caches that answer from the last value. A value older than its TTL is still
 * returned at once, and one reload runs in the background; only the first read
 * of a key waits. A failed load is not kept. A TTL of 0 turns the cache off.
 * The UI server restarts on every land, so page switches would otherwise wait
 * on Langfuse and on the vault (on /mnt/c under WSL) again and again.
 */

interface Entry<T> { at: number; value?: { v: T }; loading?: Promise<T> }

export function staleAsync<T>() {
  const map = new Map<string, Entry<T>>();
  const start = (key: string, e: Entry<T>, load: () => Promise<T>): Promise<T> => {
    const p = load().then((v) => { e.value = { v }; e.at = Date.now(); return v; });
    e.loading = p;
    p.catch(() => { if (!e.value) map.delete(key); }).finally(() => { if (e.loading === p) e.loading = undefined; });
    return p;
  };
  return {
    get(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
      if (!ttlMs) return load();
      let e = map.get(key);
      if (!e) { e = { at: 0 }; map.set(key, e); }
      if (!e.value) return e.loading ?? start(key, e, load);
      if (Date.now() - e.at >= ttlMs && !e.loading) start(key, e, load).catch(() => {});
      return Promise.resolve(e.value.v);
    },
    clear: () => map.clear(),
  };
}

/** The same for a synchronous load: the reload runs after the current request has answered. */
export function staleSync<T>() {
  const map = new Map<string, Entry<T> & { queued?: boolean }>();
  return {
    get(key: string, ttlMs: number, load: () => T): T {
      if (!ttlMs) return load();
      const e = map.get(key);
      if (!e?.value) {
        const v = load();
        map.set(key, { at: Date.now(), value: { v } });
        return v;
      }
      if (Date.now() - e.at >= ttlMs && !e.queued) {
        e.queued = true;
        setTimeout(() => {
          try { e.value = { v: load() }; e.at = Date.now(); } catch {}
          e.queued = false;
        }, 0);
      }
      return e.value.v;
    },
    clear: () => map.clear(),
  };
}
