import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLI, cliArgv, passEnv, runCli } from "./launch.ts";

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
