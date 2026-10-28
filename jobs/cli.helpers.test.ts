import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
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
