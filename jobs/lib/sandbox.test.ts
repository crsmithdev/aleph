import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { makeRunFolder, runPath } from "./sandbox.ts";

const base = mkdtempSync(join(tmpdir(), "aleph-sandbox-"));
process.env.ALEPH_RUNS_DIR = join(base, "runs");
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
  } finally { process.env.HOME = old.HOME; process.env.PATH = old.PATH; }
});
