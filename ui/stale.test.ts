import { expect, test, afterEach, beforeEach, setSystemTime } from "bun:test";
import { staleAsync, staleSync } from "./stale.ts";

// The clock is the test's: only this moves it, so a loaded machine cannot pass a TTL. A zero-delay task lets a background reload finish.
let clock = 0;
const pass = async (ms: number) => { clock += ms; setSystemTime(new Date(clock)); await new Promise((r) => setTimeout(r, 0)); };
beforeEach(() => { clock = Date.UTC(2026, 10, 1); setSystemTime(new Date(clock)); });
afterEach(() => setSystemTime());

test("staleAsync: the first read waits, a stale read answers the old value and runs one reload", async () => {
  const c = staleAsync<number>();
  let loads = 0;
  let finish = () => {};
  const load = async () => { const n = ++loads; if (n > 1) await new Promise<void>((r) => { finish = r; }); return n; };
  expect(await c.get("k", 50, load)).toBe(1);
  expect(await c.get("k", 50, load)).toBe(1);
  await pass(60);
  expect(await c.get("k", 50, load)).toBe(1);
  expect(await c.get("k", 50, load)).toBe(1);
  expect(loads).toBe(2); // One reload, still running under both reads.
  finish();
  await pass(0);
  expect(await c.get("k", 50, load)).toBe(2);
});

test("staleAsync: a failed first load is not kept; a failed reload keeps the old value", async () => {
  const c = staleAsync<number>();
  let fail = true;
  const load = async () => { if (fail) throw new Error("down"); return 7; };
  await expect(c.get("k", 10, load)).rejects.toThrow("down");
  fail = false;
  expect(await c.get("k", 10, load)).toBe(7);
  fail = true;
  await pass(20);
  expect(await c.get("k", 10, load)).toBe(7);
  await pass(5);
  expect(await c.get("k", 10, load)).toBe(7);
});

test("staleSync: a stale read answers the old value and reloads after the current task", async () => {
  const c = staleSync<number>();
  let loads = 0;
  const load = () => ++loads;
  expect(c.get("k", 10, load)).toBe(1);
  await pass(20);
  expect(c.get("k", 10, load)).toBe(1);
  expect(loads).toBe(1);
  await pass(5);
  expect(loads).toBe(2);
  expect(c.get("k", 10, load)).toBe(2);
});

test("a TTL of 0 loads every time", async () => {
  let n = 0;
  expect(staleSync<number>().get("k", 0, () => ++n)).toBe(1);
  expect(await staleAsync<number>().get("k", 0, async () => ++n)).toBe(2);
});

test("staleAsync: an idle key and the oldest key past the bound leave the cache; a recent key stays", async () => {
  const c = staleAsync<number>(2, 100);
  const loads: Record<string, number> = {};
  const get = (k: string) => c.get(k, 1e9, async () => (loads[k] = (loads[k] ?? 0) + 1));
  await get("a"); await pass(10);
  await get("b"); await pass(10);
  await get("a"); await pass(10); // "a" is now the most recent read.
  await get("c"); // Past the bound of 2: "b" leaves.
  await get("a");
  expect(loads).toEqual({ a: 1, b: 1, c: 1 });
  await get("b");
  expect(loads.b).toBe(2);
  await pass(150); // Every key is idle now; "b" is still under the bound, so only the idle time evicts it.
  await get("b");
  expect(loads.b).toBe(3);
});

test("staleAsync: a value older than ten TTLs waits for a fresh load; a failed load drops it", async () => {
  const c = staleAsync<number>();
  let loads = 0;
  let fail = false;
  const load = async () => { if (fail) throw new Error("down"); return ++loads; };
  expect(await c.get("k", 10, load)).toBe(1);
  await pass(100);
  expect(await c.get("k", 10, load)).toBe(2);
  fail = true;
  await pass(100);
  await expect(c.get("k", 10, load)).rejects.toThrow("down");
  fail = false;
  expect(await c.get("k", 10, load)).toBe(3);
});

test("staleSync: a value older than ten TTLs waits for a fresh load; a failed load drops it", async () => {
  const c = staleSync<number>();
  let loads = 0;
  let fail = false;
  const load = () => { if (fail) throw new Error("down"); return ++loads; };
  expect(c.get("k", 10, load)).toBe(1);
  await pass(100);
  expect(c.get("k", 10, load)).toBe(2);
  fail = true;
  await pass(100);
  expect(() => c.get("k", 10, load)).toThrow("down");
  fail = false;
  expect(c.get("k", 10, load)).toBe(3);
});
