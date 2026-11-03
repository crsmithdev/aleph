// Archived goal tests from jobs/lib/launch.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { detached, passEnv } from "../../../jobs/lib/launch.ts";

test("a unit gets every ALEPH_ and SIDETONE_ variable, and nothing else", () => {
  expect(passEnv({ ALEPH_A: "1", SIDETONE_B: "x y", HOME: "/h", PATH: "/p" })).toEqual(["--setenv=ALEPH_A=1", "--setenv=SIDETONE_B=x y"]);
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

test("detached does not throw when systemd-run fails", async () => {
  await withFakeSystemdRun(1, (dir) => {
    expect(() => detached(["plan", "aleph-1"], join(dir, "logs", "plan.log"))).not.toThrow();
  });
});
