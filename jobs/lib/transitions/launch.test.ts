import { expect, spyOn, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { readEvents } from "../../../lib/layout.ts";
import { CLI, detached } from "./launch.ts";

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
    // Pin the clock: both calls land in the same millisecond, whatever the machine's speed.
    const now = spyOn(Date, "now").mockReturnValue(1793565319597);
    try {
      detached(["plan", "aleph-1"], log);
      detached(["plan", "aleph-1"], log);
    } finally {
      now.mockRestore();
    }
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

test("detached logs a failed systemd-run with its stderr", async () => {
  const savedDir = process.env.ALEPH_FACTORY_DIR;
  const fac = mkdtempSync(join(tmpdir(), "aleph-fac-"));
  process.env.ALEPH_FACTORY_DIR = fac;
  try {
    await withFakeSystemdRun(1, (dir) => {
      writeFileSync(join(dir, "systemd-run"), `#!/bin/sh\necho "no bus for you" >&2\nexit 1\n`);
      detached(["plan", "aleph-1"], join(dir, "logs", "plan.log"));
    });
    const ev = readEvents().find((e) => e.action === "failed" && e.note?.includes("systemd-run failed"));
    expect(ev?.note).toContain("no bus for you");
  } finally {
    if (savedDir === undefined) delete process.env.ALEPH_FACTORY_DIR; else process.env.ALEPH_FACTORY_DIR = savedDir;
    rmSync(fac, { recursive: true, force: true });
  }
});
