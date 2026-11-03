// Archived goal tests from jobs/lib/unit.worker.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { file, state, setup, teardown } from "../../../jobs/cli.helpers";
import { actionJob, drop } from "../../../jobs/inproc.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}) => actionJob(name, action, extra, "fac");

  test("a worker silent for ALEPH_STALL_SECONDS is stuck as stalled, with no fix round", async () => {
    const r = await fjob("fstall", "quiet", { ALEPH_STALL_SECONDS: "2" });
    expect(state(r.json.run)).toMatchObject({ condition: "stuck", reason: "stalled: no output for 2 seconds" });
    // The watch stopped the worker in its 30 s sleep: it never printed the line it prints after the sleep.
    expect(file(r.json.run, "output.log")).not.toContain("did quiet");
    await drop("fstall");
  }, 30_000);

  test("a worker that keeps printing is not stalled", async () => {
    const r = await fjob("fchat", "chatty", { ALEPH_STALL_SECONDS: "2" });
    expect(state(r.json.run).condition).not.toBe("stuck");
    await drop("fchat");
  }, 30_000);

  test("a worker that commits result.md and another file does not end with no commit", async () => {
    const r = await fjob("fresult2", "commit-result-and other.txt");
    expect(state(r.json.run).reason).not.toBe("no commit");
    await drop("fresult2");
  }, 60_000);
});
