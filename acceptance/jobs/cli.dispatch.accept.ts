// Archived goal tests from jobs/cli.dispatch.test.ts: `bun run accept` runs them, `bun run test` does not.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor } from "../../tests/wait.ts";
import { aleph, base, jobsDir, passed, quiet, startScript, setup, teardown, seedItem, patchItem, until } from "../../jobs/cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {

  describe("dispatch", () => {
    let startLog: string, startCmd: string;
    const on = (extra: Record<string, string> = {}) => ({ ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog, ...extra });
    const started = () => (existsSync(startLog) ? readFileSync(startLog, "utf8").trim().split("\n").filter(Boolean) : []);
    const gate = (n: string) => join(base, `gate-${n}`);
    const goal = async (n: string) =>
      seedItem("fac", `dispatch ${n}`, { kind: "goal" }, `ACTION: hold ${gate(n)}\n`.trim()) as number;
    const settled = (id: number) => passed(startLog, id);
    const ids: number[] = [];
    beforeAll(() => {
      startLog = join(base, "start.log");
      startCmd = join(base, "start-cmd");
      startScript(startCmd, jobsDir);
    });
    // A run writes its state before its run-end dispatch: the last test's dispatch may still start a goal of this one.
    beforeEach(async () => { await until(() => quiet(startLog)); rmSync(startLog, { force: true }); });
    afterAll(async () => {
      for (const n of ["a", "b", "c"]) writeFileSync(gate(n), "");
      // The released holds finish their runs; wait for that, at most as long as the fixed wait it replaces.
      await waitFor(() => ids.every(settled), { timeout: 3000, every: 100 });
      for (const id of ids) {
        await aleph(["drop", `fac-${id}`]);
        await aleph(["issue", "drop", "fac", String(id), "test over"]);
      }
    });

    test("starts ready goals up to the live cap, and the next when a run ends, with no tick", async () => {
      const a = await goal("a"), b = await goal("b"), c = await goal("c");
      ids.push(a, b, c);
      const d = await aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "2" }));
      expect(d.json.started).toEqual([`fac-${a}`, `fac-${b}`]);
      expect(d.json.skipped).toEqual([`fac-${c}: 2 agent runs are live`]);
      expect(started()).toEqual([`fac-${a}`, `fac-${b}`]);
      writeFileSync(gate("a"), "");
      await until(() => started().length === 3);
      expect(started()[2]).toBe(`fac-${c}`);
      writeFileSync(gate("b"), "");
      writeFileSync(gate("c"), "");
      await until(() => ids.every(settled));
    }, 60_000);

    test("a goal after an open goal is skipped, starts once that goal is done, and the issue closes once its goals are done (criterion 12)", async () => {
      const addGoal = async (title: string, ...more: string[]) =>
        (await aleph(["issue", "add", "fac", title, "--spec", "-", ...more], { ALEPH_DISPATCH: "off" }, `ACTION: hold ${gate("g")}\n`)).json.added as number;
      const m = await addGoal("first of the pair");
      const n = await addGoal("second of the pair", "--after", `fac-${m}`);
      ids.push(m, n);
      const d1 = await aleph(["dispatch"], on());
      expect(d1.json.started).toEqual([`fac-${m}`]);
      expect(d1.json.skipped).toContain(`fac-${n}: after fac-${m}`);
      writeFileSync(gate("g"), "");
      await until(() => settled(m));
      patchItem("fac", `${m}`, { status: "done" });
      // A run's end dispatches too, so this dispatch and that one share the work: what counts is the end state.
      await aleph(["dispatch"], on());
      await until(() => started().includes(`fac-${n}`));
      const status = async (id: number) => (await aleph(["issue", "show", "fac", String(id), "--json"])).json.status;
      // The first issue's goals are all done, so a dispatch closes it; the second's goal is only started.
      await until(() => settled(n));
      await aleph(["dispatch"], on());
      expect(await status(m)).toBe("done");
      expect(await status(n)).toBe("open");
      patchItem("fac", `${n}`, { status: "done" });
      const d3 = await aleph(["dispatch"], on());
      expect(d3.json.started).toEqual([]);
      expect(await status(n)).toBe("done");
      expect(started().filter((l) => l === `fac-${n}`)).toHaveLength(1);
    }, 60_000);

  });
});
