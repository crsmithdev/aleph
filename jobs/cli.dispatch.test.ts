import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, jobsDir, startScript, stateNow, setup, teardown, seedItem } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {

  describe("dispatch", () => {
    let startLog: string, startCmd: string;
    const on = (extra: Record<string, string> = {}) => ({ ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog, ...extra });
    const started = () => (existsSync(startLog) ? readFileSync(startLog, "utf8").trim().split("\n").filter(Boolean) : []);
    const gate = (n: string) => join(base, `gate-${n}`);
    const goal = async (n: string) =>
      seedItem("fac", `dispatch ${n}`, { labels: ["goal"] }, `ACTION: hold ${gate(n)}\n`.trim()) as number;
    const until = async (f: () => boolean) => { for (let i = 0; i < 300 && !f(); i++) await Bun.sleep(100); expect(f()).toBe(true); };
    const settled = (id: number) => readdirSync(jobsDir).filter((r) => r.includes(`-fac-fac-${id}-`)).every((r) => stateNow(r).state === "passed");
    const ids: number[] = [];
    beforeAll(() => {
      startLog = join(base, "start.log");
      startCmd = join(base, "start-cmd");
      startScript(startCmd, jobsDir);
    });
    beforeEach(() => { rmSync(startLog, { force: true }); });
    afterAll(async () => {
      for (const n of ["a", "b", "c"]) writeFileSync(gate(n), "");
      // The released holds finish their runs; wait for that, at most as long as the fixed wait it replaces.
      for (let i = 0; i < 30 && !ids.every(settled); i++) await Bun.sleep(100);
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

  });
});
