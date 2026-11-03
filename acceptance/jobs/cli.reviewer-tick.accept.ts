// Archived goal tests from jobs/cli.reviewer-tick.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, setup, teardown, seedItem } from "../../jobs/cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {

  test("caps.json sets the day cap, and ALEPH_DAY_CAP wins over it", async () => {
    const file = join(base, "factory", "caps.json");
    const own = { ALEPH_JOBS_DIR: join(base, "caps-jobs") };
    mkdirSync(own.ALEPH_JOBS_DIR);
    const ids: number[] = [];
    for (const n of [1, 2, 3]) ids.push(seedItem("fac", `caps goal ${n}`, { kind: "goal" }, "ACTION: error\n".trim()));
    mkdirSync(join(base, "factory"), { recursive: true });
    // A fresh passing probe, so the tick does not run the sandbox probe when this test runs alone.
    writeFileSync(join(base, "factory", "probe.json"), JSON.stringify({ at: new Date().toISOString(), ok: true, failed: [] }));
    writeFileSync(file, JSON.stringify({ day: 2 }));
    try {
      const t = await aleph(["tick"], { ...own, ALEPH_DAY_CAP: "" });
      expect(t.json.started.length).toBe(2);
      expect(t.json.skipped.some((x: string) => x.includes("cap of 2 runs in 24 hours"))).toBe(true);
      expect((await aleph(["report"], { ...own, ALEPH_DAY_CAP: "" })).stdout).toContain("of 2");
      // the two runs fail and hold the factory; drop them so the next tick can start one
      for (const job of t.json.started) await aleph(["drop", job], own);
      const wins = await aleph(["tick"], { ...own, ALEPH_DAY_CAP: "3" });
      expect(wins.json.started.length).toBe(1);
    } finally {
      rmSync(file, { force: true });
      for (const id of ids) await aleph(["issue", "drop", "fac", String(id), "test over"]);
    }
  }, 60_000);
});
