/**
 * Caches that answer from the last value. A value older than its TTL is still
 * returned at once, and one reload runs in the background; only the first read
 * of a key waits. A value older than ten TTLs is dropped, so its read waits like
 * a first read. A failed load is not kept. A TTL of 0 turns the cache off.
 * With bounds, a key not read for `idleMs` leaves the async cache, and the oldest read goes first past `max` keys.
 * The UI server restarts on every land, so page switches would otherwise wait
 * on Langfuse and on the vault (on /mnt/c under WSL) again and again.
 */

interface Entry<T> { at: number; value?: { v: T }; loading?: Promise<T> }

export function staleAsync<T>(max = Infinity, idleMs = Infinity) {
  const map = new Map<string, Entry<T> & { seen: number }>(); // In order of last read, oldest first.
  const start = (key: string, e: Entry<T>, load: () => Promise<T>): Promise<T> => {
    const p = load().then((v) => { e.value = { v }; e.at = Date.now(); return v; });
    e.loading = p;
    // A failed first load drops its own entry only: after a clear, the key may hold a newer one.
    p.catch(() => { if (!e.value && map.get(key) === e) map.delete(key); }).finally(() => { if (e.loading === p) e.loading = undefined; });
    return p;
  };
  return {
    get(key: string, ttlMs: number, load: () => Promise<T>): Promise<T> {
      if (!ttlMs) return load();
      const now = Date.now();
      let e = map.get(key);
      map.delete(key);
      for (const [k, o] of map) if (now - o.seen > idleMs || map.size >= max) map.delete(k); else break;
      if (e && now - e.seen > idleMs) e = undefined;
      if (!e) e = { at: 0, seen: now };
      e.seen = now;
      map.set(key, e);
      if (now - e.at >= 10 * ttlMs) e.value = undefined;
      if (!e.value) return e.loading ?? start(key, e, load);
      if (Date.now() - e.at >= ttlMs && !e.loading) start(key, e, load).catch(() => {});
      return Promise.resolve(e.value.v);
    },
    clear: () => map.clear(),
  };
}

// The reloads of every staleSync, one per timer turn: the event loop serves other requests between two of them.
const queue: (() => void)[] = [];
const drain = () => { queue[0](); queue.shift(); if (queue.length) setTimeout(drain, 0); };

/** The same for a synchronous load: the reload runs after the current request has answered. */
export function staleSync<T>() {
  const map = new Map<string, Entry<T> & { queued?: boolean; old?: boolean }>();
  return {
    get(key: string, ttlMs: number, load: () => T): T {
      if (!ttlMs) return load();
      const e = map.get(key);
      if (!e?.value || Date.now() - e.at >= 10 * ttlMs) {
        map.delete(key);
        const v = load();
        map.set(key, { at: Date.now(), value: { v } });
        return v;
      }
      if ((e.old || Date.now() - e.at >= ttlMs) && !e.queued) {
        e.queued = true;
        const reload = () => {
          try { e.value = { v: load() }; e.at = Date.now(); } catch {}
          e.queued = e.old = false;
        };
        if (queue.push(reload) === 1) setTimeout(drain, 0);
      }
      return e.value.v;
    },
    /** Mark every kept value old: the next read of each answers it and reloads it after the current task. */
    stale: () => map.forEach((e) => { e.old = true; }),
    clear: () => map.clear(),
  };
}
