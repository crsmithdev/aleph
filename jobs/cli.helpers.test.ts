import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as helpers from "./cli.helpers";
import { base, env, jobsDir, startScript, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("startScript", () => {
  test("a pid folder left by an earlier run of the goal does not end the start", async () => {
    const stale = join(jobsDir, "20200101-000000-fac-stale-x");
    mkdirSync(stale, { recursive: true });
    writeFileSync(join(stale, "pid"), "1\n");
    const cmd = join(base, "start-cmd");
    startScript(cmd, jobsDir);
    // A bad repo key: the job quits at once and never writes a pid.
    const p = Bun.spawn([cmd, "no-such-repo", "stale", "t"], { env: env({ START_LOG: join(base, "start-log") }), stdin: new Blob(["Goal: x\n"]), stdout: "pipe", stderr: "pipe" });
    expect(await p.exited).not.toBe(0);
  });
});

describe("env", () => {
  test("ALEPH_VAULT is an empty directory under base, so no test touches the real vault", () => {
    const vault = env().ALEPH_VAULT;
    expect(vault.startsWith(base + "/")).toBe(true);
    expect(readdirSync(vault)).toEqual([]);
    // A test may still point its own run at another vault.
    expect(env({ ALEPH_VAULT: "/elsewhere" }).ALEPH_VAULT).toBe("/elsewhere");
  });
});

const alive = (pid: number) => { try { process.kill(pid, 0); return Bun.spawnSync(["sh", "-c", `grep -q '^State:.*Z' /proc/${pid}/status`]).exitCode !== 0; } catch { return false; } };
const old = (d: string) => { mkdirSync(d); const t = new Date(Date.now() - 3 * 3600_000); utimesSync(d, t, t); };

describe("teardown and setup cleanup", () => {
  test("teardown kills children that refer to base, also under timeout, and removes the folder", () => {
    const dir = helpers.base;
    // `sh -c 'sleep 300; :'` keeps sh alive with a sleep child that does not hold base itself.
    const a = Bun.spawn(["sh", "-c", "sleep 300; :", join(dir, "marker")]);
    const b = Bun.spawn(["timeout", "--kill-after=30", "300", "sh", "-c", "sleep 300; :", join(dir, "pass")]);
    const sleepers = () => helpers.referring(dir).filter((p) => readFileSync(`/proc/${p}/cmdline`, "utf8").startsWith("sleep"));
    for (let i = 0; i < 100 && sleepers().length < 2; i++) Bun.sleepSync(50);
    const kids = sleepers();
    expect(kids.length).toBe(2);
    expect(alive(a.pid) && alive(b.pid)).toBe(true);
    helpers.teardown();
    expect(existsSync(dir)).toBe(false);
    expect(alive(a.pid)).toBe(false);
    expect(alive(b.pid)).toBe(false);
    for (const k of kids) expect(alive(k)).toBe(false);
    expect(helpers.referring(dir)).toEqual([]);
    setup();
  });

  test("teardown removes the folder after a setup that failed before the servers started", () => {
    helpers.teardown();
    const path = process.env.PATH;
    let dir = "";
    process.env.PATH = "/nonexistent";
    try {
      expect(() => setup()).toThrow();
    } finally {
      process.env.PATH = path;
    }
    dir = helpers.base;
    expect(existsSync(dir)).toBe(true);
    // Servers from the first setup are stopped already; a failed setup left them unusable or unset.
    expect(() => helpers.teardown()).not.toThrow();
    expect(existsSync(dir)).toBe(false);
    setup();
  });

  test("setup removes old leftovers, keeps recent ones and old ones a live process refers to", () => {
    const stale = join(tmpdir(), `aleph-jobs-stale-${crypto.randomUUID()}`);
    const recent = join(tmpdir(), `aleph-jobs-recent-${crypto.randomUUID()}`);
    const held = join(tmpdir(), `aleph-jobs-held-${crypto.randomUUID()}`);
    old(stale); mkdirSync(recent); old(held);
    const p = Bun.spawn(["sh", "-c", "sleep 300; :", held]);
    try {
      for (let i = 0; i < 100 && helpers.referring(held).length < 2; i++) Bun.sleepSync(50);
      helpers.teardown();
      setup();
      expect(existsSync(stale)).toBe(false);
      expect(existsSync(recent)).toBe(true);
      expect(existsSync(held)).toBe(true);
      expect(alive(p.pid)).toBe(true);
    } finally {
      helpers.killReferring(held);
      p.kill(9);
      Bun.spawnSync(["rm", "-rf", recent, held]);
    }
  });
});
