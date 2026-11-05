import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { waitFor } from "../tests/wait.ts";
import { aleph, base, diagnose, issueRuns, jobsDir, quiet, startScript, stateNow, setup, teardown, until as untilQuiet, seedItem } from "./cli.helpers";
import { drop, issueClose } from "./inproc";

beforeAll(setup);
afterAll(teardown);

describe("a factory run", () => {

  describe("dispatch", () => {
    let startLog: string, startCmd: string;
    const on = (extra: Record<string, string> = {}) => ({ ALEPH_DISPATCH: "on", ALEPH_START_CMD: startCmd, START_LOG: startLog, ...extra });
    const started = () => (existsSync(startLog) ? readFileSync(startLog, "utf8").trim().split("\n").filter(Boolean) : []);
    const gate = (n: string) => join(base, `gate-${n}`);
    const issue = async (n: string) =>
      seedItem("fac", `dispatch ${n}`, { kind: "goal" }, `ACTION: hold ${gate(n)}\n`.trim()) as number;
    const until = async (f: () => boolean) => { await waitFor(f, { timeout: 30_000, every: 100 }); expect(f()).toBe(true); };
    const settled = (id: number) => issueRuns(id).every((r) => stateNow(r).condition === "passed");
    const ids: number[] = [];
    beforeAll(() => {
      startLog = join(base, "start.log");
      startCmd = join(base, "start-cmd");
      startScript(startCmd, jobsDir);
    });
    // A run writes its passed state before its run-end dispatch: that dispatch may still start the next issue. Wait it out.
    beforeEach(async () => { await untilQuiet(() => quiet(startLog)); rmSync(startLog, { force: true }); });
    afterAll(async () => {
      for (const n of ["d", "e", "f"]) writeFileSync(gate(n), "");
      // The released holds finish their runs; wait for that, at most as long as the fixed wait it replaces.
      await waitFor(() => ids.every(settled), { timeout: 3000, every: 100 });
      for (const id of ids) {
        await drop(`fac-${id}`);
        await issueClose("fac", id, "drop", "test over");
      }
    });

    // Two `aleph dispatch` processes at once: the lock between processes is what these cases test.
    test("two dispatches at once start each issue once", async () => {
      const d = await issue("d");
      ids.push(d);
      const [x, y] = await Promise.all([aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "5" })), aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "5" }))]);
      expect(started().filter((n) => n === `fac-${d}`)).toHaveLength(1);
      expect([...x.json.started, ...y.json.started].filter((n: string) => n === `fac-${d}`)).toHaveLength(1);
      writeFileSync(gate("d"), "");
      await until(() => settled(d));
    }, 60_000);

    // flaky: tests/flaky.md#dispatch-once-cap-1
    test.skip("two dispatches at once with a live cap of 1 start only one issue", async () => {
      const e = await issue("e");
      const f = await issue("f");
      ids.push(e, f);
      const [x, y] = await Promise.all([aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "1" })), aleph(["dispatch"], on({ ALEPH_LIVE_CAP: "1" }))]);
      const why = () => diagnose(`x.json ${JSON.stringify(x.json)}\ny.json ${JSON.stringify(y.json)}`, [e, f], x, y);
      const startedBoth = [...new Set([...(x.json?.started ?? []), ...(y.json?.started ?? [])])];
      if (startedBoth.length !== 1) throw new Error(`started ${startedBoth.length}, not 1\n${why()}`);
      // A run is live while its pid is written and its exit is not.
      const live = [...issueRuns(e), ...issueRuns(f)].filter((r) => existsSync(join(jobsDir, r, "pid")) && !existsSync(join(jobsDir, r, "exit")));
      if (live.length !== 1) throw new Error(`live ${live.length}, not 1\n${why()}`);
      writeFileSync(gate("e"), "");
      writeFileSync(gate("f"), "");
      await until(() => settled(e) && settled(f));
    }, 60_000);

  });
});
