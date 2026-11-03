// Archived goal tests from jobs/lib/launch.priority.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, setup, state, teardown } from "../../../jobs/cli.helpers";
import { actionJob, job, land as landJob } from "../../../jobs/inproc";

beforeAll(setup);
afterAll(teardown);

describe("run units get a low priority", () => {
  const argvLog = () => join(base, "systemd-run.log");
  const entries = () => readFileSync(argvLog(), "utf8").trim().split("\n").filter(Boolean);
  beforeAll(() => {
    mkdirSync(join(base, "fakebin"), { recursive: true });
    writeFileSync(join(base, "fakebin", "systemd-run"), `#!/bin/bash\necho "$@" >> ${argvLog()}\n`);
    chmodSync(join(base, "fakebin", "systemd-run"), 0o755);
    writeFileSync(argvLog(), "");
  });
  const viaSystemd = () => ({ ALEPH_JOB_FOREGROUND: "0", ALEPH_PID_WAIT_MS: "200", PATH: `${join(base, "fakebin")}:${process.env.PATH}` });

  test("the systemd-run argv of an agent run and of a land has CPUWeight=20 and --nice=10", async () => {
    await job("demo", "unitprio", "Goal: unitprio\nACTION: commit unitprio.txt\n", {}, viaSystemd());
    const agent = entries().find((e) => e.includes(" unit "))!;
    expect(agent).toContain("--property=CPUWeight=20");
    expect(agent).toContain("--nice=10");
    const r = await actionJob("landprio", "commit landprio.txt");
    expect(state(r.json.run).condition).toBe("passed");
    await landJob("landprio", {}, viaSystemd());
    const land = entries().find((e) => e.includes("-demo-landprio-land"))!;
    expect(land).toContain("--property=CPUWeight=20");
    expect(land).toContain("--nice=10");
  }, 60_000);
});
