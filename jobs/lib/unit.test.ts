import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSlot } from "./ledger.ts";
import { withSlot } from "./unit.ts";

// Slots are locks under $XDG_RUNTIME_DIR: keep this process's own, with one slot, so a held slot is seen at once.
let dir = "";
const saved = { XDG_RUNTIME_DIR: process.env.XDG_RUNTIME_DIR, ALEPH_CHECK_SLOTS: process.env.ALEPH_CHECK_SLOTS };
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "unit-slot-"));
  process.env.XDG_RUNTIME_DIR = dir;
  process.env.ALEPH_CHECK_SLOTS = "1";
});
afterAll(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  rmSync(dir, { recursive: true, force: true });
});

// Whether a slot can be taken within a moment: false while every slot is held.
const takeable = () => Promise.race([checkSlot().then((free) => { free(); return true; }), Bun.sleep(300).then(() => false)]);

test("a check whose exec throws frees its slot, and a second check takes it at once", async () => {
  await expect(withSlot(() => { throw new Error("exec failed"); })).rejects.toThrow("exec failed");
  expect(await takeable()).toBe(true);
  expect(await withSlot(() => "second")).toBe("second");
});

test("a rejected check frees its slot too", async () => {
  await expect(withSlot(() => Promise.reject(new Error("async failed")))).rejects.toThrow("async failed");
  expect(await takeable()).toBe(true);
});

test("while a check holds the slot, another waits for it", async () => {
  let release!: () => void;
  const held = withSlot(() => new Promise<void>((r) => { release = r; }));
  expect(await takeable()).toBe(false);
  release();
  await held;
  expect(await takeable()).toBe(true);
});
