import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, jobsDir, startScript, state, setup, teardown } from "./cli.helpers";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {

  describe("dispatch", () => {
    let startLog: string, startCmd: string;
    const on = (extra: Record<string, string> = {}) => ({ ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog, ...extra });
    const started = () => (existsSync(startLog) ? readFileSync(startLog, "utf8").trim().split("\n").filter(Boolean) : []);
    const gate = (n: string) => join(base, `gate-${n}`);
    const goal = async (n: string) =>
      (await aleph(["todo", "add", "fac", `dispatch ${n}`, "--labels", "goal", "--body", "-"], {}, `ACTION: hold ${gate(n)}\n`)).json.added as number;
    const until = async (f: () => boolean) => { for (let i = 0; i < 300 && !f(); i++) await Bun.sleep(100); expect(f()).toBe(true); };
    const settled = (id: number) => readdirSync(jobsDir).filter((r) => r.includes(`-fac-fac-${id}-`)).every((r) => state(r).state === "passed");
    const ids: number[] = [];
    beforeAll(() => {
      startLog = join(base, "start.log");
      startCmd = join(base, "start-cmd");
      startScript(startCmd, jobsDir);
    });
    beforeEach(() => { rmSync(startLog, { force: true }); });
    afterAll(async () => {
      for (const n of ["d"]) writeFileSync(gate(n), "");
      // The released holds finish their runs; wait for that, at most as long as the fixed wait it replaces.
      for (let i = 0; i < 30 && !ids.every(settled); i++) await Bun.sleep(100);
      for (const id of ids) {
        await aleph(["drop", `fac-${id}`]);
        await aleph(["todo", "drop", "fac", String(id), "test over"]);
      }
    });

    test("two dispatches at once start each goal once", async () => {
      const d = await goal("d");
      ids.push(d);
      const [x, y] = await Promise.all([aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "5" })), aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "5" }))]);
      expect(started().filter((n) => n === `fac-${d}`)).toHaveLength(1);
      expect([...x.json.started, ...y.json.started].filter((n: string) => n === `fac-${d}`)).toHaveLength(1);
      writeFileSync(gate("d"), "");
      await until(() => settled(d));
    }, 60_000);

  });
});
