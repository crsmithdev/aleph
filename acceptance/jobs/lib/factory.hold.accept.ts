// Archived goal tests from jobs/lib/factory.hold.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { base, file, state, setup, teardown, seedItem } from "../../../jobs/cli.helpers";
import { dispatch, drop, issueClose, job, land } from "../../../jobs/inproc.ts";
import { pause, reportText, resume, tick } from "../../../jobs/lib/flow.testkit.ts";

// The dispatches and ticks run in-process, as `aleph dispatch` and `aleph tick` run them; each run's unit is a process of its own.
// setup spawns openssl and git, so it can outlast the 5 s bun default; bun run test uses 30 s.
beforeAll(setup, 30_000);
afterAll(teardown);

describe("a factory run", () => {
  const fjob = (name: string, action: string, o: { land?: boolean } = {}) => job("fac", name, `Goal: ${name}\nACTION: ${action}\n`, o);
  test("a stuck job holds the factory: no start, no land by itself; Chris's land works; pause is separate; a drop clears it", async () => {
    // The hold is what this test is about: the safe default actions would clear or release the run.
    process.env.ALEPH_RESCUE = "off";
    try {
      // Its ticks run the nightly probe unless a fresh passing one is on file; alone, none is.
      mkdirSync(join(base, "factory"), { recursive: true });
      writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
      const stuckId = seedItem("fac", "the stuck one", { kind: "goal" }, "ACTION: error\n".trim());
      expect((await tick()).started).toEqual([`fac-${stuckId}`]);
      const id = seedItem("fac", "behind the hold", { kind: "goal" }, "ACTION: commit behind.txt\n".trim());
      const d = (await dispatch()).json;
      expect(d.started).toEqual([]);
      expect(d.held).toContain(`Held: fac-${stuckId} is stuck`);
      expect(d.skipped).toEqual([d.held]);
      expect((await tick()).held).toContain(`fac-${stuckId}`);
      expect(await reportText()).toContain(`Held: fac-${stuckId} is stuck`);
      // a run that passes waits, and lands once the hold clears
      const r = await fjob("fheld", "commit fheld.txt", { land: true });
      expect(state(r.json.run).condition).toBe("passed");
      expect(file(r.json.run, "next.log")).toContain("held:");
      expect((await dispatch()).json.landed).toBeUndefined();
      expect(state(r.json.run).condition).toBe("passed");
      // pause and the hold are independent
      await pause();
      await resume();
      expect((await dispatch()).json.held).toContain(`fac-${stuckId}`);
      // Chris's land still works while held
      const other2 = await fjob("fheld2", "commit fheld2.txt");
      expect(state((await land("fheld2")).json.run).condition).toBe("landed");
      expect(other2.code).toBe(0);
      await drop(`fac-${stuckId}`);
      await issueClose("fac", stuckId, "drop", "test over");
      await pause();
      expect((await dispatch()).json).toMatchObject({ paused: true });
      await resume();
      const free = (await dispatch()).json;
      expect(free.held).toBeUndefined();
      expect(free.landed).toEqual(["fheld"]);
      expect(free.started).toEqual([`fac-${id}`]);
      await drop(`fac-${id}`);
      await issueClose("fac", id, "drop", "test over");
    } finally {
      delete process.env.ALEPH_RESCUE;
    }
  }, 60_000);
});
