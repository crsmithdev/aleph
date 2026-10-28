import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { aleph, base, diagnose, jobsDir, startScript, stateNow, setup, teardown } from "./cli.helpers";

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
    const settled = (id: number) => readdirSync(jobsDir).filter((r) => r.includes(`-fac-fac-${id}-`)).every((r) => stateNow(r).state === "passed");
    const ids: number[] = [];
    beforeAll(() => {
      startLog = join(base, "start.log");
      startCmd = join(base, "start-cmd");
      startScript(startCmd, jobsDir);
    });
    beforeEach(() => { rmSync(startLog, { force: true }); });
    afterAll(async () => {
      for (const n of ["d", "e", "f"]) writeFileSync(gate(n), "");
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

    test("two dispatches at once with a live cap of 1 start only one goal", async () => {
      const e = await goal("e");
      const f = await goal("f");
      ids.push(e, f);
      const [x, y] = await Promise.all([aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "1" })), aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "1" }))]);
      const why = () => diagnose(`x.json ${JSON.stringify(x.json)}\ny.json ${JSON.stringify(y.json)}`, [e, f], x, y);
      const startedBoth = [...new Set([...(x.json?.started ?? []), ...(y.json?.started ?? [])])];
      if (startedBoth.length !== 1) throw new Error(`started ${startedBoth.length}, not 1\n${why()}`);
      // A run is live while its pid is written and its exit is not.
      const live = readdirSync(jobsDir).filter((r) => [`-fac-fac-${e}-`, `-fac-fac-${f}-`].some((p) => r.includes(p)) && existsSync(join(jobsDir, r, "pid")) && !existsSync(join(jobsDir, r, "exit")));
      if (live.length !== 1) throw new Error(`live ${live.length}, not 1\n${why()}`);
      writeFileSync(gate("e"), "");
      writeFileSync(gate("f"), "");
      await until(() => settled(e) && settled(f));
    }, 60_000);

  });
});
