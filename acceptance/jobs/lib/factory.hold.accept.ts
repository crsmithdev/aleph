// Archived goal tests from jobs/lib/factory.hold.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, setup, teardown, seedItem } from "../../../jobs/cli.helpers";
import { dispatch, drop, issueClose } from "../../../jobs/inproc.ts";
import { reportText, tick } from "../../../jobs/lib/flow.testkit.ts";

// The dispatches and ticks run in-process, as `aleph dispatch` and `aleph tick` run them; each run's unit is a process of its own.
// setup spawns openssl and git, so it can outlast the 5 s bun default; bun run test uses 30 s.
beforeAll(setup, 30_000);
afterAll(teardown);

describe("a factory run", () => {
  test("a stuck job holds only its own goal: the next goal starts beside it", async () => {
    // The safe default actions would clear or release the run; without them it stays stuck.
    process.env.ALEPH_RESCUE = "off";
    try {
      // Its ticks run the nightly probe unless a fresh passing one is on file; alone, none is.
      mkdirSync(join(base, "factory"), { recursive: true });
      writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
      const stuckId = seedItem("fac", "the stuck one", { kind: "goal" }, "ACTION: error\n".trim());
      expect((await tick()).started).toEqual([`fac-${stuckId}`]);
      const id = seedItem("fac", "beside the stuck one", { kind: "goal" }, "ACTION: commit beside.txt\n".trim());
      const d = (await dispatch()).json;
      expect(d.started).toEqual([`fac-${id}`]);
      expect(d.skipped.some((l: string) => l.startsWith(`fac-${stuckId}: its job is `))).toBe(true);
      expect(await reportText()).not.toContain("Held:");
      await drop(`fac-${stuckId}`);
      await issueClose("fac", stuckId, "drop", "test over");
      await drop(`fac-${id}`);
      await issueClose("fac", id, "drop", "test over");
    } finally {
      delete process.env.ALEPH_RESCUE;
    }
  }, 60_000);
});
