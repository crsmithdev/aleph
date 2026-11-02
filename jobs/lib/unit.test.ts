import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkSlot } from "./ledger.ts";
import { withSlot } from "./checks.ts";

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

test("setup git settings stop the .gitmodules read; a real git error still shows", async () => {
  const { mkdirSync, writeFileSync, chmodSync } = await import("node:fs");
  const { NO_SUBMODULES } = await import("./git.ts");
  const d = mkdtempSync(join(tmpdir(), "gm-"));
  try {
    mkdirSync(join(d, "src"));
    const run = (script: string) => Bun.spawnSync(["bash", "-c", script], { cwd: d, stderr: "pipe" }).stderr.toString();
    run("cd src && git init -q . && git -c user.name=a -c user.email=a@b commit -q --allow-empty -m x");
    writeFileSync(join(d, ".gitmodules"), "");
    chmodSync(join(d, ".gitmodules"), 0);
    const set = NO_SUBMODULES.join(" && ");
    expect(run(`git init -q . && ${set} && git fetch -q src HEAD:refs/heads/b`)).not.toContain(".gitmodules");
    expect(run(`${set} && git fetch -q src nosuchref`)).toContain("couldn't find remote ref");
  } finally { rmSync(d, { recursive: true, force: true }); }
});
