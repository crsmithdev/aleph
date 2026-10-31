import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { CLI, cliArgv, detached, passEnv, runCli } from "./launch.ts";

test("a unit gets every ALEPH_ and SIDETONE_ variable, and nothing else", () => {
  expect(passEnv({ ALEPH_A: "1", SIDETONE_B: "x y", HOME: "/h", PATH: "/p" })).toEqual(["--setenv=ALEPH_A=1", "--setenv=SIDETONE_B=x y"]);
});

test("the CLI is jobs/cli.ts under bun, or $ALEPH_CLI; runCli passes stdin and reads both streams and the code", async () => {
  const saved = process.env.ALEPH_CLI;
  const dir = mkdtempSync(join(tmpdir(), "aleph-launch-"));
  try {
    delete process.env.ALEPH_CLI;
    expect(cliArgv()).toEqual([process.execPath, CLI]);
    const fake = join(dir, "aleph");
    writeFileSync(fake, `#!/bin/sh\necho "$*"\ncat >&2\nexit 3\n`);
    chmodSync(fake, 0o755);
    process.env.ALEPH_CLI = fake;
    expect(await runCli(["land", "x"], { stdin: "in" })).toEqual({ code: 3, stdout: "land x\n", stderr: "in" });
  } finally {
    if (saved === undefined) delete process.env.ALEPH_CLI; else process.env.ALEPH_CLI = saved;
    rmSync(dir, { recursive: true, force: true });
  }
});

async function withFakeSystemdRun(exit: number, body: (dir: string, argvLog: string) => void | Promise<void>) {
  const savedPath = process.env.PATH, savedFg = process.env.ALEPH_JOB_FOREGROUND;
  const dir = mkdtempSync(join(tmpdir(), "aleph-launch-"));
  try {
    const argvLog = join(dir, "argv");
    writeFileSync(join(dir, "systemd-run"), `#!/bin/sh\necho "$@" >> ${argvLog}\nexit ${exit}\n`);
    chmodSync(join(dir, "systemd-run"), 0o755);
    process.env.PATH = `${dir}:${savedPath}`;
    delete process.env.ALEPH_JOB_FOREGROUND;
    await body(dir, argvLog);
  } finally {
    process.env.PATH = savedPath;
    if (savedFg === undefined) delete process.env.ALEPH_JOB_FOREGROUND; else process.env.ALEPH_JOB_FOREGROUND = savedFg;
    rmSync(dir, { recursive: true, force: true });
  }
}

test("detached starts its verb in a unit of its own, a different one per call", async () => {
  await withFakeSystemdRun(0, (dir, argvLog) => {
    const log = join(dir, "logs", "plan.log");
    detached(["plan", "aleph-1"], log);
    detached(["plan", "aleph-1"], log);
    const lines = readFileSync(argvLog, "utf8").trim().split("\n");
    expect(lines.length).toBe(2);
    const units = lines.map((l) => l.split(" ").find((a) => a.startsWith("--unit="))!);
    expect(units.every(Boolean)).toBe(true);
    expect(units[0]).not.toBe(units[1]);
    for (const l of lines) {
      expect(l.startsWith("--user ")).toBe(true);
      expect(l).toContain(`--working-directory=${dirname(log)}`);
      expect(l).toContain(`--property=StandardOutput=append:${log}`);
      expect(l).toContain(`--property=StandardError=append:${log}`);
      expect(l.endsWith(` ${process.execPath} ${CLI} plan aleph-1`)).toBe(true);
    }
  });
});

test("detached does not throw when systemd-run fails", async () => {
  await withFakeSystemdRun(1, (dir) => {
    expect(() => detached(["plan", "aleph-1"], join(dir, "logs", "plan.log"))).not.toThrow();
  });
});
