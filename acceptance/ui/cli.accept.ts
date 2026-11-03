// Archived goal tests from ui/cli.test.ts: `bun run accept` runs them, `bun run test` does not.
import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { cliArgv, runCli } from "../../ui/cli.ts";

test("the CLI is jobs/cli.ts under bun, or $ALEPH_CLI; runCli passes stdin and reads both streams and the code", async () => {
  const saved = process.env.ALEPH_CLI;
  const dir = mkdtempSync(join(tmpdir(), "aleph-cli-"));
  try {
    delete process.env.ALEPH_CLI;
    expect(cliArgv()).toEqual([process.execPath, join(join(import.meta.dir, "../../ui"), "..", "jobs", "cli.ts")]);
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
