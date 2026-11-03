// Archived goal tests from jobs/lib/sandbox.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeRunFolder, runPath, sandboxed } from "../../../jobs/lib/sandbox.ts";

const base = mkdtempSync(join(tmpdir(), "aleph-sandbox-"));
process.env.ALEPH_SANDBOX_DIR = join(base, "runs");
afterAll(() => rmSync(base, { recursive: true, force: true }));

test("a run folder's Claude Code settings keep auto memory off", () => {
  const dir = makeRunFolder("r1");
  const settings = JSON.parse(readFileSync(join(dir, "home/.claude/settings.json"), "utf8"));
  expect(settings.autoMemoryEnabled).toBe(false);
});

test("runPath adds ~/.local/bin and the bun directory at the end, once", () => {
  const home = join(base, "home1");
  const old = process.env.HOME;
  process.env.HOME = home;
  try {
    const p = runPath({ PATH: "/usr/bin:/bin" });
    expect(p.startsWith("/usr/bin:/bin:")).toBe(true);
    expect(p.split(":")).toContain(join(home, ".local/bin"));
    expect(p.endsWith(dirname(process.execPath)) || p.split(":").includes(dirname(process.execPath))).toBe(true);
    expect(runPath({ PATH: p })).toBe(p);
  } finally { process.env.HOME = old; }
});

test("makeRunFolder finds claude in ~/.local/bin when PATH lacks it", () => {
  const home = join(base, "home2");
  const bin = join(home, ".local/bin");
  mkdirSync(bin, { recursive: true });
  writeFileSync(join(bin, "claude"), "#!/bin/sh\n");
  chmodSync(join(bin, "claude"), 0o755);
  const old = { HOME: process.env.HOME, PATH: process.env.PATH };
  process.env.HOME = home;
  process.env.PATH = "/usr/bin:/bin";
  try {
    const dir = makeRunFolder("r2");
    expect(realpathSync(join(dir, "bin/claude"))).toBe(realpathSync(join(bin, "claude")));
    // git too: a step's own server (ui/server.ts) spawns it.
    expect(realpathSync(join(dir, "bin/git"))).toBe(realpathSync(Bun.which("git", { PATH: "/usr/bin:/bin" })!));
  } finally { process.env.HOME = old.HOME; process.env.PATH = old.PATH; }
});

test("makeRunFolder writes an executable bin/aleph-shot", () => {
  const dir = makeRunFolder("r-shot");
  expect(statSync(join(dir, "bin/aleph-shot")).mode & 0o111).toBe(0o111);
});

test("a check step gets TZ=UTC from its option and a worker step gets no TZ", async () => {
  const dir = makeRunFolder("r-tz");
  const old = { cmd: process.env.ALEPH_SANDBOX_CMD, tz: process.env.TZ };
  process.env.ALEPH_SANDBOX_CMD = "/usr/bin/env";
  process.env.TZ = "Asia/Tokyo";
  try {
    const run = async (name: string, env?: Record<string, string>) => {
      const f = join(dir, name);
      await sandboxed(dir, 'echo "tz=[$TZ]"', { read: [], write: ["tmp"], cwd: "work", env, stdout: f, stderr: f });
      return readFileSync(f, "utf8");
    };
    expect(await run("check.out", { TZ: "UTC" })).toContain("tz=[UTC]");
    expect(await run("worker.out")).toContain("tz=[]");
  } finally {
    if (old.cmd === undefined) delete process.env.ALEPH_SANDBOX_CMD; else process.env.ALEPH_SANDBOX_CMD = old.cmd;
    if (old.tz === undefined) delete process.env.TZ; else process.env.TZ = old.tz;
  }
});
