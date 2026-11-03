import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { jobsDir, state, setup, teardown } from "../cli.helpers";
import { actionJob, drop } from "../inproc.ts";

// The runs start in-process, as `aleph job` starts them; each run's unit is a process of its own.
beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, extra: Record<string, string> = {}) => actionJob(name, action, extra, "fac");

  test("a worker that commits only result.md is stuck with no commit, and no check, review or land starts", async () => {
    const r = await fjob("fresult", "commit result.md", { ALEPH_FIX_ROUNDS: "0" });
    const s = state(r.json.run);
    expect(s).toMatchObject({ condition: "stuck", reason: "no commit" });
    expect(s.checks ?? []).toEqual([]);
    expect(s.review).toBeUndefined();
    expect(readdirSync(jobsDir).filter((d) => d.includes("-fac-fresult-")).map((d) => state(d).kind)).not.toContain("land");
    await drop("fresult");
  }, 30_000);
});
