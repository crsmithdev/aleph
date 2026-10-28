import { expect, test } from "bun:test";
import { staleAsync, staleSync } from "./stale.ts";

test("staleAsync: the first read waits, a stale read answers the old value and runs one reload", async () => {
  const c = staleAsync<number>();
  let loads = 0;
  const load = async () => { await Bun.sleep(20); return ++loads; };
  expect(await c.get("k", 50, load)).toBe(1);
  expect(await c.get("k", 50, load)).toBe(1);
  await Bun.sleep(60);
  expect(await c.get("k", 50, load)).toBe(1);
  expect(await c.get("k", 50, load)).toBe(1);
  await Bun.sleep(40);
  expect(loads).toBe(2);
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
  await Bun.sleep(20);
  expect(await c.get("k", 10, load)).toBe(7);
  await Bun.sleep(5);
  expect(await c.get("k", 10, load)).toBe(7);
});

test("staleSync: a stale read answers the old value and reloads after the current task", async () => {
  const c = staleSync<number>();
  let loads = 0;
  const load = () => ++loads;
  expect(c.get("k", 10, load)).toBe(1);
  await Bun.sleep(20);
  expect(c.get("k", 10, load)).toBe(1);
  expect(loads).toBe(1);
  await Bun.sleep(5);
  expect(loads).toBe(2);
  expect(c.get("k", 10, load)).toBe(2);
});

test("a TTL of 0 loads every time", async () => {
  let n = 0;
  expect(staleSync<number>().get("k", 0, () => ++n)).toBe(1);
  expect(await staleAsync<number>().get("k", 0, async () => ++n)).toBe(2);
});
